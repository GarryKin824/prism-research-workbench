import {
  checkReadingSources, createReadingEvidence, literalMarkdownBlock, literalMarkdownLabel,
  readingSourceLines, readingSourceMatches, sameReadingRecord, validReadingRecord,
} from './reading-evidence.mjs';

const SCHEMA = 'prism-research-arguments/v1';
const MAX_VERSIONS = 150;
const MAX_BYTES = 4_000_000;
export const ARGUMENT_MAX_LINKS = 24;
export const ARGUMENT_FIELDS = { question: 300, conclusion: 6000, alternatives: 6000, openQuestions: 6000 };
export const ARGUMENT_RELATIONS = { support: '支持', oppose: '反对／反例', condition: '补充条件', other: '其他' };
export const ARGUMENT_SOURCE_ISSUES = {
  paperMissing: '论文不在当前项目范围',
  excerptMissing: '未找到已关联的摘录',
  excerptChanged: '已保存摘录与关联快照不同',
  unreadable: '摘录账本无法读取',
  textChanged: '当前正文与关联摘录不匹配',
};

const fail = code => { throw Error(code); };
const bounded = (value, limit) => typeof value === 'string' && value.length <= limit;
const id = value => bounded(value, 300) && value.length > 0;
const questionId = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const fields = (value, names) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
export const argumentLinkKey = link => JSON.stringify([link.paperId, link.record.id]);

export function argumentKey(namespace, projectId) {
  if (!id(namespace) || !id(projectId)) fail('ARGUMENT_PROJECT_REQUIRED');
  return namespace + ':research-arguments-v1:' + JSON.stringify(projectId);
}

export function newArgumentDraft(id) {
  return { id, base: 0, question: '', conclusion: '', alternatives: '', openQuestions: '', links: [] };
}

function validLink(link) {
  return fields(link, ['paperId', 'title', 'record', 'relation', 'note'])
    && id(link.paperId) && bounded(link.title, 2000) && link.title.length > 0
    && validReadingRecord(link.record) && typeof link.relation === 'string'
    && Object.hasOwn(ARGUMENT_RELATIONS, link.relation) && bounded(link.note, 1500);
}

function validDraft(value) {
  return fields(value, ['id', 'base', 'links', ...Object.keys(ARGUMENT_FIELDS)])
    && questionId(value.id) && Number.isSafeInteger(value.base) && value.base >= 0 && value.base <= MAX_VERSIONS
    && Object.entries(ARGUMENT_FIELDS).every(([field, limit]) => bounded(value[field], limit))
    && Array.isArray(value.links) && value.links.length <= ARGUMENT_MAX_LINKS && value.links.every(validLink)
    && new Set(value.links.map(argumentLinkKey)).size === value.links.length;
}

export function parseArgumentDraft(raw) {
  const draft = JSON.parse(raw);
  if (!validDraft(draft)) fail('ARGUMENT_DRAFT_INVALID');
  return draft;
}

export function readArgumentLedger(raw, scope) {
  if (raw === null) return { schema: SCHEMA, scope, versions: [] };
  if (!bounded(raw, MAX_BYTES) || new TextEncoder().encode(raw).length > MAX_BYTES) fail('ARGUMENT_LEDGER_INVALID');
  const value = JSON.parse(raw);
  if (!fields(value, ['schema', 'scope', 'versions']) || value.schema !== SCHEMA
    || !fields(value.scope, ['namespace', 'projectId']) || value.scope.namespace !== scope.namespace
    || value.scope.projectId !== scope.projectId || !Array.isArray(value.versions)
    || value.versions.length > MAX_VERSIONS) fail('ARGUMENT_LEDGER_INVALID');
  const revisions = new Map();
  for (const row of value.versions) {
    if (!fields(row, ['draft', 'revision', 'savedAt']) || !validDraft(row.draft) || !row.draft.question.trim()
      || !Number.isFinite(Date.parse(row.savedAt)) || new Date(row.savedAt).toISOString() !== row.savedAt
      || (revisions.get(row.draft.id) ?? 0) !== row.draft.base || row.revision !== row.draft.base + 1) {
      fail('ARGUMENT_LEDGER_INVALID');
    }
    revisions.set(row.draft.id, row.revision);
  }
  return value;
}

export function createResearchArguments({ namespace, projectId, storage }) {
  const scope = { namespace, projectId };
  const key = argumentKey(namespace, projectId);
  const readRaw = () => {
    if (!storage) fail('ARGUMENT_STORAGE_UNAVAILABLE');
    return storage.read(key);
  };
  const read = async () => readArgumentLedger(await readRaw(), scope).versions;
  async function save(draft, guard) {
    if (!validDraft(draft) || !draft.question.trim()) fail('ARGUMENT_DRAFT_INVALID');
    guard();
    const expected = await readRaw();
    const ledger = readArgumentLedger(expected, scope);
    const previous = ledger.versions.findLast(row => row.draft.id === draft.id);
    if ((previous?.revision ?? 0) !== draft.base) fail('ARGUMENT_CONFLICT');
    const row = { draft, revision: draft.base + 1, savedAt: new Date().toISOString() };
    ledger.versions.push(row);
    const next = JSON.stringify(ledger);
    if (ledger.versions.length > MAX_VERSIONS || new TextEncoder().encode(next).length > MAX_BYTES) fail('ARGUMENT_LIMIT');
    try {
      if (!await storage.compareAndWrite(key, expected, next, guard)) fail('ARGUMENT_CONFLICT');
    } catch (error) {
      if (error.outcome !== 'unknown') throw error;
    }
    const observed = await read().catch(() => null);
    if (!observed?.some(item => JSON.stringify(item) === JSON.stringify(row))) fail('ARGUMENT_SAVE_UNKNOWN');
    return { row, versions: observed };
  }
  return { read, save };
}

export async function resolveArgumentSources(links, { namespace, projectId, storage, currentPapers }) {
  const before = new Map(currentPapers().map(paper => [paper.id, paper]));
  const ledgers = new Map();
  await Promise.all([...new Set(links.map(link => link.paperId))].map(async paperId => {
    if (!before.has(paperId)) return;
    const scope = { namespace, projectId, paperId };
    const client = createReadingEvidence({ scope, storage });
    ledgers.set(paperId, await client.read().catch(() => null));
  }));
  const after = new Map(currentPapers().map(paper => [paper.id, paper]));
  return links.map(link => {
    const paper = after.get(link.paperId);
    if (!before.has(link.paperId) || !paper) return { status: 'paperMissing' };
    const ledger = ledgers.get(link.paperId);
    if (!ledger) return { status: 'unreadable' };
    const record = ledger.excerpts.find(item => item.id === link.record.id);
    if (!record) return { status: 'excerptMissing' };
    if (!sameReadingRecord(record, link.record)) return { status: 'excerptChanged' };
    if (!readingSourceMatches(record, paper.document)) return { status: 'textChanged' };
    return { status: 'current', paper };
  });
}

export async function exportResearchArgument(row, context) {
  const draft = row.draft;
  const resolved = await resolveArgumentSources(draft.links, context);
  const groups = new Map();
  const reports = new Map();
  draft.links.forEach((link, index) => {
    if (resolved[index].status !== 'current') return;
    if (!groups.has(link.paperId)) groups.set(link.paperId, { paperId: link.paperId, readable: true, excerpts: [] });
    groups.get(link.paperId).excerpts.push({ record: link.record });
  });
  const checked = await checkReadingSources({ papers: [...groups.values()] }, context);
  for (const group of checked.papers) {
    for (const { record, sourceCheck } of group.excerpts) reports.set(argumentLinkKey({ paperId: group.paperId, record }), sourceCheck);
  }
  const rechecked = await resolveArgumentSources(draft.links, context);
  if (!context.isCurrent() || rechecked.some((item, index) => item.status !== resolved[index].status)) fail('ARGUMENT_SCOPE_CHANGED');

  const parts = ['# ' + literalMarkdownLabel(draft.question), '研究论证 · 已保存版本 ' + row.revision,
    '项目 ID：' + literalMarkdownLabel(context.projectId), '问题 ID：' + draft.id];
  for (const [label, value] of [['阶段性结论', draft.conclusion], ['竞争解释', draft.alternatives], ['尚未解决的问题', draft.openQuestions]]) {
    if (value.trim()) parts.push('## ' + label, literalMarkdownBlock(value));
  }
  if (draft.links.length) parts.push('## 关联摘录');
  draft.links.forEach((link, index) => {
    const { record } = link;
    const { filename, sha256, start, end, pdfOriginal } = record.source;
    const status = resolved[index].status;
    const provenance = status === 'current' ? readingSourceLines(reports.get(argumentLinkKey(link))) : [
      '出处待核对：' + ARGUMENT_SOURCE_ISSUES[status],
      ...(pdfOriginal ? ['PDF 文件：' + literalMarkdownLabel(pdfOriginal.filename), 'PDF SHA-256：' + pdfOriginal.sha256] : []),
    ];
    parts.push('### ' + ARGUMENT_RELATIONS[link.relation] + ' · ' + literalMarkdownLabel(link.title),
      '论文 ID：' + literalMarkdownLabel(link.paperId) + ' · 摘录 ID：' + literalMarkdownLabel(record.id),
      '正文：' + literalMarkdownLabel(filename) + ' · 字符 ' + (start + 1) + '–' + end,
      '正文 SHA-256：' + sha256, ...provenance, '**原文摘录**', literalMarkdownBlock(record.quote));
    if (record.judgment) parts.push('**摘录时的判断**', literalMarkdownBlock(record.judgment));
    if (link.note) parts.push('**论证说明**', literalMarkdownBlock(link.note));
  });
  return parts.join('\n\n') + '\n';
}
