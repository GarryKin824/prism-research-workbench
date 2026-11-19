import * as archiveCore from './workflow-archive-core.mjs';
// Schema 4: preserve schema 1/2/3 and add stable-ID multi-claim histories.
import * as evidenceProjectCore from './evidence-project-archive-core.mjs';
import * as multiEvidenceCore from './multi-evidence-core.mjs';
import {sha256} from './custom-core.mjs';
export const PROJECT_LIMIT=32000000;
const bytes=s=>new TextEncoder().encode(s).length,fail=c=>{throw Error(c)},keys=(x,k)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join('|')===k.split(',').sort().join('|');
function canonical(x){return x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(canonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}'}
function parse(raw){if(typeof raw!=='string'||bytes(raw)>PROJECT_LIMIT)fail('PROJECT_TOO_LARGE');try{return JSON.parse(raw)}catch{fail('INVALID_JSON')}}
async function contents(projectRaw,multiEvidenceRaw,c){
 const nested=parse(projectRaw);if(!['prism-project-archive/v1','prism-project-archive/v2','prism-project-archive/v3'].includes(nested?.schema))fail('INVALID_BASE_PROJECT_SCHEMA');
 const base=await evidenceProjectCore.inspectProjectArchive(projectRaw,c);let base1=nested;while(base1.schema!=='prism-project-archive/v1')base1=JSON.parse(base1.projectRaw);return inspectMultiComponents(base,base1.workflowArchiveRaw,multiEvidenceRaw,c);
}
export async function inspectMultiComponents(base,workflowArchiveRaw,multiEvidenceRaw,c){
 const namespace=base.summary.namespace,warnings=[...base.summary.warnings];let map=null,staleRevisions=0,missingRevisions=0;
 if(multiEvidenceRaw!==null){
  map=await multiEvidenceCore.loadMulti(multiEvidenceRaw,{namespace},c);
  const papers=(await archiveCore.decodeArchiveComponents(workflowArchiveRaw,c)).store.papers,sources=new Map();
  for(const p of papers)sources.set(p.id,{namespace,paperId:p.id,title:p.title,documentSha256:p.document?.sha256??null,snapshotSha256:await sha256(JSON.stringify(p),c)});
  for(const claim of map.claims)for(const r of JSON.parse(claim.tableRaw).table.revisions){const source=sources.get(r.source.paperId);if(!source){missingRevisions++;warnings.push({code:'MULTI_EVIDENCE_PAPER_NOT_PRESENT',paperId:r.source.paperId,revisionId:r.id})}else if(JSON.stringify(source)!==JSON.stringify(r.source)){staleRevisions++;warnings.push({code:'MULTI_EVIDENCE_HISTORICAL_SOURCE_DRIFT',paperId:r.source.paperId,revisionId:r.id})}}
  warnings.push({code:'MULTI_EVIDENCE_MANUAL_HISTORY_ONLY_NO_VERIFICATION_OR_APPROVAL'});
 }else warnings.push({code:'MULTI_EVIDENCE_MODULE_NOT_PRESENT'});
 const fingerprint=await sha256(canonical({base:base.fingerprint,multiEvidence:map}),c);
 return {fingerprint,summary:{...base.summary,presence:{...base.summary.presence,multiEvidenceRaw:multiEvidenceRaw!==null},counts:{...base.summary.counts,multiEvidenceRevisions:map?.revision??0},multiEvidence:{present:multiEvidenceRaw!==null,revisions:map?.revision??0,claims:map?.claims.length??0,staleRevisions,missingRevisions,verification:'unverified',authority:'none',readOnly:true},warnings,readOnly:true,authority:'none'}};
}
export async function createProjectArchive({workflowArchiveRaw,sidecars,platformPlanRaw=null,evidenceMapRaw=null,multiEvidenceRaw=null},c=globalThis.crypto){
 const projectRaw=await evidenceProjectCore.createProjectArchive({workflowArchiveRaw,sidecars,platformPlanRaw,evidenceMapRaw},c),body={schema:'prism-project-archive/v4',createdAt:new Date().toISOString(),projectRaw,multiEvidenceRaw};
 if(bytes(JSON.stringify({...body,sha256:'0'.repeat(64)}))>PROJECT_LIMIT)fail('PROJECT_TOO_LARGE');await contents(projectRaw,multiEvidenceRaw,c);return JSON.stringify({...body,sha256:await sha256(JSON.stringify(body),c)});
}
export async function inspectProjectArchive(raw,c=globalThis.crypto){
 const p=parse(raw);
 if(['prism-project-archive/v1','prism-project-archive/v2','prism-project-archive/v3'].includes(p?.schema)){const base=await evidenceProjectCore.inspectProjectArchive(raw,c);return {...base,summary:{...base.summary,presence:{...base.summary.presence,multiEvidenceRaw:false},counts:{...base.summary.counts,multiEvidenceRevisions:0},multiEvidence:{present:false,revisions:0,claims:0,staleRevisions:0,missingRevisions:0,verification:'unknown',authority:'none',readOnly:true},warnings:[...base.summary.warnings,{code:'LEGACY_ARCHIVE_NO_MULTI_EVIDENCE'}]}}}
 if(!keys(p,'schema,createdAt,projectRaw,multiEvidenceRaw,sha256')||p.schema!=='prism-project-archive/v4'||typeof p.createdAt!=='string'||!Number.isFinite(Date.parse(p.createdAt))||new Date(p.createdAt).toISOString()!==p.createdAt||!(p.multiEvidenceRaw===null||typeof p.multiEvidenceRaw==='string'))fail('INVALID_PROJECT_ARCHIVE');
 const {sha256:hash,...body}=p;if(hash!==await sha256(JSON.stringify(body),c))fail('PROJECT_HASH_MISMATCH');const r=await contents(p.projectRaw,p.multiEvidenceRaw,c);return {raw,byteSha256:await sha256(raw,c),fingerprint:r.fingerprint,summary:{...r.summary,byteLength:bytes(raw)}};
}
// Only called after full archive inspection. Returns historical plain data, never runnable stores.
export async function readOnlyProjectView(raw,c=globalThis.crypto){
 const checked=await inspectProjectArchive(raw,c);let cursor=JSON.parse(raw),multiRaw=null,evidenceRaw=null,platformRaw=null;
 while(cursor.schema!=='prism-project-archive/v1'){
  if(cursor.schema==='prism-project-archive/v4')multiRaw=cursor.multiEvidenceRaw;
  if(cursor.schema==='prism-project-archive/v3')evidenceRaw=cursor.evidenceMapRaw;
  if(cursor.schema==='prism-project-archive/v2')platformRaw=cursor.platformPlanRaw;
  cursor=JSON.parse(cursor.projectRaw);
 }
 return readOnlyBaseComponents({workflowArchiveRaw:cursor.workflowArchiveRaw,sidecars:cursor.sidecars,platformPlanRaw:platformRaw,evidenceMapRaw:evidenceRaw,multiEvidenceRaw:multiRaw},checked,c);
}
export async function readOnlyBaseComponents({workflowArchiveRaw,sidecars,platformPlanRaw:platformRaw,evidenceMapRaw:evidenceRaw,multiEvidenceRaw:multiRaw},checked,c){
 const decoded=await archiveCore.decodeArchiveComponents(workflowArchiveRaw,c),wa=decoded.archive,papers=decoded.store.papers,workflows=wa.workflowRaws.map(r=>JSON.parse(r).state),claims=[];
 if(evidenceRaw!==null){const latest=new Map();for(const r of JSON.parse(evidenceRaw).table.revisions)latest.set(r.source.paperId,r);for(const [paperId,r]of latest)claims.push({kind:'legacy-v1',claimId:'legacy:'+paperId,paperId,source:r.source,fields:r.fields,revisionSha256:r.sha256,authority:'none',verification:'unverified'})}
 if(multiRaw!==null)for(const claim of JSON.parse(multiRaw).state.claims){const table=JSON.parse(claim.tableRaw).table,r=table.revisions.at(-1);claims.push({kind:'multi-v2',claimId:claim.id,paperId:claim.paperId,source:r.source,fields:r.fields,revisionCount:table.revisions.length,originSha256:claim.originSha256,revisionSha256:r.sha256,authority:'none',verification:'unverified'})}
 const sourceMap=new Map();for(const p of papers)sourceMap.set(p.id,{namespace:checked.summary.namespace,paperId:p.id,title:p.title,documentSha256:p.document?.sha256??null,snapshotSha256:await sha256(JSON.stringify(p),c)});for(const claim of claims){claim.paperMissing=!sourceMap.has(claim.paperId);claim.sourceDrift=claim.paperMissing||JSON.stringify(sourceMap.get(claim.paperId))!==JSON.stringify(claim.source)}
 const reviews=sidecars.reviewRaw===null?[]:(JSON.parse(sidecars.reviewRaw)??[]),paperIds=[...new Set([...papers.map(p=>p.id),...claims.map(x=>x.paperId),...workflows.map(w=>w.source.paperId),...reviews.map(r=>r.binding.paperId)])];
 return {authority:'none',readOnly:true,historyOnly:true,byteSha256:checked.byteSha256,summary:checked.summary,papers:paperIds.map(id=>({id,paper:papers.find(p=>p.id===id)??null,claims:claims.filter(x=>x.paperId===id),workflows:workflows.filter(w=>w.source.paperId===id),reviews:reviews.filter(r=>r.binding.paperId===id)})),platformHistory:platformRaw===null?null:JSON.parse(platformRaw),scope:'saved paper content, current claim per stable ID, workflow histories and manual review histories; other sidecars and complete claim/migration histories remain in exact archive export'};
}
