import { canonicalWorkbenchModelInput, canonicalWorkbenchReply, workbenchModelHash } from './workbench-model-contract.mjs';

import {applyOutputRequirements,currentOutputRequirements,outputRequirementsAt,outputRequirementsPrefix,validateOutputRequirements} from './flow-output-requirements.mjs';
import {executionSessionId} from './execution-targets.mjs';

export * from './workbench-model-contract.mjs';

const prefix = 'prism-native-profile-v1:';
const schema = 'prism-workbench-model-executions/v1';
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === keys.split(',').sort().join(',');
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const terminal = ['returned', 'failed', 'cancelled', 'refused'];
const unresolved = ['pending', 'unknown'];
const bytes = value => new TextEncoder().encode(value).length;
const maxBytes = 2 * 1024 * 1024;

export function canonicalNativeProgress(value) {
  if (!exact(value,'phase,sessionId,turnId,partial') || !['accepted','running','unknown','failed','cancelled','returned'].includes(value.phase)
      || value.sessionId!==null&&!executionSessionId(value.sessionId) || value.turnId!==null&&(!value.sessionId||!executionSessionId(value.turnId))
      || value.partial!==null&&(typeof value.partial!=='string'||value.partial.length>16000)
      || ['running','returned'].includes(value.phase)&&!value.turnId) throw Error('MODEL_NATIVE_PROGRESS');
  return {phase:value.phase,sessionId:value.sessionId,turnId:value.turnId,partial:value.partial};
}

export const WORKBENCH_EXECUTION_STORE = 'workbench-model-executions-v1';
export const workbenchExecutionKey = (namespace, projectId) => namespace + ':' + WORKBENCH_EXECUTION_STORE + ':' + JSON.stringify(projectId);

export const WORKBENCH_RECOVERY_SCHEMA = 'prism-automatic-receipt-key/v1';
export function readWorkbenchRecoveryKey(raw, namespace, target) {
  if (typeof raw !== 'string' || bytes(raw) > 64000) throw Error('MODEL_RECOVERY_KEY');
  const key = JSON.parse(raw);
  const hasContext=Object.hasOwn(key??{},'context');
  if (!exact(key, hasContext?'schema,input,context':'schema,input') || key.schema !== WORKBENCH_RECOVERY_SCHEMA) throw Error('MODEL_RECOVERY_KEY');
  const input = canonicalWorkbenchModelInput(key.input, namespace);
  if (input.execution?.channel !== 'automatic' || !same(input.target, target)) throw Error('MODEL_EXECUTION_SOURCE_CHANGED');
  if (hasContext) {
    const c=key.context;
    if (!exact(c,'includeDocument,range,requirementsVersion') || typeof c.includeDocument!=='boolean'
        || !Number.isSafeInteger(c.requirementsVersion) || c.requirementsVersion<0) throw Error('MODEL_RECOVERY_KEY');
    validateBasis({range:c.range,upstream:[],revision:null},c.includeDocument);
  }
  return {input,context:key.context??null};
}

export function makeWorkbenchRecoveryKey(row) {
  return {schema:WORKBENCH_RECOVERY_SCHEMA,input:row.input,...(row.outputRequirements?{context:{
    includeDocument:row.includeDocument,range:row.basis?.range??null,requirementsVersion:row.outputRequirements.version,
  }}:{})};
}

export function describeWorkbenchPdfRange(basis, pdfText) {
  const range=basis?.range;
  if(!range||!Array.isArray(pdfText?.pageSpans))return [];
  return pdfText.pageSpans.filter(span=>Math.min(span.end,range.end)>Math.max(span.start,range.start)).map(span=>span.page);
}

export function nextGuidedStep(nodes, rows, id, committedId) {
  const index=nodes.findIndex(node=>node.id===id);
  const step=rows?.[id];
  if(index<0||!step)return null;
  const review=nodes[index].kind==='review';
  const complete=review?step.judgment?.decision==='approved':
    step.value&&!step.stale&&!step.revision&&!step.outstandingResult&&!step.uncertain;
  if(!complete)return null;
  if(committedId){
    const saved=review?step.judgment:step.value;
    if(saved?.id!==committedId||saved.execution?.reply.finish==='max-tokens'
        ||review&&nodes[index].dependsOn.some(id=>rows[id]?.value?.execution?.reply.finish==='max-tokens'))return null;
  }
  const next=nodes.slice(index+1).find(node=>{
    const candidate=rows[node.id];
    return candidate&&!candidate.blocked.length&&(!candidate.value&&!candidate.judgment
      ||candidate.revision||candidate.stale||candidate.uncertain);
  });
  if(committedId&&next){
    const candidate=rows[next.id];
    if(candidate.outstandingResult||candidate.uncertain||candidate.stale||candidate.revision
        ||['failed','cancelled','refused'].includes(candidate.attempt?.state))return null;
  }
  return next??null;
}

function validReference(value) {
  return exact(value, 'id,sha256,nodeId,text') && typeof value.id === 'string'
    && value.id.length > 0 && value.id.length <= 200 && hash(value.sha256)
    && typeof value.nodeId === 'string' && value.nodeId.length <= 200
    && typeof value.text === 'string' && value.text.length <= 32000;
}

function validateBasis(basis, includeDocument) {
  if (!exact(basis, 'range,upstream,revision') || !Array.isArray(basis.upstream)
      || basis.upstream.length > 29 || new Set(basis.upstream.map(x=>x?.nodeId)).size !== basis.upstream.length
      || !basis.upstream.every(validReference)) throw Error('MODEL_BASIS_INVALID');
  if (basis.range !== null && (!includeDocument || !exact(basis.range, 'start,end')
      || !Number.isSafeInteger(basis.range.start) || !Number.isSafeInteger(basis.range.end)
      || basis.range.start < 0 || basis.range.end <= basis.range.start)) throw Error('MODEL_SOURCE_RANGE');
  if (basis.revision !== null && (!exact(basis.revision,'original,review')
      || !validReference(basis.revision.original) || !validReference(basis.revision.review))) {
    throw Error('MODEL_REVISION_INVALID');
  }
}

export function workbenchEvidenceText(documentText, range) {
  if (typeof documentText !== 'string') throw Error('MODEL_SOURCE_RANGE');
  if (range === null || range === undefined) return documentText;
  if (range.end > documentText.length) throw Error('MODEL_SOURCE_RANGE');
  const insidePair = i => /[\uD800-\uDBFF]/.test(documentText[i-1] ?? '') && /[\uDC00-\uDFFF]/.test(documentText[i] ?? '');
  if (insidePair(range.start) || insidePair(range.end)) throw Error('MODEL_SOURCE_RANGE');
  const text = documentText.slice(range.start,range.end);
  if (!text.trim()) throw Error('MODEL_SOURCE_RANGE');
  return text;
}

export function workbenchResultInputSource({record, sourcePaperRaw, requirements}) {
  const {execution,binding}=record;
  const paper=JSON.parse(sourcePaperRaw);
  if(!execution||execution.mode!=='step'||paper.id!==binding.target.paperId)throw Error('MODEL_EXECUTION_SOURCE_CHANGED');
  assertWorkbenchExecutionSource(execution,{
    target:binding.target,sourceSha256:binding.sourceSha256,projectRevisionSha256:binding.projectRevisionSha256,
    promptSha256:binding.promptSha256,promptVersion:execution.promptVersion,prompt:record.prompt,
    documentSha256:paper.document?.sha256??null,documentText:paper.document?.text,outputRequirementsHistory:requirements,
  });
  if(!execution.includeDocument)return {paper,fragment:null,pages:[]};
  const document=paper.document;
  const range=execution.basis?.range??{start:0,end:document.text.length};
  return {paper,fragment:{
    id:execution.input.requestId,quote:workbenchEvidenceText(document.text,range),
    source:{filename:document.filename,sha256:document.sha256,...range},
  },pages:describeWorkbenchPdfRange({range},document.pdfText)};
}

export function composeWorkbenchStepText(prompt, documentText, includeDocument, basis) {
  if (basis) validateBasis(basis,includeDocument);
  let result = prompt;
  if (basis?.upstream.length) {
    result += '\n\n--- 已保存的上游材料（供核对） ---\n' + JSON.stringify(basis.upstream.map(({nodeId,text})=>({step:nodeId,text})));
  }
  if (basis?.revision) {
    result += '\n\n--- 人工退回后的返修 ---\n' + JSON.stringify({
      original:basis.revision.original.text, instruction:basis.revision.review.text,
    });
  }
  if (includeDocument) {
    result += basis?.range ? '\n\n--- 论文正文片段（仅此范围） ---\n' : '\n\n--- 论文正文 ---\n';
    result += workbenchEvidenceText(documentText,basis?.range);
  }
  return result;
}

export function composeWorkbenchReviewText(prompt, documentText, includeDocument, basis) {
  return '仅提供辅助复核建议。列出可核对的证据、依据不足之处和具体返修建议。仅依据本请求材料，不编造出处或页码。正式审核决定由研究者另行填写。\n\n'
    +composeWorkbenchStepText(prompt,documentText,includeDocument,basis);
}

export const workbenchReference = (row, review = false) => ({
  id:row.id,sha256:row.sha256,nodeId:row.binding.target.nodeId,
  text:review ? row.reason : row.text,
});

export const sameWorkbenchVersion = (a,b) => ['namespace','projectId','paperId','instanceId','workflowSha256',
  'graphVersion','graphSha256'].every(key=>a?.[key]===b?.[key]);

export function assertWorkbenchExecutionReferences(record, results, reviews, node) {
  const {basis,input:{target}}=record;
  if (!basis) return;
  const lookup = (ref, rows, review = false) => {
    const row = rows.find(entry=>entry.id===ref.id);
    if (!row || !sameWorkbenchVersion(target,row.binding.target) || !same(ref,workbenchReference(row,review))) {
      throw Error('MODEL_MATERIAL_SOURCE_CHANGED');
    }
    return row;
  };
  if (basis.upstream.length !== node.dependsOn.length
      || basis.upstream.some(ref=>!node.dependsOn.includes(ref.nodeId))) throw Error('MODEL_MATERIAL_SOURCE_CHANGED');
  for (const ref of basis.upstream) {
    if (results.some(row=>row.id===ref.id)) {
      if(lookup(ref,results).execution?.reply.finish==='max-tokens'&&record.mode!=='review') throw Error('MODEL_MATERIAL_SOURCE_CHANGED');
    } else if (lookup(ref,reviews,true).decision!=='approved') throw Error('MODEL_MATERIAL_SOURCE_CHANGED');
  }
  if (basis.revision) {
    const original=lookup(basis.revision.original,results);
    const decision=lookup(basis.revision.review,reviews,true);
    if (original.binding.target.nodeId!==target.nodeId || decision.decision!=='returned'
        || decision.binding.reviewTarget!==target.nodeId || !decision.upstream.some(row=>row.sha256===original.sha256)) {
      throw Error('MODEL_REVISION_SOURCE_CHANGED');
    }
  }
}

export async function createWorkbenchExecution(input, checked, mode, includeDocument, crypto = globalThis.crypto, basis = null, requirementsVersion) {
  const document = JSON.parse(checked.instance.sourcePaperRaw).document;
  const originalPromptSha256 = await workbenchModelHash(checked.node.prompt, crypto);
  const inputSha256 = await workbenchModelHash(JSON.stringify(input), crypto);
  const outputRequirements=requirementsVersion===undefined?currentOutputRequirements(checked.instance):
    outputRequirementsAt(checked.instance.outputRequirements,requirementsVersion);
  if(!outputRequirements)throw Error('MODEL_OUTPUT_REQUIREMENTS_HISTORY_CHANGED');
  const record = {
    input, inputSha256, mode, includeDocument,
    originalPromptSha256, promptVersion: checked.node.promptVersion,
    documentSha256: document?.sha256 ?? null, projectRevisionSha256: checked.instance.projectRevisionSha256,
    state: 'pending', reply: null, code: null, ...(basis ? {basis} : {}),
    outputRequirements,
    ...(input.execution?.channel==='manual'?{createdUtc:new Date().toISOString()}:{}),
  };
  await validateWorkbenchExecution(record, input.target.namespace, input.target.projectId, crypto);
  checked.verify();
  return record;
}

export async function validateWorkbenchExecution(record, namespace, projectId, crypto = globalThis.crypto) {
  const hasBasis=Object.hasOwn(record??{},'basis');
  const hasRequirements=Object.hasOwn(record??{},'outputRequirements');
  const manuallyHandedOff=record?.input?.execution?.channel==='manual';
  const hasNative=Object.hasOwn(record??{},'native');
  const role=record?.input?.execution?.role;
  const date=text=>typeof text==='string'&&text.length===24&&Number.isFinite(Date.parse(text))&&new Date(text).toISOString()===text;
  if (!exact(record, 'input,inputSha256,mode,includeDocument,originalPromptSha256,promptVersion,documentSha256,projectRevisionSha256,state,reply,code'+(hasBasis?',basis':'')+(hasRequirements?',outputRequirements':'')+(manuallyHandedOff?',createdUtc':'')+(hasNative?',native':''))
      || typeof namespace !== 'string' || !namespace.startsWith(prefix)
      || !['step','discussion','plan','review'].includes(record.mode) || hasBasis&&!['step','review'].includes(record.mode)
      || typeof record.includeDocument !== 'boolean'
      || (role!==undefined ? role!==({step:record.basis?.revision?'revision':'work',discussion:'prompt',plan:'plan',review:'review'})[record.mode] : record.mode==='review')
      || record.mode==='review'&&(!hasBasis||record.basis?.revision!==null)
      || manuallyHandedOff&&(!date(record.createdUtc)||record.state==='returned'&&record.reply?.startedUtc!==record.createdUtc)
      || record.includeDocument && (!['step','review'].includes(record.mode) || !hash(record.documentSha256))
      || (record.documentSha256 !== null && !hash(record.documentSha256))
      || !hash(record.originalPromptSha256) || !hash(record.projectRevisionSha256)
      || !Number.isSafeInteger(record.promptVersion) || record.promptVersion < 1
      || ![...unresolved, ...terminal].includes(record.state)
      || (record.code !== null && (typeof record.code !== 'string' || !/^[A-Z0-9_]{1,64}$/.test(record.code)))) {
    throw Error('MODEL_EXECUTION_RECORD');
  }
  if(hasBasis)validateBasis(record.basis,record.includeDocument);
  if(hasRequirements)validateOutputRequirements(record.outputRequirements);
  if(hasNative){
    const native=canonicalNativeProgress(record.native);
    if(record.input.execution?.channel!=='automatic'||!same(native,record.native)
        || record.reply&&(native.sessionId!==record.reply.externalSessionId||native.turnId!==record.reply.externalTurnId))throw Error('MODEL_NATIVE_PROGRESS');
  }
  const requirementsPrefix=outputRequirementsPrefix(record.outputRequirements);
  const input = canonicalWorkbenchModelInput(record.input, namespace.slice(prefix.length));
  if (input.target.projectId !== projectId || !same(input, record.input)
      || await workbenchModelHash(JSON.stringify(input), crypto) !== record.inputSha256
      || await workbenchModelHash(input.text, crypto) !== input.promptSha256
      || !input.text.startsWith(requirementsPrefix)
      || (record.mode === 'step' && !record.includeDocument && !hasBasis
        && await workbenchModelHash(input.text.slice(requirementsPrefix.length),crypto) !== record.originalPromptSha256)
      || (record.state === 'returned' ? !same(canonicalWorkbenchReply(input, record.inputSha256, record.reply), record.reply) : record.reply !== null)) {
    throw Error('MODEL_EXECUTION_BINDING');
  }
  return record;
}

export function assertWorkbenchExecutionSource(record, { target, sourceSha256, projectRevisionSha256, promptSha256, promptVersion, documentSha256, prompt, documentText, outputRequirementsHistory }) {
  const used=record.outputRequirements;
  if(used){
    const archived=outputRequirementsAt(outputRequirementsHistory,used.version);
    if(!archived||archived.text!==used.text)throw Error('MODEL_OUTPUT_REQUIREMENTS_HISTORY_CHANGED');
  }
  const compose=record.mode==='step'?composeWorkbenchStepText:record.mode==='review'?composeWorkbenchReviewText:null;
  const expected=compose ? applyOutputRequirements(compose(prompt,documentText,record.includeDocument,record.basis),used) : null;
  if (!same(record.input.target, target) || record.input.sourceSha256 !== sourceSha256
      || record.projectRevisionSha256 !== projectRevisionSha256 || record.originalPromptSha256 !== promptSha256
      || record.promptVersion !== promptVersion || record.documentSha256 !== documentSha256
      || (compose && (record.includeDocument && typeof documentText !== 'string' || record.input.text !== expected))) {
    throw Error('MODEL_EXECUTION_SOURCE_CHANGED');
  }
}

export function manualWorkbenchReply(record,{answer,externalSessionId='',totalTokens='',partial=false},now=new Date().toISOString()) {
  const {input,inputSha256,createdUtc}=record;
  if (input.execution?.channel!=='manual'||!unresolved.includes(record.state)
      || typeof externalSessionId!=='string'||externalSessionId!==''&&!executionSessionId(externalSessionId)
      || typeof totalTokens!=='string'||totalTokens!==''&&!/^\d{1,9}$/.test(totalTokens)) throw Error('MANUAL_REPLY_INVALID');
  const {platform,channel,provider,model}=input.execution;
  return canonicalWorkbenchReply(input,inputSha256,{
    requestId:input.requestId,target:input.target,sourceSha256:input.sourceSha256,promptSha256:input.promptSha256,
    inputSha256,route:{platform,channel,provider,model},execution:input.execution,externalSessionId:externalSessionId||null,
    startedUtc:createdUtc,finishedUtc:now,answer,finish:partial?'max-tokens':'stop',
    usage:totalTokens===''?null:{totalTokens:Number(totalTokens)},
  });
}

export async function readWorkbenchExecutions(raw, namespace, projectId, crypto = globalThis.crypto) {
  if (raw === null) return { schema, namespace, projectId, records: [] };
  if (typeof raw !== 'string' || bytes(raw) > maxBytes) throw Error('MODEL_EXECUTION_LIMIT');
  const value = JSON.parse(raw);
  if (!exact(value, 'schema,namespace,projectId,records') || value.schema !== schema || value.namespace !== namespace
      || value.projectId !== projectId || !Array.isArray(value.records)) throw Error('MODEL_EXECUTION_SCHEMA');
  const ids = new Set();
  for (const record of value.records) {
    await validateWorkbenchExecution(record, namespace, projectId, crypto);
    if (ids.has(record.input.requestId)) throw Error('MODEL_EXECUTION_DUPLICATE');
    ids.add(record.input.requestId);
  }
  return value;
}

export function sameWorkbenchStep(a, b) {
  return ['namespace','projectId','paperId','instanceId','nodeId'].every(key => a[key] === b[key]);
}

export function createWorkbenchExecutionLedger({ storage, namespace, projectId, withLock, crypto = globalThis.crypto }) {
  const key = workbenchExecutionKey(namespace, projectId);
  async function read() {
    const raw = storage.getItem(key);
    const value = await readWorkbenchExecutions(raw, namespace, projectId, crypto);
    if (storage.getItem(key) !== raw) throw Error('MODEL_EXECUTION_CHANGED');
    return { raw, value };
  }
  function write(change, verify = () => {}) {
    if (typeof withLock !== 'function') throw Error('MODEL_EXECUTION_LOCK_REQUIRED');
    return withLock(key + ':write', async () => {
      const { raw, value } = await read();
      const result = change(value.records);
      const next = JSON.stringify(value);
      await readWorkbenchExecutions(next, namespace, projectId, crypto);
      verify();
      if (storage.getItem(key) !== raw) throw Error('MODEL_EXECUTION_CHANGED');
      if (next !== raw) storage.setItem(key, next);
      if (storage.getItem(key) !== next) throw Error('MODEL_EXECUTION_SAVE_UNCERTAIN');
      return result;
    });
  }
  return {
    key,
    async list() { return (await read()).value.records; },
    begin(record, verify) {
      return write(records => {
        if (record.state !== 'pending' || records.some(row => row.input.requestId === record.input.requestId
            || unresolved.includes(row.state) && sameWorkbenchStep(row.input.target, record.input.target))) {
          throw Error('MODEL_EXECUTION_CHECK_FIRST');
        }
        records.push(record);
        return record;
      }, verify);
    },
    recoverReturned(record, result, verify) {
      return write(records => {
        if (record.state !== 'pending' || record.input.execution?.channel !== 'automatic' || result.state !== 'returned'
            || result.reply?.finish !== 'stop') {
          throw Error('MODEL_RECOVERY_NOT_COMPLETE');
        }
        const reply = canonicalWorkbenchReply(record.input, record.inputSha256, result.reply);
        const native = canonicalNativeProgress(result.native);
        if (native.phase !== 'returned' || native.sessionId !== reply.externalSessionId || native.turnId !== reply.externalTurnId) {
          throw Error('MODEL_NATIVE_PROGRESS');
        }
        const existing = records.find(row => row.input.requestId === record.input.requestId);
        if (existing) {
          if (existing.state === 'returned' && existing.inputSha256 === record.inputSha256 && same(existing.reply, reply)) return existing;
          throw Error('MODEL_EXECUTION_CHECK_FIRST');
        }
        if (records.some(row => unresolved.includes(row.state) && sameWorkbenchStep(row.input.target, record.input.target))) {
          throw Error('MODEL_EXECUTION_CHECK_FIRST');
        }
        const saved = { ...record, state: 'returned', reply, native };
        records.push(saved);
        return saved;
      }, verify);
    },
    settle(requestId, result, verify) {
      return write(records => {
        const index = records.findIndex(row => row.input.requestId === requestId);
        const prior = records[index];
        if (!prior) throw Error('MODEL_EXECUTION_MISSING');
        if (terminal.includes(prior.state)) return prior;
        const state = result.state;
        const reply = state === 'returned' ? canonicalWorkbenchReply(prior.input, prior.inputSha256, result.reply) : null;
        const native=result.native?canonicalNativeProgress(result.native):prior.native;
        if(prior.native&&(prior.native.sessionId&&native?.sessionId!==prior.native.sessionId
            ||prior.native.turnId&&native?.turnId!==prior.native.turnId))throw Error('MODEL_NATIVE_PROGRESS');
        const changed = { ...prior, state, reply, code: result.code ?? null, ...(native?{native}:{}) };
        records[index] = changed;
        return changed;
      },verify);
    },
  };
}
