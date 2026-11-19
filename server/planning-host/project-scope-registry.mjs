/** Trusted in-process composition only. This is not an upload/import/authentication API.
 * Host must own source and namespace/project selection, not take them from browser JSON.
 * source.getSnapshot(): stable frozen {epoch,raw}, raw is FULL exportProjects output.
 * Every source replacement (even identical bytes), mutation, and disposal MUST advance
 * a never-reused safe-integer epoch and synchronously notify subscribers. A snapshot
 * object must remain identical between changes. subscribe must install synchronously,
 * return an unsubscribe function, and leave no listener installed if it throws.
 * Disposal may make getSnapshot throw. These are trusted Host adapter obligations;
 * bytes/hashes alone cannot prove ownership or detect an unreported ABA mutation.
 * Any event revokes, never silently rebinds. Explicit registration is needed to refresh.
 * Catalog retirement/expiry/close releases admitted registrations automatically.
 * Close the registry too on Host disposal to cancel pending validation. No storage or network I/O.
 */
import {webcrypto} from 'node:crypto';
import {loadProjects,projectPayload,selectProjectHistory} from '../../src/project-planning-core.mjs';
import {buildProjectPromptDiscussion} from '../../src/project-prompt-core.mjs';
import {canonicalPlanningRequest} from '../../src/planning-model-adapter.mjs';
const fail=()=>{throw Error('PLANNING_HOST_PROJECT_REFUSED');};
const exact=(o,ks)=>o&&typeof o==='object'&&!Array.isArray(o)&&Reflect.ownKeys(o).length===ks.length&&ks.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(o,k)??{},'value'));
const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}return o;};
export function createPlanningHostProjectRegistry({catalog,crypto=webcrypto,maxAdmissions=16}={}){
 if(!catalog||typeof catalog.registerDocument!=='function'||!Number.isSafeInteger(maxAdmissions)||maxAdmissions<1||maxAdmissions>64)fail();
 const active=new Set();let closed=false,attempts=0;
 async function registerProject(options){
  if(closed||attempts>=maxAdmissions||!exact(options,['source','namespace','projectId','bridge']))fail();
  const {source,namespace,projectId,bridge}=options;
  if(!source||typeof source.getSnapshot!=='function'||typeof source.subscribe!=='function'||typeof namespace!=='string'||!namespace.trim()||namespace.length>300||typeof projectId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(projectId))fail();
  attempts++;
  let read=source.getSnapshot.bind(source);
  const subscribe=source.subscribe.bind(source);
  let snapshot,unsubscribe,handle,catalogSignal,state,latest,revoked=false;
  function retire(){
   if(revoked)return;revoked=true;active.delete(retire);
   catalogSignal?.removeEventListener('abort',retire);catalogSignal=undefined;
   const admitted=handle;handle=undefined;
   try{admitted?.retire();}finally{
    try{unsubscribe?.();}catch{/* Revocation remains effective even if trusted cleanup fails. */}
    unsubscribe=undefined;snapshot=undefined;state=undefined;latest=undefined;read=undefined;
   }
  }
  function current(){
   if(closed||revoked)return false;
   try{const now=read();if(now!==snapshot||!Object.isFrozen(now)||now.epoch!==snapshot.epoch||now.raw!==snapshot.raw)throw Error();return true;}catch{retire();return false;}
  }
  function check(){if(!current())fail();}
  active.add(retire);
  try{
   snapshot=read();
   if(!exact(snapshot,['epoch','raw'])||!Object.isFrozen(snapshot)||!Number.isSafeInteger(snapshot.epoch)||snapshot.epoch<0||typeof snapshot.raw!=='string'||Buffer.byteLength(snapshot.raw)>4000000)fail();
   const stop=subscribe(retire);
   if(typeof stop!=='function')fail();
   unsubscribe=stop;
   // subscribe may have synchronously notified before it returned its cleanup.
   if(revoked){try{unsubscribe();}catch{}unsubscribe=undefined;fail();}
   check();
   const validated=await loadProjects(snapshot.raw,namespace,crypto);
   check();
   state=validated;
   latest=state.projects.find(p=>p.id===projectId)?.revisions.at(-1);
   if(!latest)fail();
   const graph=latest.templateRaw===null?null:JSON.parse(latest.templateRaw).state.graphs.at(-1);
   const document=freeze({namespace:state.namespace,projectId,revisionSha256:latest.sha256,templateVersion:latest.templateVersion,nodes:graph?graph.nodes.map(n=>({nodeId:n.id,promptVersion:n.promptVersion})):[]});
   check();
   if(!bridge||!['prepare','confirm','consumeResult','cancel'].every(k=>typeof bridge[k]==='function'))fail();
   const original=Object.fromEntries(['prepare','confirm','consumeResult','cancel'].map(k=>[k,bridge[k].bind(bridge)]));
   // The outer binding is a selector, not evidence that payload context is genuine.
   // Rebuild selected context from the admitted full state, preserving public formats.
   const guardedBridge=Object.freeze({...original,async prepare(input,assertStable){
    const stable=()=>{check();assertStable();check();};
    stable();
    const q=canonicalPlanningRequest(input),b=q.binding;
    if(['namespace','projectId','revisionSha256','templateVersion'].some(k=>b[k]!==document[k])||
      (q.purpose==='node-prompt-discussion'&&!document.nodes.some(n=>n.nodeId===b.nodeId&&n.promptVersion===b.promptVersion)))fail();
    const parsed=JSON.parse(q.payload),context=parsed?.context;
    if(!context||typeof context!=='object'||Array.isArray(context))fail();
    const has=k=>Object.hasOwn(context,k);
    let rebuilt;
    if(q.purpose==='project-planning'){
     if(parsed.history!==undefined&&!Array.isArray(parsed.history))fail();
     const selected=(parsed.history??[]).map(h=>({id:h?.revisionId,sha256:h?.revisionSha256}));
     const history=selectProjectHistory(state,projectId,selected);
     rebuilt=await projectPayload({project:latest,target:parsed.target,request:parsed.request,
      scope:{title:has('title'),goal:has('goal'),template:has('template')},history},crypto);
    }else{
     const built=await buildProjectPromptDiscussion(state,{projectId,expectedRevisionSha256:document.revisionSha256,nodeId:b.nodeId,
      target:parsed.target,request:parsed.request,scope:{node:true,title:has('title'),goal:has('goal')},selectedHistory:parsed.binding?.selectedHistory},crypto);
     rebuilt=built.payload;
    }
    stable();
    if(q.payload!==rebuilt)fail();
    // Pass the captured canonical request only after all async source checks finish.
    return original.prepare(q,stable);
   }});
   handle=catalog.registerDocument({document,bridge:guardedBridge,assertCurrent:current});
   catalogSignal=handle.signal;
   if(!catalogSignal||typeof catalogSignal.addEventListener!=='function'||typeof catalogSignal.removeEventListener!=='function')fail();
   catalogSignal.addEventListener('abort',retire,{once:true});
   if(catalogSignal.aborted)retire();
   check();
   return Object.freeze({documentId:handle.documentId,document,retire});
  }catch{if(handle&&revoked)handle.retire();retire();fail();}
 }
 function close(){if(closed)return;closed=true;for(const retire of [...active])retire();}
 return Object.freeze({registerProject,close,inspect:()=>Object.freeze({closed,attempts,activeRegistrations:active.size,fixtureOnly:true,realModelConnected:false})});
}
