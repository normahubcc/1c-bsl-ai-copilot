import { bslString, identifier, withoutComments } from './shared/bsl/text';
import { queryExecutable } from './entities/query/model/source';
import { ConfigurationMetadata } from './types';
import { parseFieldMapping, validateBatchSchema } from './entities/query/model/batchMapping';

/**
 * Local query templates, performance hints and conservative virtual-JOIN extraction.
 * 
 * Templates use the following query constructs; runtime validity depends on the supplied schema:
 * 1. Batch queries (ПАКЕТ ЗАПРОСОВ) with Temp Tables (ПОМЕСТИТЬ ВТ_...)
 * 2. Explicit indexing of temp tables (ИНДЕКСИРОВАТЬ ПО)
 * 3. Parameterized virtual tables without direct JOINs
 * 4. Proper ЕСТЬNULL handling on LEFT JOINs
 * 5. Temp table destruction (УНИЧТОЖИТЬ ВТ_...) to free DBMS memory
 * 6. BSL execution scaffolding with МенеджерВременныхТаблиц
 */

export interface QueryInspectionResult {
    /** Compatibility field: false for detected errors, null when syntax was not validated. */
    isValid: false | null;
    syntaxChecked: false;
    recognized: boolean;
    hasErrors: boolean;
    issues: QueryIssue[];
    optimizedQueryText?: string;
}

export interface QueryIssue {
    code: string;
    severity: 'error' | 'warning' | 'info';
    message: string;
    recommendation: string;
    line?: number;
}

export interface PackageQueryOptions {
    entityName: string; // e.g. "ЗаказКлиента" or "РеализацияТоваровУслуг"
    tabularSection: string; // e.g. "Товары"
    registerName: string; // e.g. "ТоварыНаСкладах"
    registerType?: 'Остатки' | 'Обороты' | 'СрезПоследних' | 'СрезПервых';
    fields: string[]; // e.g. ["Номенклатура", "Характеристика", "Количество"]
    includeScaffolding: boolean;
    sourceMode?: 'document' | 'table';
    metadata?: ConfigurationMetadata;
}

export interface QueryRefactorResult {
    refactoredQuery: string;
    appliedOptimizations: string[];
    reason?: string;
}

export class QueryBuilder {
    /**
     * Inspects 1C query text for performance anti-patterns according to ITS standards.
     */
    public static inspectQuery(queryText: string): QueryInspectionResult {
        const issues: QueryIssue[] = [];
        const original = withoutComments(queryText);
        queryText = queryExecutable(queryText);
        const result = (): QueryInspectionResult => ({ isValid: issues.some(i => i.severity === 'error') ? false : null,
            syntaxChecked: false, recognized: /^\s*(?:ВЫБРАТЬ|SELECT|УНИЧТОЖИТЬ)(?:\s|$)/i.test(queryText),
            hasErrors: issues.some(i => i.severity === 'error'), issues });
        const invalid = (message: string) => { issues.push({code:'QUERY-STRUCTURE',severity:'error',message,recommendation:'Исправьте текст и проверьте запрос в консоли запросов 1С.'}); return result(); };
        if (!original.trim()) return invalid('Нет текста запроса для проверки.');
        if (!result().recognized) return invalid('Ожидается текст запроса ВЫБРАТЬ. BSL-модуль проверяйте аудитом кода.');
        // These are structural guards, not a platform syntax validator.
        let depth = 0;
        for (const character of queryText) { if (character === '(') depth++; if (character === ')' && --depth < 0) return invalid('Несогласованные скобки в запросе.'); }
        if (depth !== 0) return invalid('Несогласованные скобки в запросе.');
        if (/(?:ВЫБРАТЬ|SELECT)\s*(?:(?:ИЗ|ПОМЕСТИТЬ|FROM|INTO)(?![\w\u0400-\u04FF])|;|$)/i.test(queryText) || /(?:^|\s)(?:ИЗ|СОЕДИНЕНИЕ|FROM|JOIN)\s*(?:(?:ГДЕ|КАК|ПО|WHERE|AS|ON)(?![\w\u0400-\u04FF])|;|$)/i.test(queryText)) return invalid('Не указаны поля выборки или источник данных.');
        const unquoted = original.replace(/"(?:""|[^"])*"|'(?:''|[^'])*'/g, '');
        if (/["']/.test(unquoted)) return invalid('Незакрытая строка в запросе.');

        // 1. Anti-pattern: Direct join with virtual table
        const directVirtualJoinRegex = /(ЛЕВОЕ|ПРАВОЕ|ВНУТРЕННЕЕ|ПОЛНОЕ)?\s+СОЕДИНЕНИЕ\s+Регистр(Накопления|Сведений|Бухгалтерии)\.[\w\u0400-\u04FF]+\.(Остатки|Обороты|СрезПоследних|СрезПервых)/i;
        if (directVirtualJoinRegex.test(queryText)) {
            issues.push({
                code: 'ITS-QUERY-001',
                severity: 'warning',
                message: 'Прямое соединение с виртуальной таблицей в запросе.',
                recommendation: 'Вынесите выборку из виртуальной таблицы в отдельную временную таблицу с фильтром по параметрам среза и соединяйте ее с основной таблицей.'
            });
        }

        // 2. Anti-pattern: Temp table without index in joins
        const tempTableMatches = queryText.matchAll(/ПОМЕСТИТЬ\s+(ВТ_[\w\u0400-\u04FF]+)/gi);
        for (const match of tempTableMatches) {
            const tableName = match[1];
            const statement = queryText.slice(0, match.index).split(';').pop() + queryText.slice(match.index).split(';')[0];
            const hasIndex = /ИНДЕКСИРОВАТЬ\s+ПО/i.test(statement);
            const isJoined = new RegExp(`СОЕДИНЕНИЕ\\s+${tableName}`, 'i').test(queryText) ||
                             new RegExp(`ИЗ\\s+${tableName}\\s+КАК.*СОЕДИНЕНИЕ`, 'i').test(queryText);
            
            if (isJoined && !hasIndex) {
                issues.push({
                    code: 'ITS-QUERY-002',
                    severity: 'warning',
                    message: `Временная таблица ${tableName} участвует в соединении, но не содержит инструкции ИНДЕКСИРОВАТЬ ПО.`,
                    recommendation: `Добавьте "ИНДЕКСИРОВАТЬ ПО ПолеСвязи" при помещении временной таблицы ${tableName} для ускорения планов выполнения СУБД.`
                });
            }
        }

        // 3. Anti-pattern: Virtual table without filtering parameters
        const unparameterizedVirtualRegex = /Регистр[\w\u0400-\u04FF]+\.[\w\u0400-\u04FF]+\.(Остатки|Обороты|СрезПоследних|СрезПервых)\s*\(\s*\)/gi;
        if (unparameterizedVirtualRegex.test(queryText)) {
            issues.push({
                code: 'ITS-QUERY-003',
                severity: 'warning',
                message: 'Обращение к виртуальной таблице без параметров фильтрации (в скобках пусто).',
                recommendation: 'Проверьте необходимость условий отбора в параметры виртуальной таблицы в скобках, чтобы фильтрация выполнялась на уровне СУБД до вычисления среза/остатков.'
            });
        }

        // NULL matters for arithmetic on the nullable side, not for every LEFT JOIN.
        const rawArithmetic = queryText.split(';').some(statement => {
            const aliases = [...statement.matchAll(/ЛЕВОЕ\s+СОЕДИНЕНИЕ\s+[^;]+?\s+КАК\s+([А-Яа-яЁёA-Za-z_][А-Яа-яЁёA-Za-z_0-9]*)\s+ПО/gi)].map(m => m[1]);
            const projections = statement.split(/(?:^|\s)ВЫБРАТЬ(?=\s)/i).slice(1).map(part => part.split(/\s+(?:ПОМЕСТИТЬ|ИЗ)(?=\s)/i)[0]);
            return aliases.some(alias => projections.some(projection => {
                const masked = projection.replace(/ЕСТЬNULL\s*\([^()]*\)/gi, '');
                const field = `${alias}\\.[А-Яа-яЁёA-Za-z_][А-Яа-яЁёA-Za-z_0-9]*`;
                return new RegExp(`(?:${field}\\s*[+*/-]|[+*/-]\\s*${field})`, 'i').test(masked);
            }));
        });
        if (rawArithmetic) issues.push({code:'ITS-QUERY-004',severity:'warning',
            message:'Арифметика использует поле правой стороны ЛЕВОГО СОЕДИНЕНИЯ без обработки NULL.',
            recommendation:'Проверьте требуемую семантику NULL и при необходимости используйте ЕСТЬNULL для этого поля.'});

        // 5. Anti-pattern: Missing destruction of temporary tables in batch query
        if (/ПОМЕСТИТЬ\s+ВТ_/i.test(queryText) && !/УНИЧТОЖИТЬ\s+ВТ_/i.test(queryText)) {
            issues.push({
                code: 'ITS-QUERY-005',
                severity: 'info',
                message: 'В пакетном запросе отсутствуют инструкции УНИЧТОЖИТЬ ВТ_... в конце пакета.',
                recommendation: 'Добавляйте "УНИЧТОЖИТЬ ВТ_ИмяТаблицы;" в конце пакета запросов для освобождения оперативной памяти сервера 1С и tempdb СУБД.'
            });
        }

        return result();
    }

    /** A query template, not transaction/posting logic. Fields must match the real schema. */
    public static generateBatchQuery(options: PackageQueryOptions): string {
        if (options.registerType && options.registerType !== 'Остатки') {
            throw new Error('Шаблон контроля дефицита поддерживает только Остатки регистра накопления. Для оборотов и цен используйте запрос по описанию.');
        }
        const entity = options.entityName?.trim() || '';
        const parts = entity.split('.');
        if (parts.length > 2 || (parts.length === 2 && !['Документ', 'Справочник'].includes(parts[0]))) {
            throw new Error('Укажите Документ.Имя или Справочник.Имя.');
        }
        const fullEntity = parts.length === 1 ? `Документ.${identifier(entity, 'Документ')}` : `${parts[0]}.${identifier(parts[1])}`;
        const tabular = identifier(options.tabularSection, 'Табличная часть');
        const register = identifier(options.registerName?.replace(/^РегистрНакопления\./, ''), 'Регистр накопления');
        if (options.sourceMode && !['document','table'].includes(options.sourceMode)) throw new Error('Неизвестный источник строк документа.');
        const mappings = options.fields?.map(parseFieldMapping) || [];
        const fields = mappings.map(m => m.target);
        const warnings = validateBatchSchema(options.metadata || {name:'',objects:[]}, entity, tabular, register, mappings);
        if (mappings.some(m => m.header && /^(?:СтрокиДокумента|ПериодКонтроля)$/i.test(m.source))) throw new Error('Имя параметра шапки пересекается со служебным параметром запроса.');
        // Explicit contract: dimensions first, the single numeric resource last.
        if (fields.length < 2 || new Set(fields.map(f => f.toLowerCase())).size !== fields.length) {
            throw new Error('Укажите измерения и один числовой ресурс последним полем; имена не должны повторяться.');
        }
        const dimensions = fields.slice(0, -1), resource = fields[fields.length - 1];
        const balance = `${resource}Остаток`;
        const fromTable = options.sourceMode === 'table';
        const expression = (index: number) => { const m = mappings[index]; return m.header ? (fromTable ? `&${m.source}` : `Строки.Ссылка.${m.source}`) : `Строки.${m.source}`; };
        const groups = dimensions.map((_,i) => expression(i)).filter(value => !value.startsWith('&'));
        const rawTable = 'ВТ_ВходныеСтроки';
        if (mappings.at(-1)?.header) throw new Error('Числовой ресурс должен поступать из строк документа.');
        let sourceTable = `ВТ_${tabular}`;
        if (sourceTable.toLowerCase() === rawTable.toLowerCase()) sourceTable += '_Группа';
        let balanceTable = `ВТ_Остатки${register}`;
        if (sourceTable.toLowerCase() === balanceTable.toLowerCase()) balanceTable += '_Регистра';
        if (dimensions.some(d => ['требуется', 'доступно', 'дефицит'].includes(d.toLowerCase()))) {
            throw new Error('Имена измерений Требуется, Доступно и Дефицит пересекаются с колонками результата. Используйте запрос по описанию с явными псевдонимами.');
        }
        const rawFields = [...new Set(mappings.filter(m => !m.header).map(m => m.source))];
        const preparation = fromTable ? `ВЫБРАТЬ\n${rawFields.map(f => `    Входные.${f} КАК ${f}`).join(',\n')}\nПОМЕСТИТЬ ${rawTable}\nИЗ &СтрокиДокумента КАК Входные\n;\n\n` : '';
        const query = preparation + `ВЫБРАТЬ
${dimensions.map((d,i) => `    ${expression(i)} КАК ${d}`).join(',\n')},
    СУММА(${expression(mappings.length - 1)}) КАК ${resource}
ПОМЕСТИТЬ ${sourceTable}
ИЗ ${fromTable ? rawTable : `${fullEntity}.${tabular}`} КАК Строки
${fromTable ? '' : 'ГДЕ Строки.Ссылка = &Ссылка\n'}${groups.length ? `СГРУППИРОВАТЬ ПО ${groups.join(', ')}\n` : ''}
ИНДЕКСИРОВАТЬ ПО ${dimensions.join(', ')}
;

ВЫБРАТЬ
${dimensions.map(d => `    Остатки.${d} КАК ${d}`).join(',\n')},
    Остатки.${balance} КАК ${balance}
ПОМЕСТИТЬ ${balanceTable}
ИЗ РегистрНакопления.${register}.Остатки(
    &ПериодКонтроля,
    (${dimensions.join(', ')}) В (ВЫБРАТЬ ${dimensions.join(', ')} ИЗ ${sourceTable})
) КАК Остатки
ИНДЕКСИРОВАТЬ ПО ${dimensions.join(', ')}
;

ВЫБРАТЬ
${dimensions.map(d => `    Исходные.${d} КАК ${d}`).join(',\n')},
    Исходные.${resource} КАК Требуется,
    ЕСТЬNULL(Остатки.${balance}, 0) КАК Доступно,
    Исходные.${resource} - ЕСТЬNULL(Остатки.${balance}, 0) КАК Дефицит
ИЗ ${sourceTable} КАК Исходные
    ЛЕВОЕ СОЕДИНЕНИЕ ${balanceTable} КАК Остатки
    ПО ${dimensions.map(d => `Исходные.${d} = Остатки.${d}`).join('\n        И ')}
ГДЕ Исходные.${resource} > ЕСТЬNULL(Остатки.${balance}, 0)
;

УНИЧТОЖИТЬ ${sourceTable}
;
УНИЧТОЖИТЬ ${balanceTable}${fromTable ? `;\nУНИЧТОЖИТЬ ${rawTable}` : ''}`;
        if (!options.includeScaffolding) return query;
        return `${warnings.map(warning => `// ${warning}`).join('\n')}\n// Шаблон контроля дефицита. Проверьте имена и типы полей по конфигурации.
// Все измерения регистра должны быть учтены в соединении либо явно ограничены.
// ${fromTable ? 'Текущие строки выгружаются из табличной части модуля объекта на сервере.' : 'Источник — сохранённые строки базы по Ссылка; изменения в памяти не читаются.'}
// ПериодКонтроля задаётся вызывающим кодом; учтите собственные движения при перепроведении.
// Для проведения отдельно реализуйте блокировки, движения и обработку отказа.
Запрос = Новый Запрос;
Запрос.МенеджерВременныхТаблиц = Новый МенеджерВременныхТаблиц;
Запрос.Текст = ${bslString(query)};
${fromTable ? `Запрос.УстановитьПараметр("СтрокиДокумента", ${tabular}.Выгрузить());` : 'Запрос.УстановитьПараметр("Ссылка", Ссылка);'}
${fromTable ? [...new Set(mappings.filter(m => m.header).map(m => m.source))].map(name => `Запрос.УстановитьПараметр("${name}", ${name});`).join('\n') : ''}
Запрос.УстановитьПараметр("ПериодКонтроля", ПериодКонтроля);
Результаты = Запрос.ВыполнитьПакет();
// Запрос с индексом ${fromTable ? 3 : 2} возвращает дефицит. Обработайте результат в логике документа.
ТаблицаДефицита = Результаты[${fromTable ? 3 : 2}].Выгрузить();`;
    }

    /** Conservative extraction of one virtual JOIN from a plain, single SELECT. */
    public static refactorQuery(rawQuery: string): QueryRefactorResult {
        const unchanged = (reason: string): QueryRefactorResult => ({ refactoredQuery: rawQuery, appliedOptimizations: [], reason });
        const text = withoutComments(rawQuery).trim().replace(/;\s*$/, '');
        if (/\bFOR\s+UPDATE\b|ДЛЯ\s+ИЗМЕНЕНИЯ|РАЗРЕШЕННЫЕ/i.test(text)) {
            return unchanged('Запрос с блокировками или РАЗРЕШЕННЫЕ требует ручного анализа транзакций и прав. Автоматическое преобразование отменено.');
        }
        if (!/^ВЫБРАТЬ\s/i.test(text) || /[;"*]|ПОМЕСТИТЬ|ОБЪЕДИНИТЬ/i.test(text) || (text.match(/ВЫБРАТЬ/gi) || []).length !== 1) {
            return unchanged('Поддерживается один текст запроса ВЫБРАТЬ без вложенных выборок, строковых литералов, пакетов и *. BSL-модули автоматически не переписываются.');
        }
        const expr = /СОЕДИНЕНИЕ\s+(Регистр(?:Накопления|Сведений)\.[А-Яа-яЁёA-Za-z0-9_]+\.(?:Остатки|Обороты|СрезПоследних|СрезПервых)\s*\()/gi;
        const matches = [...text.matchAll(expr)];
        if (matches.length !== 1) return unchanged('Для преобразования требуется ровно одно соединение с виртуальной таблицей. Остальной запрос оставлен без изменений.');
        const match = matches[0];
        const expressionStart = match.index! + match[0].indexOf(match[1]);
        let end = match.index! + match[0].length, depth = 1;
        while (end < text.length && depth > 0) {
            if (text[end] === '(') depth++;
            if (text[end] === ')') depth--;
            end++;
        }
        if (depth) return unchanged('Не удалось разобрать параметры виртуальной таблицы: проверьте скобки.');
        const aliasMatch = text.slice(end).match(/^\s+КАК\s+([А-Яа-яЁёA-Za-z0-9_]+)\s+ПО\s+/i);
        if (!aliasMatch) return unchanged('Укажите псевдоним виртуальной таблицы и условие ПО.');
        const alias = aliasMatch[1], vt = `ВТ_${alias}`;
        if (text.toLowerCase().includes(vt.toLowerCase())) return unchanged(`Имя ${vt} уже используется; автоматическое преобразование отменено.`);
        const fieldPattern = new RegExp(`(?:^|[^А-Яа-яЁёA-Za-z0-9_.])${alias}\\.([А-Яа-яЁёA-Za-z0-9_]+)`, 'gi');
        const references = text.slice(0, expressionStart) + text.slice(end);
        const fields = [...references.matchAll(fieldPattern)].map(m => m[1]);
        const unique = fields.filter((f, i) => fields.findIndex(v => v.toLowerCase() === f.toLowerCase()) === i);
        const condition = text.slice(end + aliasMatch[0].length).split(/\s+(?:WHERE|ГДЕ|СГРУППИРОВАТЬ|УПОРЯДОЧИТЬ|ИТОГИ)(?=\s|$)/i)[0];
        const indexField = [...condition.matchAll(fieldPattern)][0]?.[1];
        if (!unique.length || !indexField) return unchanged('Не удалось определить поля виртуальной таблицы и поле связи.');
        // Keep original resource names and NULL semantics; never invent schema fields.
        const extraction = `ВЫБРАТЬ\n${unique.map(f => `    ${alias}.${f} КАК ${f}`).join(',\n')}\nПОМЕСТИТЬ ${vt}\nИЗ ${text.slice(expressionStart, end)} КАК ${alias}\nИНДЕКСИРОВАТЬ ПО ${indexField}\n;\n\n`;
        return {
            refactoredQuery: extraction + text.slice(0, expressionStart) + vt + text.slice(end) + `;\n\nУНИЧТОЖИТЬ ${vt};`,
            appliedOptimizations: [`Выборка перенесена в ${vt}; имена полей и семантика NULL сохранены.`, `Добавлен индекс по ${indexField}. Сравните планы и время на своих данных.`],
            reason: 'Получился пакет запросов. Выборка исходного SELECT — второй результат ВыполнитьПакет() (индекс 1); адаптируйте вызывающий BSL-код.'
        };
    }
}
