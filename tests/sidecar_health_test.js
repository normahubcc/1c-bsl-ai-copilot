const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const http=require('node:http');
const {checkSidecarHealth}=require('../out/features/integrations/api/sidecarHealth');
async function run(){
 const original=http.get,token=process.env.SIDECAR_AUTH_TOKEN;
 let destroyed=false,lastOptions;
 const simulate=async(statusCode,body,event)=>{
  destroyed=false;
  http.get=(_url,options,callback)=>{
   lastOptions=options;const req=new EventEmitter();req.destroy=()=>{destroyed=true;};
   process.nextTick(()=>{
    if(event==='timeout'||event==='error'){req.emit(event);return;}
    const response=new EventEmitter();response.statusCode=statusCode;callback(response);
    if(event==='response-error'){response.emit('error',new Error('offline'));return;}
    response.emit('data',body);response.emit('end');
   });return req;
  };
  return checkSidecarHealth();
 };
 try {
  process.env.SIDECAR_AUTH_TOKEN='health-test-only';
  assert.equal((await simulate(200,JSON.stringify({status:'ok',service:'1c-configurator-sidecar',version:'1'}))).online,true);
  assert.equal(lastOptions.headers.Authorization,'Bearer health-test-only');
  assert.equal((await simulate(401,'{"error":"Unauthorized"}')).online,false);
  assert.equal((await simulate(200,'<html>other service</html>')).online,false);
  assert.equal((await simulate(200,'{"status":"ok","service":"other","version":"1"}')).online,false);
  assert.equal((await simulate(503,'{}')).online,false);
  assert.equal((await simulate(200,'', 'timeout')).online,false);assert.equal(destroyed,true);
  assert.equal((await simulate(200,'', 'error')).online,false);
  assert.equal((await simulate(200,'', 'response-error')).online,false);
  assert.equal((await simulate(200,'x'.repeat(17000))).online,false);assert.equal(destroyed,true);
 } finally {http.get=original;if(token===undefined)delete process.env.SIDECAR_AUTH_TOKEN;else process.env.SIDECAR_AUTH_TOKEN=token;}
 console.log('Sidecar health: valid identity, authorization, HTTP errors, malformed/oversized body, timeout and interrupted response passed.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
