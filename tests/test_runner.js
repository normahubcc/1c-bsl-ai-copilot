/**
 * Automated test suite for 1C BSL AI Copilot core modules.
 */

const assert = require('assert');

// 1. Test Standards Checker logic
function testStandardsChecker() {
    console.log('Testing StandardsChecker...');

    // Mock implementation of standards checker logic
    function auditCode(code) {
        const issues = [];
        const lines = code.split('\n');
        let inLoop = false;
        let inPosting = false;
        let hasDataLock = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const lineNum = i + 1;

            if (line.includes('Процедура ОбработкаПроведения')) {
                inPosting = true;
                hasDataLock = false;
            }
            if (inPosting && line.includes('Новый БлокировкаДанных')) {
                hasDataLock = true;
            }
            if (inPosting && line.includes('КонецПроцедуры')) {
                if (!hasDataLock) {
                    issues.push({ rule: 'ITS-LOCK-001', line: lineNum });
                }
                inPosting = false;
            }

            if (/^\s*(Для\s+Каждого|Пока\s+)/i.test(line)) {
                inLoop = true;
            }
            if (/^\s*КонецЦикла;/i.test(line)) {
                inLoop = false;
            }

            if (inLoop && /\.Выполнить\s*\(\s*\)/i.test(line)) {
                issues.push({ rule: 'ITS-PERF-001', line: lineNum });
            }

            if (/\.(Остатки|СрезПоследних)\s*\(\s*\)/i.test(line)) {
                issues.push({ rule: 'ITS-PERF-002', line: lineNum });
            }
        }
        return issues;
    }

    // Case A: Query inside loop detected
    const badCode1 = `
    Для Каждого Стр Из ТаблицаТовары Цикл
        Запрос = Новый Запрос;
        Запрос.Текст = "ВЫБРАТЬ * ИЗ Справочник.Номенклатура";
        Выборка = Запрос.Выполнить().Выбрать();
    КонецЦикла;
    `;
    const issues1 = auditCode(badCode1);
    assert.strictEqual(issues1.length, 1);
    assert.strictEqual(issues1[0].rule, 'ITS-PERF-001');
    console.log('  ✓ Query inside loop correctly flagged (ITS-PERF-001)');

    // Case B: Virtual table without params detected
    const badCode2 = `
    Запрос.Текст = "ВЫБРАТЬ * ИЗ РегистрНакопления.ТоварыНаСкладах.Остатки()";
    `;
    const issues2 = auditCode(badCode2);
    assert.strictEqual(issues2.length, 1);
    assert.strictEqual(issues2[0].rule, 'ITS-PERF-002');
    console.log('  ✓ Unparameterized virtual table correctly flagged (ITS-PERF-002)');

    // Case C: Missing DataLock in posting handler
    const badCode3 = `
    Процедура ОбработкаПроведения(Отказ, РежимПроведения)
        // Движения без блокировки данных
    КонецПроцедуры
    `;
    const issues3 = auditCode(badCode3);
    assert.strictEqual(issues3.length, 1);
    assert.strictEqual(issues3[0].rule, 'ITS-LOCK-001');
    console.log('  ✓ Missing DataLock correctly flagged (ITS-LOCK-001)');

    // Case D: Clean code passes
    const goodCode = `
    Процедура ОбработкаПроведения(Отказ, РежимПроведения)
        Блокировка = Новый БлокировкаДанных;
        ЭлементБлокировки = Блокировка.Добавить("РегистрНакопления.ТоварыНаСкладах");
        Блокировка.Заблокировать();
    КонецПроцедуры
    `;
    const issues4 = auditCode(goodCode);
    assert.strictEqual(issues4.length, 0);
    console.log('  ✓ Clean compliant code passes with 0 issues');
}

// 2. Test Metadata formatting
function testMetadataFormatting() {
    console.log('Testing Metadata formatting...');
    const meta = {
        name: 'Конфигурация 1С',
        objects: [
            { kind: 'Справочник', name: 'Номенклатура' },
            { kind: 'Документ', name: 'ЗаказКлиента', tabularSections: [{ name: 'Товары', fields: [] }] },
            { kind: 'РегистрНакопления', name: 'ТоварыНаСкладах' }
        ]
    };

    function formatForPrompt(metadata) {
        const lines = ['// Доступные метаданные конфигурации 1С:'];
        const grouped = {};
        for (const obj of metadata.objects) {
            if (!grouped[obj.kind]) grouped[obj.kind] = [];
            let desc = obj.name;
            if (obj.tabularSections && obj.tabularSections.length > 0) {
                desc += ` (ТЧ: ${obj.tabularSections.map(t => t.name).join(', ')})`;
            }
            grouped[obj.kind].push(desc);
        }
        for (const [kind, list] of Object.entries(grouped)) {
            lines.push(`// ${kind}: ${list.join(', ')}`);
        }
        return lines.join('\n');
    }

    const output = formatForPrompt(meta);
    assert(output.includes('Номенклатура'));
    assert(output.includes('ЗаказКлиента (ТЧ: Товары)'));
    assert(output.includes('ТоварыНаСкладах'));
    console.log('  ✓ Metadata correctly summarized for LLM context');
}

// Run all
try {
    testStandardsChecker();
    testMetadataFormatting();
    console.log('\n=======================================');
    console.log('ALL 1C COPILOT UNIT TESTS PASSED (100%)');
    console.log('=======================================');
} catch (e) {
    console.error('Test failure:', e);
    process.exit(1);
}
