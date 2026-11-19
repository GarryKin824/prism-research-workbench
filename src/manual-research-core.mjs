import {manualPreparationBase,manualStepInputText,isManualStepInput,MANUAL_MULTI_WORK_STEP_INPUT_SCHEMA,MANUAL_MULTI_STEP_INPUT_SCHEMA,MANUAL_MULTI_STEP_INPUT_MAX_BYTES} from './manual-step-input-format.mjs';
import {manualHandoffHeader,inspectManualReplyCorrelation,assertManualReplyCorrelation} from './manual-handoff-correlation.mjs';
// One pending clipboard write across this loaded workbench module, including context switches.
export const manualResearchClipboardGate={busy:false};
export function manualResearchText(prepared){
 if(isManualStepInput(prepared))return manualStepInputText(prepared);
 if(prepared?.schema!=='prism-local-preparation-v1'||prepared.authority!=='none'||prepared.executionAllowed!==false||prepared.networkAllowed!==false||typeof prepared.document?.text!=='string'||typeof prepared.step?.prompt!=='string'||!(/^[a-f0-9]{64}$/).test(prepared.integritySha256))throw Error('需要已预览的本地准备快照');
 return `研究任务（由用户手动提交）\n步骤：${prepared.step.name}\n\nPrompt：\n${prepared.step.prompt}\n\n论文：${prepared.document.filename}\n正文开始\n${prepared.document.text}\n正文结束\n\n请区分原文证据、推断与未核验内容。`;
}
// Explicitly new outbound previews only; archived v1 formatter semantics remain unchanged.
export function manualResearchOutboundText(prepared){const material=manualResearchText(prepared),text=manualHandoffHeader(prepared)+'\n\n'+material;if([MANUAL_MULTI_STEP_INPUT_SCHEMA,MANUAL_MULTI_WORK_STEP_INPUT_SCHEMA].includes(prepared?.schema)&&new TextEncoder().encode(text).length>MANUAL_MULTI_STEP_INPUT_MAX_BYTES)throw Error('STEP_INPUT_INVALID_OR_TOO_LARGE');return text}
export function manualResearchReplyCorrelation(content,expectedBinding){return inspectManualReplyCorrelation(content,expectedBinding)}
export function assertManualResearchReplyCorrelation(content,expectedBinding){return assertManualReplyCorrelation(content,expectedBinding)}
export function manualResearchRecord(prepared,id,origin=null){const snapshot=JSON.parse(JSON.stringify(prepared));manualResearchText(snapshot);if(isManualStepInput(snapshot)&&(!origin||['namespace','projectId','paperId','paperTitle'].some(k=>origin[k]!==snapshot.origin[k])))throw Error('组合交接来源与当前归属不一致');return {id,...(origin?{origin:manualResearchOrigin(origin)}:{}),binding:snapshot.integritySha256,prepared:snapshot,clipboard:'pending',sending:'not_reported',authority:'none',platformVerified:false,researchAccepted:false,replies:[]};}
export function manualResearchReply(content,id){if(typeof content!=='string'||!content.trim()||content.length>64000)throw Error('答复为空或超过 64000 字符');return {id,content,source:'user_pasted',verification:'unverified',researchAccepted:false};}

export function manualResearchOrigin(origin){const out={};for(const k of ['namespace','projectId','paperId','paperTitle']){if(typeof origin?.[k]!=='string'||origin[k].length>512)throw Error('工作台归属无效或过长');out[k]=origin[k]}return out;}

export function manualReplyDraftText(record,content){if(!record?.id||!(/^[a-f0-9]{64}$/).test(record.binding)||typeof content!=='string'||!content.length||content.length>64000)throw Error('请选择非空且不超过 64000 字符的草稿');return 'PRISM 未提交答复草稿 · 未验证 · 仅供人工保管（不可执行）\n元数据：'+JSON.stringify({recordId:record.id,binding:record.binding,filename:manualPreparationBase(record.prepared).document.filename,origin:record.origin||null})+'\n此文件不含正文或 Prompt，不是已验收研究成果。\n草稿开始\n'+content+'\n草稿结束\n';}
