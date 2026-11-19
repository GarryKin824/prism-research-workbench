// Read-only, bounded projections. Input workflows/sidecars must be validated by
// their owning parsers. No prompt, original document, or execution payload escapes.
import {sha256} from './custom-core.mjs';
import {fixedDrift,fixedSourceSnapshotDrift} from './linked-evidence-core.mjs';
export const PROGRESS_LIMITS=Object.freeze({papers:100,note:1000,findings:20,reviews:50,verdicts:20,annotations:20,fixedReferences:20,captureBytes:64*1024*1024});
export function freezeProgress(value){if(value&&typeof value==='object'){for(const item of Object.values(value))freezeProgress(item);Object.freeze(value)}return value}
const shortStep=n=>n?{id:n.id,name:n.name,kind:n.kind}:null;
export function projectWorkflowProgress({workflow:w,id,kind,sourceStatus,workflowSha256}){
 const g=w.graphs.find(g=>g.version===w.currentVersion),byRun=new Map(w.runs.map(r=>[r.id,r]));
 const current=n=>{const r=byRun.get(w.currentRuns[n]);return r&&r.graphVersion===g.version&&r.graphSha256===g.sha256&&r.status==='completed'&&r.verdict!=='revise'?r:null};
 const done=g.nodes.filter(n=>current(n.id)),running=w.runs.find(r=>r.status==='running'&&r.graphVersion===g.version),next=g.nodes.find(n=>!current(n.id)&&n.dependsOn.every(d=>current(d))),complete=!running&&g.policy.completion.nodeIds.every(n=>current(n))&&g.policy.completion.reviewIds.every(n=>current(n)?.verdict==='pass');
 const gated=next&&(g.policy.mode==='manual'||g.policy.mode==='checkpoints'&&g.policy.checkpoints.includes(next.id))&&!w.approvals.some(a=>a.nodeId===next.id);
 // A running record is observational only; even paused state can retain one.
 const state=running?'running-record':complete?'complete':w.pause?.code==='HUMAN_CONFIRMATION_REQUIRED'?'human-gate':w.pause?'paused':!w.runs.length&&!g.policy.allowSynthetic?'plan-only':gated?'human-gate':'ready';
 const verdicts=w.runs.filter(r=>r.verdict!==null).map(r=>({nodeId:r.nodeId,verdict:r.verdict,current:!!current(r.nodeId)&&current(r.nodeId).id===r.id,artifactSha256:r.artifact.sha256}));
 const artifacts=w.runs.filter(r=>r.status==='completed'&&r.artifact),currentArtifacts=artifacts.filter(r=>w.currentRuns[r.nodeId]===r.id&&r.graphVersion===g.version);
 const nodes=g.nodes.map(n=>{
  const satisfied=!!current(n.id),activeRun=w.runs.find(r=>r.nodeId===n.id&&r.status==='running'&&r.graphVersion===g.version),latest=w.runs.filter(r=>r.nodeId===n.id&&r.graphVersion===g.version).at(-1);
  const unmetDependencies=n.dependsOn.filter(d=>!current(d)),gate=g.policy.mode==='manual'||g.policy.mode==='checkpoints'&&g.policy.checkpoints.includes(n.id);
  const status=activeRun?'running-record':satisfied?'completed':latest?.verdict==='revise'?'needs-revision':latest?.status==='failed'?'failed':latest?.status==='cancelled'?'cancelled':unmetDependencies.length?'blocked':latest?.status==='interrupted'?'interrupted':w.pause?'paused':!g.policy.allowSynthetic?'plan-only':gate&&!w.approvals.some(a=>a.nodeId===n.id)?'human-gate':'ready';
  return {id:n.id,name:n.name,kind:n.kind,promptVersion:n.promptVersion,dependsOn:[...n.dependsOn],unmetDependencies,reviewTarget:n.reviewTarget,status,historicalArtifacts:w.runs.filter(r=>r.nodeId===n.id&&r.status==='completed'&&r.artifact&&(!satisfied||current(n.id).id!==r.id)).length};
 });
 return freezeProgress({id,kind,nodes,scope:kind==='instance'?'project':'shared-paper',state,currentStep:shortStep(g.nodes.find(n=>n.id===running?.nodeId)||g.nodes.find(n=>n.id===w.pause?.nodeId)||next),completedNodes:done.length,totalNodes:g.nodes.length,completionSatisfied:complete,completionNodeCount:new Set([...g.policy.completion.nodeIds,...g.policy.completion.reviewIds]).size,syntheticArtifacts:currentArtifacts.length,historicalArtifacts:artifacts.length-currentArtifacts.length,sourceStatus,graphVersion:g.version,graphSha256:g.sha256,workflowSha256,pauseCode:w.pause?.code??null,syntheticReviews:verdicts.slice(-PROGRESS_LIMITS.verdicts).reverse(),omittedSyntheticReviews:Math.max(0,verdicts.length-PROGRESS_LIMITS.verdicts),evidenceKind:'synthetic-artifact',authority:'none',realExecutionConnected:false});
}
// The native fixed-step store has no reusable public parser. Check the small
// projection's dependencies and exact local fixture bodies, without invoking it.
export async function projectBasicProgress(paper,crypto=globalThis.crypto){
 const fail=()=>{throw Error('PROGRESS_BASIC_UNAVAILABLE')},steps=paper.steps,runs=paper.runs;
 if(!Array.isArray(steps)||steps.length!==3||!Array.isArray(runs)||runs.length>100)fail();
 const byId=new Map();
 for(const [i,s]of steps.entries())if(typeof s.name!=='string'||s.name.length>100||typeof s.prompt!=='string'||s.prompt.length>16000||!Number.isSafeInteger(s.promptVersion)||s.promptVersion<1||!['ready','blocked','running','completed','passed','needs_revision','interrupted'].includes(s.status)||!(s.currentRunId===null||typeof s.currentRunId==='string'))fail();
 for(const r of runs){
  if(typeof r.id!=='string'||byId.has(r.id)||!Number.isInteger(r.stepIndex)||r.stepIndex<0||r.stepIndex>2||typeof r.prompt!=='string'||!Number.isSafeInteger(r.promptVersion)||!['running','completed','cancelled','interrupted'].includes(r.status)||!Array.isArray(r.upstream)||r.upstream.length!==r.stepIndex||!Array.isArray(r.upstreamBindings)||r.upstreamBindings.length!==r.stepIndex||!Array.isArray(r.artifacts))fail();
  if(r.status==='completed'){
   if(r.artifacts.length!==1||r.stepIndex===2&&!['passed','needs_revision'].includes(r.verdict)||r.stepIndex!==2&&r.verdict!==null&&r.verdict!==undefined)fail();
   const expected=r.stepIndex===0?'本地模拟资料检查：未读取真实论文。请人工核对数据来源、样本与许可。':r.stepIndex===1?'本地模拟结果：10个合成对象中2个状态改变。'+(r.prompt.includes('分母')?'分母：10个合成对象；不代表真实论文发现。':'缺口：未记录分母和统计口径。'):'本地模拟审核：'+r.verdict+'。只检查演示规则，不核验真实论文、统计推断或数据许可。';
   if(r.artifacts[0].content!==expected||await sha256(expected,crypto)!==r.artifacts[0].sha256)fail();
  }else if(r.artifacts.length||r.verdict!==null&&r.verdict!==undefined)fail();
  for(let i=0;i<r.stepIndex;i++){const a=byId.get(r.upstream[i]),b=r.upstreamBindings[i];if(!a||a.stepIndex!==i||a.status!=='completed'||b?.id!==a.id||b.prompt!==a.prompt||b.promptVersion!==a.promptVersion||b.sha256!==a.artifacts[0].sha256)fail()}
  if(r.stepIndex===2&&(r.reviewedRun!==r.upstream[1]||r.reviewedHash!==r.upstreamBindings[1].sha256||r.status==='completed'&&r.verdict!==(byId.get(r.upstream[1]).prompt.includes('分母')?'passed':'needs_revision')))fail();byId.set(r.id,r);
 }
 if(runs.filter(r=>r.status==='running').length>1||runs.some(r=>r.status==='running'&&steps[r.stepIndex].currentRunId!==r.id))fail();
 for(const [i,s]of steps.entries()){
  const r=byId.get(s.currentRunId);
  if(s.currentRunId===null){if(!['ready','blocked'].includes(s.status))fail();continue}
  if(!r||r.stepIndex!==i||r.prompt!==s.prompt||r.promptVersion!==s.promptVersion||r.upstream.some((id,j)=>steps[j].currentRunId!==id))fail();
  if(r.status==='running'&&s.status!=='running'||['interrupted','cancelled'].includes(r.status)&&s.status!=='interrupted')fail();
  if(r.status==='completed'&&(i===2?s.status!==r.verdict:i===0?s.status!=='completed':!['completed','needs_revision'].includes(s.status)))fail();
 }
 const current=i=>{const r=byId.get(steps[i].currentRunId);return r?.status==='completed'&&['completed','passed'].includes(steps[i].status)&&r.upstream.every((id,j)=>current(j)?.id===id)?r:null};
 const done=steps.map((_,i)=>current(i)).filter(Boolean),running=runs.find(r=>r.status==='running'),next=steps.findIndex((_,i)=>!current(i)&&Array.from({length:i},(_,j)=>current(j)).every(Boolean)),complete=done.length===3&&current(2)?.verdict==='passed';
 const state=running?'running-record':complete?'complete':steps.some(s=>s.status==='interrupted')?'paused':runs.length?'ready':'plan-only';
 const verdicts=runs.filter(r=>r.verdict).map(r=>({nodeId:'step-'+r.stepIndex,verdict:r.verdict==='passed'?'pass':'revise',current:current(r.stepIndex)?.id===r.id,artifactSha256:r.artifacts[0].sha256}));
 const stepIndex=running?.stepIndex??next;
 const nodes=steps.map((s,i)=>({id:'step-'+i,name:s.name,kind:i===2?'review':'work',promptVersion:s.promptVersion,dependsOn:Array.from({length:i},(_,j)=>'step-'+j),unmetDependencies:Array.from({length:i},(_,j)=>j).filter(j=>!current(j)).map(j=>'step-'+j),reviewTarget:i===2?'step-1':null,status:s.status==='running'?'running-record':current(i)?'completed':s.status==='needs_revision'?'needs-revision':s.status==='interrupted'?'interrupted':Array.from({length:i},(_,j)=>current(j)).some(x=>!x)?'blocked':runs.length?'ready':'plan-only',historicalArtifacts:runs.filter(r=>r.stepIndex===i&&r.status==='completed'&&current(i)?.id!==r.id).length}));
 return freezeProgress({id:'basic:'+paper.id,nodes,kind:'shared-basic',scope:'shared-paper',state,currentStep:stepIndex>=0?{id:'step-'+stepIndex,name:steps[stepIndex].name,kind:stepIndex===2?'review':'work'}:null,completedNodes:done.length,totalNodes:3,completionSatisfied:complete,completionNodeCount:3,syntheticArtifacts:done.length,historicalArtifacts:runs.filter(r=>r.status==='completed').length-done.length,sourceStatus:'same',graphVersion:null,graphSha256:null,workflowSha256:null,pauseCode:null,syntheticReviews:verdicts.slice(-PROGRESS_LIMITS.verdicts).reverse(),omittedSyntheticReviews:Math.max(0,verdicts.length-PROGRESS_LIMITS.verdicts),evidenceKind:'synthetic-artifact',authority:'none',realExecutionConnected:false});
}
export function progressSourceStatus(current,recorded){
 if(!current)return 'unavailable';
 if(current.documentStatus==='inconsistent')return 'inconsistent';
 if(recorded.documentSha256!==null&&current.documentSha256===null)return 'unavailable';
 return current.snapshotSha256!==recorded.snapshotSha256||current.documentSha256!==recorded.documentSha256||current.title!==recorded.title?'changed':'same';
}
export function progressAnnotation(row,current,{workflowRaw=null,reviewRaw=null,workflowAvailable=false,reviewAvailable=false}={}){
 const values=Object.values(row.fields),refs=values.flatMap(v=>v.evidence),fixedReferences=refs.filter(r=>r.fixedSnapshot).map(({fixedSnapshot:x})=>({kind:x.kind,recordId:x.recordId,sha256:x.sha256,sourceSnapshotDrift:fixedSourceSnapshotDrift(x,row.source),sourceStatus:!workflowAvailable||x.kind==='manual-review'&&!reviewAvailable?'unavailable':fixedDrift(x,{workflowRaw,reviewRaw,source:row.source})?'changed':'same'}));
 const fixedReferenceStatus=fixedReferences.some(r=>r.sourceStatus==='unavailable')?'unavailable':fixedReferences.some(r=>r.sourceStatus==='changed')?'changed':fixedReferences.length?'same':'none';
 return {claimId:row.claimId,revisionSha256:row.revisionSha256,sourceStatus:progressSourceStatus(current,row.source),locatorCount:refs.length,syntheticReferences:refs.filter(r=>r.fixedSnapshot?.kind==='synthetic-run').length,humanReviewReferences:refs.filter(r=>r.fixedSnapshot?.kind==='manual-review').length,fixedReferences:fixedReferences.slice(0,PROGRESS_LIMITS.fixedReferences),fixedReferenceCount:fixedReferences.length,omittedFixedReferences:Math.max(0,fixedReferences.length-PROGRESS_LIMITS.fixedReferences),fixedReferenceStatus};
}
