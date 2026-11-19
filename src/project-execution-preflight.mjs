// Read-only bridge. This is not execution authorization or a queue mutation.
import {loadProjectQueues,latestProjectQueue} from './project-queue-core.mjs';
import {importWorkflow,sha256} from './custom-core.mjs';
import {validateQueue,queueView,importQueue} from './library-core.mjs';
export async function projectExecutionPreflight(input,crypto=globalThis.crypto){
 // Snapshot caller objects before the first asynchronous digest.
 const x=JSON.parse(JSON.stringify(input));
 const {namespace,projectId,projectQueuesRaw,paperIds,papers,workflowRaws,sharedQueueRaw}=x;
 if(typeof namespace!=='string'||typeof projectId!=='string'||!Array.isArray(paperIds)||!Array.isArray(papers)||!workflowRaws||typeof workflowRaws!=='object')throw Error('INVALID_PREFLIGHT_INPUT');
 const plans=await loadProjectQueues(projectQueuesRaw,namespace,crypto),plan=latestProjectQueue(plans,projectId);
 if(!plan)throw Error('PROJECT_PLAN_MISSING');
 const blockers=[],entries=[],seen=new Set();let shared=null;
 for(const paper of papers)if(paper.steps?.some(s=>s.status==='running'))blockers.push('LEGACY_PAPER_RUNNING:'+paper.id);
 if(sharedQueueRaw!==null){
  // importQueue deliberately drops permission; inspect the verified original to retain busy/allowed state.
  await importQueue(sharedQueueRaw,crypto);
  shared=JSON.parse(sharedQueueRaw).queue;await validateQueue(shared,crypto);
  const view=queueView(shared);
  if(view.pending)blockers.push('SHARED_PENDING_REQUIRES_RECONCILIATION');
  if(view.active)blockers.push('SHARED_RUNNER_BUSY');
  if(shared.allowed)blockers.push('SHARED_RUNNER_AUTHORIZED');
 }
 if(!plan.entries.length)blockers.push('PROJECT_PLAN_EMPTY');
 if(plan.entries.length>50)blockers.push('SHARED_RUNNER_LIMIT_50');
 // A running shared paper outside this project also blocks assignment.
 for(const [id,raw]of Object.entries(workflowRaws)){
  if(raw===null)continue;await importWorkflow(raw,crypto);const w=JSON.parse(raw).state;
  if(w.source?.namespace!==namespace||w.source?.paperId!==id)throw Error('WORKFLOW_IDENTITY_MISMATCH');
  if(w.runs.some(r=>r.status==='running'))blockers.push('WORKFLOW_RUNNING:'+id);
 }
 for(const e of plan.entries){
  const issues=[],p=papers.find(p=>p.id===e.paperId),raw=workflowRaws[e.paperId]??null;
  if(!paperIds.includes(e.paperId))issues.push('PAPER_NOT_LINKED');
  if(!p)issues.push('PAPER_MISSING');else if(await sha256(JSON.stringify(p),crypto)!==e.paperSha256)issues.push('PAPER_CHANGED');
  if(raw===null)issues.push('WORKFLOW_MISSING');
  if(raw!==e.workflowRaw)issues.push('WORKFLOW_SNAPSHOT_CHANGED');
  let graphSha256=null,workflowId=null,stepPolicy=null;
  if(raw!==null){const w=JSON.parse(raw).state,g=w.graphs.find(g=>g.version===w.currentVersion);graphSha256=g.sha256;workflowId=w.id;stepPolicy={mode:g.policy.mode,checkpoints:[...g.policy.checkpoints],maxRuns:g.policy.maxRuns,maxReworks:g.policy.maxReworks,completion:JSON.parse(JSON.stringify(g.policy.completion))};
   if(p&&(w.source?.paperTitle!==p.title||w.source?.documentSha256!==(p.document?.sha256??null)))issues.push('WORKFLOW_SOURCE_CHANGED');
   if(w.execution!=='synthetic-only')issues.push('REAL_PLATFORM_UNSUPPORTED');
   if(!g.policy.allowSynthetic)issues.push('SYNTHETIC_POLICY_DISABLED');
   const pair=w.id+'|'+g.sha256;if(seen.has(pair))issues.push('DUPLICATE_WORKFLOW');seen.add(pair);
   if(shared?.configs.some(c=>c.entries.some(a=>a.workflowId===w.id&&a.graphSha256===g.sha256)))issues.push('SHARED_WORKFLOW_ALREADY_REGISTERED');
  }
  entries.push({paperId:e.paperId,title:e.title,workflowId,graphSha256,stepPolicy,issues});
 }
 const body={schema:'prism-project-execution-preflight/v1',projectId,namespace,planVersion:plan.version,planSha256:plan.sha256,authority:'none',execution:'synthetic-only',sent:false,ready:!blockers.length&&entries.every(e=>!e.issues.length),blockers,entries,inputsSha256:await sha256(JSON.stringify(x),crypto),notice:'只读预检；不是授权、任务提交或完成证明。共享论文仍共用历史，不提供项目并行执行。'};
 return {...body,sha256:await sha256(JSON.stringify(body),crypto)};
}
