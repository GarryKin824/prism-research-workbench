/** Saved handoff metadata only: never accesses clipboard, originals or execution. */
import {loadManualHandoffLedger,manualHandoffLedgerView} from './manual-handoff-ledger-core.mjs';
import {sha256} from './custom-core.mjs';
import {freezeProgress} from './research-progress-core.mjs';
export async function loadCopyResults(raw,namespace,crypto=globalThis.crypto){
 if(typeof raw!=='string'||raw.length>200000)throw Error('HANDOFF_LEDGER_SIZE');
 const state=await loadManualHandoffLedger(raw,namespace,crypto),records=[];
 for(const {clipboard,...metadata} of state.records)records.push({digest:await sha256(JSON.stringify(metadata),crypto),clipboard});
 return {state,history:{schema:state.schema,records}};
}
export function assertCopyHistory(previous,next){
 if(!previous)return;
 if(!next||previous.schema!==next.schema||next.records.length<previous.records.length||previous.records.some((r,i)=>r.digest!==next.records[i].digest||r.clipboard!=='pending'&&r.clipboard!==next.records[i].clipboard))throw Error('PROGRESS_COPY_HISTORY_CHANGED');
}
export function createCopyResults({state,status,projectId,paperId}){
 const coverage={scope:'仅所选项目与论文；共享范围仅 projectId 为空的记录，不包含任何项目记录。',meaning:'复制≠发送≠模型执行≠批准。这里只展示已保存复制元数据，不读取当前剪贴板或原件，也不推断批准关系。',history:'仅检测本控制器曾观察的有序记录前缀；pending 可合法结算，已记录终态不可改写。新控制器不能证明此前未见的回退。',limits:'账本没有时间、图版本或论文快照；保存顺序不代表当前性，binding 哈希不是身份或授权证明。'};
 const base={status,schema:state?.schema??null,count:null,items:[],authority:'none',originalsIncluded:false,sendEstablished:false,modelExecutionEstablished:false,currentApprovalEstablished:false,coverage};
 if(status!=='available')return freezeProgress(base);
 const items=manualHandoffLedgerView(state).records.flatMap((r,index)=>r.paperId===paperId&&r.projectId===projectId?[{...r,savedOrder:index+1,meaning:r.clipboard==='pending'?'未记录终态，不能断定仍进行或未复制':r.clipboard==='copied'?'曾记录复制 API 返回成功，不证明当前剪贴板、已发送或已执行':'复制结果不确定，不能断定已复制或未复制'}]:[]);
 return freezeProgress({...base,count:items.length,items});
}
