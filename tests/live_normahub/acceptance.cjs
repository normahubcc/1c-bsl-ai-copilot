// Offline native acceptance of previously recorded live suggestions; makes no inference requests.
const vscode=require('vscode'),fs=require('node:fs'),path=require('node:path');
exports.run=async()=>{
 const out=process.env.LIVE_ACCEPTANCE_OUTPUT,records=JSON.parse(fs.readFileSync(process.env.LIVE_ACCEPTANCE_INPUT,'utf8')).results.filter(r=>r.kind==='inline');
 const results=[];
 for(const old of records){
  const item={id:old.id,providerInvocations:0,source:'replay of saved real live normalized suggestion; no API request'};
  if(!old.suggestion){item.status='no_live_suggestion';results.push(item);continue;}
  let registration;
  try{
   const uri=vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri,old.id+'.bsl');await vscode.workspace.fs.writeFile(uri,Buffer.from(old.before));
   const doc=await vscode.workspace.openTextDocument(uri),editor=await vscode.window.showTextDocument(doc,{preview:false,preserveFocus:false});
   await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
   const [start,end]=old.range;const range=new vscode.Range(start.line,start.character,end.line,end.character);
   const pos=range.start;editor.selection=new vscode.Selection(pos,pos);editor.revealRange(range);
   const before=doc.getText(),version=doc.version,completion=new vscode.InlineCompletionItem(old.suggestion,range);
   registration=vscode.languages.registerInlineCompletionItemProvider({scheme:'file',pattern:uri.fsPath},{provideInlineCompletionItems(d){item.providerInvocations++;return d.uri.toString()===uri.toString()&&d.version===version?[completion]:[];}});
   await new Promise(r=>setTimeout(r,250));
   await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');await new Promise(r=>setTimeout(r,500));
   fs.writeFileSync(path.join(out,'ready.json'),JSON.stringify({id:old.id}));
   const deadline=Date.now()+15000;
   while(!fs.existsSync(path.join(out,'tab-'+old.id+'.json'))&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
   await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');await new Promise(r=>setTimeout(r,100));
   item.languageId=doc.languageId;item.before=before;item.after=doc.getText();item.expected=before.slice(0,doc.offsetAt(range.start))+old.suggestion+before.slice(doc.offsetAt(range.end));item.status=item.after===item.expected?'native_exact_insertion':item.after===before?'native_commit_no_change':'unexpected_edit';
  }catch(e){item.status='harness_error';item.error=e.message;}finally{registration?.dispose();}
  results.push(item);
 }
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({completed:true,app:vscode.env.appName,version:vscode.version,inferenceRequests:0,physicalTab:'not_run',results},null,2));
};
