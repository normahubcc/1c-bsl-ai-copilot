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
    registerType: 'Остатки' | 'Обороты' | 'СрезПоследних';
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
        const vtBalances = `ВТ_Остатки${options.registerName}`;

        let query = `ВЫБРАТЬ
    ДокументТаблица.Номенклатура КАК Номенклатура,
    СУММА(ДокументТаблица.Количество) КАК Количество
ПОМЕСТИТЬ ${vtSource}
ИЗ
    Документ.${options.entityName}.${options.tabularSection} КАК ДокументТаблица
ГДЕ
    ДокументТаблица.Ссылка = &Ссылка
СГРУППИРОВАТЬ ПО
    ДокументТаблица.Номенклатура
ИНДЕКСИРОВАТЬ ПО
    Номенклатура
;

////////////////////////////////////////////////////////////////////////////////
ВЫБРАТЬ
    Остатки.Номенклатура КАК Номенклатура,
    Остатки.КоличествоОстаток КАК КоличествоОстаток
ПОМЕСТИТЬ ${vtBalances}
ИЗ
    РегистрНакопления.${options.registerName}.${options.registerType}(
        &ПериодКонтроля,
        Номенклатура В (ВЫБРАТЬ ${vtSource}.Номенклатура ИЗ ${vtSource})
    ) КАК Остатки
ИНДЕКСИРОВАТЬ ПО
    Номенклатура
;

////////////////////////////////////////////////////////////////////////////////
ВЫБРАТЬ
    Исходные.Номенклатура КАК Номенклатура,
    Исходные.Количество КАК Требуется,
    ЕСТЬNULL(Остатки.КоличествоОстаток, 0) КАК Доступно,
    Исходные.Количество - ЕСТЬNULL(Остатки.КоличествоОстаток, 0) КАК Дефицит
ИЗ
    ${vtSource} КАК Исходные
    ЛЕВОЕ СОЕДИНЕНИЕ ${vtBalances} КАК Остатки
        ПО Исходные.Номенклатура = Остатки.Номенклатура
ГДЕ
    Исходные.Количество > ЕСТЬNULL(Остатки.КоличествоОстаток, 0)
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
}
