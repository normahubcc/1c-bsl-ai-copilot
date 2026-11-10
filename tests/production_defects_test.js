const assert = require('node:assert/strict');
const Module = require('node:module');
const {StandardsChecker:S} = require('../out/standardsChecker');
const {QueryBuilder:Q} = require('../out/queryBuilder');
const {ExtensionGenerator:E} = require('../out/extensionGenerator');
const {splitParameters} = require('../out/shared/bsl/parameters');
const {BDDGenerator:B} = require('../out/bddGenerator');
const {parseVanessaSteps} = require('../out/entities/bdd/model/steps');
const {executeTool} = require('../out/entities/toolbox/api/executeTool');
const {MetadataScanner:M} = require('../out/metadataScanner');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
let groups = 0;
function check(name, fn) { groups++; return Promise.resolve().then(fn).then(()=>console.log('PASS '+name)); }
const has = (code,rule,options) => S.auditCode(code,options).some(i=>i.rule===rule);

async function run() {
 await check('query receiver evidence, loops on one line and reassignment',()=>{
  assert.equal(has('Для Каждого Стр Из Т Цикл Обработчик.Выполнить(Стр); КонецЦикла;','ITS-PERF-001'),false);
  assert.equal(has('Для Каждого Стр Из Т Цикл Запрос.Выполнить(); КонецЦикла;','ITS-PERF-001'),true);
  assert.equal(has('Для Каждого Стр Из Т Цикл Сообщить(Стр); КонецЦикла; Запрос.Выполнить();','ITS-PERF-001'),false);
  assert.equal(has('Выборка = Новый Запрос; Для Каждого Стр Из Т Цикл Выборка.ВыполнитьПакет(); КонецЦикла;','ITS-PERF-001'),true);
  assert.equal(has('Запрос = Новый Структура; Для Каждого Стр Из Т Цикл Запрос.Выполнить(); КонецЦикла;','ITS-PERF-001'),false);
 });
 await check('ordinary exception handling is not a BSP property read',()=>assert.equal(has('Попытка\nРезультат = Запрос.Выполнить();\nИсключение\nВызватьИсключение;\nКонецПопытки;','ITS-BSP-001'),false));
 await check('dynamic first assignment detected without inspecting printed code',()=>{
  assert.equal(has('Сообщить("Запрос.Текст = Запрос.Текст + ""abc"" + Пользователь");','ITS-SEC-001'),false);
  assert.equal(has('Запрос.Текст = "ВЫБРАТЬ Ссылка ИЗ Справочник.Номенклатура ГДЕ Код = " + ПользовательскийВвод;','ITS-SEC-001'),true);
  assert.equal(has('Запрос.Текст = "ВЫБРАТЬ Ссылка " + "ИЗ Справочник.Номенклатура";','ITS-SEC-001'),false);
  assert.equal(has('// Запрос.Текст = "ВЫБРАТЬ " + Ввод;','ITS-SEC-001'),false);
 });
 await check('quoted SQL constants cannot cause performance hints',()=>{
  assert.equal(Q.inspectQuery('ВЫБРАТЬ "РегистрНакопления.Товары.Остатки()" КАК Текст').issues.length,0);
  assert.equal(S.auditCode('Сообщить("ВЫБРАТЬ ИЗ РегистрНакопления.Товары.Остатки()");').length,0);
 });
 await check('embedded query is inspected and located in original module',()=>{
  const issues=S.auditCode('Процедура Т()\nЗапрос = Новый Запрос;\nЗапрос.Текст = "ВЫБРАТЬ *\n|ИЗ РегистрНакопления.Товары.Остатки()";\nКонецПроцедуры');
  assert.ok(issues.some(i=>i.rule==='ITS-QUERY-003' && i.line>=3));
 });
 await check('invalid input never claims validity; plausible queries remain unvalidated',()=>{
  for(const text of ['мимо','ВЫБРАТЬ ИЗ','ВЫБРАТЬ Н.Ссылка ИЗ','ВЫБРАТЬ (1','ВЫБРАТЬ "не закрыто']) {
   const result=Q.inspectQuery(text);assert.equal(result.isValid,false,text);assert.equal(result.hasErrors,true);assert.equal(result.syntaxChecked,false);
  }
  const result=Q.inspectQuery('ВЫБРАТЬ Н.Ссылка ИЗ Справочник.Номенклатура КАК Н');assert.equal(result.isValid,null);assert.equal(result.hasErrors,false);assert.equal(result.syntaxChecked,false);
 });
 await check('NULL hints require nullable-side arithmetic',()=>{
  const join=' ИЗ Документ.Заказ КАК Д ЛЕВОЕ СОЕДИНЕНИЕ Справочник.Номенклатура КАК Н ПО Д.Товар = Н.Ссылка';
  assert.ok(!Q.inspectQuery('ВЫБРАТЬ Д.Ссылка'+join).issues.some(i=>i.code==='ITS-QUERY-004'));
  assert.ok(Q.inspectQuery('ВЫБРАТЬ Н.Цена * 2'+join).issues.some(i=>i.code==='ITS-QUERY-004'));
  assert.ok(!Q.inspectQuery('ВЫБРАТЬ ЕСТЬNULL(Н.Цена, 0) * 2'+join).issues.some(i=>i.code==='ITS-QUERY-004'));
  assert.ok(!Q.inspectQuery('ВЫБРАТЬ Н.Цена * 2 ИЗ Таблица КАК Н; ВЫБРАТЬ Д.Ссылка'+join).issues.some(i=>i.code==='ITS-QUERY-004'));
 });
 await check('rule settings and lexical suppression with re-enable',()=>{
  const warning='Предупреждение("текст");';
  assert.equal(has(warning,'ITS-UI-003',{disabledRules:['ITS-UI-003']}),false);
  assert.equal(has('// normahub-disable-next-line ITS-UI-003\n'+warning,'ITS-UI-003'),false);
  assert.equal(S.auditCode('// normahub-disable ITS-UI-003\n'+warning+'\n// normahub-enable ITS-UI-003\n'+warning).filter(i=>i.rule==='ITS-UI-003').length,1);
  assert.equal(has('Текст = "// normahub-disable ITS-UI-003";\n'+warning,'ITS-UI-003'),true);
 });
 const base={entityName:'Заказ',tabularSection:'Товары',registerName:'Остатки',fields:['Номенклатура=Товар','Склад=@СкладОтгрузки','Количество=Вес'],sourceMode:'table',includeScaffolding:true};
 const metadata={name:'Warehouse',objects:[{kind:'Документ',name:'Заказ',fields:[{name:'СкладОтгрузки',type:'СправочникСсылка.Склады'}],tabularSections:[{name:'Товары',fields:[{name:'Товар',type:'СправочникСсылка.Номенклатура'},{name:'Вес',type:'Число'}]}]},{kind:'РегистрНакопления',name:'Остатки',registerType:'Остатки',fields:[{name:'Номенклатура',role:'dimension',type:'СправочникСсылка.Номенклатура'},{name:'Склад',role:'dimension',type:'СправочникСсылка.Склады'},{name:'Количество',role:'resource',type:'Число'}]}]};
 await check('current-row source, header mapping, renamed resource and result index',()=>{
  const code=Q.generateBatchQuery({...base,metadata});
  assert.match(code,/ИЗ &СтрокиДокумента КАК Входные/);assert.match(code,/Товары.Выгрузить\(\)/);assert.ok(!code.includes('ГДЕ Строки.Ссылка'));
  assert.match(code,/&СкладОтгрузки КАК Склад/);assert.match(code,/СУММА\(Строки.Вес\) КАК Количество/);assert.match(code,/Результаты\[3\]/);
  assert.match(code,/УстановитьПараметр\("СкладОтгрузки", СкладОтгрузки\)/);
  assert.match(Q.generateBatchQuery({...base,sourceMode:'document',metadata}),/Строки.Ссылка.СкладОтгрузки КАК Склад/);
 });
 await check('schema mismatches, missing dimensions, role/type and reserved parameters rejected',()=>{
  for(const override of [{entityName:'НетТакого'},{tabularSection:'НетТакой'},{registerName:'НетТакого'},{fields:['Номенклатура=Нет','Склад=@СкладОтгрузки','Количество=Вес']},{fields:['Номенклатура=Товар','Количество=Вес']},{fields:['Количество=Вес','Номенклатура=Товар']},{fields:['Номенклатура=Товар','Склад=@ПериодКонтроля','Количество=Вес']}]) assert.throws(()=>Q.generateBatchQuery({...base,metadata,...override}));
  assert.throws(()=>Q.generateBatchQuery({...base,metadata:{...metadata,objects:metadata.objects.map(o=>o.kind==='РегистрНакопления'?{...o,registerType:'Обороты'}:o)}}));
 });
 await check('BDD accepts actual steps/tables, preserves requirement and reports unverified execution',async()=>{
  const steps='Given я открываю форму "Заказ"\nWhen я заполняю таблицу\n | Товар | Вес |\n | Деталь | 17 |\nThen я вижу результат';
  const result=await executeTool('1c_generate_bdd_feature',{entityName:'Заказ',prompt:'Скидка 17%, запрет отрицательной суммы.',stepsText:steps});
  assert.equal(result.stepCount,3);assert.equal(result.executionVerified,false);assert.equal(result.status,'steps-unverified');
  assert.match(result.feature,/Дано я открываю форму "Заказ"/);assert.match(result.feature,/\| Деталь \| 17 \|/);assert.match(result.feature,/Скидка 17%/);assert.ok(!result.feature.includes('TODO'));
  assert.equal((await executeTool('1c_generate_bdd_feature',{prompt:'Скидка 17%'})).status,'requirements-only');
  assert.throws(()=>parseVanessaSteps('Когда действие\n| А | Б |\n| 1 |'));
  assert.throws(()=>B.generateFeature({featureName:'Тест\nСценарий: инъекция',scenarios:[]}));
 });
 await check('XML field roles and types retained for schema validation',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'copilot-xml-roles-'));
  try {
   fs.mkdirSync(path.join(root,'AccumulationRegisters'));
   fs.writeFileSync(path.join(root,'AccumulationRegisters','Остатки.xml'),'<AccumulationRegister><Properties><Name>Остатки</Name><RegisterType>Balance</RegisterType></Properties><ChildObjects><Dimension><Properties><Name>Склад</Name><Type><v8:Type>cfg:CatalogRef.Склады</v8:Type></Type></Properties></Dimension><Resource><Properties><Name>Вес</Name><Type><v8:Type>xs:decimal</v8:Type></Type></Properties></Resource></ChildObjects></AccumulationRegister>');
   const schema=await M.scanWorkspace(root);assert.equal(schema.objects[0].registerType,'Остатки');assert.deepEqual(schema.objects[0].fields.map(f=>f.role),['dimension','resource']);assert.equal(schema.objects[0].fields[1].type,'xs:decimal');
  } finally { M.clearCache(root);fs.rmSync(root,{recursive:true,force:true}); }
 });
 await check('interceptor defaults and comma literals are preserved, forwarded arguments are names',()=>{
  const parameters=splitParameters('Знач Имя = "а,б", Флаг = Истина, Число = 17');
  const code=E.generateInterceptor({targetMethod:'Обработать',moduleType:'ОбщийМодуль',directive:'Вместо',isFunction:true,parameters});
  assert.match(code,/Знач Имя = "а,б", Флаг = Истина, Число = 17/);assert.match(code,/ПродолжитьВызов\(Имя, Флаг, Число\)/);
  assert.throws(()=>E.generateInterceptor({targetMethod:'Тест',moduleType:'ОбщийМодуль',directive:'Вместо',isFunction:false,parameters:['Имя = Истина; Сообщить(1)']}));
 });
 await check('BSP does not recommend a reader for writes or commented calls',()=>{
  assert.equal(has('Ссылка.ПолучитьОбъект().Цена = 17;','ITS-BSP-001'),false);
  assert.equal(has('Цена = Ссылка.ПолучитьОбъект().Цена;','ITS-BSP-001'),true);
 });
 await check('query identifiers containing keywords and dynamic fragments avoid false syntax errors',()=>{
  assert.equal(Q.inspectQuery('ВЫБРАТЬ Измерение.Склад ИЗ Таблица КАК Измерение').hasErrors,false);
  assert.equal(Q.inspectQuery('ВЫБРАТЬ "Текст"').hasErrors,false);
  assert.equal(Q.inspectQuery('ВЫБРАТЬ ""').hasErrors,false);
  assert.ok(!S.auditCode('Запрос.Текст = "ВЫБРАТЬ " + Поля + " ИЗ Таблица";').some(i=>i.rule==='QUERY-STRUCTURE'));
 });
 await check('reserved BSL identifiers cannot produce invalid declarations',()=>{
  assert.throws(()=>E.generateInterceptor({targetMethod:'Выполнить',moduleType:'ОбщийМодуль',directive:'Вместо',isFunction:false,parameters:[]}));
 });
 await previewChecks();
 console.log(`Production defects: ${groups} regression groups passed.`);
}

async function previewChecks() {
 const uri={toString:()=> 'file:///work/Module.bsl'},doc={uri,version:1,languageId:'bsl',fileName:'Module.bsl',isClosed:false,getText:()=>'',offsetAt:()=>0,positionAt:()=>({line:0,character:0})};
 let changed, edits=0, openGate;
 const api={TabInputText:class{constructor(uri){this.uri=uri;}},TabInputTextDiff:class{},Position:class{},window:{tabGroups:{all:[],onDidChangeTabs:fn=>{changed=fn;return{dispose(){}};}},showTextDocument:async()=>editor},workspace:{openTextDocument:async()=>{if(openGate)await openGate;return doc;}}};
 const editor={document:doc,selection:{isEmpty:true,active:{}},edit:async()=>{edits++;return true;}};api.window.activeTextEditor=editor;
 const load=Module._load;Module._load=function(name,...args){return name==='vscode'?api:load.call(this,name,...args);};
 const {PreviewStore,captureEditorTarget}=require('../out/features/apply-code/model/previewStore');
 Module._load=load;
 const tab=()=>({input:new api.TabInputText(uri)});
 await check('last tab close invalidates even same live TextDocument and version',async()=>{
  const store=new PreviewStore(),a=tab();api.window.tabGroups.all=[{tabs:[a]}];const target=captureEditorTarget();
  api.window.tabGroups.all=[];changed({closed:[a]});api.window.tabGroups.all=[{tabs:[tab()]}];
  const preview=store.add('НовыйКод','bsl',target);await assert.rejects(store.apply(preview.previewId),/закрыт|переоткрыт/);assert.equal(edits,0);
 });
 await check('closing one split preserves target while another tab remains',async()=>{
  const store=new PreviewStore(),a=tab(),b=tab();api.window.tabGroups.all=[{tabs:[a,b]}];const preview=store.add('Код','bsl',captureEditorTarget());
  api.window.tabGroups.all=[{tabs:[b]}];changed({closed:[a]});await store.apply(preview.previewId);assert.equal(edits,1);
 });
 await check('tab close during awaited apply cannot bypass lifecycle guard',async()=>{
  const store=new PreviewStore(),a=tab();api.window.tabGroups.all=[{tabs:[a]}];const preview=store.add('Код','bsl',captureEditorTarget());
  let release;openGate=new Promise(r=>release=r);const applying=store.apply(preview.previewId);
  api.window.tabGroups.all=[];changed({closed:[a]});release();openGate=undefined;
  await assert.rejects(applying,/переоткрыт/);assert.equal(edits,1);
 });
}
run().catch(error=>{console.error(error);process.exitCode=1;});
