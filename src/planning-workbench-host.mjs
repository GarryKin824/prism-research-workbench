/** Trusted deployment composition only. The resolver must describe the Host registry's
 * current document; browser fields, UUIDs and this check do not authenticate that claim.
 * Local review sends nothing. Explicit send consent is distinct from fixture invocation.
 */
import {canonicalPlanningRequest} from './planning-model-adapter.mjs';
import {createPlanningBoundedHostContextClient} from './planning-host-client.mjs';
const destination='/api · prism-planning-fixture/exchange';
const exact=(o,ks)=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&Reflect.ownKeys(o).length===ks.length&&ks.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(o,k)??{},'value'));
const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}return o;};
const fail=code=>{throw Error(code);};
const uuid=s=>typeof s==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(s);
export function createPlanningWorkbenchHost({ctx,resolveDocument,crypto=globalThis.crypto}={}) {
 if(resolveDocument!==undefined&&typeof resolveDocument!=='function')fail('PLANNING_HOST_RESOLVER_INVALID');
 const available=typeof resolveDocument==='function',local=new WeakMap(),issued=new WeakMap(),entries=new Set(),listeners=new Set();
 let enabled=false,closed=false,expired=false,epoch=0,count=0;
 function notify(){for(const listener of [...listeners])try{listener();}catch{}}
 function release(e){for(const dispose of e.cleanup??[])try{Promise.resolve(dispose()).catch(()=>{});}catch{}e.cleanup=[];e.adapter?.close();}
 function revoke(isExpired=false){enabled=false;expired=isExpired;epoch++;const prior=[...entries];entries.clear();for(const e of prior){e.cancelled=true;release(e);}notify();}
 function reconcile(){if(enabled&&[...entries].some(e=>!e.cancelled&&e.adapter?.getSnapshot().state==='closed'))revoke(true);}
 function requireEnabled(){reconcile();if(closed||!available||!enabled)fail('PLANNING_HOST_NOT_ENABLED');}
 function resolve(q){
  const r=resolveDocument(q.binding);
  if(!exact(r,['documentId','document','signal','isCurrent'])||!uuid(r.documentId)||typeof r.isCurrent!=='function'||!r.signal||typeof r.signal.aborted!=='boolean'||typeof r.signal.addEventListener!=='function'||typeof r.signal.removeEventListener!=='function'||r.signal.aborted||r.isCurrent()!==true)fail('PLANNING_HOST_DOCUMENT_INVALID');
  const d=r.document,b=q.binding;
  if(!exact(d,['namespace','projectId','revisionSha256','templateVersion','nodes'])||!Array.isArray(d.nodes)||d.nodes.length>10000||['namespace','projectId','revisionSha256','templateVersion'].some(k=>d[k]!==b[k]))fail('PLANNING_HOST_DOCUMENT_MISMATCH');
  const seen=new Set();for(const n of d.nodes){if(!exact(n,['nodeId','promptVersion'])||seen.has(n.nodeId))fail('PLANNING_HOST_DOCUMENT_INVALID');canonicalPlanningRequest({purpose:'node-prompt-discussion',binding:{...b,nodeId:n.nodeId,promptVersion:n.promptVersion},payload:q.payload});seen.add(n.nodeId);}
  if(q.purpose==='node-prompt-discussion'&&!d.nodes.some(n=>n.nodeId===b.nodeId&&n.promptVersion===b.promptVersion))fail('PLANNING_HOST_DOCUMENT_MISMATCH');
  return {source:r,document:freeze(JSON.parse(JSON.stringify(d)))};
 }
 function current(e,check=()=>true){
  try{requireEnabled();if(e.cancelled||e.epoch!==epoch||typeof check!=='function'||check()!==true)throw Error();e.stable();
   const next=resolve(e.q);if(next.source.documentId!==e.documentId||next.source.signal!==e.signal||JSON.stringify(next.document)!==e.documentRaw)throw Error();
   if(e.adapter?.getSnapshot().state==='closed'||e.signal.aborted||check()!==true)throw Error();e.stable();
   if(!enabled||closed||e.cancelled||e.epoch!==epoch)throw Error();
  }catch{revoke(true);fail('PLANNING_HOST_CONTEXT_EXPIRED');}
 }
 async function preview(input,assertStable=()=>{}){
  reconcile();if(closed)fail('PLANNING_HOST_CLOSED');if(typeof assertStable!=='function')fail('PLANNING_HOST_STABILITY_INVALID');if(count>=100)fail('PLANNING_HOST_PREVIEW_LIMIT');
  assertStable();const q=freeze(canonicalPlanningRequest(input)),canonical=JSON.stringify(q);
  if(!enabled){
   const captured=epoch,fields={kind:'planning-host-local-preview',purpose:q.purpose,binding:q.binding,payload:q.payload,documentId:null,document:null,bindingUnavailable:true,enabled:false,destination,fixtureOnly:true,realModelConnected:false,authority:'none',sent:false};
   const previewSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(fields)))),b=>b.toString(16).padStart(2,'0')).join('');
   assertStable();if(closed||epoch!==captured||JSON.stringify(canonicalPlanningRequest(input))!==canonical)fail('PLANNING_HOST_PREVIEW_EXPIRED');
   count++;const p=freeze({...fields,previewSha256});local.set(p,{bound:false,cancelled:false});return p;
  }
  const r=resolve(q);
  const e={bound:true,q,epoch,cancelled:false,used:false,documentId:r.source.documentId,signal:r.source.signal,documentRaw:JSON.stringify(r.document),stable(){assertStable();if(JSON.stringify(canonicalPlanningRequest(input))!==canonical)throw Error();}};
  entries.add(e);count++;
  try{
   e.adapter=createPlanningBoundedHostContextClient(ctx,{enabled:true,documentId:e.documentId,signal:e.signal,crypto,isCurrent:()=>{current(e);return true;}});
   current(e);
   // Observe revocation for UI subscribers as well as the bounded client's own guards.
   e.cleanup=[];const connection=ctx.connection,generation=connection.generation,initial=generation.getSnapshot();
   const retain=dispose=>{if(typeof dispose!=='function')throw Error();if(e.cancelled){try{Promise.resolve(dispose()).catch(()=>{});}catch{}}else e.cleanup.push(dispose);};
   const expired=()=>{if(!e.cancelled)revoke(true);};
   retain(generation.subscribe(()=>{if(ctx.connection!==connection||connection.generation!==generation||generation.getSnapshot()!==initial)expired();}));
   retain(ctx.on('connection/reset',expired));retain(ctx.effect(()=>expired));
   e.signal.addEventListener('abort',expired,{once:true});retain(()=>e.signal.removeEventListener('abort',expired));current(e);
   const fields={kind:'planning-host-local-preview',purpose:q.purpose,binding:q.binding,payload:q.payload,documentId:e.documentId,document:r.document,bindingUnavailable:false,enabled:true,destination,fixtureOnly:true,realModelConnected:false,authority:'none',sent:false};
   const previewSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(fields)))),b=>b.toString(16).padStart(2,'0')).join('');
   current(e);const p=freeze({...fields,previewSha256});local.set(p,e);return p;
  }catch{revoke(true);fail('PLANNING_HOST_PREVIEW_EXPIRED');}
 }
 async function send(p,{explicit,previewSha256}={},isCurrent=()=>true){
  const e=local.get(p);if(!e||!e.bound||e.used||e.cancelled||explicit!==true||previewSha256!==p.previewSha256)fail('PLANNING_HOST_SEND_CONSENT_REQUIRED');
  current(e,isCurrent);e.used=true;
  try{const result=await e.adapter.client.prepare(e.q,()=>current(e,isCurrent));current(e,isCurrent);issued.set(result,{e,kind:'preview'});return result;}
  catch{revoke(true);fail('PLANNING_HOST_OUTCOME_UNKNOWN');}
 }
 async function confirm(p,approval,isCurrent=()=>true){
  const t=issued.get(p);if(!t||t.kind!=='preview')fail('PLANNING_HOST_PREVIEW_REQUIRED');current(t.e,isCurrent);
  // Incorrect consent must not consume or send the issued fixture preview.
  if(approval?.explicit!==true||approval.previewSha256!==p.previewSha256)fail('PLANNING_HOST_CONFIRMATION_REQUIRED');
  issued.delete(p);
  try{const r=await t.e.adapter.client.confirm(p,approval,()=>{current(t.e,isCurrent);return true;});current(t.e,isCurrent);issued.set(r,{e:t.e,kind:'result'});return r;}
  catch{revoke(true);fail('PLANNING_HOST_OUTCOME_UNKNOWN');}
 }
 function consumeResult(r,isCurrent=()=>true){const t=issued.get(r);if(!t||t.kind!=='result')fail('PLANNING_HOST_RESULT_EXPIRED');current(t.e,isCurrent);issued.delete(r);try{return t.e.adapter.client.consumeResult(r,()=>{current(t.e,isCurrent);return true;});}finally{t.e.cancelled=true;entries.delete(t.e);release(t.e);}}
 function cancel(p){const e=local.get(p)??issued.get(p)?.e;if(!e)return;e.cancelled=true;release(e);entries.delete(e);local.delete(p);issued.delete(p);}
 return Object.freeze({preview,send,confirm,consumeResult,cancel,
  subscribe(listener){if(typeof listener!=='function')fail('PLANNING_HOST_LISTENER_INVALID');if(closed)return()=>{};listeners.add(listener);return()=>listeners.delete(listener);},
  boundary(){reconcile();return Object.freeze({available,enabled,state:closed?'closed':!available?'unavailable':expired?'expired':enabled?'ready':'disabled',fixtureOnly:true,realModelConnected:false,externalModelEnabled:false,actualExecutor:'official-deepseek-loopback-http-fixture',destination,label:'Host 合成 HTTP 样例，非真实 AI；未验证'});},
  setEnabled(value){if(typeof value!=='boolean')fail('PLANNING_HOST_ENABLE_INVALID');if(closed)fail('PLANNING_HOST_CLOSED');if(value&&!available)fail('PLANNING_HOST_NOT_CONFIGURED');if(!value){revoke();return;}reconcile();if(expired)fail('PLANNING_HOST_REENABLE_REQUIRED');if(!enabled){epoch++;enabled=true;notify();}},
  close(){if(closed)return;closed=true;revoke();listeners.clear();}
 });
}
