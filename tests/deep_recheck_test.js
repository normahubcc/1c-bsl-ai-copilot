// Independent negative scenarios found during the second product review.
const assert = require('node:assert/strict');
const Module = require('node:module');
const {textGeometry}=require('./helpers/textGeometry');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const settings = {enableInlineCompletion:true,debounceMs:0,autocompleteModel:'deepseek-v4.1-flash-1017',reasoningModel:'gpt-6-sol'};
const folder = {uri:{fsPath:'/work',toString:()=> 'file:///work'}};
const editors = new Map();
let workspaceOverride, lastTarget;
const api = {
 workspace:{isTrusted:true,workspaceFolders:[folder],textDocuments:[],getWorkspaceFolder:uri=>uri.toString().startsWith('file:///work/')?folder:undefined,getConfiguration:()=>({
  get:(key,fallback)=>key==='reasoningModel'&&workspaceOverride!==undefined?workspaceOverride:settings[key]??fallback,
  inspect:key=>({workspaceValue:key==='reasoningModel'?workspaceOverride:undefined}),
  update:async(key,value,target)=>{lastTarget=target;if(target===2)workspaceOverride=value;else settings[key]=value;}
 }),openTextDocument:async uri=>editors.get(uri.toString()).document},
 window:{activeTextEditor:undefined,showTextDocument:async doc=>editors.get(doc.uri.toString())},
 ConfigurationTarget:{Global:1,Workspace:2,WorkspaceFolder:3},
 Position:class{constructor(line,character){Object.assign(this,{line,character});}},
 Range:class{constructor(start,end){Object.assign(this,{start,end});}},
 InlineCompletionItem:class{constructor(insertText,range){Object.assign(this,{insertText,range});}}
};
const load = Module._load;
Module._load=function(name,...args){return name==='vscode'?api:load.call(this,name,...args);};
const {BSLInlineCompletionProvider: Provider}=require('../out/inlineCompletionProvider');
const {NormaHubClient: Client}=require('../out/normahubClient');
const {PreviewStore,captureEditorTarget}=require('../out/features/apply-code/model/previewStore');
const {NormaHub1CSidebarProvider: Sidebar}=require('../out/sidebarProvider');
const {MetadataScanner: Metadata}=require('../out/metadataScanner');
const {MultiTabScanner}=require('../out/multiTabScanner');
const {getNeighboringModules,DEFAULT_INLINE_CONTEXT_BUDGETS,buildInlineCompletionContext}=require('../out/inlineCompletionContext');
const {QueryBuilder: Query}=require('../out/queryBuilder');
const {ExtensionGenerator: Extension}=require('../out/extensionGenerator');
const {executeTool}=require('../out/entities/toolbox/api/executeTool');
const {watchMetadataChanges}=require('../out/features/project-context/model/watchMetadata');
Module._load=load;
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const token=()=>({isCancellationRequested:false,onCancellationRequested:()=>({dispose(){}})});
function document(name='Module.bsl',text='Процедура Т()\n    Сообщить('){
 const lines=text.split('\n');
 const doc={uri:{scheme:'file',toString:()=> 'file:///work/'+name},fileName:'/work/'+name,languageId:'bsl',version:1,isClosed:false,lineCount:lines.length,
  lineAt:index=>({text:lines[index]||''}),getText:range=>!range?text:lines.slice(range.start.line,range.end.line+1).join('\n'),...textGeometry(()=>text,api.Position)};
 const editor={document:doc,selection:{isEmpty:true,active:new api.Position(1,13)},edit:async callback=>{callback({insert(){},replace(){}});return true;}};
 editors.set(doc.uri.toString(),editor);return doc;
}
const context={secrets:{get:async()=> 'test-key'},subscriptions:[]};
const cases=[];
function test(name,run){cases.push({name,run});}
async function pending(){
 const gate=deferred();Client.getApiKey=async()=> 'test-key';Client.complete=async()=>gate.promise;
 const provider=new Provider(context),doc=document();
 const result=provider.provideInlineCompletionItems(doc,new api.Position(1,13),{},token());await turn();
 return{provider,doc,gate,result};
}
test('inline rejects edits during HTTP even without token cancellation',async()=>{
 const p=await pending();p.doc.version++;p.gate.resolve('Сообщить("ok");');assert.equal(await p.result,null);
});
test('inline rejects a document closed during HTTP',async()=>{
 const p=await pending();p.doc.isClosed=true;p.gate.resolve('Сообщить("ok");');assert.equal(await p.result,null);
});
test('a guard-only invocation cancels the preceding completion',async()=>{
 const p=await pending();settings.enableInlineCompletion=false;
 assert.equal(await p.provider.provideInlineCompletionItems(p.doc,new api.Position(1,13),{},token()),null);
 p.gate.resolve('Сообщить("ok");');assert.equal(await p.result,null);
});
test('async key lookup cannot reorder invocation identity',async()=>{
 const firstKey=deferred();let keys=0,calls=0;
 Client.getApiKey=()=>++keys===1?firstKey.promise:Promise.resolve('test-key');Client.complete=async()=>{calls++;return 'Сообщить("ok");';};
 const provider=new Provider(context),doc=document();
 const older=provider.provideInlineCompletionItems(doc,new api.Position(1,13),{},token());
 const newer=await provider.provideInlineCompletionItems(doc,new api.Position(1,13),{},token());assert.ok(newer);
 firstKey.resolve('test-key');assert.equal(await older,null);assert.equal(calls,1);
});
test('disposing inline provider cancels its in-flight work',async()=>{
 const p=await pending();assert.equal(typeof p.provider.dispose,'function');p.provider.dispose();p.gate.resolve('Сообщить("ok");');assert.equal(await p.result,null);
});
test('preview cannot target a reopened document with reused URI/version',async()=>{
 const original=document();api.window.activeTextEditor=editors.get(original.uri.toString());
 const store=new PreviewStore(),entry=store.add('Сообщить("new");','bsl',captureEditorTarget());
 original.isClosed=true;document('Module.bsl','ДругойТекст = 1;');
 await assert.rejects(store.apply(entry.previewId),/закрыт|переоткрыт|измен/);
});
test('model switch respects an existing workspace override',async()=>{
 workspaceOverride='deepseek-v4.1-flash-1017';const provider=new Sidebar({},{});provider._view={webview:{postMessage(){}}};
 await provider._handleChangeModel('gpt-6.1-sol','reasoningModel');assert.equal(lastTarget,2);assert.equal(workspaceOverride,'gpt-6.1-sol');
});
const query='ВЫБРАТЬ Ост.КоличествоОстаток ИЗ Документ.Заказ.Товары КАК Т ЛЕВОЕ СОЕДИНЕНИЕ РегистрНакопления.Товары.Остатки(&Дата,) КАК Ост ПО Т.Номенклатура = Ост.Номенклатура';
test('query extraction refuses lock/permission-sensitive input',async()=>{
 for(const input of [query+' ДЛЯ ИЗМЕНЕНИЯ РегистрНакопления.Товары.Остатки',query.replace('ВЫБРАТЬ','ВЫБРАТЬ РАЗРЕШЕННЫЕ')]){
  const result=Query.refactorQuery(input);assert.equal(result.refactoredQuery,input);assert.equal(result.appliedOptimizations.length,0);
 }
});
test('batch cannot collide its two temporary table names',async()=>{
 const generated=Query.generateBatchQuery({entityName:'Заказ',tabularSection:'ОстаткиТовары',registerName:'Товары',fields:['Номенклатура','Количество'],includeScaffolding:false});
 const tables=[...generated.matchAll(/ПОМЕСТИТЬ\s+(\S+)/g)].map(match=>match[1].toLowerCase());assert.equal(new Set(tables).size,2);
});
test('schema cache detects changed JSON without a manual scan',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bsl-recheck-'));
 try{
  const file=path.join(root,'metadata.json');
  fs.writeFileSync(file,JSON.stringify({objects:[{kind:'Документ',name:'Первый'}]}));await Metadata.scanWorkspace(root);
  fs.writeFileSync(file,JSON.stringify({objects:[{kind:'Документ',name:'Второй'}]}));const later=new Date(Date.now()+5000);fs.utimesSync(file,later,later);
  assert.equal((await Metadata.scanWorkspace(root)).objects[0].name,'Второй');
 }finally{Metadata.clearCache(root);fs.rmSync(root,{recursive:true,force:true});}
});
test('neighbor context cannot invent exports from comments and strings',async()=>{
 const active=document('Active.bsl'),neighbor=document('CommonModules/РеальныйМодуль/Ext/Module.bsl','// Процедура Фантом() Экспорт\nТекст = "Функция ТожеФантом() Экспорт";\nПроцедура Настоящий() Экспорт\nКонецПроцедуры');
 api.workspace.textDocuments=[active,neighbor];
 const context=MultiTabScanner.getOpenModulesContext(active);assert.ok(!context.includes('Фантом'));assert.ok(context.includes('РеальныйМодуль'));
 const modules=getNeighboringModules(active,DEFAULT_INLINE_CONTEXT_BUDGETS);assert.deepEqual(modules[0].exportedMethods,['Настоящий()']);
});
test('known event inference is case insensitive and module scoped',async()=>{
 const base={targetMethod:'приоткрытии',directive:'Вместо',moduleType:'МодульФормы',isFunction:false,parameters:[]};
 assert.ok(Extension.generateInterceptor(base).includes('(Отказ)'));
 assert.ok(!Extension.generateInterceptor({...base,moduleType:'МодульОбъекта'}).includes('&НаКлиенте'));
});
test('MCP does not coerce invalid booleans into a different operation',async()=>{
 await assert.rejects(executeTool('1c_generate_extension',{targetMethod:'Метод',directive:'Вместо',isFunction:'true'}),/isFunction/);
 await assert.rejects(executeTool('1c_build_batch_query',{entityName:'Док',tabularSection:'Товары',registerName:'Остатки',fields:['Товар','Количество'],includeScaffolding:'false'}),/includeScaffolding/);
});
test('neighbor cache follows document identity and requested method limits',async()=>{
 const active=document('CacheActive.bsl'),first=document('CacheNeighbor.bsl','Процедура Один() Экспорт\nКонецПроцедуры\nПроцедура Два() Экспорт\nКонецПроцедуры');
 api.workspace.textDocuments=[active,first];
 assert.equal(getNeighboringModules(active,DEFAULT_INLINE_CONTEXT_BUDGETS)[0].exportedMethods.length,2);
 assert.equal(getNeighboringModules(active,{...DEFAULT_INLINE_CONTEXT_BUDGETS,maxMethodsPerModule:1})[0].exportedMethods.length,1);
 first.isClosed=true;const reopened=document('CacheNeighbor.bsl','Процедура Новый() Экспорт\nКонецПроцедуры');
 api.workspace.textDocuments=[active,reopened];
 assert.deepEqual(getNeighboringModules(active,DEFAULT_INLINE_CONTEXT_BUDGETS)[0].exportedMethods,['Новый()']);
 assert.deepEqual(getNeighboringModules(active,{...DEFAULT_INLINE_CONTEXT_BUDGETS,maxNeighborModules:0}),[]);
});
test('saved object XML invalidates both scanner and inline context',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bsl-watch-')),watchers=[];
 const lookup=api.workspace.getWorkspaceFolder;
 api.workspace.createFileSystemWatcher=pattern=>{
  const callbacks={};watchers.push({pattern,callbacks});
  return{dispose(){},onDidChange:fn=>{callbacks.change=fn;return{dispose(){}};},onDidCreate:fn=>{callbacks.create=fn;return{dispose(){}};},onDidDelete:fn=>{callbacks.delete=fn;return{dispose(){}};}};
 };
 api.workspace.getWorkspaceFolder=uri=>uri.fsPath?.startsWith(root)?{uri:{fsPath:root,toString:()=>root}}:lookup(uri);
 const subscriptions=watchMetadataChanges();
 try{
  fs.mkdirSync(path.join(root,'Documents'));
  const file=path.join(root,'Documents','Заявка.xml');
  fs.writeFileSync(file,'<MetaDataObject><Attribute><Name>ПервоеПоле</Name></Attribute></MetaDataObject>');
  const doc=document('WatchActive.bsl');
  const first=await buildInlineCompletionContext(doc,new api.Position(1,13),{workspaceRoot:root});assert.ok(first.metadata.summary.includes('ПервоеПоле'));
  fs.writeFileSync(file,'<MetaDataObject><Attribute><Name>НовоеПоле</Name></Attribute></MetaDataObject>');
  watchers[0].callbacks.change({fsPath:file});
  const updated=await buildInlineCompletionContext(doc,new api.Position(1,13),{workspaceRoot:root});assert.ok(updated.metadata.summary.includes('НовоеПоле'));assert.ok(!updated.metadata.summary.includes('ПервоеПоле'));
 }finally{subscriptions.forEach(s=>s.dispose());delete api.workspace.createFileSystemWatcher;api.workspace.getWorkspaceFolder=lookup;Metadata.clearCache(root);fs.rmSync(root,{recursive:true,force:true});}
});
test('form command identifiers use the same normalization as validation',async()=>{
 const code=Extension.generateFormButtonExtension(' Кнопка ', 'Тест', ' Команда ');
 assert.ok(code.includes('Процедура Расш_Команда(Команда)'));
 assert.ok(!code.includes('Расш_ Команда '));
});
test('model acknowledgment reads a fresh configuration snapshot',async()=>{
 const original=api.workspace.getConfiguration;
 api.workspace.getConfiguration=(...args)=>{const config=original(...args);const values={reasoningModel:config.get('reasoningModel'),autocompleteModel:config.get('autocompleteModel')};return {...config,get:(key,fallback)=>values[key]??fallback};};
 try {
  workspaceOverride='deepseek-v4.1-flash-1017';const messages=[];
  const provider=new Sidebar({},{});provider._view={webview:{postMessage:message=>messages.push(message)}};
  await provider._handleChangeModel('gpt-6.1-sol','reasoningModel');
  assert.equal(messages.find(message=>message.type==='modelsChanged').reasoningModel,'gpt-6.1-sol');
 } finally {api.workspace.getConfiguration=original;}
});
test('legacy DeepSeek settings resolve to 1017 in actual completion requests',async()=>{
 const old=settings.autocompleteModel;settings.autocompleteModel='deepseek-v4.1-flash';
 Client.getApiKey=async()=> 'test-key';let model;
 Client.complete=async(_key,chosen)=>{model=chosen;return 'Сообщить("ok");';};
 const provider=new Provider(context);
 try {
  const result=await provider.provideInlineCompletionItems(document(),new api.Position(1,13),{},token());
  assert.equal(model,'deepseek-v4.1-flash-1017');assert.ok(result?.length);
  assert.equal(settings.autocompleteModel,'deepseek-v4.1-flash','Reading legacy config must not rewrite it');
 } finally {settings.autocompleteModel=old;provider.dispose();}
});
test('legacy reasoning settings and sidebar selectors use 1017 while GPT choices survive',async()=>{
 const {runTask,captureSnippetContext}=require('../out/features/ai-task/api/runTask');
 const {resolveModel,validateModel}=require('../out/shared/config/models');
 const old=settings.reasoningModel;let model;
 Client.getApiKey=async()=> 'test-key';Client.complete=async(_key,chosen)=>{model=chosen;return 'Запрос = Новый Запрос;';};
 try {
  for(const chosen of ['deepseek-v4.1-flash','gpt-6.1-sol','gpt-6-sol']) {
   settings.reasoningModel=chosen;
   await runTask(context,'query','Тест',captureSnippetContext(''));
   assert.equal(model,chosen==='deepseek-v4.1-flash'?'deepseek-v4.1-flash-1017':chosen);
  }
  const html=new Sidebar({},{})._getHtmlForWebview('',undefined,'deepseek-v4.1-flash',undefined,'deepseek-v4.1-flash');
  assert.ok(html.includes('value="deepseek-v4.1-flash-1017" selected'));
  assert.ok(!html.includes('value="deepseek-v4.1-flash"'));
  assert.equal(validateModel('deepseek-v4.1-flash'),'deepseek-v4.1-flash-1017');
  assert.equal(resolveModel(undefined),'deepseek-v4.1-flash-1017');
  assert.throws(()=>validateModel('unknown-model'));
 } finally {settings.reasoningModel=old;}
});
async function main(){
 let failed=0;
 for(const {name,run} of cases){
  settings.enableInlineCompletion=true;settings.debounceMs=0;workspaceOverride=undefined;api.workspace.textDocuments=[];
  try{await run();console.log('PASS',name);}catch(error){failed++;console.log('FAIL',name,'—',error.message.split('\n')[0]);}
 }
 console.log(`${cases.length-failed}/${cases.length} deep recheck scenarios passed`);if(failed)process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
