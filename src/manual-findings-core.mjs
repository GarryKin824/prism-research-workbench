// Read-only projection of a validated manual-reply journal. No original reply,
// preparation, document text or Prompt is returned in the browsing model.
import {sha256} from './custom-core.mjs';
export const MANUAL_FINDINGS_LIMIT=Object.freeze({query:200,terms:32});
const fold=s=>s.normalize('NFC').toLowerCase().replace(/ς/g,'σ');
export async function createManualFindingsView({state,papers,projectId,paperIds},crypto=globalThis.crypto){
 if(typeof projectId!=='string'||!Array.isArray(papers)||!Array.isArray(paperIds)||!Array.isArray(state?.records))throw Error('FINDINGS_SCOPE_UNKNOWN');
 const byId=new Map(papers.map(p=>[p.id,p])),members=new Set(paperIds),cache=new Map(),rows=[];
 for(const record of state.records){
  const ref=record.reference,id=ref.targetSource.paperId,paper=byId.get(id);
  // An origin alone is not membership, and shared paper membership is not origin.
  if(projectId&&(ref.origin.projectId!==projectId||!members.has(id)||!paper))continue;
  if(paper&&!cache.has(id))cache.set(id,{snapshot:await sha256(JSON.stringify(paper),crypto),document:typeof paper.document?.text==='string'?await sha256(paper.document.text,crypto):null,declaredDocument:paper.document?.sha256??null});
  const current=cache.get(id),source=ref.targetSource;
  const documentStatus=!paper?'paper-missing':!current.document?'missing':current.document!==current.declaredDocument?'inconsistent':current.document===source.documentSha256?'same':'changed';
  const snapshotStatus=!paper?'paper-missing':current.snapshot===source.snapshotSha256?'same':'changed';
  const sourceStatus=['paper-missing','missing'].includes(documentStatus)?'unavailable':documentStatus==='inconsistent'?'inconsistent':documentStatus==='changed'||snapshotStatus==='changed'?'changed':'same';
  rows.push({id:record.id,seq:record.seq,time:record.time,conclusion:record.conclusion,paperId:id,recordedTitle:source.title,currentTitle:paper?.title??null,canNavigate:!!paper,projectId:ref.origin.projectId,stepName:ref.preparation.trace.stepNameAtRead,stepOrigin:ref.preparation.trace.stepOrigin,promptVersion:ref.preparation.trace.promptVersion,documentStatus,snapshotStatus,sourceStatus,recordId:ref.recordId,replyId:ref.reply.id,replySha256:ref.reply.sha256,preparationSha256:ref.preparation.integritySha256,recordedDocumentSha256:source.documentSha256,recordedSnapshotSha256:source.snapshotSha256,recordedPromptSha256:ref.preparation.promptSha256,recordSha256:record.sha256,currentDocumentSha256:current?.document??null,currentSnapshotSha256:current?.snapshot??null,status:'ai_unverified',authenticated:false,originalsIncluded:false});
 }
 // The append sequence is the deterministic newest-saved order; timestamps are
 // recorded metadata, not a trusted clock or proof of execution.
 rows.reverse();return {rows,projectId,authority:'none',authenticated:false,originalsIncluded:false};
}
export function filterManualFindings(rows,{query='',paperId='',sourceStatus='all'}={}){
 if(typeof query!=='string'||query.length>MANUAL_FINDINGS_LIMIT.query||typeof paperId!=='string'||!['all','same','changed','unavailable','inconsistent'].includes(sourceStatus))return {results:[],total:rows.length,error:'INVALID_FILTER'};
 const terms=fold(query.trim()).split(/\s+/u).filter(Boolean);if(terms.length>MANUAL_FINDINGS_LIMIT.terms)return {results:[],total:rows.length,error:'TOO_MANY_TERMS'};
 const results=rows.filter(r=>(!paperId||r.paperId===paperId)&&(sourceStatus==='all'||r.sourceStatus===sourceStatus)&&terms.every(t=>[r.conclusion,r.recordedTitle,r.currentTitle??'',r.stepName,r.time,r.projectId,r.recordId,r.replyId].some(x=>fold(x).includes(t))));
 return {results,total:rows.length,error:null};
}
