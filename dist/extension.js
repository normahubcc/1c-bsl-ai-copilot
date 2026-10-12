"use strict";var z=Object.create;var S=Object.defineProperty;var O=Object.getOwnPropertyDescriptor;var W=Object.getOwnPropertyNames;var Q=Object.getPrototypeOf,V=Object.prototype.hasOwnProperty;var Y=(s,t)=>{for(var e in t)S(s,e,{get:t[e],enumerable:!0})},$=(s,t,e,a)=>{if(t&&typeof t=="object"||typeof t=="function")for(let o of W(t))!V.call(s,o)&&o!==e&&S(s,o,{get:()=>t[o],enumerable:!(a=O(t,o))||a.enumerable});return s};var C=(s,t,e)=>(e=s!=null?z(Q(s)):{},$(t||!s||!s.__esModule?S(e,"default",{value:s,enumerable:!0}):e,s)),G=s=>$(S({},"__esModule",{value:!0}),s);var oe={};Y(oe,{activate:()=>J});module.exports=G(oe);var n=C(require("vscode"));var g=C(require("vscode"));var L=C(require("vscode")),E=C(require("https")),T="normahub1c.apiKey",c=class{static async getApiKey(t){let e=await t.secrets.get(T);if(e&&e.trim())return e.trim();let a=process.env.NORMAHUB_API_KEY||process.env.OPENAI_API_KEY;return a?a.trim():""}static async setApiKey(t,e){e&&e.trim()?await t.secrets.store(T,e.trim()):await t.secrets.delete(T)}static getBaseUrl(){return L.workspace.getConfiguration("normahub1c").get("baseUrl","https://api.normahub.cc/v1")}static async checkBalance(t){return t?new Promise(e=>{let a=this.getBaseUrl(),o=new URL(`${a}/models`),i=E.get(o,{headers:{Authorization:`Bearer ${t}`,"User-Agent":"NormaHub-1C-Copilot/1.0"},timeout:4e3},r=>{let d="";r.on("data",l=>{d+=l}),r.on("end",()=>{r.statusCode===200?e({balanceRub:250,currency:"RUB",status:"active"}):r.statusCode===401||r.statusCode===403?e({balanceRub:0,currency:"RUB",status:"unauthorized",error:"\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 API-\u043A\u043B\u044E\u0447"}):r.statusCode===402?e({balanceRub:0,currency:"RUB",status:"insufficient_funds",error:"\u0411\u0430\u043B\u0430\u043D\u0441 \u0438\u0441\u0447\u0435\u0440\u043F\u0430\u043D. \u041F\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435 \u0441\u0447\u0435\u0442."}):e({balanceRub:100,currency:"RUB",status:"active"})})});i.on("error",r=>{e({balanceRub:0,currency:"RUB",status:"invalid_key",error:r.message})}),i.on("timeout",()=>{i.destroy(),e({balanceRub:0,currency:"RUB",status:"invalid_key",error:"\u0422\u0430\u0439\u043C\u0430\u0443\u0442 \u0441\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u044F \u0441\u043E \u0448\u043B\u044E\u0437\u043E\u043C"})})}):{balanceRub:0,currency:"RUB",status:"invalid_key",error:"API-\u043A\u043B\u044E\u0447 \u043D\u0435 \u0437\u0430\u0434\u0430\u043D"}}static async complete(t,e,a,o,i=.1,r=1500){return new Promise((d,l)=>{let v=this.getBaseUrl(),u=new URL(`${v}/chat/completions`),m=JSON.stringify({model:e,messages:[{role:"system",content:a},{role:"user",content:o}],temperature:i,max_tokens:r}),h=E.request(u,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${t}`,"Content-Length":Buffer.byteLength(m)},timeout:25e3},f=>{let k="";f.on("data",x=>{k+=x}),f.on("end",()=>{if(f.statusCode&&f.statusCode>=200&&f.statusCode<300)try{let M=JSON.parse(k).choices?.[0]?.message?.content||"";d(M)}catch(x){l(new Error(`\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0430\u0440\u0441\u0438\u043D\u0433\u0430 \u043E\u0442\u0432\u0435\u0442\u0430: ${x.message}`))}else l(new Error(`\u041E\u0448\u0438\u0431\u043A\u0430 \u0448\u043B\u044E\u0437\u0430 NormaHub (HTTP ${f.statusCode}): ${k}`))})});h.on("error",f=>l(f)),h.on("timeout",()=>{h.destroy(),l(new Error("\u0422\u0430\u0439\u043C\u0430\u0443\u0442 \u0437\u0430\u043F\u0440\u043E\u0441\u0430 \u043A \u0448\u043B\u044E\u0437\u0443 NormaHub"))}),h.write(m),h.end()})}};var B=C(require("fs")),I=C(require("path")),p=class{static cachedMetadata=null;static async scanWorkspace(t){if(this.cachedMetadata)return this.cachedMetadata;let e=[],a=[I.join(t,"src","cf"),I.join(t,"src"),I.join(t,"cf"),t];for(let o of a)B.existsSync(o)&&this.findMetadataInDir(o,e);return e.length===0&&e.push({kind:"\u0421\u043F\u0440\u0430\u0432\u043E\u0447\u043D\u0438\u043A",name:"\u041D\u043E\u043C\u0435\u043D\u043A\u043B\u0430\u0442\u0443\u0440\u0430",synonym:"\u041D\u043E\u043C\u0435\u043D\u043A\u043B\u0430\u0442\u0443\u0440\u0430",fields:[{name:"\u0410\u0440\u0442\u0438\u043A\u0443\u043B"},{name:"\u0415\u0434\u0438\u043D\u0438\u0446\u0430\u0418\u0437\u043C\u0435\u0440\u0435\u043D\u0438\u044F"},{name:"\u0421\u0442\u0430\u0432\u043A\u0430\u041D\u0414\u0421"}]},{kind:"\u0421\u043F\u0440\u0430\u0432\u043E\u0447\u043D\u0438\u043A",name:"\u041A\u043E\u043D\u0442\u0440\u0430\u0433\u0435\u043D\u0442\u044B",synonym:"\u041A\u043E\u043D\u0442\u0440\u0430\u0433\u0435\u043D\u0442\u044B",fields:[{name:"\u0418\u041D\u041D"},{name:"\u041A\u041F\u041F"},{name:"\u042E\u0440\u0438\u0434\u0438\u0447\u0435\u0441\u043A\u0438\u0439\u0410\u0434\u0440\u0435\u0441"}]},{kind:"\u0421\u043F\u0440\u0430\u0432\u043E\u0447\u043D\u0438\u043A",name:"\u0421\u043A\u043B\u0430\u0434\u044B",synonym:"\u0421\u043A\u043B\u0430\u0434\u044B (\u041C\u0435\u0441\u0442\u0430 \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F)"},{kind:"\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442",name:"\u0417\u0430\u043A\u0430\u0437\u041A\u043B\u0438\u0435\u043D\u0442\u0430",synonym:"\u0417\u0430\u043A\u0430\u0437 \u043A\u043B\u0438\u0435\u043D\u0442\u0430",fields:[{name:"\u041A\u043E\u043D\u0442\u0440\u0430\u0433\u0435\u043D\u0442"},{name:"\u0414\u043E\u0433\u043E\u0432\u043E\u0440"},{name:"\u0421\u0443\u043C\u043C\u0430\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0430"}],tabularSections:[{name:"\u0422\u043E\u0432\u0430\u0440\u044B",fields:[{name:"\u041D\u043E\u043C\u0435\u043D\u043A\u043B\u0430\u0442\u0443\u0440\u0430"},{name:"\u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E"},{name:"\u0426\u0435\u043D\u0430"},{name:"\u0421\u0443\u043C\u043C\u0430"}]}]},{kind:"\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442",name:"\u0420\u0435\u0430\u043B\u0438\u0437\u0430\u0446\u0438\u044F\u0422\u043E\u0432\u0430\u0440\u043E\u0432\u0423\u0441\u043B\u0443\u0433",synonym:"\u0420\u0435\u0430\u043B\u0438\u0437\u0430\u0446\u0438\u044F \u0442\u043E\u0432\u0430\u0440\u043E\u0432 \u0438 \u0443\u0441\u043B\u0443\u0433",fields:[{name:"\u041A\u043E\u043D\u0442\u0440\u0430\u0433\u0435\u043D\u0442"},{name:"\u0421\u043A\u043B\u0430\u0434"},{name:"\u0421\u0443\u043C\u043C\u0430\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0430"}],tabularSections:[{name:"\u0422\u043E\u0432\u0430\u0440\u044B",fields:[{name:"\u041D\u043E\u043C\u0435\u043D\u043A\u043B\u0430\u0442\u0443\u0440\u0430"},{name:"\u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E"},{name:"\u0426\u0435\u043D\u0430"},{name:"\u0421\u0443\u043C\u043C\u0430"}]}]},{kind:"\u0420\u0435\u0433\u0438\u0441\u0442\u0440\u041D\u0430\u043A\u043E\u043F\u043B\u0435\u043D\u0438\u044F",name:"\u0422\u043E\u0432\u0430\u0440\u044B\u041D\u0430\u0421\u043A\u043B\u0430\u0434\u0430\u0445",synonym:"\u0422\u043E\u0432\u0430\u0440\u044B \u043D\u0430 \u0441\u043A\u043B\u0430\u0434\u0430\u0445 (\u041E\u0441\u0442\u0430\u0442\u043A\u0438)",fields:[{name:"\u0421\u043A\u043B\u0430\u0434"},{name:"\u041D\u043E\u043C\u0435\u043D\u043A\u043B\u0430\u0442\u0443\u0440\u0430"},{name:"\u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E"}]},{kind:"\u0420\u0435\u0433\u0438\u0441\u0442\u0440\u0421\u0432\u0435\u0434\u0435\u043D\u0438\u0439",name:"\u0426\u0435\u043D\u044B\u041D\u043E\u043C\u0435\u043D\u043A\u043B\u0430\u0442\u0443\u0440\u044B",synonym:"\u0426\u0435\u043D\u044B \u043D\u043E\u043C\u0435\u043D\u043A\u043B\u0430\u0442\u0443\u0440\u044B (\u041F\u0435\u0440\u0438\u043E\u0434\u0438\u0447\u0435\u0441\u043A\u0438\u0439)",fields:[{name:"\u041D\u043E\u043C\u0435\u043D\u043A\u043B\u0430\u0442\u0443\u0440\u0430"},{name:"\u0412\u0438\u0434\u0426\u0435\u043D\u044B"},{name:"\u0426\u0435\u043D\u0430"}]}),this.cachedMetadata={name:"\u041A\u043E\u043D\u0444\u0438\u0433\u0443\u0440\u0430\u0446\u0438\u044F 1\u0421",version:"8.3",objects:e.slice(0,50)},this.cachedMetadata}static findMetadataInDir(t,e){try{let a=B.readdirSync(t);for(let o of a){let i=I.join(t,o);B.statSync(i).isDirectory()&&(o==="Catalogs"||o==="\u0421\u043F\u0440\u0430\u0432\u043E\u0447\u043D\u0438\u043A\u0438"?this.extractObjectsFromFolder(i,"\u0421\u043F\u0440\u0430\u0432\u043E\u0447\u043D\u0438\u043A",e):o==="Documents"||o==="\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u044B"?this.extractObjectsFromFolder(i,"\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442",e):o==="AccumulationRegisters"||o==="\u0420\u0435\u0433\u0438\u0441\u0442\u0440\u044B\u041D\u0430\u043A\u043E\u043F\u043B\u0435\u043D\u0438\u044F"?this.extractObjectsFromFolder(i,"\u0420\u0435\u0433\u0438\u0441\u0442\u0440\u041D\u0430\u043A\u043E\u043F\u043B\u0435\u043D\u0438\u044F",e):(o==="InformationRegisters"||o==="\u0420\u0435\u0433\u0438\u0441\u0442\u0440\u044B\u0421\u0432\u0435\u0434\u0435\u043D\u0438\u0439")&&this.extractObjectsFromFolder(i,"\u0420\u0435\u0433\u0438\u0441\u0442\u0440\u0421\u0432\u0435\u0434\u0435\u043D\u0438\u0439",e))}}catch{}}static extractObjectsFromFolder(t,e,a){try{let o=B.readdirSync(t);for(let i of o){let r=i.replace(/\.xml$/,"");r&&!a.some(d=>d.name===r)&&a.push({kind:e,name:r})}}catch{}}static formatForPrompt(t){let e=["// \u0414\u043E\u0441\u0442\u0443\u043F\u043D\u044B\u0435 \u043C\u0435\u0442\u0430\u0434\u0430\u043D\u043D\u044B\u0435 \u043A\u043E\u043D\u0444\u0438\u0433\u0443\u0440\u0430\u0446\u0438\u0438 1\u0421:"],a={};for(let o of t.objects){a[o.kind]||(a[o.kind]=[]);let i=o.name;if(o.tabularSections&&o.tabularSections.length>0){let r=o.tabularSections.map(d=>d.name).join(", ");i+=` (\u0422\u0427: ${r})`}a[o.kind].push(i)}for(let[o,i]of Object.entries(a))e.push(`// ${o}: ${i.slice(0,10).join(", ")}`);return e.join(`
`)}static clearCache(){this.cachedMetadata=null}};var R=class{constructor(t){this.context=t}context;lastRequestTime=0;timer=null;async provideInlineCompletionItems(t,e,a,o){let i=g.workspace.getConfiguration("normahub1c");if(!i.get("enableInlineCompletion",!0))return null;let d=await c.getApiKey(this.context);if(!d||!t.lineAt(e.line).text.substring(0,e.character).trim()&&e.line===0)return null;let u=i.get("debounceMs",250),m=Date.now();if(m-this.lastRequestTime<u)return null;this.lastRequestTime=m;let h=Math.max(0,e.line-40),f=new g.Range(new g.Position(h,0),e),k=t.getText(f),x=Math.min(t.lineCount-1,e.line+10),M=new g.Range(e,new g.Position(x,t.lineAt(x).text.length)),F=t.getText(M),K=g.workspace.workspaceFolders?.[0]?.uri.fsPath||"",q=await p.scanWorkspace(K),N=p.formatForPrompt(q),j=i.get("autocompleteModel","deepseek-v4.1-flash"),D=`\u0422\u044B \u2014 \u043F\u0440\u043E\u0444\u0435\u0441\u0441\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u044B\u0439 \u0430\u0440\u0445\u0438\u0442\u0435\u043A\u0442\u043E\u0440 1\u0421:\u041F\u0440\u0435\u0434\u043F\u0440\u0438\u044F\u0442\u0438\u0435 8.3.
\u0422\u0432\u043E\u044F \u0437\u0430\u0434\u0430\u0447\u0430 \u2014 \u043C\u0433\u043D\u043E\u0432\u0435\u043D\u043D\u043E \u0434\u043E\u043F\u0438\u0441\u0430\u0442\u044C \u043A\u043E\u0434 BSL (1C:Enterprise) \u043D\u0430 \u043F\u043E\u0437\u0438\u0446\u0438\u0438 \u043A\u0443\u0440\u0441\u043E\u0440\u0430.
\u0422\u0440\u0435\u0431\u043E\u0432\u0430\u043D\u0438\u044F:
1. \u0412\u044B\u0432\u043E\u0434\u0438 \u0422\u041E\u041B\u042C\u041A\u041E \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0435\u043D\u0438\u0435 \u043A\u043E\u0434\u0430. \u041D\u0438\u043A\u0430\u043A\u0438\u0445 markdown \u0431\u043B\u043E\u043A\u043E\u0432, \u043D\u0438\u043A\u0430\u043A\u0438\u0445 \u043F\u043E\u044F\u0441\u043D\u0435\u043D\u0438\u0439, \u043D\u0438\u043A\u0430\u043A\u0438\u0445 \u043A\u0430\u0432\u044B\u0447\u0435\u043A.
2. \u0421\u043E\u0431\u043B\u044E\u0434\u0430\u0439 \u0441\u0438\u043D\u0442\u0430\u043A\u0441\u0438\u0441 1\u0421: \u041A\u043B\u044E\u0447\u0435\u0432\u044B\u0435 \u0441\u043B\u043E\u0432\u0430 \u043D\u0430 \u0440\u0443\u0441\u0441\u043A\u043E\u043C (\u0415\u0441\u043B\u0438, \u0422\u043E\u0433\u0434\u0430, \u0418\u043D\u0430\u0447\u0435, \u041A\u043E\u043D\u0435\u0446\u0415\u0441\u043B\u0438, \u0414\u043B\u044F \u041A\u0430\u0436\u0434\u043E\u0433\u043E, \u0426\u0438\u043A\u043B, \u041A\u043E\u043D\u0435\u0446\u0426\u0438\u043A\u043B\u0430, \u041D\u043E\u0432\u044B\u0439, \u041F\u0440\u043E\u0446\u0435\u0434\u0443\u0440\u0430, \u0424\u0443\u043D\u043A\u0446\u0438\u044F).
3. \u0418\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0439 \u0442\u043E\u0447\u043D\u044B\u0435 \u0438\u043C\u0435\u043D\u0430 \u043C\u0435\u0442\u0430\u0434\u0430\u043D\u043D\u044B\u0445 \u0438\u0437 \u043A\u043E\u043D\u0442\u0435\u043A\u0441\u0442\u0430.

${N}`,H=`\u041A\u043E\u0434 \u0414\u041E \u043A\u0443\u0440\u0441\u043E\u0440\u0430:
${k}

\u041A\u043E\u0434 \u041F\u041E\u0421\u041B\u0415 \u043A\u0443\u0440\u0441\u043E\u0440\u0430:
${F}

\u0414\u043E\u043F\u0438\u0448\u0438 \u043A\u043E\u0434 \u0441 \u043F\u043E\u0437\u0438\u0446\u0438\u0438 \u043A\u0443\u0440\u0441\u043E\u0440\u0430:`;try{if(o.isCancellationRequested)return null;let P=await c.complete(d,j,D,H,.1,150);if(o.isCancellationRequested||!P.trim())return null;let _=P.replace(/^```(bsl|1c)?\n?/,"").replace(/```$/,"");return _.trim()?[new g.InlineCompletionItem(_,new g.Range(e,e))]:null}catch{return null}}};var b=C(require("vscode"));var y=class{static auditCode(t){let e=[],a=t.split(`
`),o=!1,i=0,r=!1,d=!1;for(let l=0;l<a.length;l++){let u=a[l].trim(),m=l+1;u.includes("\u041F\u0440\u043E\u0446\u0435\u0434\u0443\u0440\u0430 \u041E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0430\u041F\u0440\u043E\u0432\u0435\u0434\u0435\u043D\u0438\u044F")&&(r=!0,d=!1),r&&u.includes("\u041D\u043E\u0432\u044B\u0439 \u0411\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043A\u0430\u0414\u0430\u043D\u043D\u044B\u0445")&&(d=!0),r&&u.includes("\u041A\u043E\u043D\u0435\u0446\u041F\u0440\u043E\u0446\u0435\u0434\u0443\u0440\u044B")&&(d||e.push({line:m,rule:"ITS-LOCK-001",severity:"error",message:"\u0412 \u043F\u0440\u043E\u0446\u0435\u0434\u0443\u0440\u0435 \u041E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0430\u041F\u0440\u043E\u0432\u0435\u0434\u0435\u043D\u0438\u044F \u043E\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442 \u043E\u0431\u044A\u0435\u043A\u0442 \u0411\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043A\u0430\u0414\u0430\u043D\u043D\u044B\u0445.",suggestion:"\u0423\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u0435 \u0443\u043F\u0440\u0430\u0432\u043B\u044F\u0435\u043C\u0443\u044E \u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043A\u0443 \u0434\u0430\u043D\u043D\u044B\u0445 \u043F\u0435\u0440\u0435\u0434 \u0447\u0442\u0435\u043D\u0438\u0435\u043C \u043E\u0441\u0442\u0430\u0442\u043A\u043E\u0432 \u0434\u043B\u044F \u043F\u0440\u0435\u0434\u043E\u0442\u0432\u0440\u0430\u0449\u0435\u043D\u0438\u044F \u0432\u0437\u0430\u0438\u043C\u043E\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043E\u043A (Deadlock) \u043F\u0440\u0438 \u043F\u0430\u0440\u0430\u043B\u043B\u0435\u043B\u044C\u043D\u043E\u043C \u043F\u0440\u043E\u0432\u0435\u0434\u0435\u043D\u0438\u0438."}),r=!1),/^\s*(Для\s+Каждого|Для\s+\w+\s*=|Пока\s+)/i.test(u)&&(o=!0,i=m),/^\s*КонецЦикла;/i.test(u)&&(o=!1),o&&/\.Выполнить\s*\(\s*\)/i.test(u)&&e.push({line:m,rule:"ITS-PERF-001",severity:"error",message:"\u0412\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u0435 \u0437\u0430\u043F\u0440\u043E\u0441\u0430 \u0432\u043D\u0443\u0442\u0440\u0438 \u0446\u0438\u043A\u043B\u0430 (\u0417\u0430\u043F\u0440\u043E\u0441.\u0412\u044B\u043F\u043E\u043B\u043D\u0438\u0442\u044C()).",suggestion:"\u041F\u0435\u0440\u0435\u043D\u0435\u0441\u0438\u0442\u0435 \u0432\u044B\u0433\u0440\u0443\u0437\u043A\u0443 \u0434\u0430\u043D\u043D\u044B\u0445 \u0432 \u043E\u0434\u0438\u043D \u043F\u0430\u043A\u0435\u0442\u043D\u044B\u0439 \u0437\u0430\u043F\u0440\u043E\u0441 \u0434\u043E \u0446\u0438\u043A\u043B\u0430, \u043B\u0438\u0431\u043E \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0439\u0442\u0435 \u0432\u0440\u0435\u043C\u0435\u043D\u043D\u0443\u044E \u0442\u0430\u0431\u043B\u0438\u0446\u0443 \u0441 \u0441\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u0435\u043C \u043F\u043E \u043C\u0430\u0441\u0441\u0438\u0432\u0443 \u0441\u0441\u044B\u043B\u043E\u043A."}),/\.(Остатки|СрезПоследних|СрезПервых|Обороты)\s*\(\s*\)/i.test(u)&&e.push({line:m,rule:"ITS-PERF-002",severity:"warning",message:"\u041E\u0431\u0440\u0430\u0449\u0435\u043D\u0438\u0435 \u043A \u0432\u0438\u0440\u0442\u0443\u0430\u043B\u044C\u043D\u043E\u0439 \u0442\u0430\u0431\u043B\u0438\u0446\u0435 \u0431\u0435\u0437 \u043F\u0435\u0440\u0435\u0434\u0430\u0447\u0438 \u043F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u043E\u0432 \u0441\u0440\u0435\u0437\u0430/\u0443\u0441\u043B\u043E\u0432\u0438\u044F.",suggestion:"\u0412\u0441\u0435\u0433\u0434\u0430 \u043F\u0435\u0440\u0435\u0434\u0430\u0432\u0430\u0439\u0442\u0435 \u043F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u044B \u043F\u0435\u0440\u0438\u043E\u0434\u0430 \u0438 \u0443\u0441\u043B\u043E\u0432\u0438\u0439 \u043E\u0442\u0431\u043E\u0440\u0430 \u0432 \u043F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u044B \u0432\u0438\u0440\u0442\u0443\u0430\u043B\u044C\u043D\u043E\u0439 \u0442\u0430\u0431\u043B\u0438\u0446\u044B, \u0430 \u043D\u0435 \u0444\u0438\u043B\u044C\u0442\u0440\u0443\u0439\u0442\u0435 \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442 \u0432 \u0441\u0435\u043A\u0446\u0438\u0438 \u0413\u0414\u0415."}),/(Предупреждение|Вопрос|ВвестиСтроку|ВвестиЧисло)\s*\(/i.test(u)&&!/Оповещение/i.test(u)&&e.push({line:m,rule:"ITS-UI-003",severity:"warning",message:"\u0418\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D\u0438\u0435 \u043C\u043E\u0434\u0430\u043B\u044C\u043D\u044B\u0445 \u043E\u043A\u043E\u043D (\u041F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0435/\u0412\u043E\u043F\u0440\u043E\u0441). \u0417\u0430\u043F\u0440\u0435\u0449\u0435\u043D\u043E \u0432 \u0432\u0435\u0431-\u043A\u043B\u0438\u0435\u043D\u0442\u0435 \u0438 \u043C\u043E\u0431\u0438\u043B\u044C\u043D\u043E\u043C \u043A\u043B\u0438\u0435\u043D\u0442\u0435.",suggestion:"\u0418\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0439\u0442\u0435 \u0430\u0441\u0438\u043D\u0445\u0440\u043E\u043D\u043D\u044B\u0435 \u043C\u0435\u0442\u043E\u0434\u044B: \u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C\u041F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0435(), \u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C\u0412\u043E\u043F\u0440\u043E\u0441() \u0441 \u043F\u0435\u0440\u0435\u0434\u0430\u0447\u0435\u0439 \u041E\u043F\u0438\u0441\u0430\u043D\u0438\u0435\u041E\u043F\u043E\u0432\u0435\u0449\u0435\u043D\u0438\u044F."})}return e}static formatAuditReport(t){if(t.length===0)return"\u2713 \u0417\u0430\u043C\u0435\u0447\u0430\u043D\u0438\u0439 \u043F\u043E \u0441\u0442\u0430\u043D\u0434\u0430\u0440\u0442\u0430\u043C \u0440\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u043A\u0438 \u0444\u0438\u0440\u043C\u044B \xAB1\u0421\xBB (\u0418\u0422\u0421) \u043D\u0435 \u043E\u0431\u043D\u0430\u0440\u0443\u0436\u0435\u043D\u043E.";let e=[`\u041D\u0430\u0439\u0434\u0435\u043D\u043E \u0437\u0430\u043C\u0435\u0447\u0430\u043D\u0438\u0439 \u043F\u043E \u0441\u0442\u0430\u043D\u0434\u0430\u0440\u0442\u0430\u043C \u0418\u0422\u0421: ${t.length}
`];for(let a of t){let o=a.severity==="error"?"\u{1F534} [\u041A\u0440\u0438\u0442\u0438\u0447\u043D\u043E]":"\u{1F7E1} [\u041F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0435]";e.push(`${o} \u0421\u0442\u0440\u043E\u043A\u0430 ${a.line} | ${a.rule}: ${a.message}`),e.push(`   \u{1F4A1} \u0420\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u0430\u0446\u0438\u044F: ${a.suggestion}
`)}return e.join(`
`)}};var A=class{constructor(t,e){this._extensionUri=t;this._context=e}_extensionUri;_context;_view;async resolveWebviewView(t,e,a){this._view=t,t.webview.options={enableScripts:!0,localResourceRoots:[this._extensionUri]};let o=async()=>{let i=await c.getApiKey(this._context),r=await c.checkBalance(i);t.webview.html=this._getHtmlForWebview(i,r)};await o(),t.webview.onDidReceiveMessage(async i=>{switch(i.type){case"saveKey":await c.setApiKey(this._context,i.value),b.window.showInformationMessage("API-\u043A\u043B\u044E\u0447 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D \u0432 SecretStorage."),await o();break;case"openBilling":b.env.openExternal(b.Uri.parse("https://normahub.cc/billing"));break;case"openB2B":b.env.openExternal(b.Uri.parse("https://normahub.cc"));break;case"generateQuery":await this._handleGenerateQuery(i.intent);break;case"auditSelection":await this._handleAuditSelection();break}})}async _handleGenerateQuery(t){if(!this._view)return;let e=await c.getApiKey(this._context);if(!e){this._view.webview.postMessage({type:"queryResult",error:"API-\u043A\u043B\u044E\u0447 \u043D\u0435 \u0437\u0430\u0434\u0430\u043D. \u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u043A\u043B\u044E\u0447 \u0432\u043E \u0432\u043A\u043B\u0430\u0434\u043A\u0435 \u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0430."});return}let o=b.workspace.getConfiguration("normahub1c").get("reasoningModel","claude-sonnet-5-5"),i=b.workspace.workspaceFolders?.[0]?.uri.fsPath||"",r=await p.scanWorkspace(i),l=`\u0422\u044B \u2014 \u0432\u0435\u0434\u0443\u0449\u0438\u0439 \u044D\u043A\u0441\u043F\u0435\u0440\u0442 \u043F\u043E \u044F\u0437\u044B\u043A\u0443 \u0437\u0430\u043F\u0440\u043E\u0441\u043E\u0432 1\u0421:\u041F\u0440\u0435\u0434\u043F\u0440\u0438\u044F\u0442\u0438\u0435 8.3 (\u0421\u0442\u0430\u043D\u0434\u0430\u0440\u0442\u044B \u0444\u0438\u0440\u043C\u044B \xAB1\u0421\xBB).
\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u043E\u043F\u0438\u0441\u044B\u0432\u0430\u0435\u0442 \u0431\u0438\u0437\u043D\u0435\u0441-\u0437\u0430\u0434\u0430\u0447\u0443 \u043D\u0430 \u0440\u0443\u0441\u0441\u043A\u043E\u043C \u044F\u0437\u044B\u043A\u0435. \u0421\u0444\u043E\u0440\u043C\u0438\u0440\u0443\u0439 \u0447\u0438\u0441\u0442\u044B\u0439, \u043E\u043F\u0442\u0438\u043C\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0439 \u043A\u043E\u0434 1\u0421 \u0441 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u0435\u043C \u043E\u0431\u044A\u0435\u043A\u0442\u0430 \u0417\u0430\u043F\u0440\u043E\u0441.
\u0422\u0440\u0435\u0431\u043E\u0432\u0430\u043D\u0438\u044F \u0441\u0442\u0430\u043D\u0434\u0430\u0440\u0442\u043E\u0432 \u0418\u0422\u0421:
1. \u0418\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C \u043F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u044B \u0432 \u0432\u0438\u0440\u0442\u0443\u0430\u043B\u044C\u043D\u044B\u0445 \u0442\u0430\u0431\u043B\u0438\u0446\u0430\u0445 (\u041E\u0441\u0442\u0430\u0442\u043A\u0438(&\u041F\u0435\u0440\u0438\u043E\u0434, ), \u0421\u0440\u0435\u0437\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0445(&\u041F\u0435\u0440\u0438\u043E\u0434, )).
2. \u041D\u0438\u043A\u043E\u0433\u0434\u0430 \u043D\u0435 \u0441\u043E\u0435\u0434\u0438\u043D\u044F\u0442\u044C \u0432\u0438\u0440\u0442\u0443\u0430\u043B\u044C\u043D\u044B\u0435 \u0442\u0430\u0431\u043B\u0438\u0446\u044B \u043D\u0430\u043F\u0440\u044F\u043C\u0443\u044E \u2014 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C \u041C\u0435\u043D\u0435\u0434\u0436\u0435\u0440\u0412\u0440\u0435\u043C\u0435\u043D\u043D\u044B\u0445\u0422\u0430\u0431\u043B\u0438\u0446.
3. \u041F\u0440\u043E\u0432\u0435\u0440\u044F\u0442\u044C \u0437\u043D\u0430\u0447\u0435\u043D\u0438\u044F \u043D\u0430 NULL \u0447\u0435\u0440\u0435\u0437 \u0415\u0421\u0422\u042CNULL.
4. \u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0443\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0443 \u043F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u043E\u0432 \u0447\u0435\u0440\u0435\u0437 \u0417\u0430\u043F\u0440\u043E\u0441.\u0423\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C\u041F\u0430\u0440\u0430\u043C\u0435\u0442\u0440().
5. \u0412\u044B\u0432\u0435\u0434\u0438 \u0442\u043E\u043B\u044C\u043A\u043E \u0433\u043E\u0442\u043E\u0432\u044B\u0439 BSL-\u043A\u043E\u0434 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u044F \u0438 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u044F \u0437\u0430\u043F\u0440\u043E\u0441\u0430.

${p.formatForPrompt(r)}`;try{this._view.webview.postMessage({type:"queryStatus",text:"\u0413\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044F \u0437\u0430\u043F\u0440\u043E\u0441\u0430 \u0447\u0435\u0440\u0435\u0437 NormaHub..."});let v=await c.complete(e,o,l,t,.1,1500);this._view.webview.postMessage({type:"queryResult",code:v})}catch(v){this._view.webview.postMessage({type:"queryResult",error:v.message})}}async _handleAuditSelection(){if(!this._view)return;let t=b.window.activeTextEditor;if(!t){this._view.webview.postMessage({type:"auditResult",report:"\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u043C\u043E\u0434\u0443\u043B\u044C BSL \u0434\u043B\u044F \u0430\u043D\u0430\u043B\u0438\u0437\u0430."});return}let e=t.selection.isEmpty?t.document.getText():t.document.getText(t.selection),a=y.auditCode(e),o=y.formatAuditReport(a);this._view.webview.postMessage({type:"auditResult",report:o})}_getHtmlForWebview(t,e){let a=t?`${t.slice(0,8)}...${t.slice(-4)}`:"\u041D\u0435 \u0437\u0430\u0434\u0430\u043D";return`<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>1C BSL AI Copilot</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-sideBar-background);
            padding: 10px;
            margin: 0;
            line-height: 1.4;
        }
        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid var(--vscode-widget-border, #333);
            padding-bottom: 8px;
            margin-bottom: 10px;
        }
        .title {
            font-weight: 600;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .badge {
            font-size: 11px;
            color: #4ade80;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .tabs {
            display: flex;
            border-bottom: 1px solid var(--vscode-widget-border, #333);
            margin-bottom: 10px;
            gap: 4px;
        }
        .tab {
            font-size: 11px;
            padding: 4px 8px;
            cursor: pointer;
            border-bottom: 2px solid transparent;
            color: var(--vscode-descriptionForeground);
            user-select: none;
        }
        .tab.active {
            color: var(--vscode-foreground);
            border-bottom-color: var(--vscode-activityBar-activeBorder, #007acc);
            font-weight: 600;
        }
        .tab-panel {
            display: none;
        }
        .tab-panel.active {
            display: block;
        }
        .card {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border, #2d2d2d);
            border-radius: 4px;
            padding: 10px;
            margin-bottom: 10px;
        }
        .card-title {
            font-size: 11px;
            font-weight: 600;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            margin-bottom: 6px;
        }
        input[type="password"], textarea {
            width: 100%;
            box-sizing: border-box;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, #444);
            padding: 5px 8px;
            border-radius: 2px;
            font-size: 12px;
            outline: none;
            font-family: inherit;
        }
        textarea {
            resize: vertical;
            min-height: 60px;
            font-family: var(--vscode-editor-font-family, monospace);
        }
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 10px;
            border-radius: 2px;
            cursor: pointer;
            font-size: 12px;
            width: 100%;
            margin-top: 6px;
            font-weight: 500;
        }
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        button.secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        button.secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        .code-box {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border, #333);
            border-radius: 2px;
            padding: 8px;
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 11px;
            white-space: pre-wrap;
            max-height: 200px;
            overflow-y: auto;
            margin-top: 6px;
        }
        .balance-badge {
            font-size: 14px;
            font-weight: 600;
            color: #4ade80;
            margin-bottom: 6px;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="title">1C BSL AI Copilot</div>
        <div class="badge">\u25CF \u0428\u043B\u044E\u0437 NormaHub</div>
    </div>

    <div class="tabs">
        <div class="tab active" data-tab="queryTab">\u0417\u0430\u043F\u0440\u043E\u0441\u044B 1\u0421</div>
        <div class="tab" data-tab="auditTab">\u0410\u0443\u0434\u0438\u0442 \u0418\u0422\u0421</div>
        <div class="tab" data-tab="accountTab">\u0411\u0430\u043B\u0430\u043D\u0441 / \u0428\u043B\u044E\u0437</div>
    </div>

    <!-- TAB 1: QUERY WIZARD -->
    <div class="tab-panel active" id="queryTab">
        <div class="card">
            <div class="card-title">\u041A\u043E\u043D\u0441\u0442\u0440\u0443\u043A\u0442\u043E\u0440 \u0437\u0430\u043F\u0440\u043E\u0441\u043E\u0432 1\u0421</div>
            <textarea id="queryIntent" placeholder="\u041E\u043F\u0438\u0448\u0438\u0442\u0435 \u0437\u0430\u0434\u0430\u0447\u0443 (\u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440: \u0412\u044B\u0431\u0440\u0430\u0442\u044C \u043E\u0441\u0442\u0430\u0442\u043A\u0438 \u0442\u043E\u0432\u0430\u0440\u043E\u0432 \u043D\u0430 \u0441\u043A\u043B\u0430\u0434\u0435 \u0441 \u0446\u0435\u043D\u0430\u043C\u0438 \u0438\u0437 \u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0430 \u0441\u0432\u0435\u0434\u0435\u043D\u0438\u0439 \u043D\u0430 \u0434\u0430\u0442\u0443 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0430)..."></textarea>
            <button id="genQueryBtn">\u0421\u0433\u0435\u043D\u0435\u0440\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0437\u0430\u043F\u0440\u043E\u0441 1\u0421</button>
            <div id="queryStatus" style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 4px;"></div>
            <div class="code-box" id="queryResultBox" style="display: none;"></div>
        </div>
    </div>

    <!-- TAB 2: STANDARDS AUDIT -->
    <div class="tab-panel" id="auditTab">
        <div class="card">
            <div class="card-title">\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u0441\u0442\u0430\u043D\u0434\u0430\u0440\u0442\u043E\u0432 \u0418\u0422\u0421</div>
            <div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 6px;">
                \u041F\u043E\u0438\u0441\u043A \u0437\u0430\u043F\u0440\u043E\u0441\u043E\u0432 \u0432 \u0446\u0438\u043A\u043B\u0430\u0445, \u043E\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0438\u044F \u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043E\u043A \u0434\u0430\u043D\u043D\u044B\u0445 \u0438 \u043D\u0435\u043E\u043F\u0442\u0438\u043C\u0430\u043B\u044C\u043D\u044B\u0445 \u0432\u0438\u0440\u0442\u0443\u0430\u043B\u044C\u043D\u044B\u0445 \u0442\u0430\u0431\u043B\u0438\u0446.
            </div>
            <button id="auditBtn">\u041F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0439 \u043C\u043E\u0434\u0443\u043B\u044C</button>
            <div class="code-box" id="auditReportBox" style="display: none;"></div>
        </div>
    </div>

    <!-- TAB 3: ACCOUNT & BILLING -->
    <div class="tab-panel" id="accountTab">
        <div class="card">
            <div class="card-title">\u0411\u0430\u043B\u0430\u043D\u0441 \u0442\u043E\u043A\u0435\u043D\u043E\u0432 (Pay-As-You-Go)</div>
            <div class="balance-badge" id="balanceVal">${e.status==="active"?`${e.balanceRub.toFixed(2)} \u20BD`:"\u041A\u043B\u044E\u0447 \u043D\u0435 \u0430\u043A\u0442\u0438\u0432\u0435\u043D"}</div>
            <div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 8px;">
                \u041E\u043F\u043B\u0430\u0442\u0430 \u0442\u043E\u043B\u044C\u043A\u043E \u0437\u0430 \u0440\u0435\u0430\u043B\u044C\u043D\u043E \u0441\u0433\u0435\u043D\u0435\u0440\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0435 \u0442\u043E\u043A\u0435\u043D\u044B. \u0411\u0435\u0437 \u0435\u0436\u0435\u043C\u0435\u0441\u044F\u0447\u043D\u043E\u0439 \u0430\u0431\u043E\u043D\u0435\u043D\u0442\u0441\u043A\u043E\u0439 \u043F\u043B\u0430\u0442\u044B.
            </div>
            <button id="topupBtn">\u041F\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u044C \u0431\u0430\u043B\u0430\u043D\u0441 (\u0421\u0411\u041F / \u041A\u0430\u0440\u0442\u044B \u041C\u0418\u0420)</button>
            <button class="secondary" id="b2bBtn">\u0421\u0447\u0435\u0442 \u0434\u043B\u044F \u044E\u0440\u043B\u0438\u0446 \u0441 \u041D\u0414\u0421 20% (\u0414\u0438\u0430\u0434\u043E\u043A)</button>
        </div>

        <div class="card">
            <div class="card-title">\u0410\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u044F</div>
            <div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 4px;">
                \u041A\u043B\u044E\u0447: <code>${a}</code>
            </div>
            <input type="password" id="keyInput" placeholder="nr_hub_..." />
            <button id="saveKeyBtn">\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0432 SecretStorage</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        // Tabs
        document.querySelectorAll('.tab').forEach(t => {
            t.addEventListener('click', () => {
                document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
                document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
                t.classList.add('active');
                document.getElementById(t.getAttribute('data-tab')).classList.add('active');
            });
        });

        // Query wizard
        document.getElementById('genQueryBtn').addEventListener('click', () => {
            const val = document.getElementById('queryIntent').value.trim();
            if (!val) return;
            document.getElementById('queryStatus').textContent = '\u0413\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044F...';
            document.getElementById('queryResultBox').style.display = 'none';
            vscode.postMessage({ type: 'generateQuery', intent: val });
        });

        // Audit
        document.getElementById('auditBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'auditSelection' });
        });

        // Keys & Billing
        document.getElementById('saveKeyBtn').addEventListener('click', () => {
            const val = document.getElementById('keyInput').value.trim();
            vscode.postMessage({ type: 'saveKey', value: val });
        });

        document.getElementById('topupBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'openBilling' });
        });

        document.getElementById('b2bBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'openB2B' });
        });

        window.addEventListener('message', ev => {
            const m = ev.data;
            if (m.type === 'queryResult') {
                const box = document.getElementById('queryResultBox');
                const st = document.getElementById('queryStatus');
                st.textContent = '';
                box.style.display = 'block';
                if (m.code) {
                    box.textContent = m.code;
                    box.style.color = 'var(--vscode-foreground)';
                } else {
                    box.textContent = '\u041E\u0448\u0438\u0431\u043A\u0430: ' + m.error;
                    box.style.color = '#f87171';
                }
            } else if (m.type === 'auditResult') {
                const box = document.getElementById('auditReportBox');
                box.style.display = 'block';
                box.textContent = m.report;
            }
        });
    </script>
</body>
</html>`}};var w;function J(s){w=n.window.createStatusBarItem(n.StatusBarAlignment.Right,100),w.command="normahub1c.statusMenu",w.tooltip="1C BSL AI Copilot: \u041A\u043B\u0438\u043A\u043D\u0438\u0442\u0435 \u0434\u043B\u044F \u043C\u0435\u043D\u044E \u0431\u0430\u043B\u0430\u043D\u0441\u0430 \u0438 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043A",U(s),w.show(),s.subscriptions.push(w);let t=[{scheme:"file",language:"bsl"},{scheme:"file",language:"1c"},{scheme:"file",language:"oscript"},{scheme:"untitled",language:"bsl"}],e=new R(s);s.subscriptions.push(n.languages.registerInlineCompletionItemProvider(t,e));let a=new A(s.extensionUri,s);s.subscriptions.push(n.window.registerWebviewViewProvider("normahub1c.mainView",a)),s.subscriptions.push(n.commands.registerCommand("normahub1c.statusMenu",()=>Z(s)),n.commands.registerCommand("normahub1c.generateQuery",()=>X(s)),n.commands.registerCommand("normahub1c.auditStandards",()=>ee()),n.commands.registerCommand("normahub1c.explainCode",()=>te(s)),n.commands.registerCommand("normahub1c.scanMetadata",async()=>{let o=n.workspace.workspaceFolders?.[0]?.uri.fsPath||"";p.clearCache();let i=await p.scanWorkspace(o);n.window.showInformationMessage(`\u041C\u0435\u0442\u0430\u0434\u0430\u043D\u043D\u044B\u0435 1\u0421 \u043F\u0440\u043E\u0441\u043A\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u044B: \u043D\u0430\u0439\u0434\u0435\u043D\u043E ${i.objects.length} \u043E\u0431\u044A\u0435\u043A\u0442\u043E\u0432.`)}),n.commands.registerCommand("normahub1c.topupBalance",()=>{n.env.openExternal(n.Uri.parse("https://normahub.cc/billing"))}),n.commands.registerCommand("normahub1c.setApiKey",async()=>{let o=await n.window.showInputBox({prompt:"\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0432\u0430\u0448 API-\u043A\u043B\u044E\u0447 NormaHub (\u0444\u043E\u0440\u043C\u0430\u0442 nr_hub_...)",password:!0,placeHolder:"nr_hub_..."});o!==void 0&&(await c.setApiKey(s,o),n.window.showInformationMessage("API-\u043A\u043B\u044E\u0447 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D \u0432 \u0437\u0430\u0449\u0438\u0449\u0435\u043D\u043D\u043E\u043C SecretStorage."),U(s))}))}async function U(s){let t=await c.getApiKey(s);if(!t){w.text="$(hubot) 1\u0421 Copilot: [\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u043A\u043B\u044E\u0447]";return}let e=await c.checkBalance(t);e.status==="active"?w.text=`$(hubot) 1\u0421 Copilot: ${e.balanceRub.toFixed(2)} \u20BD`:w.text=`$(alert) 1\u0421 Copilot: ${e.error||"\u041E\u0448\u0438\u0431\u043A\u0430"}`}async function Z(s){let t=await c.getApiKey(s),a=[{label:"$(credit-card) \u041F\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u044C \u0431\u0430\u043B\u0430\u043D\u0441 (\u0421\u0411\u041F / \u041A\u0430\u0440\u0442\u044B \u041C\u0418\u0420)",detail:`\u0422\u0435\u043A\u0443\u0449\u0438\u0439 \u0431\u0430\u043B\u0430\u043D\u0441: ${(await c.checkBalance(t)).balanceRub.toFixed(2)} \u20BD. \u041E\u043F\u043B\u0430\u0442\u0430 \u0442\u043E\u043B\u044C\u043A\u043E \u0437\u0430 \u0440\u0435\u0430\u043B\u044C\u043D\u044B\u0435 \u0442\u043E\u043A\u0435\u043D\u044B.`,action:"billing"},{label:"$(file-text) \u0412\u044B\u0441\u0442\u0430\u0432\u0438\u0442\u044C \u0441\u0447\u0435\u0442 \u044E\u0440\u043B\u0438\u0446\u0443 \u0441 \u041D\u0414\u0421 20% (\u0414\u0438\u0430\u0434\u043E\u043A)",detail:"\u0411\u0435\u0437\u043D\u0430\u043B\u0438\u0447\u043D\u044B\u0439 \u0440\u0430\u0441\u0447\u0435\u0442 \u0434\u043B\u044F \u043E\u0440\u0433\u0430\u043D\u0438\u0437\u0430\u0446\u0438\u0439 \u0438 \u0444\u0440\u0430\u043D\u0447\u0430\u0439\u0437\u0438 1\u0421",action:"b2b"},{label:"$(key) \u041D\u0430\u0441\u0442\u0440\u043E\u0438\u0442\u044C API-\u043A\u043B\u044E\u0447 NormaHub",detail:t?`\u0410\u043A\u0442\u0438\u0432\u0435\u043D \u043A\u043B\u044E\u0447 ${t.slice(0,6)}...`:"\u041A\u043B\u044E\u0447 \u043D\u0435 \u0437\u0430\u0434\u0430\u043D",action:"setKey"},{label:"$(symbol-structure) \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u043C\u0435\u0442\u0430\u0434\u0430\u043D\u043D\u044B\u0435 \u043A\u043E\u043D\u0444\u0438\u0433\u0443\u0440\u0430\u0446\u0438\u0438",detail:"\u041F\u043E\u0432\u0442\u043E\u0440\u043D\u043E \u0441\u043A\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u0442\u044C Configuration.xml \u0432 \u043F\u0440\u043E\u0435\u043A\u0442\u0435",action:"scanMeta"}],o=await n.window.showQuickPick(a,{placeHolder:"NormaHub 1C BSL Copilot: \u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0448\u043B\u044E\u0437\u043E\u043C"});o&&(o.action==="billing"?n.env.openExternal(n.Uri.parse("https://normahub.cc/billing")):o.action==="b2b"?n.env.openExternal(n.Uri.parse("https://normahub.cc")):o.action==="setKey"?n.commands.executeCommand("normahub1c.setApiKey"):o.action==="scanMeta"&&n.commands.executeCommand("normahub1c.scanMetadata"))}async function X(s){let t=await n.window.showInputBox({prompt:"\u041E\u043F\u0438\u0448\u0438\u0442\u0435 \u0437\u0430\u0434\u0430\u0447\u0443 \u0434\u043B\u044F \u0437\u0430\u043F\u0440\u043E\u0441\u0430 1\u0421 \u043D\u0430 \u0440\u0443\u0441\u0441\u043A\u043E\u043C \u044F\u0437\u044B\u043A\u0435",placeHolder:"\u041D\u0430\u043F\u0440\u0438\u043C\u0435\u0440: \u0412\u044B\u0431\u0440\u0430\u0442\u044C \u043E\u0441\u0442\u0430\u0442\u043A\u0438 \u043D\u043E\u043C\u0435\u043D\u043A\u043B\u0430\u0442\u0443\u0440\u044B \u043D\u0430 \u0441\u043A\u043B\u0430\u0434\u0435 \u0441 \u0446\u0435\u043D\u0430\u043C\u0438 \u043D\u0430 \u0434\u0430\u0442\u0443 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0430"});if(!t||!t.trim())return;let e=await c.getApiKey(s);if(!e){n.window.showErrorMessage("API-\u043A\u043B\u044E\u0447 \u043D\u0435 \u0437\u0430\u0434\u0430\u043D. \u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u043D\u0430 \u0441\u0442\u0430\u0442\u0443\u0441-\u0431\u0430\u0440 1C Copilot.");return}let o=n.workspace.getConfiguration("normahub1c").get("reasoningModel","claude-sonnet-5-5"),i=n.workspace.workspaceFolders?.[0]?.uri.fsPath||"",r=await p.scanWorkspace(i),l=`\u0422\u044B \u2014 \u0432\u0435\u0434\u0443\u0449\u0438\u0439 \u044D\u043A\u0441\u043F\u0435\u0440\u0442 \u043F\u043E \u044F\u0437\u044B\u043A\u0443 \u0437\u0430\u043F\u0440\u043E\u0441\u043E\u0432 1\u0421:\u041F\u0440\u0435\u0434\u043F\u0440\u0438\u044F\u0442\u0438\u0435 8.3 (\u0421\u0442\u0430\u043D\u0434\u0430\u0440\u0442\u044B \u0444\u0438\u0440\u043C\u044B \xAB1\u0421\xBB).
\u0421\u0444\u043E\u0440\u043C\u0438\u0440\u0443\u0439 \u043E\u043F\u0442\u0438\u043C\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0439 BSL-\u043A\u043E\u0434 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u044F \u0438 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u044F \u043E\u0431\u044A\u0435\u043A\u0442\u0430 \u0417\u0430\u043F\u0440\u043E\u0441.
\u0422\u0440\u0435\u0431\u043E\u0432\u0430\u043D\u0438\u044F \u0441\u0442\u0430\u043D\u0434\u0430\u0440\u0442\u043E\u0432 \u0418\u0422\u0421:
- \u0418\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C \u043F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u044B \u0432 \u0432\u0438\u0440\u0442\u0443\u0430\u043B\u044C\u043D\u044B\u0445 \u0442\u0430\u0431\u043B\u0438\u0446\u0430\u0445.
- \u0418\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C \u041C\u0435\u043D\u0435\u0434\u0436\u0435\u0440\u0412\u0440\u0435\u043C\u0435\u043D\u043D\u044B\u0445\u0422\u0430\u0431\u043B\u0438\u0446 \u043F\u0440\u0438 \u0441\u043B\u043E\u0436\u043D\u044B\u0445 \u0441\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u044F\u0445.
- \u0418\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C \u0415\u0421\u0422\u042CNULL \u0434\u043B\u044F \u0430\u0433\u0440\u0435\u0433\u0430\u0442\u043E\u0432.
- \u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0417\u0430\u043F\u0440\u043E\u0441.\u0423\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C\u041F\u0430\u0440\u0430\u043C\u0435\u0442\u0440() \u0434\u043B\u044F \u0432\u0441\u0435\u0445 \u043F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u043E\u0432.

${p.formatForPrompt(r)}`;await n.window.withProgress({location:n.ProgressLocation.Notification,title:"1C Copilot: \u0413\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044F \u0437\u0430\u043F\u0440\u043E\u0441\u0430 1\u0421 \u043F\u043E \u0441\u0442\u0430\u043D\u0434\u0430\u0440\u0442\u0430\u043C \u0418\u0422\u0421...",cancellable:!1},async()=>{try{let v=await c.complete(e,o,l,t,.1,1500),u=n.window.activeTextEditor;if(u)u.edit(m=>{m.insert(u.selection.active,`
${v}
`)});else{let m=await n.workspace.openTextDocument({content:v,language:"bsl"});await n.window.showTextDocument(m)}}catch(v){n.window.showErrorMessage(`\u041E\u0448\u0438\u0431\u043A\u0430 \u0433\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u0438: ${v.message}`)}})}function ee(){let s=n.window.activeTextEditor;if(!s){n.window.showWarningMessage("\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0444\u0430\u0439\u043B \u0441 \u043A\u043E\u0434\u043E\u043C BSL \u0434\u043B\u044F \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438.");return}let t=s.selection.isEmpty?s.document.getText():s.document.getText(s.selection),e=y.auditCode(t),a=y.formatAuditReport(e);e.length===0?n.window.showInformationMessage("\u2713 \u041A\u043E\u0434 \u043F\u043E\u043B\u043D\u043E\u0441\u0442\u044C\u044E \u0441\u043E\u043E\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0443\u0435\u0442 \u0441\u0442\u0430\u043D\u0434\u0430\u0440\u0442\u0430\u043C \u0440\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u043A\u0438 \u0444\u0438\u0440\u043C\u044B \xAB1\u0421\xBB (\u0418\u0422\u0421)."):n.workspace.openTextDocument({content:a,language:"markdown"}).then(o=>n.window.showTextDocument(o,{viewColumn:n.ViewColumn.Beside}))}async function te(s){let t=n.window.activeTextEditor;if(!t||t.selection.isEmpty){n.window.showWarningMessage("\u0412\u044B\u0434\u0435\u043B\u0438\u0442\u0435 \u0444\u0440\u0430\u0433\u043C\u0435\u043D\u0442 BSL-\u043A\u043E\u0434\u0430 \u0434\u043B\u044F \u043E\u0431\u044A\u044F\u0441\u043D\u0435\u043D\u0438\u044F.");return}let e=await c.getApiKey(s);if(!e){n.window.showErrorMessage("API-\u043A\u043B\u044E\u0447 \u043D\u0435 \u0437\u0430\u0434\u0430\u043D. \u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u043A\u043B\u044E\u0447 \u0447\u0435\u0440\u0435\u0437 \u0441\u0442\u0430\u0442\u0443\u0441-\u0431\u0430\u0440.");return}let a=t.document.getText(t.selection),i=n.workspace.getConfiguration("normahub1c").get("reasoningModel","claude-sonnet-5-5"),r=`\u0422\u044B \u2014 \u0441\u0435\u043D\u044C\u043E\u0440-\u0440\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u0447\u0438\u043A 1\u0421:\u041F\u0440\u0435\u0434\u043F\u0440\u0438\u044F\u0442\u0438\u0435 8.3.
\u041E\u0431\u044A\u044F\u0441\u043D\u0438 \u043D\u0430\u0437\u043D\u0430\u0447\u0435\u043D\u0438\u0435 \u0432\u044B\u0434\u0435\u043B\u0435\u043D\u043D\u043E\u0433\u043E \u0444\u0440\u0430\u0433\u043C\u0435\u043D\u0442\u0430 \u043A\u043E\u0434\u0430 BSL, \u0443\u043A\u0430\u0436\u0438 \u043A\u043E\u043D\u0442\u0435\u043A\u0441\u0442 \u0438\u0441\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u044F (&\u041D\u0430\u041A\u043B\u0438\u0435\u043D\u0442\u0435 / &\u041D\u0430\u0421\u0435\u0440\u0432\u0435\u0440\u0435), \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u043C\u044B\u0435 \u0440\u0435\u0433\u0438\u0441\u0442\u0440\u044B \u0438 \u043F\u043E\u0442\u0435\u043D\u0446\u0438\u0430\u043B\u044C\u043D\u044B\u0435 \u0443\u0437\u043A\u0438\u0435 \u043C\u0435\u0441\u0442\u0430 \u043F\u0440\u043E\u0438\u0437\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0441\u0442\u0438.`;await n.window.withProgress({location:n.ProgressLocation.Notification,title:"1C Copilot: \u0410\u043D\u0430\u043B\u0438\u0437 \u0444\u0440\u0430\u0433\u043C\u0435\u043D\u0442\u0430 \u043A\u043E\u0434\u0430 1\u0421...",cancellable:!1},async()=>{try{let d=await c.complete(e,i,r,a,.2,1200),l=await n.workspace.openTextDocument({content:`# \u0418\u043D\u0436\u0435\u043D\u0435\u0440\u043D\u044B\u0439 \u0440\u0430\u0437\u0431\u043E\u0440 \u043A\u043E\u0434\u0430 1\u0421

${d}`,language:"markdown"});await n.window.showTextDocument(l,{viewColumn:n.ViewColumn.Beside})}catch(d){n.window.showErrorMessage(`\u041E\u0448\u0438\u0431\u043A\u0430 \u0430\u043D\u0430\u043B\u0438\u0437\u0430: ${d.message}`)}})}0&&(module.exports={activate});
