/** Transient trusted-code adapter seam. Only local fixtures are supported here.
 * No provider discovery, network, credentials, project writes or execution authority.
 * Attempt dedupe lasts only for this controller instance, never across refreshes.
 */
const PREFIX = '[本地模拟样例，非真实AI答复；未验证]';
const bindingKeys = ['namespace', 'projectId', 'revisionSha256', 'templateVersion', 'nodeId', 'promptVersion'];
const fail = message => { throw Error(message); };
const keys = (x, expected) => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  Reflect.ownKeys(x).length === expected.length && expected.every(k => {
    const d = Object.getOwnPropertyDescriptor(x, k);
    return d && Object.hasOwn(d, 'value');
  });
const text = (x, max) => typeof x === 'string' && x.length <= max && x.trim().length > 0 &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(x) &&
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(x);
const bytes = x => new TextEncoder().encode(x);
const id = x => typeof x === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(x);
const version = (x, min) => Number.isSafeInteger(x) && x >= min && x <= 10000;
const freeze = x => { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };
export function canonicalPlanningRequest(input) {
  if (!keys(input, ['purpose', 'binding', 'payload'])) fail('INVALID_ADAPTER_INPUT');
  const {purpose, binding: b, payload} = input;
  if (!['project-planning', 'node-prompt-discussion'].includes(purpose) || !keys(b, bindingKeys) ||
      !text(b.namespace, 300) || !id(b.projectId) || typeof b.revisionSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(b.revisionSha256) || !version(b.templateVersion, purpose === 'project-planning' ? 0 : 1) ||
      (purpose === 'project-planning' ? b.nodeId !== null || b.promptVersion !== null : !id(b.nodeId) || !version(b.promptVersion, 1)) ||
      !text(payload, 1048576) || bytes(payload).length > 1048576) fail('INVALID_ADAPTER_INPUT');
  return {purpose, binding: Object.fromEntries(bindingKeys.map(k => [k, b[k]])), payload};
}
function validateAdapter(adapter) {
  if (!keys(adapter, ['metadata', 'invoke']) || typeof adapter.invoke !== 'function' ||
      !keys(adapter.metadata, ['kind', 'connected', 'network', 'tools']) ||
      adapter.metadata.kind !== 'local-simulation' || adapter.metadata.connected !== false ||
      adapter.metadata.network !== false || adapter.metadata.tools !== 0) fail('LOCAL_SIMULATION_ADAPTER_REQUIRED');
}
export function createLocalPlanningAdapter() {
  return freeze({metadata: {kind: 'local-simulation', connected: false, network: false, tools: 0},
    async invoke(request, {signal}) {
      if (signal.aborted) fail('LOCAL_SIMULATION_ABORTED');
      const subject = request.purpose === 'project-planning' ? '项目规划' : '所选节点 Prompt';
      return {requestId: request.requestId, text: `这是本地固定样例，不是 AI 生成内容。请人工检查${subject}的目标、输入、输出及审核标准；本样例未分析上下文，不代表研究结论或执行授权。`};
    }});
}
export function createPlanningModelAdapterController({adapter = createLocalPlanningAdapter(), crypto = globalThis.crypto, timeoutMs = 5000} = {}) {
  validateAdapter(adapter);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000 ||
      !crypto?.subtle || typeof crypto.randomUUID !== 'function') fail('INVALID_ADAPTER_CONFIGURATION');
  // Trusted injected adapters must obey the local-only contract. Metadata is not a sandbox.
  const invoke = adapter.invoke.bind(adapter), previews = new WeakMap(), results = new WeakMap(), attempts = new Set();
  let active = null, sequence = 0;
  const digest = async raw => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(raw))), x => x.toString(16).padStart(2, '0')).join('');
  function current(entry, check) {
    entry.stable();
    if (typeof check !== 'function' || check() !== true || entry.cancelled) fail('ADAPTER_CONTEXT_EXPIRED');
    entry.stable();
  }
  async function prepare(input, assertStable = () => {}) {
    if (typeof assertStable !== 'function') fail('INVALID_ADAPTER_STABILITY_CHECK');
    assertStable();
    const q = canonicalPlanningRequest(input), canonical = JSON.stringify(q);
    if (++sequence > Number.MAX_SAFE_INTEGER) fail('ADAPTER_REQUEST_ID_LIMIT');
    const request = freeze({schema: 'prism-planning-model-request/v1', requestId: `${crypto.randomUUID()}:${sequence}`,
      purpose: q.purpose, binding: q.binding, messages: [{role: 'user', content: q.payload}]});
    assertStable();
    const requestSha256 = await digest(JSON.stringify(request));
    assertStable();
    const preview = freeze({kind: 'local-planning-adapter-preview', request, requestSha256,
      actualExecutor: 'local-fixture', realModelConnected: false, sent: false, authority: 'none'});
    previews.set(preview, {display: JSON.stringify(preview), request, canonical, stable: assertStable, cancelled: false, used: false});
    return preview;
  }
  async function run(preview, isCurrent = () => true) {
    const entry = previews.get(preview);
    if (!entry || entry.used || entry.cancelled || JSON.stringify(preview) !== entry.display) fail('ADAPTER_PREVIEW_EXPIRED');
    current(entry, isCurrent);
    if (active) fail('ADAPTER_RUN_ACTIVE');
    if (attempts.has(entry.canonical)) fail('ADAPTER_DUPLICATE_ATTEMPT');
    if (attempts.size >= 100) fail('ADAPTER_ATTEMPT_LIMIT');
    const abort = new AbortController();
    let timer, rejectStop;
    const stop = new Promise((_, reject) => { rejectStop = reject; });
    entry.stop = () => { entry.cancelled = true; abort.abort(); rejectStop(Error('ADAPTER_CANCELLED_OUTCOME_UNKNOWN')); };
    // Consume permission and retain the duplicate guard before the sole invoke.
    entry.used = true; attempts.add(entry.canonical); active = entry;
    timer = setTimeout(() => { entry.cancelled = true; abort.abort(); rejectStop(Error('ADAPTER_TIMEOUT_OUTCOME_UNKNOWN')); }, timeoutMs);
    try {
      const response = await Promise.race([Promise.resolve().then(() => {
        current(entry, isCurrent);
        return invoke(entry.request, {signal: abort.signal});
      }), stop]);
      current(entry, isCurrent);
      if (!keys(response, ['requestId', 'text']) || response.requestId !== entry.request.requestId ||
          !text(response.text, 16000) || bytes(response.text).length > 65536) fail('ADAPTER_RESPONSE_INVALID');
      const result = freeze({kind: 'local-planning-adapter-result', requestId: entry.request.requestId,
        requestSha256: preview.requestSha256, purpose: entry.request.purpose, binding: {...entry.request.binding},
        text: `${PREFIX}\n${response.text}`, actualExecutor: 'local-fixture', realModelConnected: false,
        authority: 'none', verified: false});
      current(entry, isCurrent);
      results.set(result, {entry, display: JSON.stringify(result), consumed: false});
      return result;
    } catch (error) {
      entry.cancelled = true; abort.abort();
      throw Error(`ADAPTER_OUTCOME_UNKNOWN:${error instanceof Error ? error.message : 'UNKNOWN_FAILURE'}`);
    } finally {
      clearTimeout(timer); delete entry.stop;
      if (active === entry) active = null;
    }
  }
  function consumeResult(result, isCurrent = () => true) {
    const issued = results.get(result);
    if (!issued || issued.consumed || JSON.stringify(result) !== issued.display) fail('ADAPTER_RESULT_EXPIRED');
    current(issued.entry, isCurrent);
    if (result.requestId !== issued.entry.request.requestId || bindingKeys.some(k => result.binding[k] !== issued.entry.request.binding[k])) fail('ADAPTER_RESULT_BINDING_MISMATCH');
    issued.consumed = true;
    return result.text;
  }
  function cancel(token) {
    const entry = previews.get(token) ?? results.get(token)?.entry;
    if (!entry) return;
    entry.cancelled = true;
    entry.stop?.();
  }
  return {prepare, run, consumeResult, cancel};
}
