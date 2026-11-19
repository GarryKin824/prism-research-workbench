/** Read-only history. A saved decision never supplies session approval. */
import {loadManualReviews,manualReviewScope} from './terminal-review-core.mjs';
import {sha256} from './custom-core.mjs';
export async function loadTerminalResults(raw,namespace,crypto=globalThis.crypto){
 const state=await loadManualReviews(raw,namespace,crypto);
 const eventDigests=[];for(const e of state.events)eventDigests.push(await sha256(JSON.stringify(e),crypto));
 return {state,eventDigests};
}
export function assertTerminalResultsHistory(old,next){
 if(old&&(old.schema!==next.schema||old.eventDigests.length>next.eventDigests.length||old.eventDigests.some((x,i)=>x!==next.eventDigests[i])))throw Error('TERMINAL_RESULTS_HISTORY_CHANGED');
}
export function createTerminalResults({state,status,namespace,projectId,paperId,source,workflow}){
 const coverage='仅此项目/论文终审决定历史及原件 ID/哈希。全部历史未重新验证：不读取原始答复、当前材料选择或会话恢复令牌，不判定当前批准、研究完成或执行许可。来源匹配只是元数据比较。';
 const base={status:projectId?status:'project-required',schema:state?.schema??null,count:projectId&&status==='available'?0:null,items:[],authority:'none',currentApprovalEstablished:false,researchCompletionEstablished:false,originalsIncluded:false,coverage};
 if(!projectId||!state||status!=='available')return base;
 const events=state.events.filter(e=>e.subject.namespace===namespace&&e.subject.projectId===projectId&&e.subject.paperId===paperId);
 const heads=new Map(events.map(e=>[manualReviewScope(e.subject),e.id]));
 const graph=workflow?.graphs.find(g=>g.version===workflow.currentVersion);
 return {...base,count:events.length,items:events.map(e=>({...JSON.parse(JSON.stringify(e)),isLedgerHead:heads.get(manualReviewScope(e.subject))===e.id,historyStatus:'historical-not-revalidated',currentApprovalEstablished:false,checks:{paperSnapshot:source?e.subject.sourceSnapshotSha256===source.snapshotSha256?'same':'changed':'unavailable',document:source?e.subject.documentSha256===source.documentSha256?'same':'changed':'unavailable',graph:graph?e.subject.graphSha256===graph.sha256&&e.subject.graphVersion===graph.version?'same':'changed':'unavailable'},originalsStatus:'not-checked',recoveryStatus:'not-checked'}))};
}
