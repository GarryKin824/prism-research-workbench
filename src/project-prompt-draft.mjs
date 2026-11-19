/** Local editable single-node form archive. Binding compares context, not provenance.
 * Callers must preview the complete packet and obtain consent before replacing a form.
 * No persistence, execution, project mutation, or authority is granted here.
 */
export const PROJECT_PROMPT_DRAFT_LIMIT = 524288;
const fail = () => { throw Error('INVALID_PROJECT_PROMPT_DRAFT'); };
const keys = (x, expected) => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  Reflect.ownKeys(x).length === expected.length && expected.every(k => Object.hasOwn(x, k));
const text = (x, max) => typeof x === 'string' && x.length <= max &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(x) &&
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(x);
const id = x => typeof x === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(x);
const hash = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const version = x => Number.isSafeInteger(x) && x >= 1 && x <= 10000;
const bytes = x => new TextEncoder().encode(x).length;
const copy = x => JSON.parse(JSON.stringify(x));
const bindingKeys = ['namespace', 'projectId', 'revisionSha256', 'templateVersion', 'nodeId', 'promptVersion'];
function validateBinding(b) {
  if (!keys(b, bindingKeys) || !text(b.namespace, 300) || !b.namespace.trim() ||
      !id(b.projectId) || !hash(b.revisionSha256) || !version(b.templateVersion) ||
      !id(b.nodeId) || !version(b.promptVersion)) fail();
}
function validate(packet) {
  if (!keys(packet, ['schema', 'authority', 'sent', 'binding', 'form']) ||
      packet.schema !== 'prism-project-template-prompt-draft/v1' ||
      packet.authority !== 'none' || packet.sent !== false) fail();
  validateBinding(packet.binding);
  const f = packet.form;
  if (!keys(f, ['target', 'request', 'scope', 'selectedHistory', 'suggestion', 'newPrompt']) ||
      !['DSH', 'Codex', 'ZCode', 'Other'].includes(f.target) ||
      !text(f.request, 12000) || !text(f.suggestion, 16000) || !text(f.newPrompt, 16000) ||
      !keys(f.scope, ['node', 'title', 'goal']) ||
      Object.values(f.scope).some(x => typeof x !== 'boolean') ||
      !Array.isArray(f.selectedHistory) || f.selectedHistory.length > 200) fail();
  const seen = new Set();
  for (const r of f.selectedHistory) {
    if (!keys(r, ['id', 'sha256']) || !id(r.id) || !hash(r.sha256) || seen.has(r.id)) fail();
    seen.add(r.id);
  }
  return packet;
}
function bindingFrom({namespace, projectId, head, nodeId}) {
  try {
    if (!head || typeof head.templateRaw !== 'string') fail();
    const state = JSON.parse(head.templateRaw).state;
    const graph = state.graphs.at(-1);
    if (graph.version !== head.templateVersion || state.currentVersion !== head.templateVersion ||
        !Array.isArray(graph.nodes)) fail();
    const nodes = graph.nodes.filter(n => n.id === nodeId);
    if (nodes.length !== 1) fail();
    const binding = {namespace, projectId, revisionSha256: head.sha256,
      templateVersion: head.templateVersion, nodeId, promptVersion: nodes[0].promptVersion};
    validateBinding(binding);
    return binding;
  } catch { fail(); }
}
export function parseProjectPromptDraft(raw) {
  if (typeof raw !== 'string' || bytes(raw) > PROJECT_PROMPT_DRAFT_LIMIT) fail();
  try { return validate(JSON.parse(raw)); } catch { fail(); }
}
export function createProjectPromptDraft({namespace, projectId, head, nodeId, form}) {
  const packet = {schema: 'prism-project-template-prompt-draft/v1', authority: 'none', sent: false,
    binding: bindingFrom({namespace, projectId, head, nodeId}), form};
  // Validate before serialization so unknown or undefined fields cannot disappear.
  validate(packet);
  const raw = JSON.stringify(packet, null, 2);
  parseProjectPromptDraft(raw);
  return raw;
}
export function matchProjectPromptDraft(packet, {namespace, projectId, head, nodeId, history = []}) {
  validate(packet);
  if (bytes(JSON.stringify(packet)) > PROJECT_PROMPT_DRAFT_LIMIT) fail();
  let current;
  try { current = bindingFrom({namespace, projectId, head, nodeId}); }
  catch { throw Error('PROJECT_PROMPT_DRAFT_CONTEXT_MISMATCH'); }
  if (bindingKeys.some(k => packet.binding[k] !== current[k]))
    throw Error('PROJECT_PROMPT_DRAFT_CONTEXT_MISMATCH');
  if (!Array.isArray(history) || packet.form.selectedHistory.some(ref => {
    const matches = history.filter(r => r && r.id === ref.id);
    return matches.length !== 1 || matches[0].kind !== 'discussion' || matches[0].sha256 !== ref.sha256;
  })) throw Error('PROJECT_PROMPT_DRAFT_HISTORY_STALE');
  return copy(packet.form);
}
