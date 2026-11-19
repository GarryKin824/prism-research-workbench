import {checkPdfTextIndex,LIMITS as PDF_LIMITS} from './pdf-intake/policy.mjs';
// Bounded historical checkpoint validation. No storage, network, or execution.
import {sha256,validateWorkflow} from './custom-core.mjs';
const exact=(x,names)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===names.split(',').sort().join(',');
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),id=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(x);
const bytes=x=>new TextEncoder().encode(x).length,clone=x=>JSON.parse(JSON.stringify(x));
const fail=code=>{throw Object.assign(Error(code),{code})};
// Same document contract as the original native store; shared by import/attach/restore.
export function normalizePaperDocument(d,{loaded=false}={}){
 const text=(x,n)=>typeof x==='string'&&x.length<=n,uint=x=>Number.isSafeInteger(x)&&x>=0;
 if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!['text','filename','mime','byteLength','sha256','pdfText'].includes(k)))fail('INVALID_DOCUMENT');
 if(!text(d.filename,255)||!d.filename.trim()||/[\\/\x00-\x1f\x7f]/.test(d.filename)||!(/\.(txt|md)$/i).test(d.filename))fail('INVALID_DOCUMENT_METADATA');
 if(!['text/plain','text/markdown'].includes(d.mime)||(/\.txt$/i).test(d.filename)&&d.mime!=='text/plain')fail('INVALID_DOCUMENT_METADATA');
 if(!text(d.text,200000)||!d.text.trim()||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(d.text)||/^\ufeff?%PDF-/i.test(d.text))fail('INVALID_DOCUMENT_TEXT');
 for(let i=0;i<d.text.length;i++){const c=d.text.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const n=d.text.charCodeAt(++i);if(!(n>=0xdc00&&n<=0xdfff))fail('INVALID_DOCUMENT_TEXT')}else if(c>=0xdc00&&c<=0xdfff)fail('INVALID_DOCUMENT_TEXT')}
 const byteLength=bytes(d.text);if(byteLength>512*1024)fail('DOCUMENT_TOO_LARGE');
 if((loaded||d.byteLength!==undefined)&&(!uint(d.byteLength)||d.byteLength!==byteLength))fail('INVALID_DOCUMENT_METADATA');
 if(loaded&&!hash(d.sha256))fail('INVALID_DOCUMENT_METADATA');
 return {text:d.text,filename:d.filename,mime:d.mime,byteLength,...(d.pdfText===undefined?{}:{pdfText:clone(checkPdfTextIndex(d.text,d.pdfText))})};
}
function safeText(value,max){if(typeof value!=='string'||!value.length||value.length>max||/[\x00-\x1f\x7f]/.test(value))return false;for(let i=0;i<value.length;i++){const n=value.charCodeAt(i);if(n>=0xd800&&n<=0xdbff){const next=value.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))return false}else if(n>=0xdc00&&n<=0xdfff)return false}return true}
function filename(value){return safeText(value,255)&&!/[\\/]/.test(value)}
export function assertDocumentAttachmentShape(paper){
 const a=paper?.documentAttachment,d=paper?.document;
 normalizePaperDocument(d,{loaded:true});
 if(!exact(a,'schema,id,namespace,time,oldPaperRaw,oldPaperSha256,oldWorkflowRaw,oldWorkflowSha256,documentSha256,provenance')||a.schema!=='prism-document-attachment/v1'||!id(a.id)||!safeText(a.namespace,300)||typeof a.time!=='string'||!Number.isFinite(Date.parse(a.time))||new Date(a.time).toISOString()!==a.time||!d||!hash(d.sha256)||d.sha256!==a.documentSha256||!hash(a.oldPaperSha256)||typeof a.oldPaperRaw!=='string'||a.oldPaperRaw.length>4000000||bytes(a.oldPaperRaw)>12000000)fail('DOCUMENT_ATTACHMENT_INVALID');
 let oldPaper;try{oldPaper=JSON.parse(a.oldPaperRaw)}catch{fail('DOCUMENT_ATTACHMENT_OLD_PAPER_INVALID')}
 if(!oldPaper||typeof oldPaper!=='object'||Array.isArray(oldPaper)||Object.hasOwn(oldPaper,'document')||Object.hasOwn(oldPaper,'documentAttachment')||oldPaper.id!==paper.id||oldPaper.title!==paper.title||oldPaper.source!==paper.source||JSON.stringify(oldPaper.metadata)!==JSON.stringify(paper.metadata))fail('DOCUMENT_ATTACHMENT_OLD_PAPER_MISMATCH');
 let oldWorkflow=null;
 if(a.oldWorkflowRaw===null){if(a.oldWorkflowSha256!==null)fail('DOCUMENT_ATTACHMENT_OLD_WORKFLOW_INVALID')}
 else{
  if(typeof a.oldWorkflowRaw!=='string'||bytes(a.oldWorkflowRaw)>4000000||!hash(a.oldWorkflowSha256))fail('DOCUMENT_ATTACHMENT_OLD_WORKFLOW_INVALID');
  let envelope;try{envelope=JSON.parse(a.oldWorkflowRaw)}catch{fail('DOCUMENT_ATTACHMENT_OLD_WORKFLOW_INVALID')}
  if(!exact(envelope,'schema,notice,state,sha256')||envelope.schema!=='prism-custom-workflow-backup/v1'||typeof envelope.notice!=='string'||envelope.notice.length>1000||!hash(envelope.sha256))fail('DOCUMENT_ATTACHMENT_OLD_WORKFLOW_INVALID');
  oldWorkflow=envelope.state;const s=oldWorkflow?.source;
  if(!s||s.namespace!==a.namespace||s.paperId!==paper.id||s.paperTitle!==paper.title||s.documentSha256!==null)fail('DOCUMENT_ATTACHMENT_OLD_WORKFLOW_MISMATCH');
 }
 const p=a.provenance;if(!p||p.textSha256!==a.documentSha256)fail('DOCUMENT_ATTACHMENT_PROVENANCE_INVALID');
 if(p.kind==='local-text'){
  if(!exact(p,'kind,filename,mime,byteLength,textSha256')||p.filename!==d.filename||p.mime!==d.mime||p.byteLength!==d.byteLength)fail('DOCUMENT_ATTACHMENT_PROVENANCE_INVALID');
 }else if(p.kind==='pdf-extraction'){
  if(!exact(p,'kind,filename,mime,byteLength,pdfSha256,textSha256,pages,pagesRead,truncated,parser,executor,ocrPerformed,binaryRetained')||!filename(p.filename)||!/\.pdf$/i.test(p.filename)||p.mime!=='application/pdf'||!Number.isSafeInteger(p.byteLength)||p.byteLength<1||p.byteLength>(d.pdfText?PDF_LIMITS.maxBytes:5242880)||!hash(p.pdfSha256)||!Number.isInteger(p.pages)||p.pages<1||p.pages>(d.pdfText?PDF_LIMITS.maxPages:50)||!Number.isInteger(p.pagesRead)||p.pagesRead<1||p.pagesRead>p.pages||typeof p.truncated!=='boolean'||p.pagesRead<p.pages&&!p.truncated||p.parser!=='PDF.js 6.3.289 derived classic'||p.executor!=='derived PDF.js classic Worker / opaque sandbox'||p.ocrPerformed!==false||p.binaryRetained!==false||typeof d.text!=='string'||d.text.length>(d.pdfText?PDF_LIMITS.maxChars:16000))fail('DOCUMENT_ATTACHMENT_PROVENANCE_INVALID');
  if(d.pdfText&&['pages','pagesRead','truncated'].some(key=>p[key]!==d.pdfText[key]))fail('DOCUMENT_ATTACHMENT_PROVENANCE_INVALID');
 }else fail('DOCUMENT_ATTACHMENT_PROVENANCE_INVALID');
 return {attachment:a,oldPaper,oldWorkflow};
}
export async function validateDocumentAttachment(paper,{namespace,crypto=globalThis.crypto}={}){
 const q=clone(paper),checked=assertDocumentAttachmentShape(q),{attachment:a}=checked;
 if(namespace!==undefined&&a.namespace!==namespace)fail('DOCUMENT_ATTACHMENT_NAMESPACE_MISMATCH');
 if(await sha256(q.document.text,crypto)!==a.documentSha256||bytes(q.document.text)!==q.document.byteLength||await sha256(a.oldPaperRaw,crypto)!==a.oldPaperSha256)fail('DOCUMENT_ATTACHMENT_HASH_MISMATCH');
 if(a.oldWorkflowRaw!==null){
  if(await sha256(a.oldWorkflowRaw,crypto)!==a.oldWorkflowSha256)fail('DOCUMENT_ATTACHMENT_HASH_MISMATCH');
  const envelope=JSON.parse(a.oldWorkflowRaw),{sha256:d,...body}=envelope;
  if(await sha256(JSON.stringify(body),crypto)!==d)fail('DOCUMENT_ATTACHMENT_WORKFLOW_HASH_MISMATCH');
  await validateWorkflow(envelope.state,crypto);
 }
 return checked;
}
