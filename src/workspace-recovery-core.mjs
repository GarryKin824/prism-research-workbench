import { inspectPdfOriginalBundle, PDF_ORIGINAL_BUNDLE_LIMITS } from './pdf-original-bundle-core.mjs';
import { readingKey, readReadingLedger, readReadingDraft, pdfOriginalAtCapture } from './reading-evidence.mjs';
import { argumentKey, readArgumentLedger, parseArgumentDraft } from './research-argument.mjs';
import { outputRequirementsPresetKey, parseOutputRequirementsPresets } from './flow-output-requirements.mjs';

export const recoveryStatusPath = '/api/prism-workspace-recovery/status';
export const recoveryDataPath = '/api/prism-workspace-recovery/snapshot';
export const recoveryTextLimit = 12 * 1024 * 1024;
export const recoveryPdfLimit = PDF_ORIGINAL_BUNDLE_LIMITS.maxTotalBytes;
export const recoveryLimit = 70 * 1024 * 1024;
const encoder = new TextEncoder();
const id = /^[a-f0-9]{64}$/;
const namespacePattern = /^prism-native-profile-v1:[a-f0-9-]{36}$/;
const single = new Set([
  ':project-planning-v1', ':project-library-v1', ':research-instances-v1', ':project-queues-v1',
  ':project-execution-owner-v1', ':library-queue-v1', ':planning-drafts-v1', ':bibliography-notes-v1',
]);
const scoped = /^:(?:(?:workbench-model-executions-v1|instance-manual-results-v1|instance-review-decisions-v1|instance-finding-evidence-v1):"[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}"(?::intent-v1)?|custom-workflow-v1:[A-Za-z0-9][A-Za-z0-9_.:-]{0,199})$/;
const coveredV1 = (namespace, key) => key === namespace || key.startsWith(namespace + ':')
  && (single.has(key.slice(namespace.length)) || scoped.test(key.slice(namespace.length)));
const exact = (value, ...fields) => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));

export function recoveryFingerprint(value) {
  return typeof value === 'string' && id.test(value);
}

function researchDataKey(namespace, key) {
  if (!key.startsWith(namespace + ':')) return null;
  const suffix = key.slice(namespace.length);
  const draft = suffix.endsWith(':tab-draft');
  const bare = draft ? key.slice(0, -10) : key;
  const reading = namespace + ':reading-evidence-v1:';
  const argument = namespace + ':research-arguments-v1:';
  try {
    if (bare.startsWith(reading)) {
      const parts = JSON.parse(bare.slice(reading.length));
      if (!Array.isArray(parts) || parts.length !== 2) return null;
      const scope = { namespace, projectId: parts[0], paperId: parts[1] };
      return readingKey(scope) === bare ? { type: 'reading', scope, draft } : null;
    }
    if (bare.startsWith(argument)) {
      const scope = { namespace, projectId: JSON.parse(bare.slice(argument.length)) };
      return argumentKey(namespace, scope.projectId) === bare ? { type: 'argument', scope, draft } : null;
    }
  } catch {}
  return null;
}

export const recoveryAnnotationKey = (namespace, key) => researchDataKey(namespace, key)?.draft === false;
export const recoveryTabDraftKey = (namespace, key) => researchDataKey(namespace, key)?.draft === true;
const draftRoot = ':workspace-editor-draft-v1:';
export function workspaceEditorDraftKey(namespace, kind, ids) {
  return namespace + draftRoot + JSON.stringify([kind, ...ids]);
}

function editorKey(namespace, key) {
  if (!key.startsWith(namespace + draftRoot)) return false;
  try {
    const parts = JSON.parse(key.slice((namespace + draftRoot).length));
    return Array.isArray(parts) && ['flow', 'requirements', 'result'].includes(parts[0])
      && parts.length === (parts[0] === 'result' ? 5 : 4) && parts.slice(1).every(id => typeof id === 'string' && !!id && id.length <= 200)
      && workspaceEditorDraftKey(namespace, parts[0], parts.slice(1)) === key;
  } catch { return false; }
}

const coveredDraft = (namespace, key) => researchDataKey(namespace, key)?.draft === true || editorKey(namespace, key);

export function recoveryEntries(storage, namespace) {
  const entries = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && (coveredV1(namespace, key) || coveredDraft(namespace, key) || key === outputRequirementsPresetKey(namespace))) {
      const raw = storage.getItem(key);
      if (raw === null) throw Error('RECOVERY_CHANGED');
      entries.push([key, raw]);
    }
  }
  return entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
}

export function recoveryBody(namespace, entries, extras) {
  return extras === undefined ? JSON.stringify({ schema: 'prism-workspace-recovery/v1', namespace, entries })
    : JSON.stringify({ schema: 'prism-workspace-recovery/v2', namespace, entries, annotations: extras.annotations, pdfBundle: extras.pdfBundle });
}

export async function inspectRecovery(raw, namespace, crypto = globalThis.crypto) {
  if (typeof raw !== 'string' || raw.length > recoveryLimit) throw Error('RECOVERY_SIZE');
  const bytes = encoder.encode(raw);
  if (!namespacePattern.test(namespace) || bytes.length > recoveryLimit) throw Error('RECOVERY_SIZE');
  const body = JSON.parse(raw);
  const version = body?.schema === 'prism-workspace-recovery/v2' ? 2 : body?.schema === 'prism-workspace-recovery/v1' ? 1 : 0;
  if (!version || !(version === 2 ? exact(body, 'schema', 'namespace', 'entries', 'annotations', 'pdfBundle')
    : exact(body, 'schema', 'namespace', 'entries'))
    || body.namespace !== namespace || !Array.isArray(body.entries) || body.entries.length > 4000
    || body.entries[0]?.[0] !== namespace) throw Error('RECOVERY_SCOPE');
  const summary = { version, entries: body.entries.length, originals: 0, pdfBytes: 0, excerpts: 0, arguments: 0, drafts: 0 };
  let textBytes = 0;
  let last = '';
  for (const item of body.entries) {
    if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== 'string' || item[0] <= last
      || !(coveredV1(namespace, item[0]) || version === 2 &&
        (coveredDraft(namespace, item[0]) || item[0] === outputRequirementsPresetKey(namespace)))
      || typeof item[1] !== 'string') throw Error('RECOVERY_SCOPE');
    // Every covered store uses JSON. Its own controller still verifies versions and references when opened.
    const parsed = JSON.parse(item[1]);
    if (item[0] === outputRequirementsPresetKey(namespace)) parseOutputRequirementsPresets(item[1]);
    if (version === 2 && coveredDraft(namespace, item[0])) {
      const identified = researchDataKey(namespace, item[0]);
      if (identified?.type === 'reading') readReadingDraft(item[1]);
      else if (identified?.type === 'argument') parseArgumentDraft(item[1]);
      else if (!exact(parsed, 'base', 'text') || typeof parsed.base !== 'string' || typeof parsed.text !== 'string'
        || parsed.base.length > 200000 || parsed.text.length > (item[0].includes('["result",') ? 2 * 1024 * 1024 : 200000)) throw Error('RECOVERY_DRAFT_FORMAT');
      summary.drafts++;
    }
    textBytes += encoder.encode(item[0]).length + encoder.encode(item[1]).length;
    last = item[0];
  }
  const papers = JSON.parse(body.entries[0][1])?.papers;
  if (!Array.isArray(papers)) throw Error('RECOVERY_BASE');
  const annotations = version === 2 ? body.annotations : [];
  if (!Array.isArray(annotations) || annotations.length > 4000) throw Error('RECOVERY_ANNOTATIONS');
  last = '';
  for (const item of annotations) {
    if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== 'string' || item[0] <= last
      || typeof item[1] !== 'string' || !recoveryAnnotationKey(namespace, item[0])) throw Error('RECOVERY_ANNOTATIONS');
    const { type, scope } = researchDataKey(namespace, item[0]);
    if (type === 'reading') summary.excerpts += readReadingLedger(item[1], scope).excerpts.length;
    else summary.arguments += readArgumentLedger(item[1], scope).versions.length;
    textBytes += encoder.encode(item[0]).length + encoder.encode(item[1]).length;
    last = item[0];
  }
  if ((version === 1 ? bytes.length : textBytes) > recoveryTextLimit) throw Error('RECOVERY_TEXT_SIZE');
  let originals = null;
  if (version === 2 && body.pdfBundle !== null) {
    if (typeof body.pdfBundle !== 'string') throw Error('RECOVERY_PDF');
    originals = await inspectPdfOriginalBundle(body.pdfBundle, { crypto });
    if (!originals.ok || originals.summary.namespace !== namespace) throw Error('RECOVERY_PDF');
    summary.originals = originals.summary.fileCount;
    summary.pdfBytes = originals.summary.totalBytes;
  }
  const available = new Set(originals?.summary.files.map(file => file.sha256) ?? []);
  const declared = new Set();
  for (const paper of papers) {
    const fingerprint = pdfOriginalAtCapture(paper)?.sha256;
    if (recoveryFingerprint(fingerprint)) declared.add(fingerprint);
  }
  summary.missingOriginals = [...declared].filter(fingerprint => !available.has(fingerprint)).length;
  const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    byte => byte.toString(16).padStart(2, '0')).join('');
  return { entries: body.entries, annotations, originals, summary, fingerprint };
}

export function emptyRecoveryDestination(storage, namespace) {
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key === namespace || key?.startsWith(namespace + ':')) return false;
  }
  return true;
}

export function restoreRecoveryEntries(storage, namespace, entries) {
  if (!emptyRecoveryDestination(storage, namespace)) throw Error('RECOVERY_DESTINATION_OCCUPIED');
  const written = [];
  try {
    // Write the base last so other controllers cannot open a half-written project as normal.
    for (const [key, raw] of [...entries.slice(1), entries[0]]) {
      if (storage.getItem(key) !== null) throw Error('RECOVERY_DESTINATION_OCCUPIED');
      storage.setItem(key, raw);
      written.push([key, raw]);
      if (storage.getItem(key) !== raw) throw Error('RECOVERY_READBACK');
    }
  } catch (error) {
    for (const [key, raw] of written.reverse()) {
      if (storage.getItem(key) === raw) storage.removeItem(key);
    }
    throw error;
  }
}
