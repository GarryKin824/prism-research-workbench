import * as graphCore from './custom-core.mjs';
import * as nodeReviewCore from './node-review-core.mjs';
const copy=x=>JSON.parse(JSON.stringify(x));
export async function verifyLinkedEvidence(input,source,c=globalThis.crypto){
 const x=copy(input),s=copy(source);if(!x||Object.keys(x).sort().join(',')!=='authority,kind,raw,recordId,schema,sha256'||x.schema!=='prism-fixed-evidence/v1'||x.authority!=='none'||typeof x.raw!=='string'||x.raw.length>4000000||typeof x.recordId!=='string'||x.sha256!==await graphCore.sha256(x.raw,c))throw Error('INVALID_FIXED_EVIDENCE');
 if(x.kind==='synthetic-run'){await graphCore.importWorkflow(x.raw,c);const w=JSON.parse(x.raw).state,r=w.runs.find(r=>r.id===x.recordId);if(w.source.namespace!==s.namespace||w.source.paperId!==s.paperId||w.source.paperTitle!==s.title||w.source.documentSha256!==s.documentSha256||!r||r.status!=='completed'||!r.artifact)throw Error('FIXED_RUN_MISMATCH');return {nodeId:r.nodeId,graphVersion:r.graphVersion,label:'本地合成运行，非真实模型验证',record:r};}
 if(x.kind==='manual-review'){const st=await nodeReviewCore.loadNodeReviews(x.raw,{namespace:s.namespace},c),r=st.records.find(r=>r.sha256===x.recordId);if(!r||JSON.stringify(r.source)!==JSON.stringify(s))throw Error('FIXED_REVIEW_MISMATCH');return {nodeId:r.reviewNodeId,graphVersion:r.graphVersion,label:'人工送审/返工记录，未独立核实',record:r};}throw Error('FIXED_KIND');
}
export async function fixedCandidates(source,workflowRaw,reviewRaw,c=globalThis.crypto){const s=copy(source),out=[];if(workflowRaw!==null){await graphCore.importWorkflow(workflowRaw,c);const w=JSON.parse(workflowRaw).state;for(const r of w.runs.filter(r=>r.status==='completed'&&r.artifact&&w.currentRuns[r.nodeId]===r.id&&r.graphVersion===w.currentVersion)){const x={schema:'prism-fixed-evidence/v1',kind:'synthetic-run',raw:workflowRaw,recordId:r.id,sha256:await graphCore.sha256(workflowRaw,c),authority:'none'};const v=await verifyLinkedEvidence(x,s,c);out.push({key:'run:'+r.id,field:'run',fixedSnapshot:x,sourceSnapshotDrift:fixedSourceSnapshotDrift(x,s),label:v.label+(fixedSourceSnapshotDrift(x,s)?' · 历史迁移快照，与当前论文快照不同':'')+' · '+r.nodeId+' · '+r.id});}}
 if(reviewRaw!==null){const st=await nodeReviewCore.loadNodeReviews(reviewRaw,{namespace:s.namespace},c);for(const r of st.records.filter(r=>JSON.stringify(r.source)===JSON.stringify(s)&&r.workflowRaw===workflowRaw)){const x={schema:'prism-fixed-evidence/v1',kind:'manual-review',raw:reviewRaw,recordId:r.sha256,sha256:await graphCore.sha256(reviewRaw,c),authority:'none'},v=await verifyLinkedEvidence(x,s,c);out.push({key:'review:'+r.sha256,field:'review',fixedSnapshot:x,sourceSnapshotDrift:fixedSourceSnapshotDrift(x,s),label:v.label+(fixedSourceSnapshotDrift(x,s)?' · 历史迁移快照，与当前论文快照不同':'')+' · '+r.reviewNodeId+' · '+(st.records.some(x=>x.revisionOf===r.sha256)?'已被返工，历史送审记录':r.status)});}}return out;}
// Presentation-only drift: migration provenance stays immutable and historical
// references remain valid/loadable. This does not authenticate source content.
export function fixedSourceSnapshotDrift(x,source){
 if(!source)return false;
 const state=JSON.parse(x.raw).state;
 const workflow=x.kind==='synthetic-run'?state:JSON.parse(state.records.find(r=>r.sha256===x.recordId).workflowRaw).state;
 return workflow.source?.sourceArchiveSha256!==source.snapshotSha256;
}
export function fixedDrift(x,{workflowRaw,reviewRaw,source}){if(fixedSourceSnapshotDrift(x,source))return true;if(x.kind==='synthetic-run')return x.raw!==workflowRaw;const r=JSON.parse(x.raw).state.records.find(r=>r.sha256===x.recordId);return x.raw!==reviewRaw||!r||r.workflowRaw!==workflowRaw}
