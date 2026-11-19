import { pdfSourceReference } from './pdf-source.mjs';
import { pdfExcerptLocation } from './pdf-intake/policy.mjs';
export { pdfSourceReference, verifyPdfSourceResult, pdfPageRange } from './pdf-source.mjs';

const SCHEMA = 'prism-reading-evidence/v1';
const DRAFT_SCHEMA = 'prism-reading-draft/v1';
const EXCERPT_LIMIT = 100;
const RECORD_LIMIT = 1024 * 1024;
export const READING_QUOTE_LIMIT = 6000;
export const READING_DRAFT_LIMIT = 100000;

function fail(code) {
  throw Error(code);
}

function exactFields(value, fields) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && fields.every(field => Object.hasOwn(value, field));
}

const isHash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const isId = value => typeof value === 'string' && value.length > 0 && value.length <= 300;
const isTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;
const isOffset = value => Number.isSafeInteger(value) && value >= 0 && value <= 200000;

export function readingKey(scope) {
  if (!exactFields(scope, ['namespace', 'projectId', 'paperId']) || !isId(scope.namespace)
      || !(scope.projectId === null || isId(scope.projectId)) || !isId(scope.paperId)) {
    fail('READING_SCOPE_INVALID');
  }
  return scope.namespace + ':reading-evidence-v1:' + JSON.stringify([scope.projectId, scope.paperId]);
}

function validSource(source) {
  const fields = ['filename', 'sha256', 'start', 'end'];
  const hasOriginal = !!source && Object.hasOwn(source, 'pdfOriginal');
  const original = source?.pdfOriginal;
  return exactFields(source, hasOriginal ? [...fields, 'pdfOriginal'] : fields)
    && (!hasOriginal || exactFields(original, ['filename', 'sha256']) && typeof original.filename === 'string'
      && original.filename.length > 0 && original.filename.length <= 255 && !/[\x00-\x1f\x7f/\\]/.test(original.filename)
      && isHash(original.sha256))
    && typeof source.filename === 'string' && source.filename.length > 0 && source.filename.length <= 255
    && isHash(source.sha256) && isOffset(source.start) && isOffset(source.end)
    && source.start < source.end && source.end - source.start <= READING_QUOTE_LIMIT;
}

function validReadingDraft(draft) {
  return exactFields(draft, ['id', 'source', 'quote', 'judgment', 'createdAt'])
    && isId(draft.id) && isTime(draft.createdAt) && validSource(draft.source)
    && typeof draft.quote === 'string' && draft.quote.trim().length > 0
    && draft.quote.length === draft.source.end - draft.source.start
    && typeof draft.judgment === 'string' && draft.judgment.length <= READING_QUOTE_LIMIT;
}

export function validReadingRecord(record) {
  if (!exactFields(record, ['id', 'source', 'quote', 'judgment', 'createdAt', 'savedAt'])) return false;
  const { savedAt, ...draft } = record;
  return isTime(savedAt) && validReadingDraft(draft);
}

export function readReadingDraft(raw) {
  if (typeof raw !== 'string' || raw.length > READING_DRAFT_LIMIT) fail('READING_DRAFT_INVALID');
  const draft = JSON.parse(raw);
  if (!validReadingDraft(draft)) fail('READING_DRAFT_INVALID');
  return draft;
}

export function exportReadingDraft(scope, draft) {
  readingKey(scope);
  if (!validReadingDraft(draft)) fail('READING_DRAFT_INVALID');
  return JSON.stringify({ schema: DRAFT_SCHEMA, scope, draft }, null, 2);
}

export function readReadingDraftBackup(raw, scope) {
  if (typeof raw !== 'string' || raw.length > READING_DRAFT_LIMIT
      || new TextEncoder().encode(raw).byteLength > READING_DRAFT_LIMIT) fail('READING_DRAFT_INVALID');
  const backup = JSON.parse(raw);
  if (!exactFields(backup, ['schema', 'scope', 'draft']) || backup.schema !== DRAFT_SCHEMA
      || !validReadingDraft(backup.draft)) fail('READING_DRAFT_INVALID');
  if (readingKey(backup.scope) !== readingKey(scope)) fail('READING_DRAFT_SCOPE_MISMATCH');
  return backup.draft;
}

// A textarea exposes LF-normalized offsets even when the exact source contains CRLF.
export function readingTextSelection(original, start, end) {
  if (!isOffset(start) || !isOffset(end) || start >= end) fail('READING_SELECT_TEXT');
  if (!original.includes('\r')) return { start, end };
  let textPosition = 0;
  let sourceStart;
  for (let offset = 0; offset <= original.length; offset++) {
    if (textPosition === start) sourceStart = offset;
    if (textPosition === end) return { start: sourceStart, end: offset };
    if (original[offset] === '\r' && original[offset + 1] === '\n') offset++;
    textPosition++;
  }
  fail('READING_SELECT_TEXT');
}

export function makeReadingDraft(document, selection, id, createdAt = new Date().toISOString(), pdfOriginal = null) {
  const { start, end } = selection;
  if (typeof document?.text !== 'string' || !isOffset(start) || !isOffset(end)
      || start >= end || end > document.text.length) fail('READING_SELECT_TEXT');
  if (end - start > READING_QUOTE_LIMIT) fail('READING_QUOTE_TOO_LONG');
  const quote = document.text.slice(start, end);
  if (!quote.trim()) fail('READING_SELECT_TEXT');
  const draft = {
    id,
    source: { filename: document.filename, sha256: document.sha256, start, end, ...(pdfOriginal ? { pdfOriginal } : {}) },
    quote,
    judgment: '',
    createdAt,
  };
  if (!validReadingDraft(draft)) fail('READING_SOURCE_CHANGED');
  return draft;
}

export function readingSourceMatches(draft, document) {
  const { filename, sha256, start, end } = draft.source;
  return typeof document?.text === 'string' && document.sha256 === sha256 && document.filename === filename
    && end <= document.text.length && document.text.slice(start, end) === draft.quote;
}

export function readingSourceContext(record, document, full = false) {
  if (!readingSourceMatches(record, document)) return null;
  const { start, end } = record.source;
  return {
    before: document.text.slice(full ? 0 : Math.max(0, start - 350), start),
    match: document.text.slice(start, end),
    after: full ? document.text.slice(end) : document.text.slice(end, end + 350),
  };
}

export function readReadingLedger(raw, scope) {
  if (raw === null) return { schema: SCHEMA, scope, excerpts: [] };
  if (typeof raw !== 'string' || raw.length > RECORD_LIMIT
      || new TextEncoder().encode(raw).byteLength > RECORD_LIMIT) fail('READING_LEDGER_INVALID');
  const ledger = JSON.parse(raw);
  if (!exactFields(ledger, ['schema', 'scope', 'excerpts']) || ledger.schema !== SCHEMA
      || readingKey(ledger.scope) !== readingKey(scope)
      || !Array.isArray(ledger.excerpts) || ledger.excerpts.length > EXCERPT_LIMIT) {
    fail('READING_LEDGER_INVALID');
  }
  const ids = new Set();
  for (const record of ledger.excerpts) {
    if (!validReadingRecord(record) || ids.has(record.id)) fail('READING_LEDGER_INVALID');
    ids.add(record.id);
  }
  return ledger;
}

function sameDraft(record, draft) {
  const a = record.source, b = draft.source;
  return record.id === draft.id && record.quote === draft.quote && record.judgment === draft.judgment
    && record.createdAt === draft.createdAt && a.filename === b.filename && a.sha256 === b.sha256
    && a.start === b.start && a.end === b.end && a.pdfOriginal?.sha256 === b.pdfOriginal?.sha256
    && a.pdfOriginal?.filename === b.pdfOriginal?.filename;
}

export function sameReadingRecord(a, b) {
  return a.savedAt === b.savedAt && sameDraft(a, b);
}

export function createReadingEvidence({ scope, storage, currentDocument }) {
  const key = readingKey(scope);
  const assertStorage = () => {
    if (!storage) fail('READING_STORAGE_UNAVAILABLE');
  };
  const read = async () => {
    assertStorage();
    return readReadingLedger(await storage.read(key), scope);
  };
  async function save(draft) {
    assertStorage();
    if (!validReadingDraft(draft)) fail('READING_DRAFT_INVALID');
    const expected = await storage.read(key);
    const ledger = readReadingLedger(expected, scope);
    const previous = ledger.excerpts.find(item => item.id === draft.id);
    if (previous) {
      if (!sameDraft(previous, draft)) fail('READING_ID_CONFLICT');
      return ledger;
    }
    const guard = () => {
      if (!readingSourceMatches(draft, currentDocument())) fail('READING_SOURCE_CHANGED');
    };
    guard();
    if (ledger.excerpts.length === EXCERPT_LIMIT) fail('READING_LEDGER_LIMIT');
    ledger.excerpts.push({ ...draft, savedAt: new Date().toISOString() });
    const next = JSON.stringify(ledger);
    if (new TextEncoder().encode(next).byteLength > RECORD_LIMIT) fail('READING_LEDGER_LIMIT');
    try {
      if (!await storage.compareAndWrite(key, expected, next, guard)) fail('READING_WRITE_CONFLICT');
    } catch (error) {
      if (error.outcome !== 'unknown') throw error;
      const readBack = await read().catch(() => null);
      if (!readBack?.excerpts.some(item => item.id === draft.id && sameDraft(item, draft))) {
        fail('READING_SAVE_UNKNOWN');
      }
      return readBack;
    }
    return ledger;
  }
  return { read, save };
}

function comparisonPaper(scope, papers) {
  const paper = papers.get(scope.paperId);
  if (!paper) fail('READING_COMPARISON_SCOPE_CHANGED');
  return paper;
}

export async function readReadingComparison({ namespace, projectId, paperIds, storage, currentPapers }) {
  if (paperIds.length < 2 || new Set(paperIds).size !== paperIds.length) fail('READING_COMPARISON_SELECTION');
  const scopes = paperIds.map(paperId => ({ namespace, projectId, paperId }));
  const before = new Map(currentPapers().map(paper => [paper.id, paper]));
  for (const scope of scopes) {
    readingKey(scope);
    comparisonPaper(scope, before);
  }
  const ledgers = await Promise.allSettled(scopes.map(scope => createReadingEvidence({ scope, storage }).read()));
  const after = new Map(currentPapers().map(paper => [paper.id, paper]));
  return {
    schema: 'prism-reading-comparison/v1', namespace, projectId,
    papers: scopes.map((scope, index) => {
      const paper = comparisonPaper(scope, after);
      const result = ledgers[index];
      return {
        paperId: paper.id, title: paper.title, authors: paper.metadata?.authors ?? [],
        year: paper.metadata?.year ?? null, doi: paper.metadata?.doi ?? null,
        readable: result.status === 'fulfilled',
        excerpts: result.status === 'fulfilled' ? result.value.excerpts.map(record => ({
          record, location: readingSourceMatches(record, paper.document) ? 'current' : 'unavailable',
        })) : [],
      };
    }),
  };
}

export async function verifyComparisonSource({ scope, storage, record, currentPapers }) {
  if (!currentPapers().some(item => item.id === scope.paperId)) fail('READING_COMPARISON_SCOPE_CHANGED');
  const { excerpts } = await createReadingEvidence({ scope, storage }).read();
  const stored = excerpts.find(item => item.id === record.id);
  const paper = currentPapers().find(item => item.id === scope.paperId);
  if (!stored || !sameReadingRecord(stored, record)
      || !readingSourceMatches(stored, paper?.document)) fail('READING_SOURCE_CHANGED');
}

export function pdfOriginalAtCapture(paper) {
  try {
    const reference = pdfSourceReference(paper);
    return reference ? { filename: reference.filename, sha256: reference.pdfSha256 } : null;
  } catch {
    return null;
  }
}

export function pdfReferenceForExcerpt(paper, record) {
  const reference = pdfSourceReference(paper);
  if (record.source.pdfOriginal && reference?.pdfSha256 !== record.source.pdfOriginal.sha256) {
    fail('PDF_ORIGINAL_VERSION_CHANGED');
  }
  return reference;
}

const sourceIssues = {
  textChanged: '当前正文与摘录不匹配',
  originalChanged: '当前原件指纹与摘录记录不同',
  unconfirmed: 'PDF 来源无法确认',
  unbound: '摘录未记录当时的 PDF 指纹',
  missing: '原件库缺少匹配的 PDF',
  noPage: '选区没有可核实的 PDF 页序',
  verificationFailed: '原件或提取正文未通过复核',
};

export async function checkReadingSources(view, { currentPapers, isCurrent, readPdfMap }) {
  if (!isCurrent()) fail('READING_SOURCE_CHANGED');
  const papers = new Map(currentPapers().map(paper => [paper.id, paper]));
  const checked = [];
  for (const group of view.papers) {
    if (!group.readable) fail('READING_COMPARISON_UNREADABLE');
    const paper = comparisonPaper(group, papers);
    const excerpts = [];
    // The entire PDF is extracted once per paper during this operation.
    let map;
    for (const entry of group.excerpts) {
      if (!isCurrent()) fail('READING_SOURCE_CHANGED');
      const { record } = entry;
      const recorded = record.source.pdfOriginal;
      const original = recorded ? { ...recorded, binding: 'captured' } : null;
      let check;
      if (!readingSourceMatches(record, paper.document)) {
        check = { status: 'pending', reason: 'textChanged', original };
      } else {
        let reference;
        try {
          reference = pdfReferenceForExcerpt(paper, record);
        } catch (error) {
          check = { status: 'pending', reason: error.message === 'PDF_ORIGINAL_VERSION_CHANGED' ? 'originalChanged' : 'unconfirmed', original };
        }
        if (!check && !reference) check = { status: 'text-only' };
        if (!check && !original) check = { status: 'pending', reason: 'unbound', original: null };
        if (!check) {
          map ??= readPdfMap(paper, reference).then(value => ({ value }), error => ({ error }));
          const result = await map;
          if (!isCurrent()) fail('READING_SOURCE_CHANGED');
          if (result.error) {
            const missing = ['VAULT_ABSENT', 'NOT_FOUND'].includes(result.error.message);
            check = { status: 'pending', reason: missing ? 'missing' : 'verificationFailed', original };
          } else {
            try {
              const location = pdfExcerptLocation(result.value, record.source.start, record.source.end);
              check = { status: 'verified', original, pageSequence: 'pdf-file-1-based', ...location };
            } catch (error) {
              check = { status: 'pending', reason: error.message === 'PDF_SOURCE_PAGE_MISSING' ? 'noPage' : 'verificationFailed', original };
            }
          }
        }
      }
      excerpts.push({ ...entry, sourceCheck: check });
    }
    checked.push({ ...group, excerpts });
  }
  return { ...view, schema: 'prism-reading-comparison/v2', papers: checked };
}

export function literalMarkdownLabel(value) {
  return value.replace(/[\r\n]+/g, ' ').replace(/[^A-Za-z0-9\s\u0080-\uffff]/g, character => '&#' + character.charCodeAt(0) + ';');
}

export function literalMarkdownBlock(value) {
  // Keep the user's actual text inside a fence it cannot close.
  const backticks = Math.max(2, ...(value.match(/`+/g) ?? []).map(run => run.length));
  const fence = '`'.repeat(backticks + 1);
  return fence + 'text\n' + value + '\n' + fence;
}

export function readingSourceLines(check) {
  if (!check || check.status === 'text-only') return [];
  const lines = [];
  if (check.original) {
    lines.push('PDF 文件：' + literalMarkdownLabel(check.original.filename), 'PDF SHA-256：' + check.original.sha256);
  }
  if (check.status === 'pending') return [...lines, '出处待核对：' + sourceIssues[check.reason]];
  const first = check.pages[0], last = check.pages.at(-1);
  const pages = check.pages.length > 1 && last - first + 1 === check.pages.length ? first + '–' + last : check.pages.join('、');
  lines.push('已复核 PDF 文件内页序：第 ' + pages + ' 页（印刷页码未核）');
  if (check.includesDisplayText) lines.push('页序按选区中的实际正文字符计算。');
  return lines;
}

export function exportReadingComparison(view, format) {
  if (view.papers.some(paper => !paper.readable)) fail('READING_COMPARISON_UNREADABLE');
  if (format === 'json') return JSON.stringify(view, null, 2);
  if (format !== 'md') fail('READING_COMPARISON_FORMAT');
  const sections = ['# 文献摘录与判断', '范围：' + (view.projectId === null
    ? '共享论文库' : '当前项目 ' + literalMarkdownLabel(view.projectId))];
  for (const paper of view.papers) {
    sections.push('## ' + literalMarkdownLabel(paper.title));
    const reference = [paper.authors.join('、'), paper.year, paper.doi && 'DOI ' + paper.doi].filter(Boolean);
    if (reference.length) sections.push('当前书目：' + literalMarkdownLabel(reference.join(' · ')));
    sections.push('论文 ID：' + literalMarkdownLabel(paper.paperId));
    if (!paper.excerpts.length) sections.push('暂无已保存摘录。');
    for (const { record, location, sourceCheck } of paper.excerpts) {
      const { filename, start, end, sha256 } = record.source;
      sections.push('### 摘录 ' + literalMarkdownLabel(record.id),
        '来源：' + literalMarkdownLabel(filename) + ' · 字符 ' + (start + 1) + '–' + end
          + ' · ' + (location === 'current' ? '当前正文可定位' : '当前正文无法定位'),
        '正文 SHA-256：' + sha256, ...readingSourceLines(sourceCheck), '**原文摘录**', literalMarkdownBlock(record.quote));
      if (record.judgment) sections.push('**研究者判断**', literalMarkdownBlock(record.judgment));
    }
  }
  return sections.join('\n\n') + '\n';
}
