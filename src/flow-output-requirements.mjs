import { WORKBENCH_MODEL_TEXT_LIMIT } from './workbench-model-contract.mjs';

const initial = Object.freeze({ version: 0, text: '' });

export const OUTPUT_REQUIREMENTS_LIMIT = WORKBENCH_MODEL_TEXT_LIMIT;

export function validateOutputRequirements(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
      || Object.keys(snapshot).sort().join(',') !== 'text,version'
      || !Number.isSafeInteger(snapshot.version) || snapshot.version < 0
      || typeof snapshot.text !== 'string' || snapshot.version === 0 && snapshot.text !== ''
      || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(snapshot.text)) {
    throw Error('OUTPUT_REQUIREMENTS_INVALID');
  }
  if (new TextEncoder().encode(snapshot.text).length > OUTPUT_REQUIREMENTS_LIMIT) {
    throw Error('OUTPUT_REQUIREMENTS_TOO_LONG');
  }
}

export function validateOutputRequirementsHistory(history) {
  if (!Array.isArray(history)) throw Error('OUTPUT_REQUIREMENTS_HISTORY');
  for (const [index, snapshot] of history.entries()) {
    validateOutputRequirements(snapshot);
    if (snapshot.version !== index + 1) throw Error('OUTPUT_REQUIREMENTS_HISTORY');
  }
}

export function currentOutputRequirements(instance) {
  return instance?.outputRequirements?.at(-1) ?? initial;
}

export function outputRequirementsAt(history, version) {
  return version === 0 ? initial : history?.[version - 1];
}

export function outputRequirementsPrefix(snapshot) {
  if (!snapshot?.text) return '';
  return '以下为本流程的输出要求，与当前步骤的具体任务共同生效。必需的结构化输出、真实证据与不确定性、安全和系统边界优先。'
    + '\n\n--- 本流程输出要求 · 第 ' + snapshot.version + ' 版 ---\n' + snapshot.text
    + '\n\n--- 当前请求 ---\n';
}

export function applyOutputRequirements(task, snapshot) {
  return outputRequirementsPrefix(snapshot) + task;
}

// Adapted from the locally installed anti-defensive-writing rules (Kiterlin, MIT).
// PRISM sends these sentences as ordinary output requirements.
export const ANTI_DEFENSIVE_WRITING_PRESET = Object.freeze({
  id: 'anti-defensive-writing',
  name: '反防御性写作 · anti-defensive-writing',
  text: [
    '开头直接给出结论或当前材料支持的判断。逐段说清观点、证据和适用条件。',
    '删去空泛过渡、预先辩解、重复限定和没有依据的模糊措辞。用具体研究范围和证据交代结论的力度。',
    '保留影响结论的样本、比较条件、时间范围、效应方向、不确定性和关键方法限制。必要限定集中写在相关位置。',
    '区分原文结果、自己的解释和尚未核对的问题。只报告材料可支持的事实；相关性、因果性与可推广范围须分别说明。',
    '证据不足时指出缺少哪项材料并缩小结论。保留不利结果和竞争解释，不补造引文、页码、显著性或机制。',
  ].join('\n'),
});

const PRESET_SUFFIX = ':output-requirements-presets-v1';
const PRESET_SCHEMA = 'prism-output-requirements-presets/v1';
const PRESET_COUNT_LIMIT = 24;
const PRESET_BYTES_LIMIT = 192 * 1024;
const presetId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const outputRequirementsPresetKey = namespace => namespace + PRESET_SUFFIX;

export function hasOutputRequirementsPreset(draft, text) {
  return draft === text || draft.startsWith(text + '\n\n') || draft.endsWith('\n\n' + text)
    || draft.includes('\n\n' + text + '\n\n');
}

export function appendOutputRequirementsPreset(draft, text) {
  if (hasOutputRequirementsPreset(draft, text)) return draft;
  const next = draft ? draft + '\n\n' + text : text;
  validateOutputRequirements({ version: 1, text: next });
  return next;
}

export function parseOutputRequirementsPresets(raw) {
  if (raw === null) return [];
  if (typeof raw !== 'string' || raw.length > PRESET_BYTES_LIMIT
      || new TextEncoder().encode(raw).length > PRESET_BYTES_LIMIT) throw Error('OUTPUT_PRESET_CAPACITY');
  const value = JSON.parse(raw);
  if (!value || Object.keys(value).sort().join(',') !== 'presets,schema'
      || value.schema !== PRESET_SCHEMA || !Array.isArray(value.presets)
      || value.presets.length > PRESET_COUNT_LIMIT) throw Error('OUTPUT_PRESET_INVALID');
  const ids = new Set(), names = new Set();
  for (const preset of value.presets) {
    if (!preset || Object.keys(preset).sort().join(',') !== 'id,name,text,version'
        || typeof preset.id !== 'string' || !presetId.test(preset.id)
        || typeof preset.name !== 'string' || !preset.name || preset.name !== preset.name.trim()
        || preset.name.length > 80 || /[\x00-\x1f\x7f-\x9f]/.test(preset.name)
        || typeof preset.text !== 'string' || !preset.text.trim() || preset.version < 1) {
      throw Error('OUTPUT_PRESET_INVALID');
    }
    validateOutputRequirements({ version: preset.version, text: preset.text });
    const name = preset.name.normalize('NFKC').toLowerCase();
    if (ids.has(preset.id) || names.has(name)) throw Error('OUTPUT_PRESET_DUPLICATE');
    ids.add(preset.id); names.add(name);
  }
  return value.presets;
}

export function createOutputRequirementsPresets({ storage, namespace, withLock, randomId = () => globalThis.crypto.randomUUID() }) {
  const key = outputRequirementsPresetKey(namespace);
  const read = () => {
    const raw = storage.getItem(key);
    return { raw, presets: parseOutputRequirementsPresets(raw) };
  };
  async function save({ id, name, text }, expectedRaw) {
    if (!withLock) throw Error('OUTPUT_PRESET_LOCK_UNAVAILABLE');
    return withLock(key, () => {
      const current = read();
      if (current.raw !== expectedRaw) throw Error('OUTPUT_PRESET_CHANGED');
      const previous = id ? current.presets.find(item => item.id === id) : null;
      if (id && !previous) throw Error('OUTPUT_PRESET_CHANGED');
      if (!previous && current.presets.length >= PRESET_COUNT_LIMIT) throw Error('OUTPUT_PRESET_CAPACITY');
      const preset = { id: previous?.id ?? randomId(), name: name.trim(), text, version: (previous?.version ?? 0) + 1 };
      if (previous?.name === preset.name && previous.text === text) return { ...current, id };
      const presets = previous
        ? current.presets.map(item => item.id === id ? preset : item)
        : [...current.presets, preset];
      const raw = JSON.stringify({ schema: PRESET_SCHEMA, presets });
      parseOutputRequirementsPresets(raw);
      storage.setItem(key, raw);
      if (storage.getItem(key) !== raw) throw Error('OUTPUT_PRESET_WRITE_UNCONFIRMED');
      return { raw, presets, id: preset.id };
    });
  }
  return { key, writable: typeof withLock === 'function', read, save };
}
