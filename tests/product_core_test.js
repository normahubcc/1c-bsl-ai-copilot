const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {QueryBuilder: Q} = require('../out/queryBuilder');
const {MetadataScanner: M} = require('../out/metadataScanner');
const {StandardsChecker: S} = require('../out/standardsChecker');
const {ExtensionGenerator: E} = require('../out/extensionGenerator');
const {TechLogAnalyzer: T} = require('../out/techLogAnalyzer');
const {executeTool} = require('../out/entities/toolbox/api/executeTool');
async function run() {
  const options={entityName:'ЗаказКлиента',tabularSection:'Состав',registerName:'ОстаткиТоваров',fields:['Номенклатура','Склад','Вес'],includeScaffolding:true};
  const code=Q.generateBatchQuery(options);
  const literal=code.match(/Запрос\.Текст = "([\s\S]*?)";\n/)[1].replace(/\n\|/g,'\n').replace(/""/g,'"');
  assert.equal(literal,Q.generateBatchQuery({...options,includeScaffolding:false}),'BSL string must reconstruct the exact query including whitespace');
  assert.ok(literal.includes('Остатки.Склад КАК Склад'));
  assert.ok(literal.includes('Исходные.Склад = Остатки.Склад'));
  assert.ok(literal.includes('ВесОстаток'));
  for(const invalid of [{entityName:''},{registerName:'РегистрСведений.Цены'},{fields:[]},{fields:['Склад','Склад']},{tabularSection:'A;УДАЛИТЬ'}]) assert.throws(()=>Q.generateBatchQuery({...options,...invalid}));
  const priceQuery='ВЫБРАТЬ Цены.Цена\nИЗ Справочник.Номенклатура КАК Н\nЛЕВОЕ СОЕДИНЕНИЕ РегистрСведений.Цены.СрезПоследних(&Дата,) КАК Цены ПО Н.Ссылка = Цены.Номенклатура';
  const ref=Q.refactorQuery(priceQuery);
  assert.ok(ref.refactoredQuery.includes('Цены.Цена КАК Цена'));
  assert.ok(!ref.refactoredQuery.includes('Цены.Количество'));
  assert.ok(!ref.refactoredQuery.includes('КАК СрезПоследних'));
  assert.ok(!ref.refactoredQuery.includes('ЕСТЬNULL'),'A structural change must not change NULL semantics');
  assert.match(ref.reason,/индекс 1/,'Package result-index change must be explicit');
  for(const unsupported of ['Процедура Т()\n'+priceQuery+'\nКонецПроцедуры',priceQuery+'; ВЫБРАТЬ 1',priceQuery.replace('Цены.Цена','*')]) {
    const result=Q.refactorQuery(unsupported);assert.equal(result.refactoredQuery,unsupported);assert.equal(result.appliedOptimizations.length,0);assert.ok(result.reason);
  }
  const indexedElsewhere='ВЫБРАТЬ ИД ПОМЕСТИТЬ ВТ_A ИЗ A ИНДЕКСИРОВАТЬ ПО ИД; ВЫБРАТЬ ИД ПОМЕСТИТЬ ВТ_B ИЗ B; ВЫБРАТЬ ИД ИЗ A СОЕДИНЕНИЕ ВТ_B ПО A.ИД = ВТ_B.ИД';
  assert.ok(Q.inspectQuery(indexedElsewhere).issues.some(i=>i.code==='ITS-QUERY-002'),'An index on a different table cannot satisfy this table');
  assert.ok(!S.auditCode('// РегистрНакопления.Товары.Остатки()').some(i=>i.rule.startsWith('ITS-')));
  assert.ok(!S.auditCode('// Ссылка.ПолучитьОбъект().Сумма').some(i=>i.rule==='ITS-BSP-001'));
  assert.ok(!S.formatAuditReport([]).includes('Код соответствует'));
  const fast=T.parseLog('00:01.000000-1,DBPOSTGR,1,Sql=SELECT 1');
  assert.equal(T.diagnose(fast).length,0);
  assert.match(T.formatReport([],0),/не распознаны/);
  assert.match(T.formatReport([],1),/Распознано событий: 1/);
  const quoted=T.parseLog("00:01.000000-3000000,DBPOSTGR,1,Sql='SELECT ''a,b''',Context='Док : 12 : Метод()'");
  assert.equal(quoted[0].properties.Sql,"SELECT 'a,b'");assert.equal(quoted[0].contextLocation.line,12);
  const method=E.generateInterceptor({targetMethod:'Рассчитать',directive:'Вместо',moduleType:'ОбщийМодуль',isFunction:true,parameters:['Знач Значение']});
  assert.ok(method.includes('Функция Расш_Рассчитать(Знач Значение)'));assert.ok(method.includes('ПродолжитьВызов(Значение)'));assert.ok(method.includes('Возврат Результат;'));
  assert.throws(()=>E.generateFormButtonExtension('Bad"Name','Заголовок','Команда'));
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bsl-schema-'));
  try {
    assert.equal((await M.scanWorkspace(root)).objects.length,0,'Missing schema must be empty');
    fs.writeFileSync(path.join(root,'metadata.json'),JSON.stringify({name:'РеальнаяСхема',objects:[{kind:'Документ',name:'Заявка',fields:[{name:'Дата'}],tabularSections:[{name:'Состав',fields:[{name:'Вес'}]}]}]}));
    M.clearCache(root);const meta=await M.scanWorkspace(root);
    assert.equal(meta.objects[0].name,'Заявка');assert.equal(meta.isDemoFallback,false);assert.ok(M.formatForPrompt(meta).includes('Состав[Вес]'));
    const viaTool=await executeTool('1c_scan_metadata',{workspacePath:root});assert.equal(viaTool.objectsCount,1);
    fs.writeFileSync(path.join(root,'metadata.json'),'not JSON');M.clearCache(root);await assert.rejects(M.scanWorkspace(root),/неверный JSON/);
  } finally {fs.rmSync(root,{recursive:true,force:true});M.clearCache(root);}
  await assert.rejects(executeTool('1c_build_batch_query',{entityName:'Заказ',tabularSection:'Состав',registerName:'Остатки'}),/fields/);
  await assert.rejects(executeTool('1c_audit_standards',{code:[]}),/code/);
  const local=await executeTool('1c_build_batch_query',{...options,entityName:options.entityName});assert.equal(local.queryCode,code,'MCP/Sidecar and IDE use the same generator');
  console.log('Product core: reconstructed BSL query, multidimensional joins, schema/parameter errors, field/NULL preservation, conservative refusal, comments, log thresholds/quotes, function signatures and JSON metadata passed.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
