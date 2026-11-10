const vscode=require('vscode'),fs=require('node:fs'),path=require('node:path'),net=require('node:net'),https=require('node:https');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
exports.run=async function(){
 const root=process.env.LIVE_REPOSITORY,out=process.env.LIVE_EVIDENCE;
 const {cases:allCases}=JSON.parse(fs.readFileSync(path.join(out,'corpus-before-run.json'),'utf8'));
 const selectedFamilies=(process.env.LIVE_FAMILIES??'').split(',').filter(Boolean);const cases=allCases.filter(c=>!selectedFamilies.length||selectedFamilies.includes(c.kind));
 let key=await new Promise((resolve,reject)=>{let data='';const c=net.connect(process.env.LIVE_CREDENTIAL_SOCKET);c.on('data',b=>data+=b);c.on('end',()=>{try{resolve(JSON.parse(data).key)}catch(e){reject(e)}});c.on('error',reject);});
 const safe=s=>(key?String(s).split(key).join('[REDACTED]'):String(s)).replace(/nr_hub_[A-Za-z0-9_-]+/g,'[REDACTED]');
 const save=(name,value)=>{fs.writeFileSync(path.join(out,name),safe(JSON.stringify(value,null,2)),{mode:0o600});};
 const results=[],network=[];let activeCase='setup';
 const write=completed=>save('results.json',{completed,app:vscode.env.appName,version:vscode.version,source:root,packagedVsix:false,plannedCases:cases.length,entireCorpusCases:allCases.length,selectedFamilies,unrunCaseIds:cases.filter(c=>!results.some(r=>r.id===c.id)).map(c=>c.id),transport:'real NormaHub HTTPS; requested 1017; no response replacement',credential:'in-memory secret port via single-use private Unix socket; not saved',primaryModelAttestation:'gateway reports base model ID; provider version not independently attested',results,network});
 const originalRequest=https.request;
 https.request=function(url,options,callback){
  let host;try{host=new URL(url).hostname;}catch{return originalRequest.call(this,url,options,callback);}
  if(host!=='api.normahub.cc')return originalRequest.call(this,url,options,callback);
  const record={caseId:activeCase,startedAt:new Date().toISOString(),startedMs:Date.now()};network.push(record);
  const req=originalRequest.call(this,url,options,res=>{
   record.httpStatus=res.statusCode;record.requestId=res.headers['x-request-id']??null;let data='';res.on('data',b=>{if(data.length<2*1024*1024)data+=b});res.on('end',()=>{
    record.elapsedMs=Date.now()-record.startedMs;try{const p=JSON.parse(data);record.responseModel=p.model??null;record.usage=p.usage??null;record.finishReason=p.choices?.[0]?.finish_reason??null;record.rawContent=p.choices?.[0]?.message?.content??null;if(p.error)record.gatewayError=safe(JSON.stringify(p.error)).slice(0,1000);}catch{record.invalidJson=true;}
   });callback(res);
  });
  const write=req.write.bind(req);req.write=function(body,...args){const p=JSON.parse(String(body));if(p.model!=='deepseek-v4.1-flash-1017'){req.destroy();throw Error('Wrong requested model');}record.request={model:p.model,messages:p.messages,maxTokens:p.max_tokens,temperature:p.temperature,reasoningEffort:p.reasoning_effort??null};return write(body,...args);};
  req.on('error',e=>{record.error=safe(e.message);record.elapsedMs=Date.now()-record.startedMs;});return req;
 };
 const {captureTaskContext,runAiTask}=require(path.join(root,'out/features/ai-task/api/runTask'));
 const {PreviewStore,captureEditorTarget}=require(path.join(root,'out/features/apply-code/model/previewStore'));
 const {queryChoices}=require(path.join(root,'out/features/create-validation-plan/model/queryChoices'));
 const {createUserPlan}=require(path.join(root,'out/features/create-validation-plan/model/createPlan'));
 const {requestFromHostPlan,runnerRequestInput}=require(path.join(root,'out/entities/runner/model/preparedJob'));
 const {BSLInlineCompletionProvider}=require(path.join(root,'out/inlineCompletionProvider'));
 const {localScopeHash}=require(path.join(root,'out/entities/editor-snapshot/model/snapshot'));
 const context={subscriptions:[],secrets:{get:async()=>key}};
 const folder=vscode.workspace.workspaceFolders[0],uri=vscode.Uri.joinPath(folder.uri,'Module.bsl');
 const operatorBase=path.join(require('node:os').homedir(),'.local/share/normahub-copilot-lab/signed-import-20261030');
 const profile={...JSON.parse(fs.readFileSync(path.join(operatorBase,'worker-v2/profile.json'),'utf8')),projectId:localScopeHash(folder.uri.toString(),uri.toString())};
 const profileFile=path.join(out,'operator-profile.json');save('operator-profile.json',profile);
 const store=new PreviewStore();let consecutiveFailures=0,lastKind=null;const stoppedFamilies=new Set(),stopReasons=[];
 const setBuffer=async text=>{const doc=await vscode.workspace.openTextDocument(uri);const editor=await vscode.window.showTextDocument(doc,{preview:false});await editor.edit(e=>e.replace(new vscode.Range(doc.positionAt(0),doc.positionAt(doc.getText().length)),text));return editor;};
 try{
  for(const tc of cases){if(stoppedFamilies.has(tc.kind))continue;if(lastKind!==tc.kind){consecutiveFailures=0;lastKind=tc.kind;}activeCase=tc.id;const started=Date.now(),n=network.length;let record={id:tc.id,kind:tc.kind,status:'started',engine:'not_run',approvalVerified:false,fullBslExecution:'not_run'};write(false);
   try{
    if(tc.kind==='inline'){
     const config=vscode.workspace.getConfiguration('normahub1c');await config.update('enableInlineCompletion',true,vscode.ConfigurationTarget.Workspace);
     const editor=await setBuffer(tc.prefix+tc.suffix),doc=editor.document,pos=doc.positionAt(tc.prefix.length);editor.selection=new vscode.Selection(pos,pos);
     const provider=new BSLInlineCompletionProvider(context),cancel=new vscode.CancellationTokenSource();
     let display;try{
      const items=await provider.provideInlineCompletionItems(doc,pos,{triggerKind:vscode.InlineCompletionTriggerKind.Invoke},cancel.token);
      const list=Array.isArray(items)?items:items?.items??[];record.suggestionCount=list.length;
      if(!list.length){record.status='no_suggestion';record.acceptance='not_run';}
      else{
       const original=doc.getText(),version=doc.version;record.suggestion=list[0].insertText;record.range=list[0].range;
       display=vscode.languages.registerInlineCompletionItemProvider({language:'bsl',scheme:'file'},{provideInlineCompletionItems(d){return d===doc&&d.version===version?list:[];}});
       await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');await new Promise(r=>setTimeout(r,200));
       await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');await new Promise(r=>setTimeout(r,100));
       record.acceptance=doc.getText()!==original?'native_commit_applied':'native_commit_no_change';record.after=doc.getText();record.before=original;
       record.status=record.acceptance==='native_commit_applied'?'accepted_needs_semantic_review':'acceptance_failed';record.physicalTab='not_run';
       record.presentation='actual live provider result; one-shot native display adapter; commit command';
      }
     }finally{display?.dispose();cancel.dispose();provider.dispose();await config.update('enableInlineCompletion',false,vscode.ConfigurationTarget.Workspace);}
    }else{
     await setBuffer(tc.kind==='query'?'// Own training fixture; selected queries only\nПроцедура Тест()\nКонецПроцедуры':tc.code);
     const target=captureEditorTarget(),snapshot=captureTaskContext();
     const generated=await runAiTask(context,tc.kind==='query'?'query':'explain',tc.intent,snapshot);record.generated=generated.code;record.sourceCurrent=generated.isCurrent();
     if(tc.kind==='query'){
      const preview=store.add(generated.code,'bsl',target,{task:generated.task,contentHash:generated.contentHash,isCurrent:generated.isCurrent});
      const artifact=store.captureQueryArtifact(preview.previewId),choices=queryChoices(generated.code);record.queryChoices=choices.length;
      if(choices.length!==1){record.status='unsupported_candidate_shape';}
      else{
       const plan=createUserPlan(artifact,profile,choices[0],{requirement:tc.intent,reference:'own-live-corpus/'+tc.id,preconditions:['Own fixture only: A/W1 rows 6+6, stock 10; no other records.'],assumptions:[],mode:tc.mode,expected:tc.expected});
       const request=runnerRequestInput(requestFromHostPlan(artifact,plan,profile)),requestFile=path.join(out,tc.id+'-request.json');save(tc.id+'-request.json',request);
       const destination=path.join(out,tc.id+'-engine');
       let cli;try{cli=await promisify(execFile)(process.env.LIVE_NODE,[path.join(root,'dist/runner-cli.js'),'run','--profile',profileFile,'--request',requestFile,'--private-key',path.join(operatorBase,'key/private.pem'),'--output',destination],{timeout:150000,maxBuffer:1024*1024});}
       catch(error){cli={stdout:error.stdout??'',stderr:error.stderr??'',exitCode:error.code??null};}
       save(tc.id+'-cli.json',{stdout:cli.stdout,stderr:cli.stderr,exitCode:cli.exitCode??0});
       const a=path.join(destination,'assessment.json');
       if(fs.existsSync(a)){const assessment=JSON.parse(fs.readFileSync(a,'utf8'));record.assessment=assessment;record.engine=assessment.queryExecutionVerified?'executed':'failed_or_unsupported';record.status=assessment.queryExecutionVerified&&assessment.comparison?.status==='equal'?'query_rows_match':assessment.queryExecutionVerified?'query_rows_differ':'engine_failed';}
       else{record.status='runner_failed';const failure=path.join(destination,'failure.json');if(fs.existsSync(failure))record.runnerFailure=JSON.parse(fs.readFileSync(failure,'utf8'));}
      }
     }else{record.status='response_needs_expert_review';record.rubric=tc.rubric;}
    }
    consecutiveFailures=network.length>n&&network.slice(n).every(x=>x.httpStatus>=200&&x.httpStatus<300)?0:consecutiveFailures+1;
   }catch(error){record.status='failed';record.error=safe(error.message);consecutiveFailures++;}
   record.elapsedMs=Date.now()-started;record.networkRequests=network.length-n;results.push(record);write(false);
   console.log(JSON.stringify({id:record.id,status:record.status,elapsedMs:record.elapsedMs}));
   if(consecutiveFailures>=3){stoppedFamilies.add(tc.kind);stopReasons.push({reason:'three_consecutive_failed_or_absent_gateway_requests',family:tc.kind,after:tc.id});save('stop-reason.json',stopReasons);}
  }
 }finally{https.request=originalRequest;write(true);key='';}
};
