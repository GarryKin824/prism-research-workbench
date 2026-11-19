import {assertScopeEditable} from './project-execution-owner.mjs';
import * as projectQueueCore from './project-queue-core.mjs';
import * as graphCore from './custom-core.mjs';
const copy=x=>JSON.parse(JSON.stringify(x));
export function createProjectQueueController({store,storage,crypto=globalThis.crypto,withLock,getScopeSnapshot}){
 const namespace=store.getStorageKey(),key=namespace+':project-queues-v1',tokens=new WeakMap();let baseline=storage.getItem(key),state=null;
 function check(){store.assertCurrentStorage();if(store.getStorageKey()!==namespace||storage.getItem(key)!==baseline)throw Error('PROJECT_QUEUE_CONFLICT')}
 async function capture(){check();if(!state)throw Error('PROJECT_QUEUE_NOT_READY');const scope=await getScopeSnapshot();if(!scope||typeof scope.projectId!=='string'||!Array.isArray(scope.paperIds)||!(scope.raw===null||typeof scope.raw==='string')||typeof scope.stable!=='function')throw Error('PROJECT_QUEUE_SCOPE_REQUIRED');const sourceBaseline=baseline,fixed={projectId:scope.projectId,paperIds:copy(scope.paperIds),raw:scope.raw},papersRaw=JSON.stringify(store.getSnapshot().papers),papers=JSON.parse(papersRaw),reads=new Map();const stable=()=>{check();if(baseline!==sourceBaseline)throw Error('PROJECT_QUEUE_PREVIEW_BASE_CHANGED');scope.stable();if(JSON.stringify(store.getSnapshot().papers)!==papersRaw)throw Error('PROJECT_QUEUE_PAPERS_CHANGED');for(const [k,v]of reads)if(storage.getItem(k)!==v)throw Error('PROJECT_QUEUE_WORKFLOW_CHANGED')};stable();return {scope:fixed,papers,reads,stable}}
 async function initialize(){check();state=baseline===null?projectQueueCore.emptyProjectQueues(namespace):await projectQueueCore.loadProjectQueues(baseline,namespace,crypto);check();return status()}
 async function status(){const s=await capture(),record=projectQueueCore.latestProjectQueue(state,s.scope.projectId),paperMap=new Map(s.papers.map(p=>[p.id,p])),drift=[];for(const e of record?.entries??[]){const p=paperMap.get(e.paperId),wk=namespace+':custom-workflow-v1:'+e.paperId,raw=storage.getItem(wk);s.reads.set(wk,raw);drift.push({paperId:e.paperId,missing:!p,unlinked:!s.scope.paperIds.includes(e.paperId),paperChanged:!!p&&await graphCore.sha256(JSON.stringify(p),crypto)!==e.paperSha256,workflowChanged:raw!==e.workflowRaw})}s.stable();return {projectId:s.scope.projectId,record:record?copy(record):null,papers:s.papers.filter(p=>s.scope.paperIds.includes(p.id)),drift,authority:'none',mode:'planning-only'}}
 async function prepare(input){const q=copy(input);if(!q||!Array.isArray(q.paperIds)||q.paperIds.length>100||new Set(q.paperIds).size!==q.paperIds.length)throw Error('INVALID_PROJECT_QUEUE_SELECTION');const s=await capture(),entries=[];for(const paperId of q.paperIds){if(!s.scope.paperIds.includes(paperId))throw Error('PAPER_NOT_LINKED_TO_PROJECT');const p=s.papers.find(x=>x.id===paperId);if(!p)throw Error('PROJECT_QUEUE_PAPER_MISSING');const k=namespace+':custom-workflow-v1:'+paperId,raw=storage.getItem(k);s.reads.set(k,raw);if(raw!==null){await graphCore.importWorkflow(raw,crypto);const w=JSON.parse(raw).state;if(w.source?.namespace!==namespace||w.source?.paperId!==paperId||w.source?.paperTitle!==p.title||w.source?.documentSha256!==(p.document?.sha256??null))throw Error('PROJECT_QUEUE_WORKFLOW_SOURCE_CHANGED')}entries.push({paperId,title:p.title,paperSha256:await graphCore.sha256(JSON.stringify(p),crypto),workflowRaw:raw})}const before=projectQueueCore.latestProjectQueue(state,s.scope.projectId),next=await projectQueueCore.reviseProjectQueue(state,s.scope.projectId,entries,crypto),raw=await projectQueueCore.exportProjectQueues(next.state,crypto);s.stable();const preview={projectId:s.scope.projectId,kind:'save-project-queue-plan',authority:'none',sent:false,diff:{before:before?.entries.map(e=>({paperId:e.paperId,title:e.title}))??[],after:entries.map(e=>({paperId:e.paperId,title:e.title,hasWorkflow:e.workflowRaw!==null})),version:next.record.version}};tokens.set(preview,{display:JSON.stringify(preview),raw,stable:s.stable,scope:s.scope});return preview}
 async function confirm(preview,isCurrent=()=>true){if(typeof withLock!=='function')throw Error('WEB_LOCKS_REQUIRED');return withLock(namespace+':project-library-write',async()=>{const t=tokens.get(preview);if(!t||JSON.stringify(preview)!==t.display)throw Error('PROJECT_QUEUE_PREVIEW_EXPIRED');t.stable();const current=await getScopeSnapshot();if(current.projectId!==t.scope.projectId||current.raw!==t.scope.raw||JSON.stringify(current.paperIds)!==JSON.stringify(t.scope.paperIds))throw Error('PROJECT_QUEUE_SCOPE_CHANGED');const next=await projectQueueCore.loadProjectQueues(t.raw,namespace,crypto);current.stable();t.stable();if(JSON.stringify(preview)!==t.display||isCurrent()!==true)throw Error('PROJECT_QUEUE_OPERATION_EXPIRED');await assertScopeEditable(storage,namespace,crypto);t.stable();if(isCurrent()!==true||JSON.stringify(preview)!==t.display)throw Error('PROJECT_QUEUE_OPERATION_EXPIRED');storage.setItem(key,t.raw);baseline=t.raw;state=next;tokens.delete(preview);try{return await status()}catch(e){throw Error('PROJECT_QUEUE_WRITTEN_RECHECK_REQUIRED:'+e.message)}})}
 // Read-only navigation of a saved plan, never execution or completion authority.
 async function openManualPaper(paperId,onNavigate,isCurrent=()=>true){
  if(typeof onNavigate!=='function')throw Error('PROJECT_QUEUE_NAVIGATION_UNAVAILABLE');
  const s=await capture(),record=projectQueueCore.latestProjectQueue(state,s.scope.projectId),entry=record?.entries.find(e=>e.paperId===paperId),paper=s.papers.find(p=>p.id===paperId);
  if(!entry||!paper||!s.scope.paperIds.includes(paperId))throw Error('PROJECT_QUEUE_NAVIGATION_NOT_IN_SAVED_PLAN');
  const wk=namespace+':custom-workflow-v1:'+paperId,raw=storage.getItem(wk);s.reads.set(wk,raw);
  if(await graphCore.sha256(JSON.stringify(paper),crypto)!==entry.paperSha256||raw!==entry.workflowRaw)throw Error('PROJECT_QUEUE_NAVIGATION_SOURCE_DRIFT');
  const verify=()=>{s.stable();if(isCurrent()!==true)throw Error('PROJECT_QUEUE_NAVIGATION_EXPIRED');return true};verify();
  // The host must call verify again after a discard dialog and before selection.
  return onNavigate({namespace,projectId:s.scope.projectId,paperId,queueVersion:record.version,verify});
 }
 // Navigation only: terminal review authority is checked by its own caller, not here.
 async function openNextManualPaper(currentPaperId,onNavigate,isCurrent=()=>true){
  if(typeof onNavigate!=='function')throw Error('PROJECT_QUEUE_NAVIGATION_UNAVAILABLE');
  return openManualPaper(currentPaperId,async current=>{
   current.verify();
   const record=projectQueueCore.latestProjectQueue(state,current.projectId),index=record?.entries.findIndex(e=>e.paperId===currentPaperId);
   if(!record||record.version!==current.queueVersion||index<0)throw Error('PROJECT_QUEUE_NAVIGATION_EXPIRED');
   const next=record.entries[index+1];
   if(!next){current.verify();return false}
   return openManualPaper(next.paperId,target=>{
    const verify=()=>{
     current.verify();target.verify();
     if(target.namespace!==current.namespace||target.projectId!==current.projectId||target.queueVersion!==current.queueVersion)throw Error('PROJECT_QUEUE_NAVIGATION_EXPIRED');
     return true;
    };
    verify();
    // Recheck both papers after any host discard dialog and immediately before selection.
    return onNavigate({...target,currentPaperId,verify});
   },isCurrent);
  },isCurrent);
 }
 return {initialize,status,prepare,confirm,openManualPaper,openNextManualPaper,async exportJSON(){check();if(!state)throw Error('PROJECT_QUEUE_NOT_READY');const raw=await projectQueueCore.exportProjectQueues(state,crypto);check();return raw}};
}
