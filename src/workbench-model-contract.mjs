import {canonicalExecutionChoice, executionSessionId} from './execution-targets.mjs';

export const WORKBENCH_MODEL_PATH = '/api/prism-node-model';
export const WORKBENCH_MODEL_STATUS_PATH = '/api/prism-node-model-status';
export const WORKBENCH_MODEL_RECEIPT_PATH = '/api/prism-node-model-receipt';
export const WORKBENCH_MODEL_ROUTE = Object.freeze({
  provider: 'deepseek-account',
  model: 'deepseek-flash',
  reasoningEffort: 'off',
  maxTokens: 512,
});
export const WORKBENCH_MODEL_BODY_LIMIT = 64000;
export const WORKBENCH_MODEL_TEXT_LIMIT = 24000;
export const WORKBENCH_MODEL_OUTPUT_LIMIT = 16000;
export const WORKBENCH_MODEL_USAGE_FIELDS = ['inputTokens', 'outputTokens', 'totalTokens',
  'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'];
const targetNames = ['namespace', 'projectId', 'paperId', 'instanceId', 'workflowSha256', 'graphVersion', 'graphSha256', 'nodeId'];
const sha = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_:.@-]{1,200}$/.test(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, names) => plain(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));

export async function workbenchModelHash(value, crypto = globalThis.crypto) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function canonicalWorkbenchModelInput(value, namespace) {
  const hasExecution=Object.hasOwn(value??{},'execution');
  if (!exact(value, ['requestId', 'target', 'sourceSha256', 'promptSha256', 'text',...(hasExecution?['execution']:[])])
      || !uuid(value.requestId) || !sha(value.sourceSha256) || !sha(value.promptSha256)
      || !exact(value.target, targetNames) || !uuid(namespace) || value.target.namespace !== 'prism-native-profile-v1:' + namespace
      || !targetNames.filter(name => !['namespace', 'graphVersion', 'graphSha256', 'workflowSha256'].includes(name))
        .every(name => id(value.target[name]))
      || !Number.isSafeInteger(value.target.graphVersion) || value.target.graphVersion < 1
      || !sha(value.target.graphSha256) || !sha(value.target.workflowSha256)
      || typeof value.text !== 'string' || !value.text.trim()
      || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(value.text)
      || new TextEncoder().encode(value.text).length > WORKBENCH_MODEL_TEXT_LIMIT) {
    throw Error('MODEL_INPUT_INVALID');
  }
  return {
    requestId: value.requestId,
    target: Object.fromEntries(targetNames.map(name => [name, value.target[name]])),
    sourceSha256: value.sourceSha256,
    promptSha256: value.promptSha256,
    text: value.text,
    ...(hasExecution?{execution:canonicalExecutionChoice(value.execution)}:{}),
  };
}

export async function makeWorkbenchModelInput(target, checked, namespace, crypto = globalThis.crypto, text = checked.node.prompt, execution) {
  const body = canonicalWorkbenchModelInput({
    requestId: crypto.randomUUID(),
    target,
    sourceSha256: checked.instance.sourceSha256,
    promptSha256: await workbenchModelHash(text, crypto),
    text,
    ...(execution?{execution}:{}),
  }, namespace);
  if (checked.node.kind !== (execution?.role==='review'?'review':'work')) throw Error('MODEL_WORK_NODE_REQUIRED');
  checked.verify();
  return body;
}

export function canonicalWorkbenchReceiptSelector(value) {
  if (!exact(value, ['requestId', 'inputSha256']) || !uuid(value.requestId) || !sha(value.inputSha256)) {
    throw Error('MODEL_RECEIPT_SELECTOR');
  }
  return { requestId: value.requestId, inputSha256: value.inputSha256 };
}

export function canonicalWorkbenchReply(input, inputSha256, value) {
  const manual=input.execution?.channel==='manual';
  const automatic=input.execution?.channel==='automatic';
  const {platform,channel,provider,model}=input.execution??{};
  const route=manual||automatic?{platform,channel,provider,model}:WORKBENCH_MODEL_ROUTE;
  const hasExecution=Object.hasOwn(input,'execution');
  const allowed = ['requestId','target','sourceSha256','promptSha256','inputSha256','route',
    'startedUtc','finishedUtc','finish','usage','answer',...(manual||automatic?['externalSessionId']:[]),
    ...(automatic?['externalTurnId','finishReason']:[]),...(hasExecution?['execution']:[])];
  const date = text => typeof text === 'string' && text.length === 24 && Number.isFinite(Date.parse(text))
    && new Date(text).toISOString() === text;
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))
      || value.inputSha256 !== inputSha256 || value.requestId !== input.requestId
      || value.sourceSha256 !== input.sourceSha256 || value.promptSha256 !== input.promptSha256
      || JSON.stringify(value.target) !== JSON.stringify(input.target)
      || JSON.stringify(value.route) !== JSON.stringify(route)
      || hasExecution&&JSON.stringify(value.execution)!==JSON.stringify(input.execution)
      || manual&&!(value.externalSessionId===null||executionSessionId(value.externalSessionId))
      || automatic&&(!executionSessionId(value.externalSessionId)||!executionSessionId(value.externalTurnId)
        || !['completed','prism-output-limit','model-output-limit'].includes(value.finishReason)
        || (value.finishReason==='completed')!==(value.finish==='stop'))
      || !date(value.startedUtc) || !date(value.finishedUtc) || value.finishedUtc < value.startedUtc
      || !['stop', 'max-tokens'].includes(value.finish)
      || typeof value.answer !== 'string' || !value.answer.trim() || value.answer.length > WORKBENCH_MODEL_OUTPUT_LIMIT) {
    throw Error('MODEL_RESPONSE_BINDING');
  }
  const usage = value.usage ?? null;
  if (usage !== null && (!plain(usage) || Object.entries(usage).some(([key, count]) =>
    !WORKBENCH_MODEL_USAGE_FIELDS.includes(key) || !Number.isSafeInteger(count) || count < 0))) {
    throw Error('MODEL_RESPONSE_USAGE');
  }
  return {
    requestId: value.requestId, target: input.target, sourceSha256: input.sourceSha256, promptSha256: input.promptSha256,
    inputSha256, route, startedUtc: value.startedUtc, finishedUtc: value.finishedUtc,
    finish: value.finish, usage, answer: value.answer,
    ...(hasExecution?{execution:input.execution}:{}),...(manual||automatic?{externalSessionId:value.externalSessionId}:{}),
    ...(automatic?{externalTurnId:value.externalTurnId,finishReason:value.finishReason}:{}),
  };
}
