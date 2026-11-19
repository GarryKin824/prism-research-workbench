import {createWorkflow,defaultNodes,DEFAULT_POLICY,sha256} from './custom-core.mjs';
export const EXTERNAL_PLAN_LIMIT=1024*1024;
const MAX=EXTERNAL_PLAN_LIMIT,fail=code=>{throw Error(code)},freeze=x=>{if(x&&typeof x==='object'){Object.freeze(x);for(const v of Object.values(x))freeze(v)}return x};
function validString(s){if(typeof s!=='string'||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s))fail('EXTERNAL_PLAN_TEXT');for(let i=0;i<s.length;i++){const n=s.charCodeAt(i);if(n>=0xd800&&n<=0xdbff){const b=s.charCodeAt(++i);if(!(b>=0xdc00&&b<=0xdfff))fail('EXTERNAL_PLAN_UTF16')}else if(n>=0xdc00&&n<=0xdfff)fail('EXTERNAL_PLAN_UTF16')}return s}
// Copy descriptors, never invoke accessors or inherited serializers from caller objects.
function data(input){let count=0;const seen=new Set();function walk(x,depth){if(++count>12000||depth>20)fail('EXTERNAL_PLAN_COMPLEXITY');if(x===null||typeof x==='boolean')return x;if(typeof x==='string')return validString(x);if(typeof x==='number'&&Number.isFinite(x))return x;if(!x||typeof x!=='object'||seen.has(x))fail('EXTERNAL_PLAN_DATA');const p=Object.getPrototypeOf(x);if(!Array.isArray(x)&&p!==null&&Object.getPrototypeOf(p)!==null)fail('EXTERNAL_PLAN_PROTOTYPE');seen.add(x);const out=Array.isArray(x)?[]:Object.create(null);for(const k of Reflect.ownKeys(x)){if(k==='length'&&Array.isArray(x))continue;if(typeof k!=='string'||['__proto__','prototype','constructor','toJSON'].includes(k))fail('EXTERNAL_PLAN_PROTOTYPE');if(Array.isArray(x)&&(!/^(0|[1-9]\d*)$/.test(k)||Number(k)>=x.length))fail('EXTERNAL_PLAN_DATA');const d=Object.getOwnPropertyDescriptor(x,k);if(!d||!Object.hasOwn(d,'value')||!d.enumerable)fail('EXTERNAL_PLAN_DATA');out[k]=walk(d.value,depth+1)}if(Array.isArray(x)&&Object.keys(out).length!==x.length)fail('EXTERNAL_PLAN_DATA');seen.delete(x);return out}return walk(input,0)}
const keys=(x,n)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===n.split(',').sort().join(',');
function contextOf(value){const c=data(value);if(!keys(c,'namespace,projectId,revisionSha256')||typeof c.namespace!=='string'||!c.namespace.trim()||c.namespace.length>300||typeof c.projectId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(c.projectId)||['constructor','prototype','__proto__'].includes(c.projectId)||typeof c.revisionSha256!=='string'||!/^[a-f0-9]{64}$/.test(c.revisionSha256))fail('EXTERNAL_PLAN_CONTEXT');return c}
// Strict JSON syntax plus duplicate member rejection (including escaped key spellings).
function parseJSON(raw){let i=0;function ws(){while(/[\x20\t\r\n]/.test(raw[i]||'\0'))i++}function string(){const start=i++;while(i<raw.length){const c=raw[i++];if(c==='"')return JSON.parse(raw.slice(start,i));if(c==='\\')i++}fail('EXTERNAL_PLAN_JSON')}function value(depth){if(depth>20)fail('EXTERNAL_PLAN_COMPLEXITY');ws();const c=raw[i];if(c==='"'){string();return}if(c==='{'){i++;ws();const names=new Set();if(raw[i]==='}'){i++;return}while(true){ws();if(raw[i]!=='"')fail('EXTERNAL_PLAN_JSON');const name=string();if(names.has(name))fail('EXTERNAL_PLAN_DUPLICATE_KEY');names.add(name);ws();if(raw[i++]!==':')fail('EXTERNAL_PLAN_JSON');value(depth+1);ws();const sep=raw[i++];if(sep==='}')return;if(sep!==',')fail('EXTERNAL_PLAN_JSON')}}if(c==='['){i++;ws();if(raw[i]===']'){i++;return}while(true){value(depth+1);ws();const sep=raw[i++];if(sep===']')return;if(sep!==',')fail('EXTERNAL_PLAN_JSON')}}const m=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(raw.slice(i));if(!m)fail('EXTERNAL_PLAN_JSON');i+=m[0].length}value(0);ws();if(i!==raw.length)fail('EXTERNAL_PLAN_JSON');return data(JSON.parse(raw))}
export function makeExternalPlanContract(context){const c=contextOf(context);return freeze({schema:'prism-external-plan-contract/v1',context:c,example:{schema:'prism-external-plan/v1',...c,nodes:defaultNodes(),completion:{nodeIds:['analysis'],reviewIds:['review']}},instructions:'请以此契约的 example 对象为输出格式，只返回修改后的 example 对象，不要返回外层 context/example/instructions 包装，不加 Markdown 围栏。保持 example 中的 schema、namespace、projectId、revisionSha256 原样；只修改 nodes 与 completion。节点字段为 id/name/kind/prompt/dependsOn/reviewTarget，不含 promptVersion。所有步骤、输入输出及审核标准写入 Prompt；不得加入 policy、执行状态、批准、凭据或其他字段。计划仅是未验证建议，不授权任何执行；人工校验采纳后还需单独预览确认保存模板，不自动应用论文。'})}
export async function parseExternalPlan(raw,context,beforeDefinition,crypto=globalThis.crypto){
 const c=contextOf(context);if(typeof raw!=='string'||raw.length>MAX||new TextEncoder().encode(raw).length>MAX)fail('EXTERNAL_PLAN_SIZE');validString(raw);let packet;try{packet=parseJSON(raw)}catch(e){if(e.message?.startsWith('EXTERNAL_PLAN_'))throw e;fail('EXTERNAL_PLAN_JSON')}
 if(!keys(packet,'schema,namespace,projectId,revisionSha256,nodes,completion')||packet.schema!=='prism-external-plan/v1')fail('EXTERNAL_PLAN_SCHEMA');if(['namespace','projectId','revisionSha256'].some(k=>packet[k]!==c[k]))fail('EXTERNAL_PLAN_CONTEXT_MISMATCH');
 const before=data(beforeDefinition);if(!keys(before,'nodes,policy')||JSON.stringify(before).length>MAX)fail('EXTERNAL_PLAN_BEFORE');
 const definition={nodes:packet.nodes,policy:{...DEFAULT_POLICY,checkpoints:[],completion:packet.completion}};
 // Only local graph validation; generated identity/history is deliberately discarded.
 await createWorkflow({...definition,source:null,legacy:null},crypto);
 const warnings=[{code:'EXTERNAL_UNVERIFIED',message:'外部 AI 建议未经核验。结构通过不代表科研有效、事实可靠或安全；请逐项核对所有 Prompt、依赖及完成条件。'}];
 const text=JSON.stringify(packet.nodes);if(/api[_ -]?key|password|secret|token|密钥|密码|凭据/i.test(text))warnings.push({code:'CREDENTIAL_WORDS',message:'发现凭据类词语，请核对是否包含不应外传的秘密；该提示不定位、存储或认证任何凭据。'});if(/exec(?:ute)?|shell|powershell|sudo|删除|运行命令|自动发送|自动批准/i.test(text))warnings.push({code:'ACTION_WORDS',message:'发现执行或高影响动作相关词语，请核对意图；文本不会在此执行。'});warnings.push({code:'LIMITED_KEYWORD_HINTS',message:'关键词提示仅覆盖少量模式，可能误报或漏报，不是安全扫描；没有额外命中也不表示安全。'});
 return freeze({schema:'prism-external-plan-preview/v1',context:c,rawSha256:await sha256(raw,crypto),beforeSha256:await sha256(JSON.stringify(before),crypto),definition,diff:{before,after:definition},warnings,authority:'none',executionAllowed:false});
}

// Portable manual materials, not a plan, authorization, preview token or proof of provenance.
// Historical receipt remains opaque text and is never parsed into an adoption operation.
export const EXTERNAL_PLAN_MATERIALS_LIMIT=3*1024*1024;
function materialsOf(value){
 const p=data(value);
 if(!keys(p,'schema,context,raw,receiptRaw,authority')||p.schema!=='prism-external-plan-materials/v1'||p.authority!=='none')fail('EXTERNAL_PLAN_MATERIALS_SCHEMA');
 const context=contextOf(p.context);
 if(typeof p.raw!=='string'||new TextEncoder().encode(p.raw).length>EXTERNAL_PLAN_LIMIT)fail('EXTERNAL_PLAN_MATERIALS_RAW_LIMIT');
 if(p.receiptRaw!==null&&(typeof p.receiptRaw!=='string'||new TextEncoder().encode(p.receiptRaw).length>EXTERNAL_PLAN_LIMIT))fail('EXTERNAL_PLAN_MATERIALS_RECEIPT_LIMIT');
 const packet={schema:p.schema,context,raw:p.raw,receiptRaw:p.receiptRaw,authority:'none'};
 if(new TextEncoder().encode(JSON.stringify(packet)).length>EXTERNAL_PLAN_MATERIALS_LIMIT)fail('EXTERNAL_PLAN_MATERIALS_SIZE');
 return freeze(packet);
}
export function createExternalPlanMaterials({context,raw,receiptRaw=null}){
 return JSON.stringify(materialsOf({schema:'prism-external-plan-materials/v1',context,raw,receiptRaw,authority:'none'}));
}
export function parseExternalPlanMaterials(raw){
 if(typeof raw!=='string'||new TextEncoder().encode(raw).length>EXTERNAL_PLAN_MATERIALS_LIMIT)fail('EXTERNAL_PLAN_MATERIALS_SIZE');
 validString(raw);return materialsOf(parseJSON(raw));
}
export function matchExternalPlanMaterials(packet,currentContext){
 const p=materialsOf(packet),c=contextOf(currentContext);
 if(['namespace','projectId','revisionSha256'].some(k=>p.context[k]!==c[k]))fail('EXTERNAL_PLAN_MATERIALS_CONTEXT_MISMATCH');
 // Return only original text. Caller must preserve its full editor snapshot through
 // async boundaries and obtain separate replacement consent. Existing parse/adopt
 // and independent template-save confirmation remain mandatory.
 return p.raw;
}
