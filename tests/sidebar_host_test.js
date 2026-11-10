// Real host handlers; only the VS Code, disk and AI boundaries are controlled.
const assert = require('node:assert/strict');
const Module = require('node:module');
const {textGeometry}=require('./helpers/textGeometry');
const messages = [], settings = { reasoningModel:'gpt-6-sol', autocompleteModel:'deepseek-v4.1-flash-1017' };
const documents = new Map(), edits = [], listeners = {};
const disposable = { dispose() {} };
let receive, key = 'nr_hub_test', renders = 0;
const api = {
  workspace:{ isTrusted:true,workspaceFolders:[],textDocuments:[],getConfiguration:()=>({get:(k,d)=>settings[k]??d,update:async(k,v)=>{settings[k]=v;}}),openTextDocument:async uri=>{
    if (uri.content !== undefined) return {uri:{toString:()=> 'untitled:result'},languageId:uri.language,getText:()=>uri.content};
    return documents.get(uri.toString()).document;
  }},
  window:{activeTextEditor:undefined,onDidChangeActiveTextEditor:fn=>{listeners.editor=fn;return disposable;},onDidChangeTextEditorSelection:()=>disposable,showInformationMessage(){},showWarningMessage(){},showErrorMessage(){},showTextDocument:async doc=>documents.get(doc.uri.toString())||{document:doc}},
  commands:{executeCommand:async()=>{}},
  env:{clipboard:{writeText:async()=>{}}},ConfigurationTarget:{Global:1},TextEditorRevealType:{InCenter:1},
  Position:class {constructor(line,character){Object.assign(this,{line,character});}},
  Range:class {constructor(start,end){Object.assign(this,{start,end});}},
  Selection:class {constructor(start,end){Object.assign(this,{start,end});}}
};
const load = Module._load;
Module._load = function(name,...args){return name==='vscode'?api:load.call(this,name,...args);};
const {NormaHub1CSidebarProvider}=require('../out/sidebarProvider');
const {NormaHubClient}=require('../out/normahubClient');
const {MetadataScanner}=require('../out/metadataScanner');
Module._load=load;
const last = type=>messages.filter(m=>m.type===type).at(-1);
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function editor(name, code='Итог = 1;', selected=false, languageId='bsl') {
  const uri={scheme:'file',toString:()=> 'file:///work/'+name};
  const doc={uri,fileName:name,languageId,version:1,lineCount:code.split('\n').length,getText:()=>code,...textGeometry(()=>code,api.Position)};
  const selection={isEmpty:!selected,start:new api.Position(0,0),end:new api.Position(0,code.length),active:new api.Position(0,0)};
  const ed={document:doc,selection,revealRange(){},edit:async fn=>{fn({insert:(position,text)=>{ed.inserted={position,text};edits.push({name,text});},replace:(range,text)=>{ed.replaced={range,text};edits.push({name,text});}});doc.version++;return true;}};
  documents.set(uri.toString(),ed);return ed;
}
async function run(){
  let scans=0, balances=0;
  const gateway=deferred();
  NormaHubClient.checkBalance=async()=>{balances++;return gateway.promise;};
  MetadataScanner.scanWorkspace=async()=>{scans++;return {name:'Test',objects:[],isDemoFallback:false};};
  const context={subscriptions:[],secrets:{get:async()=>key,store:async(_,v)=>{key=v;},delete:async()=>{key='';}}};
  const view={webview:{set html(v){this.renderedHtml=v;renders++;},postMessage:m=>{messages.push(m);return Promise.resolve(true);},onDidReceiveMessage:fn=>{receive=fn;return disposable;}}};
  const provider=new NormaHub1CSidebarProvider({fsPath:'/ext'},context);
  await provider.resolveWebviewView(view,{},{});
  assert.equal(scans,0); assert.equal(balances,0); assert.equal(renders,1);
  const original=editor('Untitled-1','Итог = 1;');api.window.activeTextEditor=original;
  const ready=receive({type:'webviewReady'});gateway.resolve({status:'active'});await ready;
  assert.equal(last('editorContext').isBsl,true);assert.equal(last('sidebarStatus').metadataAvailable,false);
  for(const request of [
    {type:'generateBatchTemplate',entity:'ЗаказКлиента',tabular:'Товары',register:'ТоварыНаСкладах',fields:['Номенклатура','Склад','Количество']},
    {type:'generateExtension',method:'ПриОткрытии',moduleType:'МодульФормы',directive:'Вместо',params:''},
    {type:'generateFormButton',buttonName:'Кнопка',title:'Печать "Акта"',commandName:'Печать'}
  ]){await receive(request);assert.ok(messages.at(-1).previewId);assert.equal(edits.length,0,'Generation cannot edit files');}
  assert.ok(last('extensionResult').code.includes('Расш_ПриОткрытии(Отказ)'));
  assert.ok(last('formBtnResult').code.includes('Заголовок = "Печать ""Акта""";'));
  const form=last('formBtnResult');
  api.window.activeTextEditor=editor('other.json','{}',false,'json');
  await receive({type:'insertCode',previewId:form.previewId});
  assert.equal(edits[0].name,'Untitled-1','Explicit apply targets the captured document even if active editor changes');
  assert.equal(edits.length,1);
  await receive({type:'insertCode',previewId:form.previewId});assert.equal(edits.length,1,'A preview applies only once');
  await receive({type:'insertCode',code:'Injected raw text'});assert.equal(edits.length,1,'Arbitrary raw code has no apply capability');
  api.window.activeTextEditor=original;
  await receive({type:'generateExtension',method:'ПриОткрытии',moduleType:'МодульФормы',directive:'Вместо',params:''});
  const changed=last('extensionResult');original.document.version++;
  await receive({type:'insertCode',previewId:changed.previewId});assert.match(last('toast').message,/изменён/);assert.equal(edits.length,1);
  await receive({type:'generateExtension',method:'ПриОткрытии',moduleType:'МодульФормы',directive:'Вместо',params:''});
  const blocked=last('extensionResult');const edit=original.edit;original.edit=async()=>false;
  await receive({type:'insertCode',previewId:blocked.previewId});assert.match(last('toast').message,/Не удалось вставить/);original.edit=edit;
  await receive({type:'changeModel',model:'gpt-6.1-sol',purpose:'reasoningModel'});
  assert.equal(settings.reasoningModel,'gpt-6.1-sol');assert.equal(settings.autocompleteModel,'deepseek-v4.1-flash-1017');
  await receive({type:'changeModel',model:'gpt-6-sol',purpose:'autocompleteModel'});
  assert.equal(settings.reasoningModel,'gpt-6.1-sol');assert.equal(settings.autocompleteModel,'gpt-6-sol');
  await receive({type:'saveKey',value:'nr_hub_updated'});assert.equal(renders,1);assert.match(last('sidebarStatus').maskedKey,/nr_hub_u/);
  await receive(null);await receive({type:'saveKey',value:'   '});assert.equal(key,'nr_hub_updated','Blank input must not delete a saved key');
  await receive({type:'generateBatchTemplate',entity:'',tabular:'',register:'',fields:[]});assert.ok(last('batchResult').error);
  await receive({type:'generateBdd',entity:'ЗаказКлиента',tabular:'Состав',register:'Отгрузки',prompt:'Скидка ровно 17%',openEditor:false});
  assert.match(last('bddResult').feature,/Скидка ровно 17%/);assert.match(last('bddResult').feature,/Состав/);assert.ok(!last('bddResult').feature.includes('Тестовый товар'));
  const selection=editor('audit.bsl','Предупреждение("Тест");',true);selection.selection.start.line=40;selection.document.lineCount=100;api.window.activeTextEditor=selection;
  await receive({type:'auditSelection'});assert.equal(last('auditResult').issues[0].line,41);
  api.window.activeTextEditor=original;await receive({type:'jumpToLine',line:41});assert.equal(selection.selection.start.line,40);
  selection.document.version++;await receive({type:'jumpToLine',line:41});assert.match(last('toast').message,/изменён после проверки/);
  await receive({type:'auditCodeSnippet',code:'Предупреждение("Тест");'});assert.equal(last('auditResult').canJump,false);
  const network=deferred();let calls=0,captured;
  NormaHubClient.complete=async(...args)=>{calls++;captured=args;return network.promise;};
  api.window.activeTextEditor=original;
  const first=receive({type:'generateQuery',intent:'Остатки на дату'});await new Promise(r=>setImmediate(r));
  await receive({type:'generateQuery',intent:'Повтор'});assert.equal(calls,1);
  api.window.activeTextEditor=editor('new.bsl');network.resolve('```bsl\nЗапрос = Новый Запрос;\n```');await first;
  assert.equal(last('queryResult').targetName,'Untitled-1');assert.equal(last('queryResult').code,'Запрос = Новый Запрос;');
  assert.ok(captured[3].includes('Итог = 1;'));assert.ok(!captured[2].includes('Демо-схема'));assert.equal(last('taskState').busy,false);
  NormaHubClient.complete=async()=>'';await receive({type:'generateQuery',intent:'Остатки'});assert.match(last('queryResult').error,/пустой ответ/);
  NormaHubClient.complete=async()=>'// Уточните схему.';await receive({type:'generateQuery',intent:'Остатки'});assert.match(last('queryResult').error,/только комментарии/);
  NormaHubClient.complete=async()=>{throw new Error('Сеть недоступна');};await receive({type:'generateQuery',intent:'Остатки'});assert.match(last('queryResult').error,/Сеть недоступна/);
  await receive({type:'scanMetadata'});assert.equal(last('metadataResult').objectsCount,0);
  const malicious=provider._getHtmlForWebview('<img src=x>',{error:'<script>bad()</script>'},'gpt-6-sol');
  assert.ok(!malicious.includes('<script>bad()</script>'));assert.ok(malicious.includes('&lt;script&gt;bad()&lt;/script&gt;'));
  assert.ok(!malicious.includes('handleMockPreviewAction'));assert.ok(!malicious.includes('Тестовый товар'));
  await provider.openTool('extensions');assert.equal(last('navigateTool').tool,'extensions');
  const {PreviewStore,captureEditorTarget}=require('../out/features/apply-code/model/previewStore');
  api.window.activeTextEditor=original;
  const store=new PreviewStore(),entry=store.add('Итог = 2;','bsl',captureEditorTarget());
  const gate=deferred();let applications=0;
  original.edit=async()=>{applications++;await gate.promise;return true;};
  const applying=store.apply(entry.previewId);await new Promise(r=>setImmediate(r));
  await assert.rejects(store.apply(entry.previewId),/уже применяется/);
  gate.resolve();await applying;assert.equal(applications,1,'Concurrent clicks cannot duplicate an insertion');

  const {workspaceRoot}=require('../out/shared/config/workspace');
  const folderA={uri:{fsPath:'/a',toString:()=> 'file:///a'}},folderB={uri:{fsPath:'/b',toString:()=> 'file:///b'}};
  api.workspace.workspaceFolders=[folderA,folderB];
  api.workspace.getWorkspaceFolder=uri=>uri.toString().startsWith('file:///a/')?folderA:undefined;
  assert.equal(workspaceRoot({uri:{scheme:'file',toString:()=> 'file:///a/module.bsl'}}),'/a');
  assert.equal(workspaceRoot({uri:{scheme:'file',toString:()=> 'file:///outside/module.bsl'}}),'');
  assert.equal(workspaceRoot({uri:{scheme:'untitled',toString:()=> 'untitled:1'}}),'','Ambiguous multi-root context must stay empty');
  console.log('Sidebar host: startup, shared previews, captured targets, single apply, version guards, model separation, BDD requirements, AI results/errors and audit navigation passed.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
