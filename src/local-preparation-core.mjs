// Pure in-memory preparation. No store, model, filesystem, network or execution capability.
export async function createLocalPreparation({filename,text,prompt,stepName='本地草稿',trace},crypto){
 if(typeof filename!=='string'||!filename||filename.length>255||/[\\/\x00-\x1f\x7f]/.test(filename)||!(/\.(txt|md)$/i).test(filename))throw Error('仅支持 TXT / Markdown 文件');
 if(typeof text!=='string'||!text.trim()||text.length>200000||typeof prompt!=='string'||!prompt.trim()||prompt.length>16000||typeof stepName!=='string'||!stepName.trim()||stepName.length>120)throw Error('正文或 Prompt 为空或超过长度限制');
 for(const value of [text,prompt,stepName]){if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))throw Error('包含不支持的控制字符');for(let i=0;i<value.length;i++){const n=value.charCodeAt(i);if(n>=0xd800&&n<=0xdbff){const next=value.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))throw Error('文本编码无效');}else if(n>=0xdc00&&n<=0xdfff)throw Error('文本编码无效');}}
 if(/^\ufeff?%PDF-/.test(text))throw Error('PDF 请先在本地转为文本，不可伪装为 TXT');
 const encoder=new TextEncoder();const bytes=encoder.encode(text);if(bytes.length>524288)throw Error('正文超过 512 KiB');
 const sha=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
 const provenance=trace===undefined?undefined:validatePreparationTrace(trace);
 const payload={...(provenance?{trace:provenance}:{}),schema:'prism-local-preparation-v1',purpose:'local-review-only',authority:'none',executionAllowed:false,networkAllowed:false,document:{filename,text,bytes:bytes.length,sha256:await sha(text)},step:{name:stepName,prompt,sha256:await sha(prompt)}};
 return {...payload,integritySha256:await sha(JSON.stringify(payload))};
}

export function validatePreparationTrace(t){const keys=[...(t?.stepOrigin==='custom_graph'?['graphVersion','graphSha256','nodeId']:[]),'documentOrigin','stepOrigin','stepIndex','promptVersion','stepNameAtRead','promptEdited','stepNameEdited'];if(!t||Array.isArray(t)||Object.keys(t).sort().join('|')!==keys.sort().join('|')||!['workspace_copy','selected_file'].includes(t.documentOrigin)||!['workspace_copy','local_draft','custom_graph'].includes(t.stepOrigin)||typeof t.promptEdited!=='boolean'||typeof t.stepNameEdited!=='boolean'||typeof t.stepNameAtRead!=='string'||t.stepNameAtRead.length>120)throw Error('准备来源元数据无效');if(t.stepOrigin==='custom_graph'){if(t.stepIndex!==null||!Number.isSafeInteger(t.graphVersion)||t.graphVersion<1||!Number.isSafeInteger(t.promptVersion)||t.promptVersion<1||!(/^[a-f0-9]{64}$/).test(t.graphSha256)||typeof t.nodeId!=='string'||!(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/).test(t.nodeId))throw Error('自定义图节点版本元数据无效');}else if(t.stepOrigin==='workspace_copy'){if(!(t.stepIndex===null||Number.isSafeInteger(t.stepIndex)&&t.stepIndex>=0&&t.stepIndex<3)||!(t.promptVersion===null||Number.isSafeInteger(t.promptVersion)&&t.promptVersion>=1))throw Error('步骤版本元数据无效');}else if(t.stepIndex!==null||t.promptVersion!==null||t.stepNameAtRead!==''||t.promptEdited||t.stepNameEdited)throw Error('本地草稿不得声称继承步骤版本');return Object.fromEntries(keys.map(k=>[k,t[k]]));}

export const PREPARATION_ARCHIVE_MAX_BYTES=2097152;
export async function readPreparationArchive(text,crypto){
 const fail=()=>{throw Error('准备包格式、长度或完整性校验失败；未恢复任何研究状态')};
 if(typeof text!=='string'||new TextEncoder().encode(text).length>PREPARATION_ARCHIVE_MAX_BYTES)fail();let p;try{p=JSON.parse(text)}catch{fail()}
 const keys=(o,expected)=>{if(!o||Array.isArray(o)||typeof o!=='object'||Object.keys(o).sort().join('|')!==expected.sort().join('|'))fail()};
 keys(p,['schema','purpose','authority','executionAllowed','networkAllowed','document','step','integritySha256',...(Object.hasOwn(p,'trace')?['trace']:[])]);keys(p.document,['filename','text','bytes','sha256']);keys(p.step,['name','prompt','sha256']);
 let checked;try{checked=await createLocalPreparation({filename:p.document.filename,text:p.document.text,prompt:p.step.prompt,stepName:p.step.name,...(Object.hasOwn(p,'trace')?{trace:p.trace}:{})},crypto)}catch{fail()}
 for(const k of ['schema','purpose','authority','executionAllowed','networkAllowed','integritySha256'])if(p[k]!==checked[k])fail();for(const k of ['bytes','sha256'])if(p.document[k]!==checked.document[k])fail();if(p.step.sha256!==checked.step.sha256)fail();return checked;
}
