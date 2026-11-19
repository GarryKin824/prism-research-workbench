import {captureManualRecoveryFence} from './manual-recovery-fence.mjs';
import {createManualReviewController,captureManualRecords} from './manual-review-controller.mjs';
import {prepareManualStepInput,prepareManualMultiReviewInput,prepareManualMultiWorkInput} from './manual-step-input-core.mjs';
import {manualStepInputText,manualPreparationBase} from './manual-step-input-format.mjs';
import {createProjectLibraryController} from './project-library-controller.mjs';
import {sha256} from './custom-core.mjs';
export function createManualStepInputController({store,storage,crypto=globalThis.crypto,getRecords,getRecoveryFence}){
 const namespace=store.getStorageKey(),issued=new WeakMap(),reviewCtl=createManualReviewController({store,storage,crypto,getRecords,getRecoveryFence});
 const check=()=>{store.assertCurrentStorage();if(store.getStorageKey()!==namespace)throw Error('STEP_INPUT_NAMESPACE_CHANGED')};
 async function prepareInput(input,{isCurrent=()=>true}={},multi=false){
  const inputRaw=JSON.stringify(input),q=JSON.parse(inputRaw),recovery=captureManualRecoveryFence(getRecoveryFence);check();
  const expected=multi?'context,inputs,prompt,targetNodeId':'context,prompt,record,replyId,targetNodeId';
  if(!q||Object.keys(q).sort().join(',')!==expected||q.context?.namespace!==namespace||!q.context.projectId)throw Error('STEP_INPUT_PROJECT_REQUIRED');
  // Capture every authority-bearing read, including the complete live originals, before hashing.
  const paper=JSON.parse(JSON.stringify(store.getSnapshot().papers.find(p=>p.id===q.context.paperId)??null));if(!paper)throw Error('STEP_INPUT_PAPER_MISSING');
  const paperRaw=JSON.stringify(paper),key=namespace+':custom-workflow-v1:'+paper.id,workflowRaw=storage.getItem(key),memberKey=namespace+':project-library-v1',projectKey=namespace+':project-planning-v1',memberRaw=storage.getItem(memberKey),projectRaw=storage.getItem(projectKey);
  const workflow=JSON.parse(workflowRaw).state,graph=workflow.graphs.find(g=>g.version===workflow.currentVersion),sourceNode=multi?null:graph.nodes.find(n=>n.id===manualPreparationBase(q.record?.prepared)?.trace?.nodeId),requiresLive=multi||(sourceNode?.kind==='review'&&sourceNode.dependsOn.length>1),records=captureManualRecords(getRecords,{required:requiresLive});
  if(requiresLive){for(const selected of multi?(Array.isArray(q.inputs)?q.inputs:[]):[{record:q.record,replyId:q.replyId}])records.exact(selected.record,selected.replyId,q.context)}
  const initialStable=()=>{check();records.stable();recovery.stable();if(isCurrent()!==true||JSON.stringify(input)!==inputRaw)throw Error('STEP_INPUT_PREVIEW_EXPIRED');if(JSON.stringify(store.getSnapshot().papers.find(p=>p.id===paper.id)??null)!==paperRaw||storage.getItem(key)!==workflowRaw||storage.getItem(memberKey)!==memberRaw||storage.getItem(projectKey)!==projectRaw)throw Error('STEP_INPUT_SOURCE_CHANGED')};
  const members=createProjectLibraryController({store,storage,crypto});await members.initialize();initialStable();const member=await members.snapshot(q.context.projectId);initialStable();
  if(!member.paperIds.includes(q.context.paperId))throw Error('STEP_INPUT_PROJECT_MEMBERSHIP');
  const stable=()=>{initialStable();member.stable()};
  stable();const source={namespace,paperId:paper.id,title:paper.title,documentSha256:paper.document?.sha256??null,snapshotSha256:await sha256(paperRaw,crypto)};stable();
  let approval=null;
  if(sourceNode?.kind==='review')approval=await reviewCtl.approval({context:q.context,record:q.record,replyId:q.replyId,targetNodeId:q.targetNodeId},{isCurrent});
  stable();const prepared=multi?await (multi==='work'?prepareManualMultiWorkInput:prepareManualMultiReviewInput)({context:q.context,targetNodeId:q.targetNodeId,prompt:q.prompt,selections:q.inputs,paper,source,workflowRaw},crypto):await prepareManualStepInput({...q,paper,source,workflowRaw},crypto,approval?.event);stable();if(approval)approval.stable();
  const preview={prepared,text:manualStepInputText(prepared)};issued.set(preview,{stable:()=>{stable();if(approval)approval.stable()},display:JSON.stringify(preview)});return preview;
 }
 function confirm(preview,{explicitConfirmation=false,isCurrent=()=>true}={}){
  const t=issued.get(preview);if(!t||explicitConfirmation!==true)throw Error('STEP_INPUT_CONFIRM_REQUIRED');
  t.stable();if(isCurrent()!==true||JSON.stringify(preview)!==t.display)throw Error('STEP_INPUT_PREVIEW_EXPIRED');
  return preview.prepared; // Synchronous final guard; caller copies in this same turn.
 }
 return {prepare:(input,options)=>prepareInput(input,options,false),prepareMulti:(input,options)=>prepareInput(input,options,true),prepareMultiWork:(input,options)=>prepareInput(input,options,'work'),confirm,cancel:preview=>issued.delete(preview)};
}
