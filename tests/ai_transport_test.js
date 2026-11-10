const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const Module=require('node:module'),https=require('node:https');
const load=Module._load;Module._load=function(name,...args){return name==='vscode'?{}:load.call(this,name,...args);};
const {NormaHubClient,CompletionTruncatedError}=require('../out/normahubClient');Module._load=load;
async function run(){
 const original=https.request; let sent;
 const simulate=async(body,event,model='test-model',options)=>{
  https.request=(_url,_options,callback)=>{
   const request=new EventEmitter();request.write=payload=>{sent=JSON.parse(payload);};request.destroy=()=>{};
   request.end=()=>process.nextTick(()=>{
    const response=new EventEmitter();response.statusCode=200;callback(response);
    if(event==='error'){response.emit('error',new Error('stream'));return;}
    response.emit('data',JSON.stringify(body));response.emit('end');
   });return request;
  };
  return NormaHubClient.complete('test-key',model,'system','user',0.1,1500,options);
 };
 try {
  await assert.rejects(simulate({choices:[{finish_reason:'length',message:{content:'Запрос ='}}]}),/обрезан/);
  let diagnostics;
  await assert.rejects(simulate({choices:[{finish_reason:'length',message:{content:''}}],usage:{prompt_tokens:123,completion_tokens:1450,
   completion_tokens_details:{reasoning_tokens:1400}}},undefined,'deepseek-v4.1-flash-1017',{onDiagnostics:value=>{diagnostics=value;}}),error=>{
   assert.ok(error instanceof CompletionTruncatedError);assert.match(error.message,/рассуждение/);
   assert.deepEqual(error.diagnostics,diagnostics);return true;
  });
  assert.deepEqual(diagnostics,{finishReason:'length',maxTokens:1500,promptTokens:123,completionTokens:1450,reasoningTokens:1400});
  const safe={choices:[{finish_reason:'stop',message:{content:'Готово'}}],usage:{prompt_tokens:-1,
   completion_tokens:'secret',completion_tokens_details:{reasoning_tokens:5}}};
  assert.equal(await simulate(safe,undefined,'test-model',{onDiagnostics:value=>{diagnostics=value;throw Error('diagnostic sink');}}),'Готово');
  assert.deepEqual(diagnostics,{finishReason:'stop',maxTokens:1500,reasoningTokens:5});
  await assert.rejects(simulate({choices:[{message:{content:{not:'text'}}}]}),/текстовый ответ/);
  await assert.rejects(simulate({},'error'),/прерван/);
  assert.equal(await simulate({choices:[{finish_reason:'stop',message:{content:'Запрос = Новый Запрос;'}}]}),'Запрос = Новый Запрос;');
  const complete={choices:[{finish_reason:'stop',message:{content:'BSL draft'}}]};
  await simulate(complete,undefined,'deepseek-v4.1-flash-1017');assert.equal(sent.model,'deepseek-v4.1-flash-1017');assert.equal(sent.reasoning_effort,'low');assert.equal(sent.max_tokens,1500);assert.ok(!('thinking' in sent));
  for(const model of ['gpt-6.1-sol','gpt-6-sol','test-model']){await simulate(complete,undefined,model);assert.equal(sent.model,model);assert.ok(!('reasoning_effort' in sent));}
 } finally {https.request=original;}
 const originalGet=https.get;
 const health=async(body,event)=>{
  https.get=(_url,_options,callback)=>{
   const request=new EventEmitter();request.destroy=()=>{};
   process.nextTick(()=>{const response=new EventEmitter();response.statusCode=200;callback(response);
    if(event){response.emit(event,new Error('stream'));return;}
    response.emit('data',body);response.emit('end');
   });return request;
  };
  return NormaHubClient.checkBalance('test-key');
 };
 try {
  for(const body of ['<html>upstream error</html>','{}','{"data":false}']) assert.notEqual((await health(body)).status,'active','HTTP 200 alone is not proof of a valid gateway response');
  assert.equal((await health('{"data":[]}')).status,'active');
  assert.notEqual((await health('', 'error')).status,'active');
  assert.notEqual((await health('', 'aborted')).status,'active');
 } finally {https.get=originalGet;}
 console.log('AI transport: truncated and non-text responses rejected; interrupted response fails; complete text accepted.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
