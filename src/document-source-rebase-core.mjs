import * as G from './custom-core.mjs';
import {validateDocumentAttachment} from './document-attachment-core.mjs';
export async function previewDocumentSourceRebase({namespace,paper,oldWorkflowRaw},crypto=globalThis.crypto){
 await validateDocumentAttachment(paper,{namespace,crypto});
 const cp=paper.documentAttachment;if(!cp||typeof cp.oldWorkflowRaw!=='string'||oldWorkflowRaw!==cp.oldWorkflowRaw)throw Error('SOURCE_REBASE_BASE_CHANGED');
 await G.importWorkflow(oldWorkflowRaw,crypto);const old=JSON.parse(oldWorkflowRaw).state,before=JSON.parse(cp.oldPaperRaw);
 if(old.source?.namespace!==namespace||old.source.paperId!==paper.id||old.source.paperTitle!==before.title||old.source.documentSha256!==null||old.runs.some(r=>r.status==='running')||old.syntheticAuthorized)throw Error('SOURCE_REBASE_OLD_SOURCE_OR_ACTIVE');
 const documentSha256=await G.sha256(paper.document.text,crypto);if(documentSha256!==paper.document.sha256||documentSha256!==cp.documentSha256)throw Error('SOURCE_REBASE_DOCUMENT_CHANGED');
 const source={namespace,paperId:paper.id,paperTitle:paper.title,documentSha256,sourceArchiveSha256:await G.sha256(JSON.stringify(paper),crypto)},graph=old.graphs.find(g=>g.version===old.currentVersion);
 const workflow=await G.createWorkflow({source,legacy:null,nodes:graph.nodes.map(({promptVersion,...node})=>node),policy:{...graph.policy,mode:'manual',allowSynthetic:false}},crypto);
 if(workflow.id===old.id)throw Error('SOURCE_REBASE_ID_REUSED');
 const raw=await G.exportWorkflow(workflow,crypto);if(new TextEncoder().encode(raw).length>4000000)throw Error('SOURCE_REBASE_TOO_LARGE');
 return {workflow,raw,oldWorkflowSummary:{id:old.id,sha256:cp.oldWorkflowSha256,graphVersion:old.currentVersion,graphSha256:graph.sha256,runs:old.runs.length,approvals:old.approvals.length,retainedIn:'paper.documentAttachment.oldWorkflowRaw'},notice:'明确复制旧设计到新正文来源：新 workflow ID、图版本和提示版本从 1 起；旧运行/审核不继承，旧完整档案保留在正文挂接 checkpoint。手动且禁止合成执行，不代表批准或真实模型运行。'};
}
/** Metadata lineage check, not proof of user consent or prior operation success. */
export async function validateSourceRebaseWorkflow(currentWorkflow,paper,{namespace,crypto=globalThis.crypto,allowSnapshotDrift=false}={}){
 await validateDocumentAttachment(paper,{namespace,crypto});const cp=paper.documentAttachment;if(!cp?.oldWorkflowRaw)throw Error('SOURCE_REBASE_NO_OLD_DESIGN');
 await G.importWorkflow(cp.oldWorkflowRaw,crypto);const old=JSON.parse(cp.oldWorkflowRaw).state;
 await G.validateWorkflow(currentWorkflow,crypto);const graph=old.graphs.find(g=>g.version===old.currentVersion),first=currentWorkflow.graphs[0],expectedNodes=graph.nodes.map(({promptVersion,...n})=>({...n,promptVersion:1})),expectedPolicy={...graph.policy,mode:'manual',allowSynthetic:false};
 const s=currentWorkflow.source,actual=await G.sha256(paper.document.text,crypto),snapshotSha256=await G.sha256(JSON.stringify(paper),crypto),snapshotStatus=s?.sourceArchiveSha256===snapshotSha256?'same':'changed';
 if(currentWorkflow.id===old.id||currentWorkflow.legacy!==null||!s||s.namespace!==namespace||s.paperId!==paper.id||s.paperTitle!==paper.title||s.documentSha256!==actual||actual!==paper.document.sha256||actual!==cp.documentSha256||!allowSnapshotDrift&&snapshotStatus!=='same'||JSON.stringify(first.nodes)!==JSON.stringify(expectedNodes)||JSON.stringify(first.policy)!==JSON.stringify(expectedPolicy))throw Error('SOURCE_REBASE_LINEAGE_MISMATCH');
 return {metadataMatch:true,snapshotStatus,consentEstablished:false,oldWorkflowId:old.id,newWorkflowId:currentWorkflow.id};
}
