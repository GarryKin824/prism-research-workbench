import * as E from './finding-evidence-core.mjs';
import {loadManualJournal} from './manual-reply-journal.mjs';
import {loadLibrary,currentMembers} from './project-library-core.mjs';
import {loadProjects} from './project-planning-core.mjs';
import {sha256} from './custom-core.mjs';
import {freezeProgress} from './research-progress-core.mjs';
export function createFindingEvidenceController({store,storage,crypto=globalThis.crypto,withLock}){
 const namespace=store.getStorageKey(),key=namespace+':finding-evidence-v1';let closed=false,unknown=false,busy=false,epoch=0,issued=null,observed=[],journalObserved=[],attempts=0;
 const fail=code=>{throw Error('FINDING_EVIDENCE_'+code)};
 function check(){if(closed)fail('CLOSED');if(unknown)fail('UNKNOWN_RELOAD_REQUIRED');if(store.getStorageKey()!==namespace)fail('SOURCE_CHANGED');store.assertCurrentStorage();}
 function history(state,old){if(state.records.length<old.length||old.some((h,i)=>state.records[i].sha256!==h))fail('HISTORY_CHANGED');return state.records.map(r=>r.sha256);}
 async function capture(scope,guard){
  check();if(typeof guard!=='function'||guard()!==true||typeof scope.projectId!=='string'||typeof scope.paperId!=='string')fail('SCOPE');
  const keys=[key,namespace+':manual-reply-journal-v1',...(scope.projectId?[namespace+':project-library-v1',namespace+':project-planning-v1']:[])],raws=keys.map(k=>storage.getItem(k)),paper=store.getSnapshot().papers.find(p=>p.id===scope.paperId),paperRaw=JSON.stringify(paper??null),start=epoch;
  function stable(expectedLedger=raws[0]){check();if(start!==epoch||guard()!==true||JSON.stringify(store.getSnapshot().papers.find(p=>p.id===scope.paperId)??null)!==paperRaw||keys.some((k,i)=>storage.getItem(k)!==(i===0?expectedLedger:raws[i])))fail('SOURCE_CHANGED');}
  const guarded={subtle:{digest:async(...args)=>{stable();const r=await crypto.subtle.digest(...args);stable();return r;}},randomUUID:()=>crypto.randomUUID()};
  if(!paper)fail('PAPER_MISSING');
  if(scope.projectId){const members=await loadLibrary(raws[2],namespace,guarded),projects=await loadProjects(raws[3],namespace,guarded);if(!projects.projects.some(p=>p.id===scope.projectId)||!currentMembers(members,scope.projectId).some(p=>p.id===scope.paperId))fail('SCOPE');}
  const journal=await loadManualJournal(raws[1],namespace,guarded),state=raws[0]===null?E.emptyFindingEvidence(namespace):await E.loadFindingEvidence(raws[0],namespace,guarded);stable();const next=history(state,observed),jn=history(journal,journalObserved);
  const snapshotSha256=await sha256(paperRaw,guarded),actual=typeof paper.document?.text==='string'?await sha256(paper.document.text,guarded):null,documentSha256=actual&&actual===paper.document.sha256?actual:null;
  stable();observed=next;journalObserved=jn;
  return {state,journal,paper,raw:raws[0],stable,guarded,documentSha256,snapshotSha256,findings:journal.records.filter(r=>r.reference.origin.projectId===scope.projectId&&r.reference.targetSource.paperId===scope.paperId)};
 }
 async function inspect(scope,isCurrent=()=>true){const c=await capture(scope,isCurrent);c.stable();return freezeProgress({status:c.raw===null?'missing':'available',count:c.raw===null?null:c.state.records.filter(r=>r.scope.projectId===scope.projectId&&r.scope.paperId===scope.paperId).length,records:E.findingEvidenceView(c.state,{...scope,documentSha256:c.documentSha256,paperSnapshotSha256:c.snapshotSha256}),findings:c.findings.map(r=>({id:r.id,sha256:r.sha256,conclusion:r.conclusion})),source:{documentSha256:c.documentSha256,paperSnapshotSha256:c.snapshotSha256},authority:'none',canPersist:typeof withLock==='function'});}
 async function prepare(input,isCurrent=()=>true){
  check();if(busy)fail('BUSY');if(attempts++>=64)fail('ATTEMPT_LIMIT');busy=true;issued=null;const operation=++epoch;
  try{const q=JSON.parse(JSON.stringify(input));if(!['save','withdraw'].includes(q.action)||typeof q.note!=='string'||q.note.length>6000)fail('INPUT');const c=await capture(q,isCurrent),finding=c.findings.find(r=>r.id===q.findingId&&r.sha256===q.findingSha256);if(!finding)fail('FINDING_SCOPE');
   const scope={namespace,projectId:q.projectId,paperId:q.paperId,findingId:q.findingId,findingSha256:q.findingSha256},old=q.evidenceId?c.state.records.filter(r=>r.evidenceId===q.evidenceId).at(-1):null;
   if(q.evidenceId&&(!old||JSON.stringify(old.scope)!==JSON.stringify(scope)||old.status==='withdrawn'))fail('EVIDENCE_SCOPE');
   if(q.action==='withdraw'&&!old)fail('EVIDENCE_SCOPE');
   let matches=[],moreMatches=false;
   if(q.action==='save'){if(!c.documentSha256)fail('DOCUMENT_UNAVAILABLE');if(typeof q.quote!=='string'||!q.quote.trim()||q.quote.length>6000||typeof q.locator!=='string'||q.locator.length>1000)fail('INPUT');let from=0;while(true){const start=c.paper.document.text.indexOf(q.quote,from);if(start<0)break;if(matches.length===20){moreMatches=true;break;}matches.push({start,end:start+q.quote.length});from=start+1;}if(!matches.length)fail('QUOTE_NOT_FOUND');}
   const fields={evidenceId:old?.evidenceId??crypto.randomUUID(),scope,status:q.action==='withdraw'?'withdrawn':'active',documentSha256:q.action==='withdraw'?old.documentSha256:c.documentSha256,paperSnapshotSha256:q.action==='withdraw'?old.paperSnapshotSha256:c.snapshotSha256,quote:q.action==='withdraw'?old.quote:q.quote,locator:q.action==='withdraw'?old.locator:q.locator,note:q.note};
   const state=await E.appendFindingEvidence(c.state,fields,c.guarded),raw=await E.exportFindingEvidence(state,c.guarded),record=state.records.at(-1),body={kind:'finding-evidence-preview',record,matches,moreMatches,findingSourceStatus:finding.reference.targetSource.documentSha256===c.documentSha256&&finding.reference.targetSource.snapshotSha256===c.snapshotSha256?'same':'changed',notice:'仅记录人工选择的逐字位置；不是 PDF 页码认证、结论支持证明、AI 验证或批准。'},digest=await sha256(JSON.stringify(body),c.guarded);c.stable();if(operation!==epoch)fail('PREVIEW_EXPIRED');const preview=freezeProgress({...body,sha256:digest});issued={preview,c,state,raw,operation,used:false};return preview;
  }finally{busy=false;}
 }
 async function confirm(preview,approval={},isCurrent=()=>true){
  check();const t=issued;if(!t||t.preview!==preview||t.used||approval.explicit!==true||approval.sha256!==preview.sha256)fail('CONFIRM_REQUIRED');if(typeof withLock!=='function')throw Error('WEB_LOCKS_REQUIRED');t.used=true;
  return withLock(key+':write',async()=>{check();if(issued!==t||t.operation!==epoch||isCurrent()!==true)fail('PREVIEW_EXPIRED');t.c.stable();
   try{storage.setItem(key,t.raw);if(storage.getItem(key)!==t.raw)throw Error('readback');t.c.stable(t.raw);if(isCurrent()!==true)throw Error('expired after write');}catch{unknown=true;issued=null;epoch++;fail('WRITE_UNKNOWN_NO_RETRY');}
   observed=t.state.records.map(r=>r.sha256);issued=null;epoch++;return freezeProgress({saved:true,record:t.state.records.at(-1)});
  });
 }
 return Object.freeze({namespace,key,inspect,prepare,confirm,cancel(preview){if(preview===undefined||issued?.preview===preview){issued=null;epoch++;}},close(){closed=true;issued=null;epoch++;},async exportJSON(scope,isCurrent=()=>true){const c=await capture(scope,isCurrent);const raw=await E.exportFindingEvidence(c.state,c.guarded);c.stable();return raw;}});
}
