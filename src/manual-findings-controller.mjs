import {loadManualJournal,emptyManualJournal} from './manual-reply-journal.mjs';
import {createManualFindingsView,filterManualFindings} from './manual-findings-core.mjs';
import {createProjectLibraryController} from './project-library-controller.mjs';
import {verifyManualReplyOriginals} from './manual-reply-reference.mjs';
import {buildManualFindingsReport,captureReportBibliography} from './manual-findings-report-core.mjs';
import {sha256} from './custom-core.mjs';
/** A fresh read for each request. It intentionally does not reuse the append
 * controller's fixed baseline and has no save/confirm/restore capability. */
export function createManualFindingsController({store,storage,crypto=globalThis.crypto}){
 const namespace=store.getStorageKey(),key=namespace+':manual-reply-journal-v1';let generation=0;
 async function read({projectId,scopeReady},isCurrent=()=>true){
  const operation=++generation;
  if(scopeReady!==true||typeof projectId!=='string')throw Error('FINDINGS_SCOPE_UNKNOWN');
  const check=()=>{store.assertCurrentStorage();if(store.getStorageKey()!==namespace||generation!==operation||isCurrent()!==true)throw Error('FINDINGS_CONTEXT_CHANGED')};
  check();const raw=storage.getItem(key),paperSnapshot=store.getSnapshot().papers,papersRaw=JSON.stringify(paperSnapshot),papers=JSON.parse(papersRaw);let scope=null,projectRaw=null;
  const stable=()=>{check();if(storage.getItem(key)!==raw||JSON.stringify(store.getSnapshot().papers)!==papersRaw)throw Error('FINDINGS_SOURCE_CHANGED');scope?.stable()};
  if(projectId){const controller=createProjectLibraryController({store,storage,crypto});await controller.initialize();scope=await controller.snapshot(projectId);projectRaw=storage.getItem(namespace+':project-planning-v1');stable()}
  const state=raw===null?emptyManualJournal(namespace):await loadManualJournal(raw,namespace,crypto);stable();
  const view=await createManualFindingsView({state,papers,projectId,paperIds:scope?.paperIds??papers.map(p=>p.id)},crypto);stable();
  // Native store snapshots are deeply frozen. Polls/render checks can compare
  // their identity instead of serializing every document every second. Full
  // stable() remains mandatory around async reads and immediately before navigation.
  const checkCurrent=()=>{check();if(storage.getItem(key)!==raw)throw Error('FINDINGS_SOURCE_CHANGED');const current=store.getSnapshot().papers;if(current!==paperSnapshot||!Object.isFrozen(paperSnapshot)){if(JSON.stringify(current)!==papersRaw)throw Error('FINDINGS_SOURCE_CHANGED')}if(scope&&(storage.getItem(namespace+':project-library-v1')!==scope.raw||storage.getItem(namespace+':project-planning-v1')!==projectRaw))throw Error('FINDINGS_SCOPE_CHANGED')};
  // Keep full, validated references private to this exact displayed view. Do not
  // reconstruct them from flattened rows or trust mutable caller-owned rows.
  const displayed=new Map(view.rows.map(row=>[row.id,row.recordSha256]));
  const references=new Map(state.records.filter(record=>displayed.has(record.id)).map(record=>[record.id,{sha256:record.sha256,raw:JSON.stringify(record.reference)}]));
  // Export only this validated view's immutable projection. Public browsing rows
  // may be caller-owned; neither altered rows nor injected IDs become report data.
  const records=new Map(state.records.map(record=>[record.id,record])),paperById=new Map(papers.map(paper=>[paper.id,paper]));
  const pinnedRows=Object.freeze(view.rows.map(row=>{
   const record=records.get(row.id),reference=record.reference,trace=reference.preparation.trace;
   return Object.freeze({...row,bibliography:captureReportBibliography(paperById.get(row.paperId)),originNamespace:reference.origin.namespace,documentOrigin:trace.documentOrigin,stepIndex:trace.stepIndex??null,nodeId:trace.nodeId??null,graphVersion:trace.graphVersion??null,graphSha256:trace.graphSha256??null,replyByteLength:reference.reply.byteLength,previousRecordSha256:record.previousSha256});
  }));
  const issuedReports=new WeakMap();let reportGeneration=0;
  function invalidateReport(){reportGeneration++}
  async function prepareReport(input,isReportCurrent=()=>true){
   const reportOperation=++reportGeneration;
   const stillCurrent=()=>{stable();if(reportGeneration!==reportOperation||isReportCurrent()!==true)throw Error('FINDINGS_CONTEXT_CHANGED')};
   stillCurrent();
   if(!input||!Array.isArray(input.findings)||input.findings.length<1||input.findings.length>200||!['markdown','csv'].includes(input.format))throw Error('FINDINGS_REPORT_INPUT');
   const format=input.format,filter=input.filter;
   if(!filter||Object.keys(filter).sort().join(',')!=='paperId,query,sourceStatus'||typeof filter.paperId!=='string'||filter.paperId.length>100||typeof filter.query!=='string'||filter.query.length>200||typeof filter.sourceStatus!=='string')throw Error('FINDINGS_REPORT_FILTER');
   const capturedFilter=Object.freeze({query:filter.query,paperId:filter.paperId,sourceStatus:filter.sourceStatus});
   const filtered=filterManualFindings(pinnedRows,capturedFilter);
   if(filtered.error)throw Error('FINDINGS_REPORT_FILTER');
   if(!filtered.results.length)throw Error('FINDINGS_REPORT_EMPTY');
   // The caller must name every currently matched row, in displayed order.
   // This prevents hidden omissions, arbitrary subsets, and scope expansion.
   if(input.findings.length!==filtered.results.length||input.findings.some((requested,index)=>!requested||requested.findingId!==filtered.results[index].id||requested.expectedRecordSha256!==filtered.results[index].recordSha256))throw Error('FINDINGS_REPORT_SELECTION');
   const output=buildManualFindingsReport({rows:filtered.results,projectId,filter:capturedFilter,total:pinnedRows.length,excludedScopeCount:state.records.length-pinnedRows.length,format});
   stillCurrent();const contentSha256=await sha256(output.text,crypto);stillCurrent();
   const report=Object.freeze({...output,contentSha256});issuedReports.set(report,reportOperation);return report;
  }
  function validateReport(report,isReportCurrent=()=>true){
   stable();if(!report||issuedReports.get(report)!==reportGeneration||isReportCurrent()!==true)throw Error('FINDINGS_REPORT_EXPIRED');
   return report;
  }
  async function verifyOriginals(input,isVerificationCurrent=()=>true){
   const findingId=input?.findingId,expectedRecordSha256=input?.expectedRecordSha256,archiveRaw=input?.archiveRaw;
   const record=references.get(findingId);
   const stillCurrent=()=>{stable();if(isVerificationCurrent()!==true)throw Error('FINDINGS_CONTEXT_CHANGED')};
   stillCurrent();
   if(!record||record.sha256!==expectedRecordSha256||displayed.get(findingId)!==expectedRecordSha256)throw Error('FINDINGS_REFERENCE_MISMATCH');
   const report=await verifyManualReplyOriginals({referenceRaw:record.raw,archiveRaw},crypto);
   stillCurrent();return report;
  }
  return {...view,key,namespace,journalPresent:raw!==null,stable,checkCurrent,verifyOriginals,prepareReport,validateReport,invalidateReport};
 }
 return {key,namespace,read,cancel(){generation++}};
}
