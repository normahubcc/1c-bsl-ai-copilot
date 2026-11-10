// Own disposable fixture only. Does not run 1C, open a user base or invoke a model.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const base = process.argv[2] && path.resolve(process.argv[2]);
const mounted = process.argv[3];
if (!base || !mounted || !/^\/lab\/[a-zA-Z0-9_-]+$/.test(mounted)) throw new Error('Use a new absolute host lab directory and /lab/<single-new-subdirectory>.');
if (fs.existsSync(base)) throw new Error('Refusing to overwrite an existing directory.');
const runId = randomUUID();
const startedAt = new Date().toISOString();
execFileSync(process.execPath, [path.join(__dirname, 'prepare.js'), base], { stdio: 'inherit' });
const file = path.join(base, 'config/CommonModules/Проверки/Ext/Module.bsl');
let moduleText = fs.readFileSync(file, 'utf8').replaceAll('/lab/query-results.txt', mounted + '/query-results.txt');
const correct = fs.readFileSync(path.join(base, 'generated-Текущие.bsl'), 'utf8');
const broken = correct.replace('СУММА(Строки.Вес)', 'Строки.Вес')
    .replace('|СГРУППИРОВАТЬ ПО Строки.Товар, Строки.Склад\n', '');
if (broken === correct || broken.includes('СУММА(Строки.Вес)') || broken.includes('|СГРУППИРОВАТЬ ПО Строки.Товар')) throw new Error('Controlled mutation no longer matches the generator; review the fixture.');
fs.writeFileSync(path.join(base, 'controlled-per-line-mutation.bsl'), broken);
moduleText += `
Функция ОшибочнаяПроверкаСтрок(Док, ПериодКонтроля)
 Товары = Док.Товары;
 ${broken}
 Возврат ТаблицаДефицита;
КонецФункции

Процедура ЗапуститьПроверкиСравнения() Экспорт
 Журнал = Новый ЗаписьТекста("${mounted}/verification-results.txt", КодировкаТекста.UTF8);
 Журнал.ЗаписатьСтроку("RUN|${runId}");
 Попытка
  ОстаткиДляТеста();
  Док = Заказ("A", "W1", 6);
  СтрокаТовара = Док.Товары.Добавить();
  СтрокаТовара.Товар = "A"; СтрокаТовара.Склад = "W1"; СтрокаТовара.Вес = 6;
  ВерныйРезультат = ДефицитТекущие(Док, Дата(2026, 1, 3));
  ОшибочныйРезультат = ОшибочнаяПроверкаСтрок(Док, Дата(2026, 1, 3));
  Утверждение(ВерныйРезультат.Количество() = 1, "Expected exactly one deficit row");
  Утверждение(ВерныйРезультат[0].Номенклатура = "A" И ВерныйРезультат[0].Дефицит = 2, "Expected independently specified deficit 2");
  Утверждение(ОшибочныйРезультат.Количество() = 0, "Controlled per-line defect must miss the aggregate deficit");
  Журнал.ЗаписатьСтроку("correct.count|" + Строка(ВерныйРезультат.Количество()));
  Для Каждого СтрокаРезультата Из ВерныйРезультат Цикл
   Журнал.ЗаписатьСтроку("correct.row|" + СтрокаРезультата.Номенклатура + "|" + Строка(СтрокаРезультата.Дефицит));
  КонецЦикла;
  Журнал.ЗаписатьСтроку("broken.count|" + Строка(ОшибочныйРезультат.Количество()));
  Журнал.ЗаписатьСтроку("PASS|typed_comparison");
 Исключение
  Журнал.ЗаписатьСтроку("FAIL|" + ОписаниеОшибки());
 КонецПопытки;
 Журнал.Закрыть();
КонецПроцедуры
`;
fs.writeFileSync(file, moduleText);
fs.writeFileSync(path.join(base, 'config/Ext/ManagedApplicationModule.bsl'),
    'Процедура ПриНачалеРаботыСистемы()\nПроверки.ЗапуститьПроверкиСравнения();\nЗавершитьРаботуСистемы(Ложь);\nКонецПроцедуры\n');
const sha256 = value => createHash('sha256').update(value).digest('hex');
fs.writeFileSync(path.join(base, 'verification-manifest.json'), JSON.stringify({
    schemaVersion: 1, runId, createdAt: startedAt, mounted, platformVersion: '8.3.27.1508',
    fixture: 'own-training-file-base', controlledMutation: true,
    correctSourceHash: sha256(correct), mutatedSourceHash: sha256(broken), moduleHash: sha256(moduleText),
    expected: { columns: ['Номенклатура', 'Дефицит'], rows: [[{ type: 'string', value: 'A' }, { type: 'number', value: '2' }]] }
}, null, 2));
console.log('Prepared new isolated verification fixture: ' + runId + '; controlled mutation is test-only.');
