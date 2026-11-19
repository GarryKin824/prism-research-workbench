import {captureManualRecoveryFence} from './manual-recovery-fence.mjs';
import {createManualReviewController,captureManualRecords} from './manual-review-controller.mjs';
import * as ledger from './manual-handoff-ledger-core.mjs';
import {readPreparationArchive} from './local-preparation-core.mjs';
import {readManualStepInput,isManualStepInput,manualPreparationBase} from './manual-step-input-format.mjs';
import {manualResearchText,manualResearchOutboundText,manualResearchRecord} from './manual-research-core.mjs';
// withLock must use a real cross-tab exclusive primitive (Web Locks in the UI).
// No localStorage spinlock, lease or read/write fallback claims atomicity.
export function createManualHandoffLedgerController({store,storage,crypto=globalThis.crypto,withLock,getRecords,getRecoveryFence}){
 const namespace=store.getStorageKey(),key=namespace+':manual-handoff-ledger-v1';let uncertain=false,observed=null,busy=false,everPresent=false;const reviewCtl=createManualReviewController({store,storage,crypto,withLock,getRecords,getRecoveryFence});
 const fail=code=>{throw Error(code)};
 const check=(source=true)=>{if(uncertain)fail('HANDOFF_LEDGER_UNKNOWN_RELOAD_REQUIRED');if(source)store.assertCurrentStorage();if(store.getStorageKey()!==namespace)fail('HANDOFF_LEDGER_NAMESPACE_CHANGED')};
 function rawRead(){let raw;try{raw=storage.getItem(key)}catch{uncertain=true;fail('HANDOFF_LEDGER_READ_UNKNOWN_NO_COPY')}if(raw!==null)everPresent=true;else if(everPresent){uncertain=true;fail('HANDOFF_LEDGER_ROLLBACK_NO_COPY')}return raw}
 function observe(state){if(observed)for(const old of observed.records){const next=state?.records.find(r=>r.id===old.id);if(!next||next.binding!==old.binding||next.paperId!==old.paperId||next.projectId!==old.projectId||next.kind!==old.kind||(old.clipboard!=='pending'&&next.clipboard!==old.clipboard)){uncertain=true;fail('HANDOFF_LEDGER_ROLLBACK_NO_COPY')}}observed=state;}
 async function read(){const raw=rawRead();let state;try{state=raw===null?null:await ledger.loadManualHandoffLedger(raw,namespace,crypto)}catch(e){uncertain=true;throw e}if(rawRead()!==raw)fail('HANDOFF_LEDGER_HEAD_CHANGED');observe(state);return {raw,state}}
 async function inspect(){check(false);const {state}=await read();check(false);return {key,exists:state!==null,canPersist:typeof withLock==='function',view:state?ledger.manualHandoffLedgerView(state):null}}
 function writeReadback(raw,expected){if(rawRead()!==expected)fail('HANDOFF_LEDGER_HEAD_CHANGED');try{storage.setItem(key,raw)}catch{uncertain=true;fail('HANDOFF_LEDGER_WRITE_UNKNOWN_NO_RETRY')}if(rawRead()!==raw){uncertain=true;fail('HANDOFF_LEDGER_WRITE_UNKNOWN_NO_RETRY')}}
 async function copy(input,{persist=false,explicitConfirmation=false,isCurrent=()=>true,validate=()=>true,writeClipboard,onStarted=()=>{}}={}){
  if(busy)fail('HANDOFF_LEDGER_BUSY');if(explicitConfirmation!==true)fail('HANDOFF_LEDGER_CONFIRM_REQUIRED');if(typeof writeClipboard!=='function')fail('HANDOFF_LEDGER_CLIPBOARD_REQUIRED');
  const inputRaw=JSON.stringify(input),q=JSON.parse(inputRaw),recovery=captureManualRecoveryFence(getRecoveryFence);check();recovery.assertBindingAvailable(q.prepared?.integritySha256);
  // Freeze live records and scope before lock acquisition, ledger reads or hashing can yield.
  const recordSnapshot=captureManualRecords(getRecords),paperId=q.context?.paperId,guardSource=manualPreparationBase(q.prepared)?.trace?.stepOrigin==='custom_graph',paperRaw=guardSource?JSON.stringify(store.getSnapshot().papers.find(p=>p.id===paperId)??null):null,scopeKeys=guardSource?[namespace+':custom-workflow-v1:'+paperId,namespace+':project-library-v1',namespace+':project-planning-v1']:[],scopeRaw=scopeKeys.map(k=>storage.getItem(k));
  const stable=()=>{check();recordSnapshot.stable();recovery.stable();recovery.assertBindingAvailable(q.prepared?.integritySha256);if(isCurrent()!==true||validate()!==true||JSON.stringify(input)!==inputRaw)fail('HANDOFF_LEDGER_PREVIEW_EXPIRED');if(guardSource&&(JSON.stringify(store.getSnapshot().papers.find(p=>p.id===paperId)??null)!==paperRaw||scopeKeys.some((k,i)=>storage.getItem(k)!==scopeRaw[i])))fail('HANDOFF_LEDGER_SOURCE_CHANGED')};
  busy=true;try{const work=async()=>{
   stable();const head=await read();stable();if(head.state?.records.some(r=>r.binding===q.prepared?.integritySha256))fail('HANDOFF_LEDGER_DUPLICATE');
   if((persist||head.state)&&typeof withLock!=='function')fail('WEB_LOCKS_REQUIRED_FOR_HANDOFF_LEDGER');
   if(head.state&&!persist)fail('HANDOFF_LEDGER_CONSENT_REQUIRED_NO_BYPASS');
   const checked=isManualStepInput(q.prepared)?await readManualStepInput(JSON.stringify(q.prepared),crypto):await readPreparationArchive(JSON.stringify(q.prepared),crypto);
   // Only the deterministic preparation formats are allowed, never arbitrary added routing text.
   if(manualResearchText(checked)!==q.text&&manualResearchOutboundText(checked)!==q.text)fail('HANDOFF_LEDGER_TEXT_MISMATCH');
   const record=manualResearchRecord(checked,q.id,q.context);const reviewGuard=await reviewCtl.guardHandoff({prepared:checked,context:q.context},{isCurrent,recordSnapshot});stable();reviewGuard();if(rawRead()!==head.raw)fail('HANDOFF_LEDGER_HEAD_CHANGED');
   let pending=null,pendingRaw=null;if(persist){
    if(q.context?.namespace!==namespace)fail('HANDOFF_LEDGER_CONTEXT');
    pending=ledger.appendManualHandoffIntent(head.state||ledger.emptyManualHandoffLedger(namespace),{id:record.id,binding:record.binding,paperId:q.context.paperId,projectId:q.context.projectId,kind:isManualStepInput(checked)?'step_input':'initial',clipboard:'pending'});
    pendingRaw=await ledger.exportManualHandoffLedger(pending,crypto);stable();writeReadback(pendingRaw,head.raw);observe(pending);
   }
   // There is no await between the last live-source guard and clipboard invocation.
   // If the guard fails after pending was committed it remains blocking, not retryable.
   stable();reviewGuard();if(rawRead()!==(pendingRaw??head.raw))fail('HANDOFF_LEDGER_HEAD_CHANGED');
   onStarted(record);let clipboard='copied';try{await writeClipboard(q.text)}catch{clipboard='unknown'}
   // Once clipboard starts, settle only the captured original ledger and intent.
   // Do not consult the newly selected project, current store or component lifetime.
   if(pending){const settled=ledger.settleManualHandoffIntent(pending,record.id,clipboard),raw=await ledger.exportManualHandoffLedger(settled,crypto);try{writeReadback(raw,pendingRaw);observe(settled)}catch(e){uncertain=true;throw Error('HANDOFF_LEDGER_SETTLE_UNKNOWN_NO_RETRY: '+e.message)}}
   return {record:{...record,clipboard},durable:!!pending,clipboard};
  };return typeof withLock==='function'?await withLock(key+':copy',work):await work()}finally{busy=false}
 }
 return {key,namespace,inspect,copy};
}
