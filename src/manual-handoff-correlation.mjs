// Pure material-routing hints. No I/O, platform identity, conversation registry or authority.
export const MANUAL_REPLY_CORRELATION_MAX_CHARS=64000;
const manualCorrelationHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const manualReplyHeaderCandidate=line=>/^PRISM-Reply-To\b/i.test(line.trimStart());

/** Only the leading header block is inspected. Quoted/buried markers are reply material. */
export function inspectManualReplyCorrelation(content,expectedBinding){
 if(!manualCorrelationHash(expectedBinding))throw Error('MANUAL_REPLY_BINDING_INVALID');
 if(typeof content!=='string'||content.length>MANUAL_REPLY_CORRELATION_MAX_CHARS)return {state:'malformed',expectedBinding,replyBinding:null,allowed:false,authority:'none',platformVerified:false};
 // Inspection never rewrites the caller's reply bytes. A single leading BOM is transport trivia.
 const lines=(content.startsWith('\ufeff')?content.slice(1):content).split(/\r\n|\n|\r/);
 let start=0;while(start<lines.length&&!lines[start].trim())start++;
 let state='missing',replyBinding=null;
 if(start<lines.length&&manualReplyHeaderCandidate(lines[start])){
  let headers=1;
  // Blank separators do not hide duplicate leading headers. Stop at actual body/quoted text.
  for(let end=start+1;end<lines.length;end++){if(!lines[end].trim())continue;if(manualReplyHeaderCandidate(lines[end]))headers++;else break}
  const match=/^PRISM-Reply-To: ([a-f0-9]{64})$/.exec(lines[start]);
  if(headers>1)state='ambiguous';
  else if(!match)state='malformed';
  else{replyBinding=match[1];state=replyBinding===expectedBinding?'matching':'mismatch'}
 }
 return {state,expectedBinding,replyBinding,allowed:state==='matching'||state==='missing',authority:'none',platformVerified:false};
}

/** Missing legacy headers remain usable but uncorrelated. Explicit bad routing never does. */
export function assertManualReplyCorrelation(content,expectedBinding){
 const result=inspectManualReplyCorrelation(content,expectedBinding);
 if(!result.allowed)throw Error('MANUAL_REPLY_CORRELATION_'+result.state.toUpperCase());
 return result;
}

/** New outbound presentation only. Never infer that a v1 archived copy included this header. */
export function manualHandoffHeader(prepared){
 const stepInput=['prism-manual-step-input-v1','prism-manual-step-input-v2','prism-manual-step-input-v3'].includes(prepared?.schema),base=stepInput?prepared.base:prepared,trace=base?.trace;
 if(!['prism-local-preparation-v1','prism-manual-step-input-v1','prism-manual-step-input-v2','prism-manual-step-input-v3'].includes(prepared?.schema)||!manualCorrelationHash(prepared.integritySha256)||!manualCorrelationHash(base?.step?.sha256))throw Error('MANUAL_HANDOFF_BINDING_INVALID');
 const identity={kind:stepInput?'step_input':'initial',promptSha256:base.step.sha256};
 if(trace?.stepOrigin==='custom_graph'){
  if(typeof trace.nodeId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(trace.nodeId)||!Number.isSafeInteger(trace.graphVersion)||trace.graphVersion<1||!manualCorrelationHash(trace.graphSha256))throw Error('MANUAL_HANDOFF_IDENTITY_INVALID');
  Object.assign(identity,{nodeId:trace.nodeId,graphVersion:trace.graphVersion,graphSha256:trace.graphSha256});
 }
 if(Number.isSafeInteger(trace?.stepIndex)&&trace.stepIndex>=0&&trace.stepIndex<3)identity.stepIndex=trace.stepIndex;
 if(Number.isSafeInteger(trace?.promptVersion)&&trace.promptVersion>=1)identity.promptVersion=trace.promptVersion;
 return `PRISM 手动交接关联信息\nPRISM-Preparation: ${prepared.integritySha256}\nPRISM-Target: ${JSON.stringify(identity)}\n请将以下一行原样作为答复的首个非空行，随后另起一行写答复：\nPRISM-Reply-To: ${prepared.integritySha256}\n这是人工复制交接，未连接平台；平台及会话身份均未验证。标记只帮助核对准备材料，不认证答复来源、会话身份或研究正确性，不代表审核通过。相同准备绑定可能用于不同项目或会话，不能据此区分它们。\n以下为人工审阅的材料与 Prompt：`;
}
