'use strict';
const assert=require('node:assert/strict'), crypto=require('node:crypto'), Module=require('node:module');
const {queryChoices}=require('../out/features/create-validation-plan/model/queryChoices');
const {parseColumns,parseTypedCsv}=require('../out/features/create-validation-plan/model/typedCsv');
const {createUserPlan}=require('../out/features/create-validation-plan/model/createPlan');
const {materializeSingleFileChange,createSingleFileChange}=require('../out/entities/code-change/model/singleFileChange');
const {sha256Text}=require('../out/shared/lib/sha256');
const {profile:makeProfile,request:makeRequest}=require('./helpers/runnerData');
const profile=makeProfile(crypto.generateKeyPairSync('ed25519').publicKey);
const raw=makeRequest(profile,'ВЫБРАТЬ "A" КАК Товар, 2 КАК Дефицит',true);
const artifact={identity:raw.candidate,code:raw.candidateCode,isCurrent:()=>true};
const tests=[],test=(name,run)=>tests.push({name,run});
test('Query choices preserve UTF-16 positions, doubled quotes, CRLF and comment exclusion',()=>{
 const code='// "ВЫБРАТЬ 0"\r\n// 😀\r\nЗапрос.Текст = "ВЫБРАТЬ\r\n| ""A"" КАК Товар";';
 const c=queryChoices(code);assert.equal(c.length,1);assert.equal(c[0].start,code.indexOf('"ВЫБРАТЬ\r'));
 assert.equal(c[0].query,'ВЫБРАТЬ\n "A" КАК Товар');assert.equal(c[0].line,3);
});
test('Dynamic concatenations and unsupported batches cannot masquerade as complete query literals',()=>{
 for(const code of ['Запрос.Текст = "ВЫБРАТЬ 1" + Поля;', 'Запрос.Текст = Поля + "ВЫБРАТЬ 1";', 'Запрос.Текст = "ВЫБРАТЬ 1; ВЫБРАТЬ 2";', '// ВЫБРАТЬ 1'])assert.equal(queryChoices(code).length,0);
 assert.equal(queryChoices('SELECT 1').length,1);assert.equal(queryChoices('A="ВЫБРАТЬ 1";B="ВЫБРАТЬ 2";').length,2);
});
test('CSV keeps large exact decimals, duplicate rows, quoting and explicit NULL distinct from literal strings',()=>{
 const t=parseTypedCsv('Товар:string;Количество:number\r\n"NULL";9007199254740993,1250\r\nNULL;-0\r\n"NULL";9007199254740993.125\r\n');
 assert.equal(t.rows[0][0].value,'NULL');assert.equal(t.rows[0][1].value,'9007199254740993.125');assert.equal(t.rows[1][0].type,'null');assert.equal(t.rows[1][1].value,'0');assert.deepEqual(t.rows[0],t.rows[2]);
 assert.equal(parseTypedCsv('X:string\n"A;B\n""C"""\n').rows[0][0].value,'A;B\n"C"');
});
test('CSV supports typed dates, booleans, nonempty references, empty references and undefined',()=>{
 const t=parseTypedCsv('D:date;B:boolean;R:reference;U:string\n2024-02-29T00:00:00;Истина;Справочник.Товары#aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee;UNDEFINED\n2024-02-29T00:00:00;false;EMPTYREF:Справочник.Товары;"UNDEFINED"');
 assert.equal(t.rows[0][1].value,true);assert.equal(t.rows[0][2].type,'reference');assert.equal(t.rows[1][2].type,'empty_reference');assert.equal(t.rows[0][3].type,'undefined');assert.equal(t.rows[1][3].value,'UNDEFINED');
});
test('Malformed CSV, implicit empty numbers, duplicate columns and precision-destroying numbers are rejected',()=>{
 for(const text of ['A:number\n1e3','A:number\n','A:number\n\n','A:string;a:string\nx;y','A:date\n2023-02-29T00:00:00','A:string\n"x"tail','A:string\nx;y','A:string\n"x','A:reference\nabc']) {
  if(text==='A:number\n'){assert.equal(parseTypedCsv(text).rows.length,0);continue;}assert.throws(()=>parseTypedCsv(text));
 }
 assert.throws(()=>parseColumns('A:unknown'));assert.throws(()=>parseTypedCsv('A:string\n'+'x\n'.repeat(2001)));
});
test('Native manual plan binds the actual candidate and pinned scope, hashes user requirement and stays proposed',()=>{
 const requirement='Две строки по 6, остаток 10: дефицит 2.';
 const plan=createUserPlan(artifact,profile,queryChoices(artifact.code)[0],{requirement,reference:'TASK-1',preconditions:['Own fixture'],assumptions:[],mode:'multiset',expected:parseTypedCsv('Товар:string;Дефицит:number\nA;2')});
 assert.equal(plan.contract.approvalState,'proposed');assert.equal(plan.contract.projectId,artifact.identity.scopeHash);assert.equal(plan.contract.scope.metadataHash,profile.metadataHash);
 assert.equal(plan.contract.requirement.sha256,crypto.createHash('sha256').update(requirement,'utf8').digest('hex'));
 assert.throws(()=>createUserPlan({...artifact,isCurrent:()=>false},profile,queryChoices(artifact.code)[0],{}),/контекст/);
});
test('Diff materializes exact insertion and replacement, preserving unsaved code units and refusing mixed snapshots',()=>{
 const base='А😀\r\nБ',source={schemaVersion:1,sourceUri:'file:///a.bsl',projectUri:null,languageId:'bsl',documentVersion:1,lifecycleEpoch:0,contentHash:sha256Text(base),textHashEncoding:'utf16le',documentLength:base.length};
 const change=createSingleFileChange(source,{start:5,end:6},'В');assert.equal(materializeSingleFileChange(source,base,change,'В'),'А😀\r\nВ');
 assert.throws(()=>materializeSingleFileChange(source,base+'x',change,'В'));assert.throws(()=>materializeSingleFileChange(source,base,change,'OTHER'));
});
let load=Module._load;Module._load=function(name,parent,main){if(name==='vscode')return {};return load.call(this,name,parent,main);};
const {validationPlanWizard}=require('../out/app/validation/api/validationPlanWizard');Module._load=load;
function uiFixture(){
 let inputs=['6+6, stock 10 => deficit 2','TASK-1','Own fixture','', 'Товар:string;Дефицит:number','A;2'];
 let choices=['0','manual','add','finish','multiset'];const state={confirmed:0,cancelInput:false,current:true};
 return {state,ui:{async input(options){if(state.cancelInput)return undefined;const value=inputs.shift();assert.equal(options.validateInput(value),undefined);return value;},
 async pick(items){const next=choices.shift();return items.find(i=>i.action===next);},async file(){throw Error('manual flow must not read files');},
 async confirm(message,options,label){state.confirmed++;assert.equal(options.modal,true);assert.match(options.detail,/не являются утверждённым/);return label;}}};
}
test('Native wizard requires independent inputs and explicit proposal confirmation without any AI or file read',async()=>{
 const f=uiFixture(),p=await validationPlanWizard(artifact,profile,f.ui,s=>s,()=>{assert.ok(f.state.current);});
 assert.equal(f.state.confirmed,1);assert.equal(p.contract.assertion.expected.rows[0][1].value,'2');assert.equal(p.selection.start,raw.selection.start);
});
test('Cancelling or changing the source while a wizard input is open produces no plan or confirmation',async()=>{
 const f=uiFixture();f.state.cancelInput=true;assert.equal(await validationPlanWizard(artifact,profile,f.ui,s=>s,()=>{}),undefined);assert.equal(f.state.confirmed,0);
 const g=uiFixture();g.ui.input=async()=>{g.state.current=false;return 'own';};await assert.rejects(validationPlanWizard(artifact,profile,g.ui,s=>s,()=>{if(!g.state.current)throw Error('stale');}),/stale/);assert.equal(g.state.confirmed,0);
});
(async()=>{for(const t of tests){await t.run();console.log('  ✓ '+t.name);}console.log('Extension workflows: '+tests.length+' groups passed.');})().catch(e=>{console.error(e);process.exitCode=1;});
