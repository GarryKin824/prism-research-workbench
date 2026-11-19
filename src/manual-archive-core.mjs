import {readManualStepInput,isManualStepInput} from './manual-step-input-format.mjs';
export const MANUAL_ARCHIVE_MAX_BYTES=8388608;
export function serializeManualArchive(records){
 const text=JSON.stringify({schema:'prism-manual-research-records-v1',authority:'none',executionAllowed:false,records},null,2);
 if(new TextEncoder().encode(text).length>MANUAL_ARCHIVE_MAX_BYTES)throw Error('记录总量超过 8 MiB；未下载。请先逐条下载；若单条含草稿仍超限，取消包含草稿后下载记录，并用“仅下载当前未提交草稿（TXT）”另存草稿。原记录仍保留在本页。');
 return text;
}
// In-memory, non-executable archive projection. No store or platform authority.
export async function readManualArchive(text,{crypto,prepare}){
 const fail=()=>{throw Error('记录包格式、绑定或长度校验失败；未导入任何研究状态');};
 if(typeof text!=='string'||new TextEncoder().encode(text).length>MANUAL_ARCHIVE_MAX_BYTES)fail();
 let input;try{input=JSON.parse(text)}catch{fail()}
 const keys=(o,names)=>{if(!o||Array.isArray(o)||typeof o!=='object'||Object.keys(o).sort().join('|')!==names.sort().join('|'))fail();};
 const str=(s,max)=>{if(typeof s!=='string'||!s.length||s.length>max)fail();};
 keys(input,['schema','authority','executionAllowed','records']);if(input.schema!=='prism-manual-research-records-v1'||input.authority!=='none'||input.executionAllowed!==false||!Array.isArray(input.records)||!input.records.length||input.records.length>20)fail();
 const records=[],ids=new Set();
 for(const r of input.records){
  keys(r,[...(Object.hasOwn(r,'origin')?['origin']:[]),...(Object.hasOwn(r,'replyDraft')?['replyDraft']:[]),'id','binding','prepared','clipboard','sending','authority','platformVerified','researchAccepted','replies']);str(r.id,128);if(ids.has(r.id))fail();ids.add(r.id);
  if(r.authority!=='none'||r.platformVerified!==false||r.researchAccepted!==false||!['pending','copied','unknown'].includes(r.clipboard)||!['not_reported','user_reported_sent','user_reported_unknown'].includes(r.sending)||!Array.isArray(r.replies)||r.replies.length>20)fail();
  let origin;if(Object.hasOwn(r,'origin')){keys(r.origin,['namespace','projectId','paperId','paperTitle']);origin={};for(const k of ['namespace','projectId','paperId','paperTitle']){if(typeof r.origin[k]!=='string'||r.origin[k].length>512)fail();origin[k]=r.origin[k]}}
  let replyDraft;if(Object.hasOwn(r,'replyDraft')){keys(r.replyDraft,['content','status','verification']);str(r.replyDraft.content,64000);if(r.replyDraft.status!=='unsubmitted'||r.replyDraft.verification!=='unverified')fail();replyDraft={content:r.replyDraft.content,status:'unsubmitted',verification:'unverified'};}
  const p=r.prepared;let checked;if(isManualStepInput(p)){try{checked=await readManualStepInput(JSON.stringify(p),crypto)}catch{fail()}if(r.binding!==checked.integritySha256||!origin||['namespace','projectId','paperId','paperTitle'].some(k=>origin[k]!==checked.origin[k]))fail();}else{keys(p,[...(Object.hasOwn(p,'trace')?['trace']:[]),'schema','purpose','authority','executionAllowed','networkAllowed','document','step','integritySha256']);keys(p.document,['filename','text','bytes','sha256']);keys(p.step,['name','prompt','sha256']);
  try{checked=await prepare({filename:p.document.filename,text:p.document.text,prompt:p.step.prompt,stepName:p.step.name,...(Object.hasOwn(p,'trace')?{trace:p.trace}:{})},crypto)}catch{fail()}
  for(const k of ['schema','purpose','authority','executionAllowed','networkAllowed','integritySha256'])if(p[k]!==checked[k])fail();
  if(r.binding!==checked.integritySha256||p.document.bytes!==checked.document.bytes||p.document.sha256!==checked.document.sha256||p.step.sha256!==checked.step.sha256)fail();}
  const replies=[],replyIds=new Set();for(const reply of r.replies){keys(reply,['id','content','source','verification','researchAccepted']);str(reply.id,128);str(reply.content,64000);if(!reply.content.trim()||replyIds.has(reply.id)||reply.source!=='user_pasted'||reply.verification!=='unverified'||reply.researchAccepted!==false)fail();replyIds.add(reply.id);replies.push({id:reply.id,content:reply.content,source:'user_pasted',verification:'unverified',researchAccepted:false});}
  records.push({id:r.id,...(replyDraft?{replyDraft}:{}),...(origin?{origin}:{}),binding:r.binding,prepared:checked,clipboard:r.clipboard,sending:r.sending,authority:'none',platformVerified:false,researchAccepted:false,replies});
 }
 return {records,authority:'none',executionAllowed:false,readOnly:true};
}
