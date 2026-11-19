// Read-only, bounded metadata for an independently validated source checkpoint.
// Full old paper/workflow payloads stay in the base archive, not ordinary reports.
import {validateDocumentAttachment} from './document-attachment-core.mjs';
export async function createDocumentSourceResults({paper,namespace},crypto=globalThis.crypto){
 const base={status:'missing',scope:'shared-paper-source-history',authority:'none',authenticated:false,rawIncluded:false,currentApprovalEstablished:false,binaryIncluded:false,coverage:'保存来源检查点的元数据，不自动恢复旧正文、流程、批准或执行。全文匹配与哈希不证明文件对应此文献；原 PDF 不在检查点中。'};
 if(!paper.documentAttachment)return base;
 try{
  const {attachment:a,oldPaper,oldWorkflow}=await validateDocumentAttachment(paper,{crypto});
  const w=oldWorkflow?.state??oldWorkflow;
  return {...base,status:'available',attachmentId:a.id,time:a.time,currentNamespace:namespace,recordedNamespace:a.namespace,namespaceStatus:a.namespace===namespace?'same':'historical-other-namespace',paperId:paper.id,oldPaper:{id:oldPaper.id,title:oldPaper.title,source:oldPaper.source,documentPresent:false,snapshotSha256:a.oldPaperSha256,basicRunCount:oldPaper.runs.length},documentSha256:a.documentSha256,provenance:JSON.parse(JSON.stringify(a.provenance)),oldWorkflow:w?{id:w.id,currentVersion:w.currentVersion,graphCount:w.graphs.length,runCount:w.runs.length,byteSha256:a.oldWorkflowSha256}:null,checkpointContains:{oldPaperRaw:true,oldWorkflowRaw:a.oldWorkflowRaw!==null},historyPreservedNotCurrent:true};
 }catch{return {...base,status:'unavailable'};}
}
