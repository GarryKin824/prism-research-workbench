// Explicit, independent project-target preparation. No workflow writes, execution,
// automatic association/queueing, persistent coordinator state or automatic replay.
import * as planning from './project-planning-core.mjs';
import * as membershipCore from './project-library-core.mjs';
import * as queueCore from './project-queue-core.mjs';
import * as graph from './custom-core.mjs';
import {createProjectLibraryController} from './project-library-controller.mjs';
import {createProjectQueueController} from './project-queue-controller.mjs';
const outcomes=new WeakMap(),clone=x=>JSON.parse(JSON.stringify(x)),fail=code=>{throw Error(code)};
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).every(k=>keys.includes(k));
export function createProjectApplicationFlowController({store,storage,crypto=globalThis.crypto,withLock}){
 const namespace=store.getStorageKey(),keys={planning:namespace+':project-planning-v1',membership:namespace+':project-library-v1',queue:namespace+':project-queues-v1'},issued=new WeakMap();let closed=false,generation=0,busy=false;
 let byNamespace=outcomes.get(storage);if(!byNamespace){byNamespace=new Map();outcomes.set(storage,byNamespace)}let outcome=byNamespace.get(namespace);if(!outcome){outcome={uncertain:false,recovery:null};byNamespace.set(namespace,outcome)}
 const check=()=>{if(closed||store.getStorageKey()!==namespace)fail('PROJECT_APPLICATION_CONTEXT_CHANGED');store.assertCurrentStorage()};
 function input(value){if(!exact(value,['projectId','paperId','applicationId'])||typeof value.projectId!=='string'||!value.projectId||!(value.paperId===undefined||typeof value.paperId==='string')||!(value.applicationId===undefined||value.applicationId===null||typeof value.applicationId==='string'))fail('PROJECT_APPLICATION_INPUT');return {projectId:value.projectId,paperId:value.paperId||'',applicationId:value.applicationId||null}}
 async function capture(value,isCurrent){
  check();const q=input(value),inputRaw=JSON.stringify(value),epoch=generation,baseRaw=storage.getItem(namespace),snapshot=store.getSnapshot(),papersRaw=JSON.stringify(snapshot.papers),papers=JSON.parse(papersRaw),paper=q.paperId?papers.find(p=>p.id===q.paperId):null;
  if(q.paperId&&!paper)fail('PROJECT_APPLICATION_PAPER_MISSING');
  const rawKeys=[keys.planning,keys.membership,keys.queue,namespace+':library-queue-v1',namespace+':project-execution-owner-v1',namespace+':research-instances-v1',...(paper?[namespace+':custom-workflow-v1:'+paper.id]:[])],raws=new Map(rawKeys.map(k=>[k,storage.getItem(k)]));
  const stable=(except=null)=>{check();if(epoch!==generation||isCurrent()!==true||JSON.stringify(value)!==inputRaw)fail('PROJECT_APPLICATION_PREVIEW_EXPIRED');if(storage.getItem(namespace)!==baseRaw||JSON.stringify(store.getSnapshot().papers)!==papersRaw||rawKeys.some(k=>k!==except&&storage.getItem(k)!==raws.get(k)))fail('PROJECT_APPLICATION_SOURCE_CHANGED')};stable();
  const projectRaw=raws.get(keys.planning);if(projectRaw===null)fail('PROJECT_APPLICATION_PROJECT_MISSING');const projects=await planning.loadProjects(projectRaw,namespace,crypto);stable();const project=projects.projects.find(p=>p.id===q.projectId);if(!project)fail('PROJECT_APPLICATION_PROJECT_MISSING');
  const membershipRaw=raws.get(keys.membership),members=membershipRaw===null?membershipCore.emptyLibrary(namespace):await membershipCore.loadLibrary(membershipRaw,namespace,crypto);stable();
  const queueRaw=raws.get(keys.queue),queues=queueRaw===null?queueCore.emptyProjectQueues(namespace):await queueCore.loadProjectQueues(queueRaw,namespace,crypto);stable();
  const workflowRaw=paper?raws.get(namespace+':custom-workflow-v1:'+paper.id):null;let workflow=null;
  if(workflowRaw!==null){await graph.importWorkflow(workflowRaw,crypto);stable();workflow=JSON.parse(workflowRaw).state}
  const memberIds=membershipCore.currentMembers(members,q.projectId).map(p=>p.id),sharedProjects=[];
  if(paper)for(const entry of members.projects)if(membershipCore.currentMembers(members,entry.projectId).some(p=>p.id===paper.id)){
   const p=projects.projects.find(p=>p.id===entry.projectId);if(!p)fail('PROJECT_APPLICATION_MEMBERSHIP_PROJECT_MISSING');sharedProjects.push({projectId:p.id,title:p.revisions.at(-1).title});
  }
  const head=project.revisions.at(-1),applications=project.revisions.filter(r=>r.kind==='application'),applicationTargets=applications.map(r=>({applicationId:r.id,paperId:r.application.paperId,paperTitle:JSON.parse(r.application.targetWorkflowRaw).state.source.paperTitle,seq:r.seq,templateVersion:r.templateVersion,currentHead:r.id===head.id}));
  const selected=q.applicationId?applications.find(r=>r.id===q.applicationId):(head.kind==='application'&&head.application.paperId===q.paperId?head:null);
  if(q.applicationId&&(!selected||selected.application.paperId!==q.paperId))fail('PROJECT_APPLICATION_SELECTION_MISMATCH');
  const paperHash=paper?await graph.sha256(JSON.stringify(paper),crypto):null;stable();
  const sourceMatches=!workflow||workflow.source?.namespace===namespace&&workflow.source.paperId===paper.id&&workflow.source.paperTitle===paper.title&&workflow.source.documentSha256===(paper.document?.sha256??null);
  let graphStatus='no-application';
  if(!paper)graphStatus='no-target';else if(!sourceMatches||selected&&selected.application.paperHash!==paperHash)graphStatus='source-drift';else if(selected)graphStatus=workflowRaw===selected.application.targetWorkflowRaw?'exact-target-match':workflowRaw===selected.application.baseWorkflowRaw?'exact-base-ready':'workflow-drift';
  const status=selected&&selected.id!==head.id?'historical-application':graphStatus,queue=queueCore.latestProjectQueue(queues,q.projectId),entry=queue?.entries.find(e=>e.paperId===q.paperId),targetDrift=!!entry&&(entry.paperSha256!==paperHash||entry.workflowRaw!==workflowRaw);
  const inspection={namespace,projectId:q.projectId,projectTitle:head.title,paperId:q.paperId,paperTitle:paper?.title??null,applicationTargets,applicationId:selected?.id??null,status,graphStatus,linked:!!paper&&memberIds.includes(paper.id),sharedProjects,queue:{present:!!queue,paperIds:queue?.entries.map(e=>e.paperId)??[],targetPresent:!!entry,targetDrift},writeBlocked:outcome.uncertain,recovery:outcome.recovery?clone(outcome.recovery):null,notice:'当前字节匹配仅供核对，不证明历史写入、同意或执行成功。历史方案不重放。关联、规划队列与模板应用分别确认；同一论文在各项目共享图和历史。'};
  stable();return {q,paper,project,projects,members,queues,workflowRaw,paperHash,raws,stable,inspection};
 }
 async function inspect(value,options={}){return (await capture(value,options.isCurrent??(()=>true))).inspection}
 function requireWritable(){check();if(outcome.uncertain)fail('PROJECT_APPLICATION_WRITE_UNKNOWN_NO_RETRY');if(store.getSnapshot().persistence?.saved!==true)fail('PROJECT_APPLICATION_BASE_NOT_DURABLE');if(typeof withLock!=='function')fail('WEB_LOCKS_REQUIRED_FOR_PROJECT_APPLICATION')}
 function issue(preview,token){issued.set(preview,{...token,display:JSON.stringify(preview)});return preview}
 function storageFor(token,key){return {getItem:k=>storage.getItem(k),setItem(k,raw){
   if(k!==key||typeof raw!=='string'||token.attempt)fail('PROJECT_APPLICATION_SINGLE_WRITE_REQUIRED');token.lastGuard();
   token.attempt={key,namespace,previousRaw:storage.getItem(k),attemptedRaw:raw,observedRaw:null,observedReadSucceeded:false,outcome:'unknown'};storage.setItem(k,raw);
  },removeItem(){fail('PROJECT_APPLICATION_REMOVE_FORBIDDEN')},clear(){fail('PROJECT_APPLICATION_CLEAR_FORBIDDEN')}}}
 async function prepareLink(value,options={}){
  requireWritable();const captured=await capture(value,options.isCurrent??(()=>true));if(!captured.paper)fail('PROJECT_APPLICATION_TARGET_REQUIRED');const token={captured,operation:'link',attempt:null,lastGuard:()=>{throw Error('PROJECT_APPLICATION_WRITE_NOT_CONFIRMED')}};
  const adapter=storageFor(token,keys.membership),controller=createProjectLibraryController({store,storage:adapter,crypto,withLock});await controller.initialize();captured.stable();const scope=await controller.snapshot(captured.q.projectId);captured.stable();
  let inner=null;if(!scope.paperIds.includes(captured.q.paperId)){inner=await controller.prepare({projectId:captured.q.projectId,paperIds:[...scope.paperIds,captured.q.paperId]});captured.stable()}
  const preview={kind:'project-application-link',projectId:captured.q.projectId,paperId:captured.q.paperId,changed:!!inner,inspection:captured.inspection,diff:inner?{...inner.diff,retainedSourceChanges:inner.diff.retained.flatMap(after=>{const before=scope.members.find(p=>p.id===after.id);return JSON.stringify(before)===JSON.stringify(after)?[]:[{before,after}]})}:{added:[],removed:[],retained:scope.members,retainedSourceChanges:[],notice:'目标已关联，不写入关系。'},notice:'只确认此关联阶段，不应用模板、不排队或运行。保留现有成员；预览同时列出当前来源快照。'};
  return issue(preview,{...token,token,controller,inner,key:keys.membership});
 }
 async function prepareQueue(value,options={}){
  requireWritable();const captured=await capture(value,options.isCurrent??(()=>true));if(!captured.paper)fail('PROJECT_APPLICATION_TARGET_REQUIRED');if(!captured.inspection.linked)fail('PROJECT_APPLICATION_LINK_FIRST');
  const token={captured,operation:'queue',attempt:null,lastGuard:()=>{throw Error('PROJECT_APPLICATION_WRITE_NOT_CONFIRMED')}};const adapter=storageFor(token,keys.queue),members=createProjectLibraryController({store,storage:adapter,crypto,withLock});await members.initialize();captured.stable();
  const controller=createProjectQueueController({store,storage:adapter,crypto,withLock,getScopeSnapshot:()=>members.snapshot(captured.q.projectId)});let status=await controller.initialize();captured.stable();
  const paperIds=status.record?.entries.map(e=>e.paperId)??[],targetPresent=paperIds.includes(captured.q.paperId);if(!targetPresent)paperIds.push(captured.q.paperId);
  // Pin every source before deriving summaries or asking the delegated controller
  // to build its immutable snapshot. The summaries disclose no document or prompt text.
  const currentPapers=clone(store.getSnapshot().papers),currentRaws=new Map(paperIds.map(id=>[namespace+':custom-workflow-v1:'+id,storage.getItem(namespace+':custom-workflow-v1:'+id)])),originalStable=captured.stable;
  captured.stable=()=>{originalStable();if([...currentRaws].some(([key,raw])=>storage.getItem(key)!==raw))fail('PROJECT_APPLICATION_SOURCE_CHANGED')};captured.stable();
  // The initial async status may have resolved before a non-target source changed.
  // Re-read drift under the complete pin, including the unchanged/no-write path.
  status=await controller.status();captured.stable();
  const changed=!targetPresent||status.drift.some(row=>row.missing||row.unlinked||row.paperChanged||row.workflowChanged),inner=changed?await controller.prepare({paperIds}):null;captured.stable();
  async function sourceSummary(entry,paper=null){
   const raw=entry.workflowRaw;let workflow=null,workflowByteSha256=null;
   if(raw!==null){await graph.importWorkflow(raw,crypto);captured.stable();workflow=JSON.parse(raw).state;workflowByteSha256=await graph.sha256(raw,crypto);captured.stable()}
   const currentGraph=workflow?.graphs.find(g=>g.version===workflow.currentVersion);
   const paperSha256=paper?await graph.sha256(JSON.stringify(paper),crypto):entry.paperSha256;captured.stable();
   return {paperId:entry.paperId,title:entry.title,paperSha256,documentSha256:paper?paper.document?.sha256??null:workflow?.source?.documentSha256??null,documentSha256Origin:paper?'current-paper':workflow?'saved-workflow-source':'not-recorded',workflowByteSha256,workflowId:workflow?.id??null,currentVersion:workflow?.currentVersion??null,currentGraphSha256:currentGraph?.sha256??null,nodes:currentGraph?.nodes.map(n=>({id:n.id,name:n.name,promptVersion:n.promptVersion}))??[]};
  }
  const before=[],after=[];for(const entry of status.record?.entries??[])before.push(await sourceSummary(entry));
  for(const id of paperIds){const paper=currentPapers.find(p=>p.id===id);if(!paper)fail('PROJECT_APPLICATION_PAPER_MISSING');after.push(await sourceSummary({paperId:id,title:paper.title,workflowRaw:currentRaws.get(namespace+':custom-workflow-v1:'+id)},paper))}
  captured.stable();const sourceSnapshots={before,after,notice:'仅来源摘要，不含完整论文正文或Prompt；workflowByteSha256校验完整工作流原字节。旧队列未保存论文原件，若当时没有workflow，documentSha256为未记录，不代表正文不存在。'};
  const diff={...(inner?.diff??{before:status.record?.entries.map(e=>({paperId:e.paperId,title:e.title}))??[],after:status.record?.entries.map(e=>({paperId:e.paperId,title:e.title,hasWorkflow:e.workflowRaw!==null}))??[],version:status.record?.version??0}),sourceSnapshots};
  const preview={kind:'project-application-queue',projectId:captured.q.projectId,paperId:captured.q.paperId,changed,inspection:captured.inspection,refreshExisting:targetPresent&&changed,diff,notice:'只保存规划队列，不调度。追加保留原顺序；已有队列源变化时将对所列全部条目保存当前来源新版本，不删除旧队列历史。'};
  return issue(preview,{...token,token,controller,inner,key:keys.queue});
 }
 async function membershipSnapshot(projectId){const c=createProjectLibraryController({store,storage,crypto});await c.initialize();const s=await c.snapshot(projectId);return {projectId:s.projectId,paperIds:[...s.paperIds],raw:s.raw,ready:true,stable:s.stable}}
 async function confirm(preview,{explicitConfirmation=false,isCurrent=()=>true}={},operation){
  requireWritable();if(busy)fail('PROJECT_APPLICATION_BUSY');const t=issued.get(preview);if(!t||t.operation!==operation||explicitConfirmation!==true)fail('PROJECT_APPLICATION_CONFIRM_REQUIRED');
  const stable=()=>{requireWritable();t.captured.stable();if(t.cancelled||issued.get(preview)!==t||JSON.stringify(preview)!==t.display||isCurrent()!==true)fail('PROJECT_APPLICATION_PREVIEW_EXPIRED')};stable();busy=true;
  // The adapter closes over its original token. Store a shared attempt/guard cell.
  t.token.lastGuard=stable;
  try{
   if(t.inner)await t.controller.confirm(t.inner,()=>{stable();return true});else stable();
  }catch(error){
   const attempt=t.token.attempt;if(!attempt)throw error;
   try{attempt.observedRaw=storage.getItem(t.key);attempt.observedReadSucceeded=true}catch{}
   issued.delete(preview);
   if(attempt.observedReadSucceeded&&attempt.observedRaw===attempt.previousRaw)fail('PROJECT_APPLICATION_NOT_SAVED_NEW_PREVIEW_REQUIRED');
   // Exact readback identifies the attempted current bytes, including throw-after-write.
   if(!(attempt.observedReadSucceeded&&attempt.observedRaw===attempt.attemptedRaw)){outcome.uncertain=true;outcome.recovery=clone(attempt);fail('PROJECT_APPLICATION_WRITE_UNKNOWN_NO_RETRY')}
  }finally{busy=false}
  const attempt=t.token.attempt;
  if(attempt){try{attempt.observedRaw=storage.getItem(t.key);attempt.observedReadSucceeded=true}catch{attempt.observedReadSucceeded=false}if(!attempt.observedReadSucceeded||attempt.observedRaw!==attempt.attemptedRaw){outcome.uncertain=true;outcome.recovery=clone(attempt);issued.delete(preview);fail('PROJECT_APPLICATION_WRITE_UNKNOWN_NO_RETRY')}}
  issued.delete(preview);
  const result={status:attempt?'saved':'unchanged',operation,projectId:preview.projectId,paperId:preview.paperId,inspection:null,membership:null};
  try{check();result.membership=await membershipSnapshot(preview.projectId);result.inspection=await inspect(t.captured.q);result.membership.stable()}catch(error){result.status=attempt?'saved-recheck-required':'unchanged';result.recheckReason=error.message;result.inspection=null;result.membership=null}
  return result;
 }
 async function prepareNavigation(value,options={}){const current=options.isCurrent??(()=>true),c=await capture(value,current);if(!c.paper||!c.inspection.linked)fail('PROJECT_APPLICATION_LINK_FIRST');const membership=await membershipSnapshot(c.q.projectId);c.stable();membership.stable();return {area:'planning',projectId:c.q.projectId,paperId:c.q.paperId,membership,stable:()=>{c.stable();membership.stable();if(current()!==true)fail('PROJECT_APPLICATION_PREVIEW_EXPIRED')}}}
 return {namespace,inspect,prepareLink,confirmLink:(p,o)=>confirm(p,o,'link'),prepareQueue,confirmQueue:(p,o)=>confirm(p,o,'queue'),prepareNavigation,recovery:()=>outcome.recovery?clone(outcome.recovery):null,cancel(preview){const token=issued.get(preview);if(token)token.cancelled=true;issued.delete(preview)},close(){closed=true;generation++}};
}
