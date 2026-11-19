import {captureManualRecoveryFence} from './manual-recovery-fence.mjs';
import {inspectManualOperationRecords,createManualOperationsView,createManualChainBoard} from './manual-operations-core.mjs';
import {loadManualHandoffLedger} from './manual-handoff-ledger-core.mjs';
import {loadManualReviews} from './manual-review-core.mjs';
import {createManualReviewController} from './manual-review-controller.mjs';
import {createProjectLibraryController} from './project-library-controller.mjs';
import {isManualStepInput} from './manual-step-input-format.mjs';
import {importWorkflow,sha256} from './custom-core.mjs';
// Read-only: no save, preparation preview, clipboard, restore, execution or network API.
export function createManualOperationsController({store,storage,crypto=globalThis.crypto,getRecoveryFence}){
 const namespace=store.getStorageKey(),ledgerKey=namespace+':manual-handoff-ledger-v1',reviewKey=namespace+':manual-review-decisions-v1';let generation=0,observedLedger=null,observedReviews=null;
 // Legacy standalone source embeddings omit imports. They have no recovery callback.
 function recoverySnapshot(){if(typeof captureManualRecoveryFence==='function')return captureManualRecoveryFence(getRecoveryFence);if(typeof getRecoveryFence==='function')throw Error('MANUAL_RECOVERY_FENCE_UNAVAILABLE');return {stable:()=>true,assertHead:()=>true}}
 async function read({projectId,scopeReady,records,paperId=null},isCurrent=()=>true){
  const operation=++generation,recovery=recoverySnapshot();if(scopeReady!==true||typeof projectId!=='string'||!projectId)throw Error('OPERATIONS_PROJECT_REQUIRED');
  const recordsRaw=JSON.stringify(records),snapshot=store.getSnapshot().papers,papersRaw=JSON.stringify(snapshot),papers=JSON.parse(papersRaw),captured=JSON.parse(recordsRaw);
  const check=()=>{store.assertCurrentStorage();recovery.stable();if(generation!==operation||store.getStorageKey()!==namespace||isCurrent()!==true||JSON.stringify(records)!==recordsRaw)throw Error('OPERATIONS_CONTEXT_CHANGED')};check();
  const raw=new Map(),readErrors=[];function capture(key){try{const value=storage.getItem(key);raw.set(key,value);return value}catch{readErrors.push(key===ledgerKey?'OPERATIONS_LEDGER_READ_FAILED':'OPERATIONS_REVIEW_READ_FAILED');return undefined}}
  const ledgerRaw=capture(ledgerKey),reviewRaw=capture(reviewKey),members=createProjectLibraryController({store,storage,crypto});let scope;
  const stable=()=>{check();for(const [key,value] of raw)if(storage.getItem(key)!==value)throw Error('OPERATIONS_SOURCE_CHANGED');if(JSON.stringify(store.getSnapshot().papers)!==papersRaw)throw Error('OPERATIONS_SOURCE_CHANGED');scope?.stable()};
  await members.initialize();scope=await members.snapshot(projectId);stable();
  // Source keys are captured before any original hashing yields, including all review target graphs.
  for(const id of scope.paperIds){const key=namespace+':custom-workflow-v1:'+id;raw.set(key,storage.getItem(key))}
  let ledger=null,reviews=null;const errors=[...readErrors];
  if(ledgerRaw!==null&&ledgerRaw!==undefined)try{ledger=await loadManualHandoffLedger(ledgerRaw,namespace,crypto)}catch{errors.push('OPERATIONS_LEDGER_INVALID')}
  stable();if(reviewRaw!==null&&reviewRaw!==undefined)try{reviews=await loadManualReviews(reviewRaw,namespace,crypto)}catch{errors.push('OPERATIONS_REVIEW_INVALID')}
  stable();
  // A read refresh must not turn a previously observed append-only sidecar into
  // empty success after deletion or a checksum-valid history rollback.
  if(observedLedger&&(ledgerRaw===null||ledger&&observedLedger.records.some(old=>{const next=ledger.records.find(r=>r.id===old.id);return !next||['binding','paperId','projectId','kind'].some(k=>next[k]!==old[k])||(old.clipboard!=='pending'&&next.clipboard!==old.clipboard)}))){errors.push('OPERATIONS_LEDGER_ROLLBACK');ledger=null}
  if(observedReviews&&(reviewRaw===null||reviews&&((observedReviews.schema==='prism-manual-review-decisions-v2'&&reviews.schema!==observedReviews.schema)||reviews.events.length<observedReviews.events.length||observedReviews.events.some((e,i)=>JSON.stringify(e)!==JSON.stringify(reviews.events[i]))))){errors.push('OPERATIONS_REVIEW_ROLLBACK');reviews=null}
  if(reviews)recovery.assertHead(reviews);
  const inspected=await inspectManualOperationRecords(captured,crypto);stable();
  const view=createManualOperationsView({namespace,projectId,paperIds:scope.paperIds,papers,inspected,ledger,reviews,errors}),reviewCtl=createManualReviewController({store,storage,crypto,getRecoveryFence,getRecords:()=>{check();return records}});
  for(const row of view.rows){
   row.targets=[];row.targetCheck=null;
   const record=row.recordIndex===null?null:inspected[row.recordIndex]?.record,paper=papers.find(p=>p.id===row.paperId);
   if(!row.canLocate||!record?.replies.length||!paper||!isManualStepInput(record.prepared)||errors.some(e=>e.includes('REVIEW')))continue;
   const workflowRaw=raw.get(namespace+':custom-workflow-v1:'+row.paperId);let graph;
   try{await importWorkflow(workflowRaw,crypto);stable();const w=JSON.parse(workflowRaw).state;graph=w.graphs.find(g=>g.version===w.currentVersion)}catch{stable();row.targetCheck='unavailable';continue}
   const node=graph?.nodes.find(n=>n.id===record.prepared.base.trace?.nodeId);if(node?.kind!=='review')continue;
   for(const target of graph.nodes.filter(n=>n.kind==='work'&&n.dependsOn.length===1&&n.dependsOn[0]===node.id)){
    const input={context:{namespace,projectId,paperId:paper.id,paperTitle:paper.title},record:captured[row.recordIndex],replyId:record.replies.at(-1).id,targetNodeId:target.id};
    try{
     const current=await reviewCtl.inspectCurrent(input,{isCurrent:()=>{stable();return true}});stable();current.stable();
     let state=current.exact?current.event.decision:'needs_review';
     if(current.recoveryRequired){const decision=row.decisions.find(d=>d.id===current.event?.id);if(decision)decision.check='recovery_required'}
     if(state==='approved'){
      const approved=await reviewCtl.approval(input,{isCurrent:()=>{stable();return true}});stable();approved.stable();if(approved.event.id!==current.event.id)throw Error('OPERATIONS_REVIEW_MISMATCH');
      const decision=row.decisions.find(d=>d.id===approved.event.id);if(decision?.originalMatches)decision.check='current';else throw Error('OPERATIONS_REVIEW_MISMATCH');
     }
     row.targets.push({targetNodeId:target.id,state,replyId:input.replyId,eventId:current.exact?current.event.id:null,recoveryRequired:current.recoveryRequired===true});
    }catch{stable();row.targetCheck='unavailable'}
   }
  }
  stable();if(ledger)observedLedger=ledger;if(reviews)observedReviews=reviews;const pinned=new Map(view.rows.map(row=>[row.key,{paperId:row.paperId,recordId:row.recordId,binding:row.binding,canLocate:row.canLocate,canNavigate:row.canNavigate}]));
  function location(key,{original=false}={}){stable();const row=pinned.get(key);if(!row||!row.canNavigate||original&&!row.canLocate)throw Error('OPERATIONS_LOCATION_UNAVAILABLE');return Object.freeze({namespace,projectId,paperId:row.paperId,recordId:original?row.recordId:null,binding:original?row.binding:null})}
  const checkCurrent=()=>{check();for(const [key,value] of raw)if(storage.getItem(key)!==value)throw Error('OPERATIONS_SOURCE_CHANGED');const current=store.getSnapshot().papers;if(current!==snapshot||!Object.isFrozen(snapshot)){if(JSON.stringify(current)!==papersRaw)throw Error('OPERATIONS_SOURCE_CHANGED')}scope.stable()};
  let chainBoard=null,chainBoardError=null;
  if(paperId!==null){
   try{
    if(typeof paperId!=='string'||!scope.paperIds.includes(paperId))throw Error('CHAIN_PAPER_OUTSIDE_PROJECT');
    const paper=papers.find(p=>p.id===paperId),workflowRaw=raw.get(namespace+':custom-workflow-v1:'+paperId);
    await importWorkflow(workflowRaw,crypto);stable();
    const w=JSON.parse(workflowRaw).state,graph=w.graphs.find(g=>g.version===w.currentVersion);
    const source={namespace,paperId,title:paper.title,documentSha256:paper.document?.sha256??null,snapshotSha256:await sha256(JSON.stringify(paper),crypto)};stable();
    if(!graph||w.source?.namespace!==namespace||w.source?.paperId!==paperId||w.source?.paperTitle!==paper.title||w.source?.documentSha256!==source.documentSha256||w.source?.sourceArchiveSha256!==source.snapshotSha256)throw Error('CHAIN_GRAPH_SOURCE_CHANGED');
    chainBoard=createManualChainBoard({paperId,graph,inspected,rows:view.rows,paper,namespace,projectId,source});
   }catch(e){stable();chainBoardError=e.message==='CHAIN_PAPER_OUTSIDE_PROJECT'||e.message==='CHAIN_GRAPH_SOURCE_CHANGED'?e.message:'CHAIN_GRAPH_UNAVAILABLE'}
  }
  const pinnedBoard=chainBoard?JSON.parse(JSON.stringify(chainBoard)):null;
  function locationTask(nodeId,task,{recordKey=null}={}){
   stable();const node=pinnedBoard?.nodes.find(n=>n.id===nodeId);
   if(!node)throw Error('CHAIN_LOCATION_UNAVAILABLE');
   const record=recordKey===null?null:node.records.find(r=>r.key===recordKey);
   if(task==='record'||task==='humanreview'){
    if(task==='record'&&!record||task==='humanreview'&&!(record?record.canReview:node.availableTasks.includes('humanreview')))throw Error('CHAIN_LOCATION_UNAVAILABLE');
   }else if(task!==node.task||!node.task||recordKey!==null)throw Error('CHAIN_LOCATION_UNAVAILABLE');
   return Object.freeze({namespace,projectId,paperId,nodeId,nodeName:node.name,stable,graphVersion:pinnedBoard.graphVersion,graphSha256:pinnedBoard.graphSha256,task,recordId:record?.recordId??null,binding:record?.binding??null,authority:'none',executionAllowed:false});
  }
  stable();return {...view,stable,checkCurrent,location,chainBoard,chainBoardError,locationTask};
 }
 return {namespace,read,cancel(){generation++}};
}
