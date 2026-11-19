import {isLinkedInstanceReply,verifyLinkedInstanceReply} from './instance-reply-link.mjs';
import {createInstanceLedgerIntent} from './instance-ledger-intent.mjs';
import {assertWorkbenchExecutionSource,readWorkbenchExecutions,validateWorkbenchExecution,workbenchExecutionKey} from './workbench-model-execution.mjs';
// Append-only recorded material. Does not create runs, approvals or execution permissions.
import {sha256} from './custom-core.mjs';
const outcomes=new WeakMap(),clone=x=>JSON.parse(JSON.stringify(x)),fail=c=>{throw Error(c)},bytes=s=>new TextEncoder().encode(s).length;
const exact=(x,fields)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===fields.split(',').sort().join(',');
const text=(x,n)=>typeof x==='string'&&x.length<=n;
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export const INSTANCE_MANUAL_RESULTS_LIMIT=2*1024*1024;
const targetKeys='namespace,projectId,paperId,instanceId,workflowSha256,graphVersion,graphSha256,nodeId';
function targetValid(t){return exact(t,targetKeys)&&['namespace','projectId','paperId','instanceId','nodeId'].every(k=>text(t[k],200)&&t[k].length>0)&&hash(t.workflowSha256)&&hash(t.graphSha256)&&Number.isSafeInteger(t.graphVersion)&&t.graphVersion>0}
function empty(namespace,projectId){return {schema:'prism-instance-manual-results/v1',namespace,projectId,authority:'none',records:[]}}
async function validateResults(raw,namespace,projectId,crypto,allowGaps=false){
 if(typeof raw!=='string'||bytes(raw)>INSTANCE_MANUAL_RESULTS_LIMIT)fail('INSTANCE_RESULTS_SIZE');const p=JSON.parse(raw);
 if(!exact(p,'schema,namespace,projectId,authority,records')||p.schema!=='prism-instance-manual-results/v1'||p.namespace!==namespace||p.projectId!==projectId||p.authority!=='none'||!Array.isArray(p.records)||p.records.length>100)fail('INSTANCE_RESULTS_SCHEMA');
 let prior=null;const ids=new Set();
 const requests=new Set();
 for(const r of p.records){
  const model=r?.kind==='deepseek-account-reply-unreviewed';
  if(!exact(r,'id,createdAt,kind,binding,prompt,source,text,sourceLabel,previousSha256,sha256'+(model?',execution':''))||!text(r.id,100)||!r.id||ids.has(r.id)||!text(r.createdAt,40)||!Number.isFinite(Date.parse(r.createdAt))||(!model&&r.kind!=='human-provided-unverified')||!text(r.text,32000)||!r.text.trim()||bytes(r.text)>128*1024||!text(r.sourceLabel,500)||(allowGaps?!(r.previousSha256===null||hash(r.previousSha256)):r.previousSha256!==prior)||!hash(r.sha256))fail('INSTANCE_RESULTS_RECORD');
  const b=r.binding;if(!exact(b,'target,sourceSha256,projectRevisionSha256,promptSha256')||!targetValid(b.target)||b.target.namespace!==namespace||b.target.projectId!==projectId||!hash(b.sourceSha256)||!hash(b.projectRevisionSha256)||!hash(b.promptSha256))fail('INSTANCE_RESULTS_BINDING');
  if(!text(r.prompt,16000)||await sha256(r.prompt,crypto)!==b.promptSha256||!exact(r.source,'paperId,title,documentSha256,sourceSha256')||r.source.paperId!==b.target.paperId||!text(r.source.title,2000)||!(r.source.documentSha256===null||hash(r.source.documentSha256))||r.source.sourceSha256!==b.sourceSha256)fail('INSTANCE_RESULTS_SOURCE');
  if(model){
   const execution=await validateWorkbenchExecution(r.execution,namespace,projectId,crypto),requestId=execution.input.requestId;
   if(execution.state!=='returned'||execution.mode!=='step'||execution.reply.answer!==r.text||requests.has(requestId)
      ||JSON.stringify(execution.input.target)!==JSON.stringify(b.target)||execution.input.sourceSha256!==b.sourceSha256
      ||execution.projectRevisionSha256!==b.projectRevisionSha256||execution.originalPromptSha256!==b.promptSha256
      ||execution.documentSha256!==r.source.documentSha256)fail('INSTANCE_RESULTS_EXECUTION');
   requests.add(requestId);
  }
  const {sha256:d,...body}=r;if(await sha256(JSON.stringify(body),crypto)!==d)fail('INSTANCE_RESULTS_HASH');ids.add(r.id);prior=d;
 }
 return p;
}
export async function readInstanceManualResults(raw,namespace,projectId,crypto=globalThis.crypto){return validateResults(raw,namespace,projectId,crypto)}
export async function inspectInstanceManualResultsExport(raw,crypto=globalThis.crypto){
 if(typeof raw!=='string'||bytes(raw)>INSTANCE_MANUAL_RESULTS_LIMIT)fail('INSTANCE_RESULTS_SIZE');const p=JSON.parse(raw);
 if(!exact(p,'schema,namespace,projectId,instanceId,records,authority,completeness')||p.schema!=='prism-instance-manual-results-export/v1'||p.authority!=='none'||p.completeness!=='selected-instance-history-not-execution'||!text(p.namespace,200)||!p.namespace||!text(p.projectId,200)||!p.projectId||!text(p.instanceId,200)||!p.instanceId)fail('INSTANCE_RESULTS_EXPORT_SCHEMA');
 const checked=await validateResults(JSON.stringify({schema:'prism-instance-manual-results/v1',namespace:p.namespace,projectId:p.projectId,records:p.records,authority:'none'}),p.namespace,p.projectId,crypto,true);
 if(checked.records.some(r=>r.binding.target.instanceId!==p.instanceId))fail('INSTANCE_RESULTS_EXPORT_SCOPE');return {...p,readOnly:true,unverified:true};
}
export function createInstanceManualResultsController({store,storage,projectId,crypto=globalThis.crypto,withLock,verifyNavigation}){
 const namespace=store.getStorageKey();if(!text(projectId,200)||!projectId||!text(namespace,200)||!namespace)fail('INSTANCE_RESULTS_SCOPE');
 const key=namespace+':instance-manual-results-v1:'+JSON.stringify(projectId),lockName=key+':write',tokens=new WeakMap();let generation=0,busy=false;
 let map=outcomes.get(storage);if(!map){map=new Map();outcomes.set(storage,map)}let outcome=map.get(key);if(!outcome){outcome={unknown:false,recovery:null,preservation:null,knownRecords:[]};map.set(key,outcome)}
 const intent=createInstanceLedgerIntent({storage,namespace,projectId,ledgerKind:'manual-results',ledgerKey:key,crypto,withLock});
 const check=write=>{if(store.getStorageKey()!==namespace)fail('INSTANCE_RESULTS_SCOPE_CHANGED');if(write){store.assertCurrentStorage();if(outcome.unknown)fail('INSTANCE_RESULTS_WRITE_UNKNOWN_NO_RETRY')}};
 const get=()=>{try{return storage.getItem(key)}catch{fail('INSTANCE_RESULTS_READ_FAILED')}};
 async function decode(raw){if(raw===null){if(outcome.knownRecords.length)fail('INSTANCE_RESULTS_HISTORY_CHANGED');return empty(namespace,projectId);}outcome.preservation={key,raw,verification:'unverified'};const p=await readInstanceManualResults(raw,namespace,projectId,crypto);if(outcome.knownRecords.some((r,i)=>JSON.stringify(p.records[i])!==r))fail('INSTANCE_RESULTS_HISTORY_CHANGED');outcome.knownRecords=p.records.map(r=>JSON.stringify(r));return p}
 async function read({explicitReadConsent=false,isCurrent=()=>true,instanceId}={}){if(explicitReadConsent!==true)fail('INSTANCE_RESULTS_READ_CONSENT');check(false);const g=++generation,raw=get();const stable=()=>{check(false);if(g!==generation||!isCurrent())fail('INSTANCE_RESULTS_EXPIRED');if(get()!==raw)fail('INSTANCE_RESULTS_CAS')};stable();const p=await decode(raw);stable();const intentRead=await intent.inspect({explicitReadConsent:true,isCurrent});stable();return {records:clone(instanceId?p.records.filter(r=>r.binding.target.instanceId===instanceId):p.records),outcome:outcome.unknown||intentRead.blocked?'unknown':'read-only',authority:'none'}}
 async function inspect(target,isCurrent){if(typeof verifyNavigation!=='function')fail('INSTANCE_RESULTS_NAVIGATION_REQUIRED');const checked=await verifyNavigation(target,isCurrent);checked.verify();return checked}
 async function prepare({target,text:body,sourceLabel='',execution=null},{isCurrent=()=>true}={}){
  check(true);if(busy)fail('INSTANCE_RESULTS_BUSY');if(!targetValid(target)||target.namespace!==namespace||target.projectId!==projectId)fail('INSTANCE_RESULTS_SCOPE');
  if(!text(body,32000)||!body.trim()||bytes(body)>128*1024||!text(sourceLabel,500))fail('INSTANCE_RESULTS_TEXT');const copied=clone(target),display=JSON.stringify(target),g=++generation,previousRaw=get();
  const stable=()=>{check(true);if(g!==generation||!isCurrent()||JSON.stringify(target)!==display)fail('INSTANCE_RESULTS_EXPIRED');if(get()!==previousRaw)fail('INSTANCE_RESULTS_CAS')};stable();
  await intent.assertWritable({expectedRaw:previousRaw,isCurrent});stable();const current=await inspect(copied,()=>{try{stable();return true}catch{return false}});stable();current.verify();const state=await decode(previousRaw);stable();current.verify();
  if(!execution&&isLinkedInstanceReply(body)){const linked=await verifyLinkedInstanceReply({text:body,target:copied,store,storage,projectId,verifyNavigation,crypto,isCurrent:()=>{try{stable();current.verify();return true}catch{return false}}});stable();current.verify();linked.verify()}
  const binding={target:copied,sourceSha256:current.instance.sourceSha256,projectRevisionSha256:current.instance.projectRevisionSha256,promptSha256:await sha256(current.node.prompt,crypto)};stable();current.verify();
  const paper=JSON.parse(current.instance.sourcePaperRaw),documentSha256=paper.document?.sha256??null;
  if(execution){
   await validateWorkbenchExecution(execution,namespace,projectId,crypto);
   assertWorkbenchExecutionSource(execution,{...binding,promptVersion:current.node.promptVersion,documentSha256,
    prompt:current.node.prompt,documentText:paper.document?.text,outputRequirementsHistory:current.instance.outputRequirements});
   const rows=await readWorkbenchExecutions(storage.getItem(workbenchExecutionKey(namespace,projectId)),namespace,projectId,crypto);
   if(!rows.records.some(row=>JSON.stringify(row)===JSON.stringify(execution)))fail('INSTANCE_RESULTS_EXECUTION_MISSING');
   if(state.records.some(row=>row.execution?.input.requestId===execution.input.requestId))fail('INSTANCE_RESULTS_EXECUTION_ALREADY_SAVED');
   stable();current.verify();
  }
  const record={id:crypto.randomUUID(),createdAt:new Date().toISOString(),kind:execution?'deepseek-account-reply-unreviewed':'human-provided-unverified',
   binding,prompt:current.node.prompt,source:{paperId:copied.paperId,title:paper.title,documentSha256,sourceSha256:current.instance.sourceSha256},
   text:body,sourceLabel,previousSha256:state.records.at(-1)?.sha256??null,...(execution?{execution:clone(execution)}:{})};
  record.sha256=await sha256(JSON.stringify(record),crypto);stable();current.verify();
  const newRaw=JSON.stringify({...state,records:[...state.records,record]});await readInstanceManualResults(newRaw,namespace,projectId,crypto);stable();current.verify();
  const portable=JSON.stringify({schema:'prism-instance-manual-results-export/v1',namespace,projectId,instanceId:copied.instanceId,records:[...state.records,record].filter(r=>r.binding.target.instanceId===copied.instanceId),authority:'none',completeness:'selected-instance-history-not-execution'});await inspectInstanceManualResultsExport(portable,crypto);stable();current.verify();
  const preview={kind:'append-instance-human-result',record:clone(record),authority:'none'};tokens.set(preview,{display:JSON.stringify(preview),record,newRaw,previousRaw,stable,verify:current.verify});return preview;
 }
 async function confirm(preview,{explicitConfirmation=false,isCurrent=()=>true}={}){
  if(explicitConfirmation!==true)fail('INSTANCE_RESULTS_CONFIRM_REQUIRED');if(typeof withLock!=='function')fail('INSTANCE_RESULTS_WEB_LOCKS_REQUIRED');if(busy)fail('INSTANCE_RESULTS_BUSY');const t=tokens.get(preview);if(!t)fail('INSTANCE_RESULTS_EXPIRED');tokens.delete(preview);busy=true;
  const stable=()=>{t.stable();if(!isCurrent()||JSON.stringify(preview)!==t.display)fail('INSTANCE_RESULTS_EXPIRED');t.verify()};
  try{return await withLock(lockName,async()=>{stable();const current=await inspect(t.record.binding.target,()=>{try{stable();return true}catch{return false}});stable();current.verify();
   if(current.instance.sourceSha256!==t.record.binding.sourceSha256||current.instance.projectRevisionSha256!==t.record.binding.projectRevisionSha256||await sha256(current.node.prompt,crypto)!==t.record.binding.promptSha256)fail('INSTANCE_RESULTS_BINDING_CHANGED');stable();current.verify();await readInstanceManualResults(t.newRaw,namespace,projectId,crypto);stable();current.verify();
   if(t.record.execution){const history=await readWorkbenchExecutions(storage.getItem(workbenchExecutionKey(namespace,projectId)),namespace,projectId,crypto);if(!history.records.some(row=>JSON.stringify(row)===JSON.stringify(t.record.execution)))fail('INSTANCE_RESULTS_EXECUTION_MISSING');stable();current.verify()}
   const recovery={key,previousRaw:t.previousRaw,attemptedRaw:t.newRaw,observedRaw:null,observedReadSucceeded:false,outcome:'unknown'};
   try{const intentToken=await intent.begin({previousRaw:t.previousRaw,attemptedRaw:t.newRaw,operationId:t.record.id,isCurrent:()=>{try{stable();current.verify();return true}catch{return false}}});stable();current.verify();storage.setItem(key,t.newRaw);recovery.observedRaw=storage.getItem(key);recovery.observedReadSucceeded=true;if(recovery.observedRaw!==t.newRaw)throw Error('readback');await intent.settle(intentToken,{isCurrent})}catch{outcome.unknown=true;outcome.recovery=recovery;fail('INSTANCE_RESULTS_WRITE_UNKNOWN_NO_RETRY')}
   outcome.knownRecords=JSON.parse(t.newRaw).records.map(r=>JSON.stringify(r));return {committed:true,record:clone(t.record),authority:'none'};
  })}finally{busy=false}
 }
 async function checkRecord(record,{isCurrent=()=>true}={}){try{const persistent=await intent.inspect({explicitReadConsent:true,isCurrent});if(persistent.blocked||outcome.unknown)return {status:'unknown',authority:'none'};const current=await inspect(record.binding.target,isCurrent);persistent.stable?.();if(!isCurrent())fail('INSTANCE_RESULTS_EXPIRED');current.verify();const promptHash=await sha256(current.node.prompt,crypto);persistent.stable?.();current.verify();if(!isCurrent())fail('INSTANCE_RESULTS_EXPIRED');return {status:current.instance.sourceSha256===record.binding.sourceSha256&&current.instance.projectRevisionSha256===record.binding.projectRevisionSha256&&promptHash===record.binding.promptSha256?'current':'changed',authority:'none'}}catch{return {status:'changed-or-unavailable',authority:'none'}}}
 async function exportJSON({instanceId,...options}={}){if(!text(instanceId,200)||!instanceId)fail('INSTANCE_RESULTS_EXPORT_SCOPE');const data=await read(options),packet={schema:'prism-instance-manual-results-export/v1',namespace,projectId,instanceId,records:data.records.filter(r=>r.binding.target.instanceId===instanceId),authority:'none',completeness:'selected-instance-history-not-execution'},raw=JSON.stringify(packet);await inspectInstanceManualResultsExport(raw,crypto);if(options.isCurrent&&options.isCurrent()!==true)fail('INSTANCE_RESULTS_EXPIRED');return raw}
 function cancel(){generation++}
async function prepareIntentResolution({target,explicitReadConsent=false,isCurrent=()=>true,verifyCurrent}={}){
 if(explicitReadConsent!==true||typeof verifyCurrent!=='function')fail('LEDGER_INTENT_RESOLUTION_CONSENT');check(false);const raw=storage.getItem(key),data=await decode(raw);const record=data.records.at(-1),meta=intent.status().metadata;
 if(!record||record.id!==meta?.operationId||JSON.stringify(Object.entries(record.binding.target).sort())!==JSON.stringify(Object.entries(target||{}).sort()))fail('LEDGER_INTENT_RESOLUTION_TARGET');
 const checked=await verifyNavigation(target,isCurrent);checked.verify();const promptHash=await sha256(checked.node.prompt,crypto);checked.verify();
 const originalPrompt=record.prompt??record.binding.prompt;if(promptHash!==record.binding.promptSha256||originalPrompt!==checked.node.prompt||record.binding.sourceSha256!==checked.instance.sourceSha256||record.binding.projectRevisionSha256!==checked.instance.projectRevisionSha256)fail('LEDGER_INTENT_RESOLUTION_SOURCE');
 const verify=()=>{check(false);checked.verify();if(!isCurrent()||verifyCurrent()===false||storage.getItem(key)!==raw)fail('LEDGER_INTENT_RESOLUTION_CHANGED');return true};verify();return intent.prepareResolution({explicitReadConsent:true,isCurrent,verifyCurrent:verify});
 }
  return {key,namespace,projectId,read,prepare,confirm,cancel,checkRecord,exportJSON,prepareIntentResolution,confirmIntentResolution:(preview,options)=>intent.confirmResolution(preview,options),intentStatus:()=>intent.status(),inspectIntent:options=>intent.inspect(options),recovery:()=>outcome.recovery?clone(outcome.recovery):intent.status().blocked?{intent:intent.status()}:null,preservation:()=>outcome.preservation?clone(outcome.preservation):null};
}
