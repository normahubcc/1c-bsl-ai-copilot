// Actual installed VSIX smoke: imports no source modules and uses a new profile without credentials.
const vscode=require('vscode'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
exports.run=async()=>{
 const evidence=process.env.SNAPSHOT_IDE_EVIDENCE,results=[];
 const check=async(name,run)=>{try{results.push({name,pass:true,detail:await run()});}catch(e){results.push({name,pass:false,error:String(e.stack||e)});}};
 const extension=vscode.extensions.getExtension('normahub.1c-bsl-ai-copilot');
 await check('installed VSIX activates from its package payload rather than the development source',async()=>{
  assert.ok(extension);assert.equal(extension.packageJSON.version,process.env.SNAPSHOT_PACKAGE_VERSION);assert.notEqual(path.resolve(extension.extensionPath),path.resolve(process.env.SNAPSHOT_REPOSITORY));
  const bundle=fs.readFileSync(path.join(extension.extensionPath,'dist/extension.js'));
  assert.equal(crypto.createHash('sha256').update(bundle).digest('hex'),process.env.SNAPSHOT_PACKAGE_BUNDLE_HASH);
  await extension.activate();assert.ok(extension.isActive);assert.ok(!process.env.NORMAHUB_API_KEY&&!process.env.OPENAI_API_KEY);
  return {installedPath:extension.extensionPath,version:extension.packageJSON.version,bundleHash:process.env.SNAPSHOT_PACKAGE_BUNDLE_HASH};
 });
 await check('every contributed command has a real registered handler, including validation and native diff',async()=>{
  const commands=await vscode.commands.getCommands();const contributed=extension.packageJSON.contributes.commands.map(c=>c.command);
  for(const command of contributed)assert.ok(commands.includes(command),command);
  assert.ok(commands.includes('normahub1c.reviewLastPreview'));assert.ok(commands.includes('normahub1c.manageQueryRunner'));
  return {registered:contributed.length};
 });
 await check('installed tool navigation and metadata scanning run without an AI key or source mutation',async()=>{
  const folder=vscode.workspace.workspaceFolders[0],doc=await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri,'Module.bsl'));
  await vscode.window.showTextDocument(doc,{preview:false});const original=doc.getText();
  for(const command of ['generateQuery','generateBatchQuery','generateExtensionMethod','bspAssistant','auditStandards','inspectQuery','refactorQuery','generateVanessaFeature','analyzeTechLog','scanMetadata'])await vscode.commands.executeCommand('normahub1c.'+command);
  assert.equal(doc.getText(),original);assert.equal(doc.isDirty,false);return {navigationCommands:10,sourceUnchanged:true};
 });
 await check('installed RU/EN command catalogues and bsl/1c/oscript registrations are available',async()=>{
  const en=JSON.parse(fs.readFileSync(path.join(extension.extensionPath,'package.nls.json'),'utf8'));
  const ru=JSON.parse(fs.readFileSync(path.join(extension.extensionPath,'package.nls.ru.json'),'utf8'));
  for(const key of ['command.reviewLastPreview','command.manageQueryRunner']){assert.ok(en[key]&&ru[key]);assert.notEqual(en[key],ru[key]);}
  const languages=await vscode.languages.getLanguages();for(const id of ['bsl','1c','oscript']){assert.ok(languages.includes(id));const doc=await vscode.workspace.openTextDocument({language:id,content:'// own packaged smoke'});assert.equal(doc.languageId,id);}
  return {commandCatalogueLanguages:['ru','en'],bslAliases:['bsl','1c','oscript']};
 });
 fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify({completed:true,app:vscode.env.appName,version:vscode.version,packagedVsix:true,inference:'not_run; no credentials',scope:'installed activation, handlers, navigation, settings and language registrations',results},null,2));
 assert.ok(results.every(r=>r.pass),'Packaged smoke failed; inspect results.json');
};
