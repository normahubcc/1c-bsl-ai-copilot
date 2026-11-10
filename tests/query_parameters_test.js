'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {profile:makeProfile,request:makeRequest,table,isolation,hash}=require('./helpers/runnerData');
const {parseRunnerProfile,parseRunnerRequest,createRunnerChallenge}=require('../out/entities/runner/model/queryJob');
const {parseQueryParameters,queryParameterNames}=require('../out/entities/runner/model/parameters');
const {parseEngineObservation,signRunnerReceipt,verifyRunnerReceipt}=require('../out/entities/runner/model/receipt');
const {executeQueryJob,executePreparedQueryJob}=require('../out/app/runner/api/executeQueryJob');
const {preparedJobEnvelope,requestFromHostPlan}=require('../out/entities/runner/model/preparedJob');
const {jsonHash}=require('../out/shared/lib/jsonContract');
const keys=crypto.generateKeyPairSync('ed25519'),privatePem=keys.privateKey.export({type:'pkcs8',format:'pem'}).toString(),publicPem=keys.publicKey.export({type:'spki',format:'pem'}).toString();
const p1=makeProfile(keys.publicKey),p2=parseRunnerProfile({...p1,schemaVersion:2,kind:'query_text_fixture_v2',profileId:'own-parameters-v2'});
const make=(parameters=[{name:'Склад',value:{type:'string',value:'W1'}}])=>({...makeRequest(p2,'ВЫБРАТЬ &Склад КАК Товар, 2 КАК Дефицит',true),schemaVersion:2,parameters});
const tests=[],test=(name,run)=>tests.push({name,run});
test('Parameter scanner ignores quoted/comment values, supports escaped quotes and deduplicates names case-insensitively',()=>{
 assert.deepEqual(queryParameterNames('ВЫБРАТЬ "&Секрет"";" КАК X, &Склад // &Лишний\nГДЕ &склад = &Дата'),['склад','Дата']);
 assert.throws(()=>queryParameterNames('ВЫБРАТЬ &Плохое.Имя &И'+ 'я'.repeat(64)));
});
test('Typed scalar parameters preserve decimal precision, empty strings, dates, null and booleans',()=>{
 const parameters=parseQueryParameters([{name:'Число',value:{type:'number',value:'9007199254740993.1250'}},{name:'Текст',value:{type:'string',value:''}},{name:'Флаг',value:{type:'boolean',value:false}},{name:'Пустое',value:{type:'null'}},{name:'Момент',value:{type:'date',value:'2024-02-29T12:34:56'}}]);
 assert.equal(parameters.find(p=>p.name==='Число').value.value,'9007199254740993.125');assert.ok(Object.isFrozen(parameters));
});
test('Duplicate/reserved/untyped/unsafe/oversized parameters are rejected before execution',()=>{
 for(const value of [[{name:'Дата',value:{type:'null'}}],[{name:'X',value:{type:'null'}},{name:'x',value:{type:'null'}}],[{name:'x',value:{type:'undefined'}}],[{name:'x',value:{type:'number',value:2}}],[{name:'x',value:{type:'string',value:'\ud800'}}],[{name:'x',value:{type:'string',value:'a\0'}}],[{name:'x',value:{type:'number',value:'1'.repeat(39)}}],[{name:'x',value:{type:'date',value:'2023-02-29T00:00:00'}}]])assert.throws(()=>parseQueryParameters(value));
 assert.throws(()=>parseQueryParameters(Array.from({length:10},(_,i)=>({name:'x'+i,value:{type:'string',value:'я'.repeat(16384)}}))),/128 KiB/);
});
test('Versioned requests require exact parameter bindings; v1 wire shape and version authority remain distinct',()=>{
 const request=parseRunnerRequest(make());assert.equal(request.schemaVersion,2);assert.equal(request.parameters[0].name,'Склад');
 for(const parameters of [[],[{name:'Other',value:{type:'null'}}],[{name:'Склад',value:{type:'null'}},{name:'Extra',value:{type:'null'}}]])assert.throws(()=>parseRunnerRequest(make(parameters)));
 const legacy=makeRequest(p1);assert.ok(!('parameters' in parseRunnerRequest(legacy)));
 assert.throws(()=>parseRunnerRequest({...legacy,parameters:[]}));assert.throws(()=>createRunnerChallenge(request,parseRunnerProfile(p1)),/versions/);
});
test('Legacy unsupported parameters fail during new-job preflight, but old failed observations stay verifiable',()=>{
 const request=parseRunnerRequest(makeRequest(p1,'ВЫБРАТЬ &Склад КАК Товар, 2 КАК Дефицит',true));
 assert.throws(()=>createRunnerChallenge(request,parseRunnerProfile(p1)),/профиль v2/);
 // Reconstruct the old challenge contract, without inventing current runnability.
 const policy=require('../out/entities/runner/model/queryJob').RUNNER_POLICY,now=Date.now();
 const challenge={schemaVersion:1,jobId:crypto.randomUUID(),nonce:hash('old-nonce'),requestHash:jsonHash(request),profileHash:jsonHash(parseRunnerProfile(p1)),policyHash:jsonHash(policy),createdAt:new Date(now).toISOString(),deadlineAt:new Date(now+policy.deadlineMs).toISOString()};
 const time=new Date(now).toISOString(),observation={schemaVersion:1,nonce:challenge.nonce,platformVersion:p1.platformVersion,binaryHash:p1.binaryHash,status:'failed',actual:null,reason:'Historical missing parameter',logHash:hash('old log')};
 const receipt=signRunnerReceipt(request,parseRunnerProfile(p1),challenge,observation,isolation(),privatePem,time,time);
 assert.equal(verifyRunnerReceipt(receipt,request,parseRunnerProfile(p1),challenge,publicPem,now).queryExecutionVerified,false);
});
test('Receipt v2 binds parameter values and actual worker digest; changing either invalidates evidence',()=>{
 const request=parseRunnerRequest(make()),challenge=createRunnerChallenge(request,p2),time=challenge.createdAt;
 const observation=parseEngineObservation({schemaVersion:2,parametersHash:jsonHash(request.parameters),nonce:challenge.nonce,platformVersion:p2.platformVersion,binaryHash:p2.binaryHash,status:'completed',actual:table(),reason:null,logHash:hash('new log')});
 const receipt=signRunnerReceipt(request,p2,challenge,observation,isolation(),privatePem,time,time);
 assert.equal(receipt.schemaVersion,2);assert.equal(receipt.payload.parametersHash,jsonHash(request.parameters));assert.equal(verifyRunnerReceipt(receipt,request,p2,challenge,publicPem,Date.now()).queryExecutionVerified,true);
 const other=parseRunnerRequest(make([{name:'Склад',value:{type:'string',value:'W2'}}]));assert.throws(()=>verifyRunnerReceipt(receipt,other,p2,challenge,publicPem),/binding/);
 assert.throws(()=>signRunnerReceipt(request,p2,challenge,{...observation,parametersHash:hash('wrong')},isolation(),privatePem,time,time),/parameter binding/);
 const tampered=structuredClone(receipt);tampered.payload.parameters[0].value.value='W2';assert.throws(()=>verifyRunnerReceipt(tampered,request,p2,challenge,publicPem),/signature/);
});
test('Controlled execution preserves typed parameters and refuses missing bindings before runtime for normal/prepared jobs',async()=>{
 let calls=0;const runtime={async execute(request,profile,challenge){calls++;return {engine:{schemaVersion:2,parametersHash:jsonHash(request.parameters),nonce:challenge.nonce,platformVersion:p2.platformVersion,binaryHash:p2.binaryHash,status:'completed',actual:table(),reason:null,logHash:hash('own controlled log')},isolation:isolation()};}};
 const request=make(),result=await executeQueryJob(request,p2,privatePem,runtime);assert.equal(calls,1);assert.equal(result.assessment.queryExecutionVerified,true);
 await assert.rejects(executeQueryJob(make([]),p2,privatePem,runtime));assert.equal(calls,1);
 const parsed=parseRunnerRequest(request),prepared=preparedJobEnvelope(parsed,createRunnerChallenge(parsed,p2));await executePreparedQueryJob(prepared,p2,privatePem,runtime);assert.equal(calls,2);
});
test('A plan cannot select a new protocol or binding implicitly through a public operator profile',()=>{
 const raw=make(),artifact={identity:raw.candidate,code:raw.candidateCode,isCurrent:()=>true};
 const plan={schemaVersion:2,operation:'query_validation_plan',selection:raw.selection,contract:raw.contract,parameters:raw.parameters};
 assert.equal(requestFromHostPlan(artifact,plan,p2).parameters[0].value.value,'W1');
 assert.throws(()=>requestFromHostPlan(artifact,{...plan,schemaVersion:1},p2),/Версия/);
 assert.throws(()=>requestFromHostPlan(artifact,{...plan,publicKeyPem:publicPem},p2));
});
(async()=>{for(const t of tests){await t.run();console.log('  ✓ '+t.name);}console.log('Query parameters:',tests.length,'groups passed; controlled runtime, real crypto.');})().catch(e=>{console.error(e);process.exitCode=1;});
