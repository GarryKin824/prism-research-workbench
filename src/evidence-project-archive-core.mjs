import * as archiveCore from './workflow-archive-core.mjs';
// Schema 3: immutable schema 1/2 project plus manual, unverified evidence map.
import * as platformProjectCore from './platform-project-archive-core.mjs';
import * as evidenceMapCore from './evidence-map-core.mjs';
import {sha256} from './custom-core.mjs';
export const PROJECT_LIMIT=32000000;
const bytes=s=>new TextEncoder().encode(s).length,fail=c=>{throw Error(c)},keys=(x,k)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join('|')===k.split(',').sort().join('|');
function canonical(x){return x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(canonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}'}
function parse(raw){if(typeof raw!=='string'||bytes(raw)>PROJECT_LIMIT)fail('PROJECT_TOO_LARGE');try{return JSON.parse(raw)}catch{fail('INVALID_JSON')}}
async function contents(projectRaw,evidenceMapRaw,c){
 const nested=parse(projectRaw);if(!['prism-project-archive/v1','prism-project-archive/v2'].includes(nested?.schema))fail('INVALID_BASE_PROJECT_SCHEMA');
 const base=await platformProjectCore.inspectProjectArchive(projectRaw,c),base1=nested.schema==='prism-project-archive/v2'?JSON.parse(nested.projectRaw):nested;return inspectEvidenceComponents(base,base1.workflowArchiveRaw,evidenceMapRaw,c);
}
export async function inspectEvidenceComponents(base,workflowArchiveRaw,evidenceMapRaw,c){
 const namespace=base.summary.namespace,warnings=[...base.summary.warnings];let map=null,staleRevisions=0,missingRevisions=0;
 if(evidenceMapRaw!==null){
  map=await evidenceMapCore.loadEvidenceMap(evidenceMapRaw,{namespace},c);
  const papers=(await archiveCore.decodeArchiveComponents(workflowArchiveRaw,c)).store.papers,sources=new Map();
  for(const p of papers)sources.set(p.id,{namespace,paperId:p.id,title:p.title,documentSha256:p.document?.sha256??null,snapshotSha256:await sha256(JSON.stringify(p),c)});
  for(const r of map.revisions){const source=sources.get(r.source.paperId);if(!source){missingRevisions++;warnings.push({code:'EVIDENCE_MAP_PAPER_NOT_PRESENT',paperId:r.source.paperId,revisionId:r.id})}else if(JSON.stringify(source)!==JSON.stringify(r.source)){staleRevisions++;warnings.push({code:'EVIDENCE_MAP_HISTORICAL_SOURCE_DRIFT',paperId:r.source.paperId,revisionId:r.id})}}
  warnings.push({code:'EVIDENCE_MAP_MANUAL_HISTORY_ONLY_NO_VERIFICATION_OR_APPROVAL'});
 }else warnings.push({code:'EVIDENCE_MAP_MODULE_NOT_PRESENT'});
 const fingerprint=await sha256(canonical({base:base.fingerprint,evidenceMap:map}),c);
 return {fingerprint,summary:{...base.summary,presence:{...base.summary.presence,evidenceMapRaw:evidenceMapRaw!==null},counts:{...base.summary.counts,evidenceMapRevisions:map?.revisions.length??0},evidenceMap:{present:evidenceMapRaw!==null,revisions:map?.revisions.length??0,staleRevisions,missingRevisions,verification:'unverified',authority:'none',readOnly:true},warnings,readOnly:true,authority:'none'}};
}
export async function createProjectArchive({workflowArchiveRaw,sidecars,platformPlanRaw=null,evidenceMapRaw=null},c=globalThis.crypto){
 const projectRaw=await platformProjectCore.createProjectArchive({workflowArchiveRaw,sidecars,platformPlanRaw},c),body={schema:'prism-project-archive/v3',createdAt:new Date().toISOString(),projectRaw,evidenceMapRaw};
 if(bytes(JSON.stringify({...body,sha256:'0'.repeat(64)}))>PROJECT_LIMIT)fail('PROJECT_TOO_LARGE');await contents(projectRaw,evidenceMapRaw,c);return JSON.stringify({...body,sha256:await sha256(JSON.stringify(body),c)});
}
export async function inspectProjectArchive(raw,c=globalThis.crypto){
 const p=parse(raw);
 if(['prism-project-archive/v1','prism-project-archive/v2'].includes(p?.schema)){const base=await platformProjectCore.inspectProjectArchive(raw,c);return {...base,summary:{...base.summary,presence:{...base.summary.presence,evidenceMapRaw:false},counts:{...base.summary.counts,evidenceMapRevisions:0},evidenceMap:{present:false,revisions:0,staleRevisions:0,missingRevisions:0,verification:'unknown',authority:'none',readOnly:true},warnings:[...base.summary.warnings,{code:'LEGACY_ARCHIVE_NO_EVIDENCE_MAP'}]}}}
 if(!keys(p,'schema,createdAt,projectRaw,evidenceMapRaw,sha256')||p.schema!=='prism-project-archive/v3'||typeof p.createdAt!=='string'||!Number.isFinite(Date.parse(p.createdAt))||new Date(p.createdAt).toISOString()!==p.createdAt||!(p.evidenceMapRaw===null||typeof p.evidenceMapRaw==='string'))fail('INVALID_PROJECT_ARCHIVE');
 const {sha256:hash,...body}=p;if(hash!==await sha256(JSON.stringify(body),c))fail('PROJECT_HASH_MISMATCH');const r=await contents(p.projectRaw,p.evidenceMapRaw,c);return {raw,byteSha256:await sha256(raw,c),fingerprint:r.fingerprint,summary:{...r.summary,byteLength:bytes(raw)}};
}
