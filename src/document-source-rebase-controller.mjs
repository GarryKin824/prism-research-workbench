import * as G from './custom-core.mjs';
import {previewDocumentSourceRebase} from './document-source-rebase-core.mjs';
import {validateDocumentAttachment} from './document-attachment-core.mjs';
import {assertScopeEditable} from './project-execution-owner.mjs';
import {importQueue,queueView} from './library-core.mjs';
import {freezeProgress} from './research-progress-core.mjs';
export function createDocumentSourceRebaseController({store,storage,crypto=globalThis.crypto,withLock}){
 const namespace=store.getStorageKey();let closed=false,unknown=false,epoch=0,busy=false,issued=null,attempts=0;
 const fail=c=>{throw Error('SOURCE_REBASE_'+c)};
 function check(){if(closed)fail('CLOSED');if(unknown)fail('UNKNOWN_RELOAD_REQUIRED');if(store.getStorageKey()!==namespace)fail('CONTEXT_CHANGED');store.assertCurrentStorage();}
 async function capture(paperId,guard){
  check();if(typeof paperId!=='string'||typeof guard!=='function'||guard()!==true)fail('CONTEXT_CHANGED');
  const key=namespace+':custom-workflow-v1:'+paperId,keys=[namespace,key,...['research-instances-v1','project-execution-owner-v1','library-queue-v1','project-library-v1','project-planning-v1','project-queues-v1'].map(k=>namespace+':'+k)],raws=keys.map(k=>storage.getItem(k)),paper=store.getSnapshot().papers.find(p=>p.id===paperId),paperRaw=JSON.stringify(paper??null),operation=epoch;
  if(!paper||!raws[0]||JSON.stringify(JSON.parse(raws[0]).papers?.find(p=>p.id===paperId)??null)!==paperRaw)fail('DURABLE_CHECKPOINT_REQUIRED');
  function stable(expected=raws[1]){check();if(operation!==epoch||guard()!==true||JSON.stringify(store.getSnapshot().papers.find(p=>p.id===paperId)??null)!==paperRaw||keys.some((k,i)=>storage.getItem(k)!==(i===1?expected:raws[i])))fail('CONTEXT_CHANGED');}
  const guarded={randomUUID:()=>{stable();return crypto.randomUUID();},subtle:{digest:async(...args)=>{stable();const r=await crypto.subtle.digest(...args);stable();return r;}}};
  await validateDocumentAttachment(paper,{namespace,crypto:guarded});stable();
  async function idle(){await assertScopeEditable(storage,namespace,guarded);if(paper.runs?.some(r=>r.status==='running'))fail('ACTIVE');if(raws[4]!==null){await importQueue(raws[4],guarded);const q=JSON.parse(raws[4]).queue,view=queueView(q);if(q.allowed||view.active||view.pending)fail('ACTIVE_QUEUE');}stable();}
  return {paper,key,oldRaw:raws[1],stable,guarded,idle};
 }
 async function inspect({paperId},guard=()=>true){const c=await capture(paperId,guard),cp=c.paper.documentAttachment;let status='unavailable',oldWorkflowSummary=null;
  if(cp?.oldWorkflowRaw&&c.oldRaw===cp.oldWorkflowRaw){const old=await G.importWorkflow(c.oldRaw,c.guarded);oldWorkflowSummary={id:old.id,graphVersion:old.currentVersion,runs:old.runs.length};status='rebase-available';}
  else if(c.oldRaw){const w=await G.importWorkflow(c.oldRaw,c.guarded),actual=await G.sha256(c.paper.document.text,c.guarded);if(w.source?.namespace===namespace&&w.source.paperId===paperId&&w.source.paperTitle===c.paper.title&&w.source.documentSha256===actual&&actual===c.paper.document.sha256)status='source-current';}
  c.stable();return freezeProgress({status,oldWorkflowSummary,newSource:{paperId,documentSha256:c.paper.document.sha256},canPersist:typeof withLock==='function',notice:'source-current 仅为当前来源分类，不认证此前某次写入成功，也不自动恢复或重放。'});
 }
 async function prepare({paperId},guard=()=>true){check();if(busy)fail('BUSY');if(attempts++>=32)fail('ATTEMPT_LIMIT');busy=true;issued=null;epoch++;try{const c=await capture(paperId,guard);await c.idle();const result=await previewDocumentSourceRebase({namespace,paper:c.paper,oldWorkflowRaw:c.oldRaw},c.guarded),body={kind:'document-source-rebase-preview',paperId,oldWorkflowSummary:result.oldWorkflowSummary,newWorkflow:result.workflow,notice:result.notice},sha256=await G.sha256(JSON.stringify(body),c.guarded);c.stable();const preview=freezeProgress({...body,sha256});issued={preview,c,raw:result.raw,used:false};return preview;}finally{busy=false;}}
 async function confirm(preview,approval={},guard=()=>true){check();const t=issued;if(!t||t.preview!==preview||t.used||approval.explicit!==true||approval.sha256!==preview.sha256)fail('CONFIRM_REQUIRED');if(typeof withLock!=='function')throw Error('WEB_LOCKS_REQUIRED');t.used=true;
  return withLock(namespace+':library-queue-write',()=>withLock(namespace+':external-inbox-write',async()=>{check();if(issued!==t||guard()!==true)fail('PREVIEW_EXPIRED');t.c.stable();await t.c.idle();t.c.stable();if(guard()!==true)fail('PREVIEW_EXPIRED');try{storage.setItem(t.c.key,t.raw);if(storage.getItem(t.c.key)!==t.raw)throw Error();t.c.stable(t.raw);if(guard()!==true)throw Error();}catch{unknown=true;issued=null;epoch++;fail('WRITE_UNKNOWN_NO_RETRY');}issued=null;epoch++;return {saved:true,workflowId:preview.newWorkflow.id};}));
 }
 return Object.freeze({inspect,prepare,confirm,cancel(p){if(p===undefined||issued?.preview===p){issued=null;epoch++;}},close(){closed=true;issued=null;epoch++;}});
}
