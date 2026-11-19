/** Explicit metadata intake, then separately confirmed membership and queue plans.
 * No search, network, research scheduling, workflow creation or execution authority.
 */
import * as discoverySourcesCore from './discovery-sources.mjs';
import {createProjectLibraryController} from './project-library-controller.mjs';
import {createProjectQueueController} from './project-queue-controller.mjs';
const discoveryIntakeClone=x=>JSON.parse(JSON.stringify(x));
const discoveryIntakeFreeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(discoveryIntakeFreeze);Object.freeze(x);}return x;};
export function createDiscoveryIntakeController({store,storage,crypto=globalThis.crypto,withLock}={}){
 if(!store||!storage)throw Error('DISCOVERY_INTAKE_CONFIGURATION');
 const namespace=store.getStorageKey(),tokens=new WeakMap();let closed=false;
 const fail=code=>{throw Error(code);};
 const current=guard=>{if(closed||store.getStorageKey()!==namespace)fail('DISCOVERY_INTAKE_EXPIRED');if(guard&&guard()!==true)fail('DISCOVERY_INTAKE_EXPIRED');store.assertCurrentStorage();};
 function capture(){current();const revision=store.getSnapshot().revision,raw=JSON.stringify(store.getSnapshot().papers);return {revision,papers:JSON.parse(raw),stable:()=>{current();if(store.getSnapshot().revision!==revision||JSON.stringify(store.getSnapshot().papers)!==raw)fail('DISCOVERY_INTAKE_SOURCE_CHANGED');}};}
 function saved(){current();if(!store.getSnapshot().persistence.saved)fail('DISCOVERY_SAVED_INTAKE_REQUIRED');}
 function matches(candidate,papers){return discoverySourcesCore.filterDiscoveryCandidates([candidate],{},papers).existingMatches[0]?.paperId??null;}
 function ids(paperIds){if(!Array.isArray(paperIds)||!paperIds.length||paperIds.length>100||new Set(paperIds).size!==paperIds.length||paperIds.some(id=>typeof id!=='string'||!id))fail('DISCOVERY_PAPER_SELECTION_INVALID');return [...paperIds];}
 function issue(preview,data){discoveryIntakeFreeze(preview);tokens.set(preview,{...data,display:JSON.stringify(preview),used:false});return preview;}
 function claim(preview,kind,approval,guard){current(guard);const t=tokens.get(preview);if(!t||t.used||preview.kind!==kind||JSON.stringify(preview)!==t.display||approval?.explicit!==true)fail('DISCOVERY_CONFIRMATION_REQUIRED');t.stable();current(guard);t.used=true;return t;}
 async function prepareImport({candidates,selectedIds}={}){
  const s=capture();
  if(!Array.isArray(candidates)||candidates.length>50||!candidates.every(discoverySourcesCore.validateDiscoveryCandidate)||new Set(candidates.map(c=>c.id)).size!==candidates.length||new Set(candidates.map(c=>c.identity)).size!==candidates.length||!Array.isArray(selectedIds)||!selectedIds.length||selectedIds.length>50||new Set(selectedIds).size!==selectedIds.length)fail('DISCOVERY_SELECTION_INVALID');
  const chosen=selectedIds.map(id=>candidates.find(c=>c.id===id));if(chosen.some(c=>!c))fail('DISCOVERY_SELECTION_INVALID');
  const fixed=discoveryIntakeClone(chosen),existing=fixed.map(c=>({candidateId:c.id,paperId:matches(c,s.papers)})),existingCount=existing.filter(x=>x.paperId).length;
  if(s.papers.length+fixed.length-existingCount>100)fail('PAPER_LIMIT');s.stable();
  return issue({kind:'discovery-intake-preview',namespace,revision:s.revision,candidates:fixed,existingMatches:existing,newCount:fixed.length-existingCount,existingCount,authority:'none',executionAllowed:false,notice:'仅建档所选元数据；来源、查询词与合成标记明文保存。已存在记录保留，不覆盖、不关联、不排队、不执行。'},{...s,selected:fixed});
 }
 async function confirmImport(preview,approval={},guard=()=>true){
  const t=claim(preview,'discovery-intake-preview',approval,guard),beforeIds=new Set(t.papers.map(p=>p.id));
  await store.dispatch({type:'importSearchCandidates',candidates:t.selected,revision:t.revision,isCurrent:()=>{try{current(guard);return true;}catch{return false;}}});
  const papers=store.getSnapshot().papers,selectedPaperIds=t.selected.map(c=>matches(c,papers)),added=selectedPaperIds.filter(id=>id&&!beforeIds.has(id)).length;
  let status='saved';try{saved();if(selectedPaperIds.some(id=>!id))status='unknown';}catch{status=store.getSnapshot().persistence.saved?'unknown':'memory-only';}
  return discoveryIntakeFreeze({status,paperIds:status==='saved'?[...new Set(selectedPaperIds)]:[],added,existing:t.selected.length-added,warnings:status==='saved'?['仅元数据建档，没有读取全文、关联项目、排队或执行。']:['保存状态不可靠，停止后续项目关联与排队；已留内存或可能写入的部分不自动撤销，不重试。请保留当前页并备份/核查。']});
 }
 async function membership(projectId){saved();if(typeof projectId!=='string'||!projectId)fail('PROJECT_MISSING');const m=createProjectLibraryController({store,storage,crypto,withLock});await m.initialize();const s=await m.snapshot(projectId);return {m,s};}
 async function prepareLink({projectId,paperIds}={}){
  const selected=ids(paperIds),captured=capture(),{m,s}=await membership(projectId);for(const id of selected)if(!s.papers.some(p=>p.id===id))fail('PAPER_MISSING');
  const combined=[...s.paperIds,...selected.filter(id=>!s.paperIds.includes(id))],changed=combined.length!==s.paperIds.length,inner=changed?await m.prepare({projectId,paperIds:combined}):null;captured.stable();s.stable();
  const stable=()=>{saved();captured.stable();s.stable();};
  return issue({kind:'discovery-link-preview',projectId,changed,authority:'none',executionAllowed:false,diff:inner?.diff??{added:[],removed:[],retained:s.members,notice:'所选论文已关联；不修改既有关系。'}},{stable,m,inner,projectId});
 }
 async function confirmLink(preview,approval={},guard=()=>true){
  const t=claim(preview,'discovery-link-preview',approval,guard);
  if(!t.inner)return t.m.snapshot(t.projectId);
  try{return await t.m.confirm(t.inner,()=>{try{current(guard);saved();return true;}catch{return false;}});}catch{fail('DISCOVERY_LINK_OUTCOME_UNKNOWN_REFRESH_REQUIRED');}
 }
 async function prepareQueue({projectId,paperIds}={}){
  const selected=ids(paperIds),captured=capture(),{m,s}=await membership(projectId);if(selected.some(id=>!s.paperIds.includes(id)))fail('DISCOVERY_LINK_FIRST');
  const q=createProjectQueueController({store,storage,crypto,withLock,getScopeSnapshot:()=>m.snapshot(projectId)}),status=await q.initialize(),before=status.record?.entries.map(e=>e.paperId)??[],combined=[...before,...selected.filter(id=>!before.includes(id))],changed=combined.length!==before.length;
  const inner=changed?await q.prepare({paperIds:combined}):null;captured.stable();s.stable();const stable=()=>{saved();captured.stable();s.stable();};
  return issue({kind:'discovery-queue-preview',projectId,changed,authority:'none',executionAllowed:false,diff:inner?.diff??{before:status.record?.entries.map(e=>({paperId:e.paperId,title:e.title}))??[],after:status.record?.entries.map(e=>({paperId:e.paperId,title:e.title,hasWorkflow:e.workflowRaw!==null}))??[],version:status.record?.version??0},notice:'仅追加到当前项目待办计划并保留原顺序；不启动队列、模型、工作流或研究。'},{stable,q,inner});
 }
 async function confirmQueue(preview,approval={},guard=()=>true){
  const t=claim(preview,'discovery-queue-preview',approval,guard);if(!t.inner)return t.q.status();
  try{return await t.q.confirm(t.inner,()=>{try{current(guard);saved();return true;}catch{return false;}});}catch{fail('DISCOVERY_QUEUE_OUTCOME_UNKNOWN_REFRESH_REQUIRED');}
 }
 return {prepareImport,confirmImport,prepareLink,confirmLink,prepareQueue,confirmQueue,cancel:token=>tokens.delete(token),close:()=>{closed=true;}};
}
