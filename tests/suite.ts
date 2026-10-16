import * as assert from 'assert';
import { StandardsChecker } from '../src/standardsChecker';
import { BSPHelper } from '../src/bspHelper';
import { QueryBuilder } from '../src/queryBuilder';
import { ExtensionGenerator } from '../src/extensionGenerator';
import { MetadataScanner } from '../src/metadataScanner';
import { BDDGenerator } from '../src/bddGenerator';
import { TechLogAnalyzer } from '../src/techLogAnalyzer';
import { BSLTokenizer, BSLTokenType, BSLScopeAnalyzer } from '../src/bslTokenizer';

console.log('====================================================');
console.log('RUNNING SENIOR-GRADE 1C COPILOT UNIT TEST SUITE');
console.log('====================================================');

// 1. Test StandardsChecker
console.log('\n[1/5] Testing StandardsChecker...');
{
    // A: Query inside loop
    const loopQuery = `
    Для Каждого Стр Из Коллекция Цикл
        Запрос = Новый Запрос;
        Запрос.Выполнить();
    КонецЦикла;
    `;
    const issues1 = StandardsChecker.auditCode(loopQuery);
    const hasLoopIssue = issues1.some(i => i.rule === 'ITS-PERF-001');
    assert.strictEqual(hasLoopIssue, true, 'Must detect query in loop');
    console.log('  ✓ ITS-PERF-001: Query inside loop correctly flagged');

    // B: Missing DataLock
    const noLock = `
    Процедура ОбработкаПроведения(Отказ, РежимПроведения)
        // нет блокировки данных
    КонецПроцедуры
    `;
    const issues2 = StandardsChecker.auditCode(noLock);
    const hasLockIssue = issues2.some(i => i.rule === 'ITS-LOCK-001');
    assert.strictEqual(hasLockIssue, true, 'Must detect missing DataLock');
    console.log('  ✓ ITS-LOCK-001: Missing DataLock in posting correctly flagged');

    // C: Deprecated Modal
    const modalCode = `
    Предупреждение("Внимание!");
    `;
    const issues3 = StandardsChecker.auditCode(modalCode);
    const hasModal = issues3.some(i => i.rule === 'ITS-UI-003');
    assert.strictEqual(hasModal, true, 'Must detect modal call');
    console.log('  ✓ ITS-UI-003: Synchronous modal window correctly flagged');

    // D: Clean code
    const cleanCode = `
    Процедура ОбработкаПроведения(Отказ, РежимПроведения)
        Блокировка = Новый БлокировкаДанных;
        Элемент = Блокировка.Добавить("РегистрНакопления.ТоварыНаСкладах");
        Блокировка.Заблокировать();
    КонецПроцедуры
    `;
    const cleanIssues = StandardsChecker.auditCode(cleanCode);
    assert.strictEqual(cleanIssues.length, 0, 'Clean compliant code must pass with 0 issues');
    console.log('  ✓ Compliant code passes audit with 0 issues');

    // E: inPosting state leak regression test
    const multiProcCode = `
    Процедура ОбработкаПроведения(Отказ, РежимПроведения)
        Блокировка = Новый БлокировкаДанных;
        Блокировка.Заблокировать();
    КонецПроцедуры

    Процедура ПриЗаписи(Отказ)
        // Вторая процедура без блокировки данных не должна ложно флагаться
    КонецПроцедуры
    `;
    const multiIssues = StandardsChecker.auditCode(multiProcCode);
    assert.strictEqual(multiIssues.length, 0, 'Subsequent procedures must not inherit inPosting state');
    console.log('  ✓ inPosting state does not leak to subsequent procedures');
}

// 2. Test BSPHelper
console.log('\n[2/5] Testing BSPHelper (Библиотека Стандартных Подсистем)...');
{
    assert.ok(BSPHelper.STANDARD_MODULES.length >= 35, `Must have at least 35 standard BSP modules documented (found ${BSPHelper.STANDARD_MODULES.length})`);
    const hasObjReader = BSPHelper.STANDARD_MODULES.some(m => m.method === 'ЗначениеРеквизитаОбъекта');
    assert.strictEqual(hasObjReader, true, 'Must document ЗначениеРеквизитаОбъекта');
    const hasTableConvert = BSPHelper.STANDARD_MODULES.some(m => m.method === 'ТаблицаЗначенийВМассив');
    assert.strictEqual(hasTableConvert, true, 'Must document ТаблицаЗначенийВМассив');
    const hasLongOps = BSPHelper.STANDARD_MODULES.some(m => m.module === 'ДлительныеОперации');
    assert.strictEqual(hasLongOps, true, 'Must document ДлительныеОперации');

    // Detection of manual ПолучитьОбъект anti-pattern
    const badBspCode = `
    Ставка = Ссылка.ПолучитьОбъект().СтавкаНДС;
    `;
    const bspSuggestions = BSPHelper.analyzeForBSPOptimization(badBspCode);
    assert.strictEqual(bspSuggestions.length, 1, 'Must detect ПолучитьОбъект anti-pattern');
    assert.strictEqual(bspSuggestions[0].moduleName, 'ОбщегоНазначения');
    console.log('  ✓ Anti-pattern Ссылка.ПолучитьОбъект() flagged with suggestion to use ОбщегоНазначения');

    const promptText = BSPHelper.getBSPPromptInjection();
    assert.ok(promptText.includes('Библиотеки Стандартных Подсистем'), 'Prompt injection must contain BSP header');
    console.log(`  ✓ BSP knowledge prompt injection formatted successfully (${BSPHelper.STANDARD_MODULES.length} methods)`);
}

// 3. Test QueryBuilder
console.log('\n[3/5] Testing QueryBuilder (Пакетные запросы и временные таблицы)...');
{
    // A: Detect direct JOIN with virtual table
    const badJoinQuery = `
    ВЫБРАТЬ
        Док.Номенклатура,
        Остатки.КоличествоОстаток
    ИЗ
        Документ.РеализацияТоваровУслуг.Товары КАК Док
        ЛЕВОЕ СОЕДИНЕНИЕ РегистрНакопления.ТоварыНаСкладах.Остатки(&Период, ) КАК Остатки
            ПО Док.Номенклатура = Остатки.Номенклатура
    `;
    const inspection = QueryBuilder.inspectQuery(badJoinQuery);
    assert.strictEqual(inspection.isValid, false, 'Query with direct virtual table join must be invalid');
    assert.ok(inspection.issues.some(i => i.code === 'ITS-QUERY-001'), 'Must flag ITS-QUERY-001');
    console.log('  ✓ ITS-QUERY-001: Direct JOIN with virtual table flagged');

    // B: Detect temp table in JOIN without INDEX
    const unindexedTemp = `
    ВЫБРАТЬ * ПОМЕСТИТЬ ВТ_Данные ИЗ Таблица;
    ВЫБРАТЬ * ИЗ Основная СОЕДИНЕНИЕ ВТ_Данные ПО Основная.ИД = ВТ_Данные.ИД;
    `;
    const tempInspection = QueryBuilder.inspectQuery(unindexedTemp);
    assert.ok(tempInspection.issues.some(i => i.code === 'ITS-QUERY-002'), 'Must flag unindexed temp table in JOIN');
    console.log('  ✓ ITS-QUERY-002: Unindexed temporary table in JOIN flagged');

    // C: Generate compliant batch query
    const generatedBatch = QueryBuilder.generateBatchQuery({
        entityName: 'ЗаказКлиента',
        tabularSection: 'Товары',
        registerName: 'ТоварыНаСкладах',
        registerType: 'Остатки',
        fields: ['Номенклатура', 'Количество'],
        includeScaffolding: true
    });

    assert.ok(generatedBatch.includes('ПОМЕСТИТЬ ВТ_Товары'), 'Must create temp table for tabular section');
    assert.ok(generatedBatch.includes('ИНДЕКСИРОВАТЬ ПО'), 'Must index temp tables');
    assert.ok(generatedBatch.includes('УНИЧТОЖИТЬ ВТ_Товары'), 'Must destroy temp tables at end');
    assert.ok(generatedBatch.includes('Новый МенеджерВременныхТаблиц'), 'Must instantiate МенеджерВременныхТаблиц');
    assert.ok(generatedBatch.includes('ЕСТЬNULL'), 'Must wrap balances with ЕСТЬNULL');
    console.log('  ✓ Batch Query Generation produces fully standards-compliant 1C package');

    // D: Intelligent query refactoring
    const refactorResult = QueryBuilder.refactorQuery(badJoinQuery);
    assert.ok(refactorResult.refactoredQuery.includes('ПОМЕСТИТЬ ВТ_Остатки'), 'Refactored query must create temp table ВТ_Остатки');
    assert.ok(refactorResult.refactoredQuery.includes('ИНДЕКСИРОВАТЬ ПО'), 'Refactored query must index temp table');
    assert.ok(refactorResult.refactoredQuery.includes('ЕСТЬNULL(Остатки.КоличествоОстаток, 0)'), 'Refactored query must wrap with ЕСТЬNULL');
    assert.ok(refactorResult.refactoredQuery.includes('УНИЧТОЖИТЬ ВТ_Остатки'), 'Refactored query must destroy temp table');
    assert.ok(refactorResult.appliedOptimizations.length >= 3, 'Must record applied optimizations');
    // E: QueryBuilder with СрезПоследних must use РегистрСведений
    const srezQuery = QueryBuilder.generateBatchQuery({
        entityName: 'УстановкаЦенНоменклатуры',
        tabularSection: 'Товары',
        registerName: 'ЦеныНоменклатуры',
        registerType: 'СрезПоследних',
        fields: ['Номенклатура', 'Цена'],
        includeScaffolding: false
    });
    assert.ok(srezQuery.includes('РегистрСведений.ЦеныНоменклатуры.СрезПоследних'), 'СрезПоследних must target РегистрСведений');
    assert.ok(!srezQuery.includes('РегистрНакопления.ЦеныНоменклатуры'), 'Must NOT target РегистрНакопления for СрезПоследних');
    console.log('  ✓ QueryBuilder correctly targets РегистрСведений for СрезПоследних');
}

// 4. Test ExtensionGenerator (cfe)
console.log('\n[4/5] Testing ExtensionGenerator (Расширения конфигурации cfe)...');
{
    // A: &Вместо
    const vmestoCode = ExtensionGenerator.generateInterceptor({
        targetMethod: 'РассчитатьСкидки',
        directive: 'Вместо',
        moduleType: 'ОбщийМодуль',
        isFunction: false,
        parameters: ['ДокументОбъект', 'Отказ']
    });
    assert.ok(vmestoCode.includes('&Вместо("РассчитатьСкидки")'), 'Must have &Вместо directive');
    assert.ok(vmestoCode.includes('ПродолжитьВызов(ДокументОбъект, Отказ)'), 'Must call ПродолжитьВызов');
    console.log('  ✓ &Вместо interceptor correctly generated with ПродолжитьВызов()');

    // B: &ИзменениеИКонтроль
    const controlCode = ExtensionGenerator.generateInterceptor({
        targetMethod: 'ПроверитьЗаполнение',
        directive: 'ИзменениеИКонтроль',
        moduleType: 'МодульОбъекта',
        isFunction: false,
        parameters: ['Отказ']
    });
    assert.ok(controlCode.includes('&ИзменениеИКонтроль("ПроверитьЗаполнение")'), 'Must have &ИзменениеИКонтроль');
    assert.ok(controlCode.includes('#Вставка'), 'Must include #Вставка tag');
    assert.ok(controlCode.includes('#КонецВставки'), 'Must include #КонецВставки tag');
    console.log('  ✓ &ИзменениеИКонтроль generated with #Вставка/#КонецВставки tags');

    // C: Managed Form dynamic button injection
    const formCode = ExtensionGenerator.generateFormButtonExtension('КнопкаПечатиАкта', 'Печать акта', 'КомандаПечатиАкта');
    assert.ok(formCode.includes('&После("ПриСозданииНаСервере")'), 'Must extend ПриСозданииНаСервере');
    assert.ok(formCode.includes('Элементы.Добавить("КнопкаПечатиАкта"'), 'Must dynamically add form button');
    assert.ok(formCode.includes('Команды.Добавить("КомандаПечатиАкта"'), 'Must register form command');
    console.log('  ✓ Managed form dynamic UI injection extension generated');

    // D: Canonical signature inference
    const autoSig = ExtensionGenerator.generateInterceptor({
        targetMethod: 'ОбработкаПроведения',
        directive: 'Вместо',
        moduleType: 'МодульОбъекта',
        isFunction: false,
        parameters: []
    });
    assert.ok(autoSig.includes('Расш_ОбработкаПроведения(Отказ, РежимПроведения)'), 'Must infer canonical signature');
    console.log('  ✓ ExtensionGenerator infers canonical 1C event handler signatures');
}

// 5. Test MetadataScanner
console.log('\n[5/5] Testing MetadataScanner...');
{
    const summary = MetadataScanner.formatForPrompt({
        name: 'ERP 2.5',
        version: '8.3.25',
        objects: [
            {
                kind: 'Справочник',
                name: 'Номенклатура',
                synonym: 'Номенклатура',
                fields: [{ name: 'Артикул' }, { name: 'ЕдиницаИзмерения' }]
            },
            {
                kind: 'Документ',
                name: 'РеализацияТоваровУслуг',
                tabularSections: [{ name: 'Товары', fields: [{ name: 'Номенклатура' }, { name: 'Количество' }] }]
            }
        ]
    });
    assert.ok(summary.includes('Номенклатура'), 'Must list catalog Номенклатура');
    assert.ok(summary.includes('РеализацияТоваровУслуг'), 'Must list document РеализацияТоваровУслуг');
    assert.ok(summary.includes('Табличные части: Товары'), 'Must list tabular section Товары');
    console.log('  ✓ Metadata correctly summarized and formatted for LLM context');
}

// 6. Test BDDGenerator (Vanessa-Automation BDD)
console.log('\n[6/7] Testing BDDGenerator (Vanessa-Automation BDD)...');
{
    // A: Standard Document Scenario
    const spec = BDDGenerator.generateDocumentScenario('РеализацияТоваровУслуг', 'Товары', 'ТоварыНаСкладах');
    const featureText = BDDGenerator.generateFeature(spec);

    assert.ok(featureText.includes('# language: ru'), 'Must specify Russian Gherkin language header');
    assert.ok(featureText.includes('Функционал: Проведение и валидация документа "РеализацияТоваровУслуг"'), 'Must have Feature title');
    assert.ok(featureText.includes('Контекст:'), 'Must have Background context');
    assert.ok(featureText.includes('Сценарий: Успешное создание и проведение документа'), 'Must have positive scenario');
    assert.ok(featureText.includes('Сценарий: Контроль превышения остатка'), 'Must have negative scenario');
    assert.ok(featureText.includes('| \'Номенклатура\' | \'Количество\' | \'Цена\' |'), 'Must generate data table headers');
    assert.strictEqual(
        featureText.split("| 'Номенклатура' | 'Количество' | 'Цена' |").length - 1,
        1,
        'Must emit table headers exactly once'
    );
    assert.ok(featureText.includes("| 'Тестовый товар А' | '5' | '1200' |"), 'Must preserve the first data row');
    console.log('  ✓ Vanessa-Automation Russian Gherkin .feature generated with scenarios and tables');

    // B: Freeform Natural Language Intent Parsing
    const parsedFeature = BDDGenerator.parseNaturalLanguageToFeature('Создать тест для документа "ЗаказПокупателя" с проверкой остатков');
    assert.ok(parsedFeature.includes('ЗаказПокупателя'), 'Must extract document name from natural language prompt');
    console.log('  ✓ Natural language intent parsed into structured BDD feature');
}

// 7. Test TechLogAnalyzer (1C Technological Log Diagnostics)
console.log('\n[7/7] Testing TechLogAnalyzer (Технологический Журнал 1С - ТЖ)...');
{
    const sampleLog = `
14:20.123000-7500000,TLOCK,2,process=rphost,p:processName=Trade,t:clientID=124,Context=Документ.РеализацияТоваровУслуг.МодульОбъекта : 142 : БлокировкаДанных.Заблокировать(),Regions=AccumRgOpt.ТоварыНаСкладах,WaitConnections=122,Locks=AccumRgOpt.ТоварыНаСкладах(Exclusive)
15:02.450000-0,TDEADLOCK,3,process=rphost,p:processName=Trade,t:clientID=124,Context=Документ.ЗаказКлиента.МодульОбъекта : 88 : Движения.Записать(),DeadlockConnectionList=122 124
16:10.005000-0,EXCP,1,process=rphost,p:processName=Trade,t:clientID=99,Context=Справочник.Номенклатура.Форма.ФормаЭлемента.Форма : 54 : Значение = Ссылка.ПолучитьОбъект(),Descr='Попытка передачи с клиента на сервер мутабельного значения'
12:00.000000-4500000,DBPOSTGR,2,process=rphost,p:processName=Trade,Sql='SELECT * FROM _Document123 WHERE _Fld456 = 1',Context=Отчет.ОстаткиТоваров.МодульОбъекта : 210 : Запрос.Выполнить()
    `;

    const events = TechLogAnalyzer.parseLog(sampleLog);
    assert.strictEqual(events.length, 4, 'Must parse exactly 4 events (TLOCK, TDEADLOCK, EXCP, DBPOSTGR)');
    console.log('  ✓ All 4 distinct Tech Log event types correctly parsed');

    // Verify TLOCK event details
    const tlock = events.find(e => e.event === 'TLOCK')!;
    assert.strictEqual(tlock.durationSec, 7.5, 'Duration must be converted to 7.5 seconds');
    assert.strictEqual(tlock.contextLocation?.line, 142, 'Context line must be 142');

    // Run diagnosis
    const diagnoses = TechLogAnalyzer.diagnose(events);
    assert.strictEqual(diagnoses.length, 4, 'Must produce 4 diagnoses');

    const hasDeadlockDiag = diagnoses.some(d => d.category === 'Взаимные блокировки (TDEADLOCK)' && d.severity === 'critical');
    assert.strictEqual(hasDeadlockDiag, true, 'Deadlock must be diagnosed with critical severity');

    const hasLockDiag = diagnoses.some(d => d.category === 'Транзакционные блокировки (TLOCK)' && d.severity === 'critical');
    assert.strictEqual(hasLockDiag, true, 'Long TLOCK (>5s) must be critical');

    const report = TechLogAnalyzer.formatReport(diagnoses);
    assert.ok(report.includes('Взаимные блокировки (TDEADLOCK)'), 'Report must mention deadlock');
    assert.ok(report.includes('Рекомендации эксперта по High-Load 1С'), 'Report must provide High-Load recommendations');
    console.log('  ✓ TLOCK, TDEADLOCK, EXCP and slow SQL diagnosed with High-Load fixes');
}

// 8. Test BSLTokenizer & BSLScopeAnalyzer (Flagship Stage 1)
console.log('\n[8/8] Testing BSLTokenizer & BSLScopeAnalyzer (Flagship AST Engine)...');
{
    // A: Test tokenization of complex BSL code with multiline pipes and escaped quotes
    const complexSource = `
&НаСервере
// Комментарий с ложным кодом: Запрос.Выполнить();
Процедура РассчитатьЦену(Знач Коэффициент, Скидка = 0) Экспорт
    Перем Итог, ВалютаУчета;
    СтрокаСоСпецсимволами = "Это ""экранированная кавычка"" в 1С";
    МногострочныйТекст = "Первая строка"
        |Вторая строка с кодом Запрос.Выполнить()
        |Третья строка;
    
    Для Каждого Стр Из ТаблицаТоваров Цикл
        // Закомментированный вызов не должен детектироваться
        // Запрос = Новый Запрос;
        // Запрос.Выполнить();
        ТекстЛожный = "Запрос.Выполнить() внутри строки";
        Итог = Итог + Стр.Цена;
    КонецЦикла;
КонецПроцедуры
`;

    const tokens = BSLTokenizer.tokenize(complexSource);
    assert.ok(tokens.length > 20, 'Must produce valid tokens');

    // Verify string literal with escaped quotes
    const escapedStrToken = tokens.find(t => t.type === BSLTokenType.STRING_LITERAL && t.value.includes('экранированная кавычка'));
    assert.ok(escapedStrToken, 'Must parse string literal with escaped quotes');

    // Verify multiline pipe string token
    const pipeTokens = tokens.filter(t => t.type === BSLTokenType.STRING_LITERAL && t.value.startsWith('|'));
    assert.ok(pipeTokens.length >= 2, 'Must tokenize multiline pipe string literals');

    // Verify Directive token
    const directiveToken = tokens.find(t => t.type === BSLTokenType.DIRECTIVE);
    assert.strictEqual(directiveToken?.value, '&НаСервере', 'Must tokenize compilation directive &НаСервере');

    // Verify Scope Analysis inside loop
    const scopeAtLoop = BSLScopeAnalyzer.analyzeScopeAtPosition(tokens, 15, 10);
    assert.strictEqual(scopeAtLoop.currentMethod?.name, 'РассчитатьЦену', 'Must identify enclosing method');
    assert.strictEqual(scopeAtLoop.currentMethod?.isFunction, false, 'Must identify procedure');
    assert.strictEqual(scopeAtLoop.currentMethod?.isExport, true, 'Must identify export status');
    assert.strictEqual(scopeAtLoop.compilationDirective, '&НаСервере', 'Must capture active directive');
    assert.strictEqual(scopeAtLoop.insideLoop, true, 'Must know target is inside loop');
    assert.ok(scopeAtLoop.localVariables.includes('Коэффициент'), 'Must capture parameters');
    assert.ok(scopeAtLoop.localVariables.includes('Итог'), 'Must capture Перем variables');

    // Verify StandardsChecker immunity on commented-out or string query
    const issues = StandardsChecker.auditCode(complexSource);
    const falsePositives = issues.filter(i => i.rule === 'ITS-PERF-001');
    assert.strictEqual(falsePositives.length, 0, 'Commented or stringified query calls MUST NOT trigger ITS-PERF-001');
    console.log('  ✓ Deterministic tokenization of pipes, quotes and directives verified');
    console.log('  ✓ Scope analysis accurately extracts method, parameters and Перем');
    console.log('  ✓ StandardsChecker verified 100% immune to commented-out false positives');
}

console.log('\n====================================================');
console.log('ALL SENIOR 1C CORE EXTENSION TESTS PASSED (100%)');
console.log('====================================================\n');
