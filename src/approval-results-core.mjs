/** Read-only metadata projection of validated local human decisions. This module
 * does not inspect originals, recovery fences or clipboard state and grants nothing. */
import {loadManualReviews,manualReviewScope,MANUAL_REVIEW_V2_SCHEMA,MANUAL_REVIEW_MAX_BYTES} from './manual-review-core.mjs';
import {sha256} from './custom-core.mjs';
import {freezeProgress} from './research-progress-core.mjs';
export async function loadApprovalResults(raw,namespace,crypto=globalThis.crypto){
 if(typeof raw!=='string'||raw.length>MANUAL_REVIEW_MAX_BYTES)throw Error('HUMAN_REVIEW_LEDGER_SIZE');
 const state=await loadManualReviews(raw,namespace,crypto),eventDigests=[];
 for(const event of state.events)eventDigests.push(await sha256(JSON.stringify(event),crypto));
 return {state,eventDigests};
}
export function assertApprovalHistory(previous,next){
 if(!previous)return;
 if(!next||previous.schema===MANUAL_REVIEW_V2_SCHEMA&&next.schema!==MANUAL_REVIEW_V2_SCHEMA||next.eventDigests.length<previous.eventDigests.length||previous.eventDigests.some((hash,i)=>next.eventDigests[i]!==hash))throw Error('PROGRESS_APPROVAL_HISTORY_CHANGED');
}
export async function createApprovalResults({state,status,namespace,projectId,paperId,source,workflow,workflowStatus,projectMembershipStatus='same'},crypto=globalThis.crypto){
 const coverage={scope:'仅所选项目与这篇论文的已保存批准/退回/撤销事件；最新事件仅指同账本 scope 的 head。',assessment:'只比较当前捕获的论文/图/提示元数据；未检查原始回复、当前材料选择或恢复隔离，不代表后续步骤当前获准执行。',history:'当前控制器只检测曾观察的事件前缀改写和 schema 降级；新控制器不能证明此前未见的历史回退。',projectPlanning:'账本不记录项目规划版本；当前项目成员关系匹配不证明原决定对应当前目标/规划，也不判断目标改版后适用性。',drift:'metadata mismatch 是当前绑定差异，不等于历史记录损坏或已被撤销；head/returned/revoked 仍按账本事实展示。',copyState:'批准元数据不包含复制状态；单篇结果另有独立复制账本，二者互不授权。'};
 const base={status:projectId?status:'project-required',schema:state?.schema??null,count:null,headsCount:null,items:[],authority:'none',executionApproval:'not_assessed',currentApprovalEstablished:false,originalsIncluded:false,coverage};
 if(!projectId||status==='unavailable')return freezeProgress(base);
 if(status==='missing')return freezeProgress(base);
 const events=state.events.filter(e=>e.subject.namespace===namespace&&e.subject.projectId===projectId&&e.subject.paperId===paperId),heads=new Map();
 for(const e of events)heads.set(manualReviewScope(e.subject),e);
 const graph=workflowStatus==='available'?workflow?.graphs.find(g=>g.version===workflow.currentVersion):null;
 const promptHashes=new Map();if(graph)for(const n of graph.nodes)promptHashes.set(n.id,await sha256(n.prompt,crypto));
 function checksFor(s){
  const paperSnapshotStatus=source?.snapshotSha256?source.snapshotSha256===s.sourceSnapshotSha256?'same':'changed':'unavailable';
  const documentStatus=!source?.documentSha256?'unavailable':source.documentStatus!=='same'||source.documentSha256!==source.declaredDocumentSha256||source.documentSha256!==s.documentSha256?'changed':'same';
  const graphStatus=!graph?'unavailable':graph.version===s.graphVersion&&graph.sha256===s.graphSha256?'same':'changed';
  const review=graph?.nodes.find(n=>n.id===s.reviewNodeId),target=graph?.nodes.find(n=>n.id===s.targetNodeId),inputs=s.reviewInputs;
  let reviewNodeStatus=!graph?'unavailable':!review?'changed':'same';
  if(review&& (review.kind!=='review'||review.reviewTarget!==s.reviewTargetId||review.promptVersion!==s.promptVersion||promptHashes.get(review.id)!==s.promptSha256||JSON.stringify(review.dependsOn)!==JSON.stringify(inputs?inputs.map(u=>u.nodeId):[s.reviewTargetId])))reviewNodeStatus='changed';
  const targetNodeStatus=!graph?'unavailable':!target||target.kind!=='work'||JSON.stringify(target.dependsOn)!==JSON.stringify([s.reviewNodeId])||target.promptVersion!==s.targetPromptVersion||promptHashes.get(target.id)!==s.targetPromptSha256?'changed':'same';
  const upstreamBindings=inputs?inputs.map(u=>{const n=graph?.nodes.find(n=>n.id===u.nodeId);return {nodeId:u.nodeId,recordId:u.recordId,replyId:u.replyId,status:!graph?'unavailable':!n||n.promptVersion!==u.promptVersion||promptHashes.get(n.id)!==u.promptSha256?'changed':'same',originalsStatus:'not_assessed'};}):[{nodeId:s.reviewTargetId,recordId:s.reviewInputRecordId,replyId:s.reviewInputReplyId,status:'unavailable',reason:'v1 未记录上游提示版本/哈希；不推测其仍匹配。',originalsStatus:'not_assessed'}];
  return {paperSnapshotStatus,documentStatus,graphStatus,reviewNodeStatus,targetNodeStatus,projectMembershipStatus,upstreamBindings};
 }
 const items=events.map(e=>{const scopeKey=manualReviewScope(e.subject),head=heads.get(scopeKey),checks=checksFor(e.subject),values=[checks.paperSnapshotStatus,checks.documentStatus,checks.graphStatus,checks.reviewNodeStatus,checks.targetNodeStatus,checks.projectMembershipStatus,...checks.upstreamBindings.map(u=>u.status)];return {...JSON.parse(JSON.stringify(e)),scopeKey,isLedgerHead:head.id===e.id,supersededById:head.id===e.id?null:head.id,historyStatus:head.id===e.id?'head':'superseded',checks,applicability:values.includes('changed')?'mismatch':values.includes('unavailable')?'unavailable':'metadata-match-only',currentApprovalEstablished:false};});
 return freezeProgress({...base,count:items.length,headsCount:heads.size,items});
}
