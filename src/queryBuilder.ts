/**
 * 1C:Enterprise Query Package Builder & Optimizer (Senior Grade).
 * 
 * Enforces ITS standards for 1C queries:
 * 1. Batch queries (ПАКЕТ ЗАПРОСОВ) with Temp Tables (ПОМЕСТИТЬ ВТ_...)
 * 2. Explicit indexing of temp tables (ИНДЕКСИРОВАТЬ ПО)
 * 3. Parameterized virtual tables without direct JOINs
 * 4. Proper ЕСТЬNULL handling on LEFT JOINs
 * 5. Temp table destruction (УНИЧТОЖИТЬ ВТ_...) to free DBMS memory
 * 6. BSL execution scaffolding with МенеджерВременныхТаблиц
 */

export interface QueryInspectionResult {
    isValid: boolean;
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
}

export class QueryBuilder {
    /**
     * Inspects 1C query text for performance anti-patterns according to ITS standards.
     */
    public static inspectQuery(queryText: string): QueryInspectionResult {
        const issues: QueryIssue[] = [];
        const lines = queryText.split('\n');

        // 1. Anti-pattern: Direct join with virtual table
        const directVirtualJoinRegex = /(ЛЕВОЕ|ПРАВОЕ|ВНУТРЕННЕЕ|ПОЛНОЕ)?\s+СОЕДИНЕНИЕ\s+Регистр(Накопления|Сведений|Бухгалтерии)\.[\w\u0400-\u04FF]+\.(Остатки|Обороты|СрезПоследних|СрезПервых)/i;
        if (directVirtualJoinRegex.test(queryText)) {
            issues.push({
                code: 'ITS-QUERY-001',
                severity: 'error',
                message: 'Прямое соединение с виртуальной таблицей в запросе.',
                recommendation: 'Вынесите выборку из виртуальной таблицы в отдельную временную таблицу с фильтром по параметрам среза и соединяйте ее с основной таблицей.'
            });
        }

        // 2. Anti-pattern: Temp table without index in joins
        const tempTableMatches = queryText.matchAll(/ПОМЕСТИТЬ\s+(ВТ_[\w\u0400-\u04FF]+)/gi);
        for (const match of tempTableMatches) {
            const tableName = match[1];
            const hasIndex = new RegExp(`ИНДЕКСИРОВАТЬ\\s+ПО`, 'i').test(queryText);
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
                severity: 'error',
                message: 'Обращение к виртуальной таблице без параметров фильтрации (в скобках пусто).',
                recommendation: 'Всегда передавайте условия отбора в параметры виртуальной таблицы в скобках, чтобы фильтрация выполнялась на уровне СУБД до вычисления среза/остатков.'
            });
        }

        // 4. Anti-pattern: Left join without ISNULL / ЕСТЬNULL
        if (/ЛЕВОЕ\s+СОЕДИНЕНИЕ/i.test(queryText) && !/ЕСТЬNULL/i.test(queryText)) {
            issues.push({
                code: 'ITS-QUERY-004',
                severity: 'warning',
                message: 'В запросе используется ЛЕВОЕ СОЕДИНЕНИЕ, но отсутствуют функции ЕСТЬNULL для числовых ресурсов или полей отбора.',
                recommendation: 'Оборачивайте поля присоединенной таблицы в ЕСТЬNULL(Поле, 0), чтобы избежать появления значений NULL в арифметических операциях.'
            });
        }

        // 5. Anti-pattern: Missing destruction of temporary tables in batch query
        if (/ПОМЕСТИТЬ\s+ВТ_/i.test(queryText) && !/УНИЧТОЖИТЬ\s+ВТ_/i.test(queryText)) {
            issues.push({
                code: 'ITS-QUERY-005',
                severity: 'info',
                message: 'В пакетном запросе отсутствуют инструкции УНИЧТОЖИТЬ ВТ_... в конце пакета.',
                recommendation: 'Добавляйте "УНИЧТОЖИТЬ ВТ_ИмяТаблицы;" в конце пакета запросов для освобождения оперативной памяти сервера 1С и tempdb СУБД.'
            });
        }

        return {
            isValid: issues.filter(i => i.severity === 'error').length === 0,
            issues
        };
    }

    /**
     * Generates a fully standards-compliant 1C Batch Query with Temp Tables, indexing, and cleanup.
     */
    public static generateBatchQuery(options: PackageQueryOptions): string {
        const vtSource = `ВТ_${options.tabularSection}`;
        const cleanReg = options.registerName.replace(/^(РегистрНакопления|РегистрСведений|РегистрБухгалтерии)\./, '');
        const vtBalances = `ВТ_Остатки${cleanReg}`;

        // Infer entity full path (Документ vs Справочник)
        let fullEntity = options.entityName.trim();
        if (!fullEntity.includes('.')) {
            fullEntity = `Документ.${fullEntity}`;
        }

        // Infer correct register kind and virtual table
        let registerKind = 'РегистрНакопления';
        const regType = options.registerType || 'Остатки';
        if (options.registerName.startsWith('РегистрСведений.') || regType === 'СрезПоследних' || regType === 'СрезПервых') {
            registerKind = 'РегистрСведений';
        } else if (options.registerName.startsWith('РегистрБухгалтерии.')) {
            registerKind = 'РегистрБухгалтерии';
        }

        // Separate fields into dimensions and resources
        const rawFields = (options.fields && options.fields.length > 0) ? options.fields : ['Номенклатура', 'Количество'];
        const resourceKeywords = /Количество|Сумма|Вес|Объем|Стоимость|Цена|Остаток/i;
        const dimensions = rawFields.filter(f => !resourceKeywords.test(f));
        const resources = rawFields.filter(f => resourceKeywords.test(f));

        const mainDim = dimensions[0] || 'Номенклатура';
        const mainRes = resources[0] || 'Количество';

        // Select items for source table
        const srcSelectLines: string[] = [];
        for (const dim of (dimensions.length ? dimensions : [mainDim])) {
            srcSelectLines.push(`    ДокументТаблица.${dim} КАК ${dim}`);
        }
        for (const res of (resources.length ? resources : [mainRes])) {
            srcSelectLines.push(`    СУММА(ДокументТаблица.${res}) КАК ${res}`);
        }

        const groupByDims = (dimensions.length ? dimensions : [mainDim]).map(d => `    ДокументТаблица.${d}`).join(',\n');
        const indexDims = (dimensions.length ? dimensions : [mainDim]).join(', ');

        // Resource name in virtual table
        let vtResName = mainRes;
        if (registerKind === 'РегистрНакопления') {
            if (regType === 'Остатки') {
                vtResName = `${mainRes}Остаток`;
            } else if (regType === 'Обороты') {
                vtResName = `${mainRes}Оборот`;
            }
        }

        // Virtual table parameter filter
        const vtFilterCondition = `${mainDim} В (ВЫБРАТЬ ${vtSource}.${mainDim} ИЗ ${vtSource})`;

        // Join condition
        const joinConditions = (dimensions.length ? dimensions : [mainDim])
            .map(d => `Исходные.${d} = Остатки.${d}`)
            .join('\n        И ');

        let query = `ВЫБРАТЬ
${srcSelectLines.join(',\n')}
ПОМЕСТИТЬ ${vtSource}
ИЗ
    ${fullEntity}.${options.tabularSection} КАК ДокументТаблица
ГДЕ
    ДокументТаблица.Ссылка = &Ссылка
СГРУППИРОВАТЬ ПО
${groupByDims}
ИНДЕКСИРОВАТЬ ПО
    ${indexDims}
;

////////////////////////////////////////////////////////////////////////////////
ВЫБРАТЬ
    Остатки.${mainDim} КАК ${mainDim},
    Остатки.${vtResName} КАК ${vtResName}
ПОМЕСТИТЬ ${vtBalances}
ИЗ
    ${registerKind}.${cleanReg}.${regType}(
        &ПериодКонтроля,
        ${vtFilterCondition}
    ) КАК Остатки
ИНДЕКСИРОВАТЬ ПО
    ${mainDim}
;

////////////////////////////////////////////////////////////////////////////////
ВЫБРАТЬ
    Исходные.${mainDim} КАК ${mainDim},
    Исходные.${mainRes} КАК Требуется,
    ЕСТЬNULL(Остатки.${vtResName}, 0) КАК Доступно,
    Исходные.${mainRes} - ЕСТЬNULL(Остатки.${vtResName}, 0) КАК Дефицит
ИЗ
    ${vtSource} КАК Исходные
    ЛЕВОЕ СОЕДИНЕНИЕ ${vtBalances} КАК Остатки
        ПО ${joinConditions}
ГДЕ
    Исходные.${mainRes} > ЕСТЬNULL(Остатки.${vtResName}, 0)
;

////////////////////////////////////////////////////////////////////////////////
УНИЧТОЖИТЬ ${vtSource}
;

////////////////////////////////////////////////////////////////////////////////
УНИЧТОЖИТЬ ${vtBalances}`;

        if (!options.includeScaffolding) {
            return query;
        }

        return `// Инициализация объекта Запрос с Менеджером Временных Таблиц
Запрос = Новый Запрос;
Запрос.МенеджерВременныхТаблиц = Новый МенеджерВременныхТаблиц;
Запрос.Текст = 
    "${query.split('\n').join('"\n    + "')}";

Запрос.УстановитьПараметр("Ссылка", Ссылка);
Запрос.УстановитьПараметр("ПериодКонтроля", ?(ЗначениеЗаполнено(Дата), Дата, ТекущаяДатаСеанса()));

Результаты = Запрос.ВыполнитьПакет();
// Индекс 2 соответствует третьему запросу выборки дефицита (после двух помещений во временные таблицы)
ВыборкаДефицит = Результаты[2].Выбрать();

Пока ВыборкаДефицит.Следующий() Цикл
    // Обработка нехватки товара
    ОбщегоНазначенияКлиентСервер.СообщитьПользователю(
        СтроковыеФункцииКлиентСервер.ВставитьПараметрыВСтроку(
            НСтр("ru = 'Недостаточно товара \"%1\": требуется %2, в наличии %3'"),
            ВыборкаДефицит.Номенклатура,
            ВыборкаДефицит.Требуется,
            ВыборкаДефицит.Доступно
        )
    );
КонецЦикла;`;
    }

    /**
     * Intelligently refactors an arbitrary 1C query according to ITS standards:
     * - Isolates virtual table JOINs into temporary indexed tables
     * - Wraps numeric fields from LEFT JOINs with ЕСТЬNULL(..., 0)
     * - Appends УНИЧТОЖИТЬ ВТ_... to release server memory
     */
    public static refactorQuery(rawQuery: string): { refactoredQuery: string; appliedOptimizations: string[] } {
        const appliedOptimizations: string[] = [];
        let modified = rawQuery.trim();

        // 1. Detect Direct Virtual Table Join
        const vtJoinRegex = /(ЛЕВОЕ|ПРАВОЕ|ВНУТРЕННЕЕ|ПОЛНОЕ)?\s*СОЕДИНЕНИЕ\s+(Регистр(?:Накопления|Сведений|Бухгалтерии)\.([а-яА-ЯёЁa-zA-Z0-9_]+)\.(Остатки|Обороты|СрезПоследних|СрезПервых)\s*\(([^)]*)\))\s+КАК\s+([а-яА-ЯёЁa-zA-Z0-9_]+)\s+ПО\s+([^\n;]+)/i;
        const match = modified.match(vtJoinRegex);

        if (match) {
            const joinType = match[1] || 'ЛЕВОЕ';
            const fullVtExpr = match[2];
            const registerName = match[3];
            const vtType = match[4];
            const alias = match[6];
            const onCondition = match[7].trim();

            let joinField = 'Номенклатура';
            const fieldMatch = onCondition.match(new RegExp(`${alias}\\.([а-яА-ЯёЁa-zA-Z0-9_]+)`, 'i'));
            if (fieldMatch) {
                joinField = fieldMatch[1];
            }

            const vtName = `ВТ_${alias}`;

            // Build temp table extraction query
            const tempTablePart = `ВЫБРАТЬ
    ${alias}.${joinField} КАК ${joinField},
    ${alias}.Количество${vtType === 'Остатки' ? 'Остаток' : ''} КАК Количество
ПОМЕСТИТЬ ${vtName}
ИЗ
    ${fullVtExpr} КАК ${alias}
ИНДЕКСИРОВАТЬ ПО
    ${joinField}
;

////////////////////////////////////////////////////////////////////////////////
`;
            appliedOptimizations.push(`Вынесение виртуальной таблицы ${registerName}.${vtType} в индексированную временную таблицу ${vtName}`);
            appliedOptimizations.push(`Добавлена явная инструкция ИНДЕКСИРОВАТЬ ПО ${joinField}`);

            // Replace direct join in the main query
            const replacementJoin = `${joinType} СОЕДИНЕНИЕ ${vtName} КАК ${alias} ПО ${onCondition}`;
            modified = modified.replace(match[0], replacementJoin);

            // Wrap query with temp table and destruction
            modified = `${tempTablePart}${modified}\n\n////////////////////////////////////////////////////////////////////////////////\nУНИЧТОЖИТЬ ${vtName};`;
            appliedOptimizations.push(`Добавлена инструкция УНИЧТОЖИТЬ ${vtName} для освобождения памяти СУБД`);
        }

        // 2. Ensure ЕСТЬNULL wrapping on LEFT JOIN numeric/aggregate fields if not present
        if (/ЛЕВОЕ\s+СОЕДИНЕНИЕ/i.test(modified) && !/ЕСТЬNULL/i.test(modified)) {
            const nullTarget = /([а-яА-ЯёЁa-zA-Z0-9_]+\.(?:Количество|Сумма|Остаток)[а-яА-ЯёЁa-zA-Z0-9_]*)/gi;
            if (nullTarget.test(modified)) {
                modified = modified.replace(nullTarget, 'ЕСТЬNULL($1, 0)');
                appliedOptimizations.push('Обертывание числовых полей соединения в функцию ЕСТЬNULL(..., 0)');
            }
        }

        return {
            refactoredQuery: modified,
            appliedOptimizations
        };
    }
}
