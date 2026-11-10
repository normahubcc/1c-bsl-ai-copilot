// Explicit paid run: credential on non-echo stdin only, single-use local broker, never env/files/argv.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process'),readline=require('node:readline');
const root=path.resolve(__dirname,'../..'),output=path.resolve(process.argv[2]||'');
if(!process.argv[2]||fs.existsSync(output))throw Error('Pass a new evidence directory.');
const manifest=require(path.join(root,'package.json'));
const artifact=path.join(root,`${manifest.name}-${manifest.version}.vsix`);
if(!fs.existsSync(artifact))throw Error('Current-version VSIX is missing; build and verify it before live evaluation.');
const artifactSha256=crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
fs.mkdirSync(output,{recursive:true,mode:0o700});
const families=process.argv[3]??'';if(families&&!/^(query|explain|inline)(,(query|explain|inline))*$/.test(families))throw Error('Invalid family filter');
const corpus=require('./corpus.cjs');fs.writeFileSync(path.join(output,'corpus-before-run.json'),JSON.stringify(corpus,null,2));
fs.writeFileSync(path.join(output,'run-identity.json'),JSON.stringify({head:spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim(),source:root,dirty:!!spawnSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).stdout.trim(),artifact:path.basename(artifact),artifactSha256,requestedModel:'deepseek-v4.1-flash-1017',maxCaseRequests:30,automaticRetries:0,selectedFamilies:families||'all',stopPolicy:'three consecutive failures per family',corpusSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(output,'corpus-before-run.json'))).digest('hex'),startedAt:new Date().toISOString()},null,2));
const workspace=path.join(output,'workspace');fs.mkdirSync(workspace);
fs.writeFileSync(path.join(workspace,'Module.bsl'),'// Own paid live evaluation workspace\nПроцедура Тест()\nКонецПроцедуры');
fs.writeFileSync(path.join(workspace,'metadata.json'),JSON.stringify({name:'OwnTrainingFixture',objects:[{kind:'Документ',name:'Заказ',fields:[{name:'СкладШапки'}]},{kind:'РегистрНакопления',name:'ТоварыНаСкладах',fields:[{name:'Номенклатура'},{name:'Склад'},{name:'Количество'}]}]}));
fs.mkdirSync(path.join(workspace,'.vscode'));fs.writeFileSync(path.join(workspace,'.vscode/settings.json'),JSON.stringify({'normahub1c.enableInlineCompletion':false,'normahub1c.reasoningModel':'deepseek-v4.1-flash-1017','normahub1c.autocompleteModel':'deepseek-v4.1-flash-1017','files.autoSave':'off','files.hotExit':'off','extensions.autoUpdate':false,'extensions.autoCheckUpdates':false,'workbench.startupEditor':'none','editor.inlineSuggest.enabled':true}));
const companion=path.join(output,'companion');fs.mkdirSync(companion);fs.writeFileSync(path.join(companion,'package.json'),JSON.stringify({name:'live-boundary',publisher:'copilot',version:'0.0.1',engines:{vscode:'^1.100.0'},main:'./main.cjs',activationEvents:['*']}));fs.writeFileSync(path.join(companion,'main.cjs'),'exports.activate=context=>context;');
// Install the primary extension into the isolated profile so languages/configuration really exist.
const installEnv=Object.fromEntries(['PATH','HOME','USER','LOGNAME','SHELL','LANG','LC_ALL','DISPLAY','WAYLAND_DISPLAY','XAUTHORITY','XDG_RUNTIME_DIR','DBUS_SESSION_BUS_ADDRESS','TMPDIR'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
const installation=spawnSync('code',['--user-data-dir',path.join(output,'profile'),'--extensions-dir',path.join(output,'extensions'),'--install-extension',artifact],{cwd:root,env:installEnv,encoding:'utf8',timeout:60000});
fs.writeFileSync(path.join(output,'install.log'),(installation.stdout??'')+(installation.stderr??''));
if(installation.status!==0)throw Error('Isolated primary extension installation failed');
const rl=readline.createInterface({input:process.stdin,terminal:false});console.log('Prepared 30-case corpus. Waiting for credential on stdin.');
rl.once('line',key=>{rl.close();process.stdin.pause();if(!key.startsWith('nr_hub_'))throw Error('Invalid credential format');
 const socket=path.join(output,'credential.sock');let served=false;
 const broker=net.createServer(client=>{if(served){client.destroy();return;}served=true;client.end(JSON.stringify({key})+'\n');broker.close();});
 broker.listen(socket,()=>{fs.chmodSync(socket,0o600);
  const keep=['PATH','HOME','USER','LOGNAME','SHELL','LANG','LC_ALL','DISPLAY','WAYLAND_DISPLAY','XAUTHORITY','XDG_RUNTIME_DIR','DBUS_SESSION_BUS_ADDRESS','TMPDIR'];
  const env=Object.fromEntries(keep.filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));Object.assign(env,{LIVE_REPOSITORY:root,LIVE_EVIDENCE:output,LIVE_CREDENTIAL_SOCKET:socket,LIVE_NODE:process.execPath,LIVE_FAMILIES:families});
  const args=['--new-window','--wait','--skip-welcome','--skip-release-notes','--disable-workspace-trust','--disable-updates','--disable-telemetry','--password-store=basic','--disable-gpu','--user-data-dir',path.join(output,'profile'),'--extensions-dir',path.join(output,'extensions'),'--extensionDevelopmentPath='+companion,'--extensionTestsPath='+path.join(__dirname,'suite.cjs'),workspace,'--no-sandbox'];
  const log=fs.openSync(path.join(output,'launch.log'),'w',0o600),child=spawn('code',args,{cwd:root,env,stdio:['ignore',log,log],detached:true});
  const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGTERM')}catch{}broker.close();key='';console.log('Live run timed out; partial outcomes retained.');process.exitCode=1;},1500_000);
  child.once('exit',code=>{clearTimeout(timer);fs.closeSync(log);broker.close();key='';const f=path.join(output,'results.json');let result;
   try{result=JSON.parse(fs.readFileSync(f,'utf8'));}catch{console.log('No completed results; inspect isolated launch.log.');process.exitCode=1;return;}
   console.log(JSON.stringify({completed:result.completed,total:result.results.length,exitCode:code,output}));if(!result.completed)process.exitCode=1;
  });
 });
});
