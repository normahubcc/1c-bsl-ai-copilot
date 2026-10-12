import * as assert from 'assert';
import { StandardsChecker } from '../src/standardsChecker';
import { BSPHelper } from '../src/bspHelper';
import { QueryBuilder } from '../src/queryBuilder';
import { ExtensionGenerator } from '../src/extensionGenerator';
import { MetadataScanner } from '../src/metadataScanner';

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
}

// 2. Test BSPHelper
console.log('\n[2/5] Testing BSPHelper (Библиотека Стандартных Подсистем)...');
{
    assert.ok(BSPHelper.STANDARD_MODULES.length >= 8, 'Must have at least 8 standard BSP modules documented');
    const hasObjReader = BSPHelper.STANDARD_MODULES.some(m => m.method === 'ЗначениеРеквизитаОбъекта');
    assert.strictEqual(hasObjReader, true, 'Must document ЗначениеРеквизитаОбъекта');

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
    console.log('  ✓ BSP knowledge prompt injection formatted successfully');
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
    const formCode = ExtensionGenerator.generateFormButtonExtension('КнопкаПечать', 'Печать акта', 'ПечатьАкта');
    assert.ok(formCode.includes('&После("ПриСозданииНаСервере")'), 'Must extend ПриСозданииНаСервере');
    assert.ok(formCode.includes('Элементы.Добавить("КнопкаПечать"'), 'Must dynamically add form button');
    assert.ok(formCode.includes('Команды.Добавить("ПечатьАкта"'), 'Must register form command');
    console.log('  ✓ Managed form dynamic UI injection extension generated');
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

console.log('\n====================================================');
console.log('ALL SENIOR 1C CORE EXTENSION TESTS PASSED (100%)');
console.log('====================================================\n');
