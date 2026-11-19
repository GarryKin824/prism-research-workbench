const readingMessages = {
  READING_SELECT_TEXT: '请在原文中选中要摘录的文字。',
  READING_QUOTE_TOO_LONG: '摘录最多 6,000 字。请缩小选区。',
  READING_SOURCE_CHANGED: '论文范围或正文已变化。请在当前原文中重选，判断草稿会保留。',
  READING_WRITE_CONFLICT: '另一标签刚保存了摘录。草稿已保留，可再次保存。',
  READING_ID_CONFLICT: '这份摘录已有同编号的版本。请先导出草稿并核对。',
  READING_SAVE_UNKNOWN: '保存结果待核对。草稿已保留，可重读摘录后再确认。',
  READING_STORAGE_UNAVAILABLE: '当前环境无法保存摘录。可先导出草稿。',
  READING_LEDGER_LIMIT: '这篇论文的摘录容量已满。草稿已保留。',
  READING_LEDGER_INVALID: '已保存摘录需要核对。草稿已保留。',
  READING_DRAFT_SCOPE_MISMATCH: '请在草稿原来的项目和论文中打开这份备份。',
  READING_DRAFT_INVALID: '请选择有效的摘录草稿 JSON 文件。',
};

function readWorkspaceTabDraft(key, memory, parse) {
  if (memory.has(key)) return memory.get(key);
  let raw;
  try {
    const previous = globalThis.sessionStorage.getItem(key);
    raw = globalThis.localStorage.getItem(key);
    if (previous !== null && raw !== null && raw !== previous) return { draft: null, damaged: previous };
    if (previous !== null && raw === null) {
      raw = previous;
      const draft = parse(raw);
      return writePaperDraft(key, memory, draft);
    }
  } catch {
    return { draft: null, volatile: true };
  }
  if (raw === null) return { draft: null };
  try {
    return { draft: parse(raw) };
  } catch {
    return { draft: null, damaged: raw };
  }
}

function readPaperDraft(key, memory) {
  return readWorkspaceTabDraft(key, memory, readingEvidenceCore.readReadingDraft);
}

function writePaperDraft(key, memory, draft) {
  const raw = draft === null ? null : JSON.stringify(draft);
  try {
    const storage = globalThis.localStorage;
    if (raw === null) storage.removeItem(key);
    else storage.setItem(key, raw);
    if (storage.getItem(key) !== raw) throw Error('READING_DRAFT_READBACK');
    globalThis.sessionStorage.removeItem(key);
    memory.delete(key);
    return { draft };
  } catch {
    const state = { draft, volatile: true };
    memory.set(key, state);
    return state;
  }
}

function downloadReadingData(raw, filename, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([raw], { type }));
  try {
    const link = document.createElement('a');
    link.download = filename;
    link.href = url;
    link.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function readingSourceLabel(item) {
  return item.source.filename + ' · 字符 ' + (item.source.start + 1) + '–' + item.source.end;
}

async function inspectReadingPdf({ store, mount, currentPapers, paper, reference, isCurrent, signal, range }) {
  const namespace = store.getStorageKey();
  const revision = store.getSnapshot().revision;
  const context = { namespace, revision, selectedPaperId: paper.id };
  const vault = createPdfOriginalVaultController({ namespace });
  let parser;
  function currentDocument() {
    if (!isCurrent() || signal.aborted) throw Error('PDF_CANCELLED');
    const fresh = currentPapers().find(item => item.id === paper.id);
    if (store.getSnapshot().revision !== revision || !fresh || fresh.document?.sha256 !== paper.document.sha256
      || JSON.stringify(readingEvidenceCore.pdfSourceReference(fresh)) !== JSON.stringify(reference)) {
      throw Error('PDF_SOURCE_MISMATCH');
    }
    return fresh.document;
  }
  const current = () => { try { currentDocument(); return true; } catch { return false; } };
  function close() { parser?.destroy(); vault.close(); }
  signal.addEventListener('abort', close, { once: true });
  try {
    currentDocument();
    const original = await vault.exportOriginal(reference.pdfSha256, { isCurrent: current, allowCreate: false });
    currentDocument();
    if (!original.ok) throw Error(original.code);
    if (original.sha256 !== reference.pdfSha256 || original.size !== reference.byteLength) throw Error('PDF_SOURCE_MISMATCH');
    parser = createPdfIntake({ mount, getContext: () => { currentDocument(); return context; } });
    const file = new File([original.blob], original.name, { type: 'application/pdf' });
    const result = await parser.run(file, {
      confirmed: true, context,
      inspection: { pdfSha256: reference.pdfSha256, textSha256: reference.textSha256, ...(reference.version===2?{version:2}:{}), ...(range ?? { mapOnly: true }) },
    });
    readingEvidenceCore.verifyPdfSourceResult(reference, currentDocument(), result);
    return result;
  } finally {
    signal.removeEventListener('abort', close);
    close();
  }
}

function PaperReader({ store, scope, paper, currentDocument, currentPapers, draftMemory, onExit }) {
  const source = paper.document;
  const pdfIndex=source?.pdfText;
  const [readingPage,setReadingPage]=React.useState(()=>source?.text.length>16000?(pdfIndex?.pageSpans[0]?.page??0):0);
  const span=pdfIndex?.pageSpans.find(item=>item.page===readingPage);
  const paged=!!pdfIndex&&readingPage>0;
  const textStart=paged?(span?.start??0):0;
  const displayedText=paged?(span?source.text.slice(span.start,span.end):''):source?.text;
  const pagePickerId=React.useId();
  const key = readingEvidenceCore.readingKey(scope) + ':tab-draft';
  const [display, setDisplay] = React.useState('formatted');
  const [entry, setEntry] = React.useState(() => readPaperDraft(key, draftMemory));
  const [ledger, setLedger] = React.useState(null);
  const [readError, setReadError] = React.useState('');
  const [message, setMessage] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [reload, setReload] = React.useState(0);
  const [restore, setRestore] = React.useState(null);
  const [exporting, setExporting] = React.useState(false);
  const exportFlight = React.useRef(null);
  const pdfExportHost = React.useRef(null);
  const rawText = React.useRef(null);
  const judgment = React.useRef(null);
  const focusJudgment = React.useRef(false);
  const mounted = React.useRef(false);
  const saving = React.useRef(false);
  const backupGeneration = React.useRef(0);
  const newestDocument = React.useRef(currentDocument);
  newestDocument.current = currentDocument;
  const controller = React.useMemo(() => readingEvidenceCore.createReadingEvidence({
    scope, storage: store.annotationStorage, currentDocument: () => {
      if (!mounted.current) throw Error('READING_SOURCE_CHANGED');
      return newestDocument.current();
    },
  }), [key, store]);

  const draft = entry.draft;
  const stale = !!draft && !readingEvidenceCore.readingSourceMatches(draft, source);
  const canCreate = !busy && entry.damaged === undefined && !!source;
  React.useLayoutEffect(() => {
    if (focusJudgment.current) {
      focusJudgment.current = false;
      judgment.current?.focus();
    }
  }, [draft?.id]);
  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; exportFlight.current?.abort(); };
  }, []);
  React.useEffect(() => {
    let live = true;
    setReadError('');
    controller.read().then(result => {
      if (live) setLedger(result);
    }, error => {
      if (live) setReadError(readingMessages[error.message] ?? '暂时无法读取摘录。');
    });
    return () => { live = false; };
  }, [controller, reload]);

  function changeDraft(next) {
    setEntry(writePaperDraft(key, draftMemory, next));
  }

  function capture() {
    if (!canCreate || !rawText.current || draft && !stale) return;
    try {
      const input = rawText.current;
      const selected = readingEvidenceCore.readingTextSelection(source.text, textStart+input.selectionStart, textStart+input.selectionEnd);
      const next = readingEvidenceCore.makeReadingDraft(source, selected, globalThis.crypto.randomUUID(),
        undefined, readingEvidenceCore.pdfOriginalAtCapture(paper));
      cancelRestore();
      focusJudgment.current = true;
      changeDraft({ ...next, judgment: draft?.judgment ?? '' });
      setMessage(null);
    } catch (error) {
      setMessage({ error: readingMessages[error.message] ?? '暂时无法生成摘录。' });
      rawText.current.focus();
    }
  }

  function cancelRestore() {
    backupGeneration.current++;
    setRestore(null);
  }

  async function chooseBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    cancelRestore();
    if (!file || draft || entry.damaged !== undefined) return;
    const generation = backupGeneration.current;
    const current = () => mounted.current && backupGeneration.current === generation;
    setRestore({ status: 'loading' });
    if (file.size < 1 || file.size > readingEvidenceCore.READING_DRAFT_LIMIT) {
      setRestore({ error: readingMessages.READING_DRAFT_INVALID });
      return;
    }
    let bytes;
    try {
      bytes = await file.arrayBuffer();
      if (bytes.byteLength !== file.size) throw Error('READING_DRAFT_FILE_CHANGED');
    } catch {
      if (current()) setRestore({ error: '无法读取文件。请重新选择备份。' });
      return;
    }
    if (!current()) return;
    try {
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const recovered = readingEvidenceCore.readReadingDraftBackup(raw, scope);
      setRestore({ draft: recovered });
    } catch (error) {
      setRestore({ error: readingMessages[error.message] ?? readingMessages.READING_DRAFT_INVALID });
    }
  }

  function restoreBackup() {
    if (!restore?.draft) return;
    const existing = readPaperDraft(key, draftMemory);
    if (existing.draft || existing.damaged !== undefined) {
      setRestore({ error: '已有草稿记录。请先核对当前草稿。' });
      return;
    }
    if (ledger?.excerpts.some(record => record.id === restore.draft.id)) {
      setRestore({ error: '这份摘录已保存在当前论文。' });
      return;
    }
    focusJudgment.current = true;
    changeDraft(restore.draft);
    cancelRestore();
    setMessage({ status: '草稿已恢复，可继续编辑。' });
  }

  async function save() {
    if (!draft || stale || !ledger || readError || saving.current) return;
    saving.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const updated = await controller.save(draft);
      if (!mounted.current) return;
      setLedger(updated);
      changeDraft(null);
      setMessage({ status: '摘录已保存。' });
    } catch (error) {
      if (mounted.current) setMessage({ error: readingMessages[error.message] ?? '保存未完成。草稿已保留。' });
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function download(raw, filename) {
    try {
      downloadReadingData(raw, filename);
    } catch {
      setMessage({ error: '无法下载文件。当前内容仍在工作台。' });
    }
  }

  async function downloadExcerpts() {
    if (exportFlight.current) return;
    const operation = new AbortController();
    exportFlight.current = operation;
    const revision = store.getSnapshot().revision;
    const isCurrent = () => mounted.current && !operation.signal.aborted && store.getSnapshot().revision === revision;
    setExporting(true);
    setMessage(null);
    try {
      const latest = await controller.read();
      const checked = await readingEvidenceCore.checkReadingSources({ papers: [{
        paperId: paper.id, readable: true, excerpts: latest.excerpts.map(record => ({ record })),
      }] }, {
        currentPapers, isCurrent,
        readPdfMap: (target, reference) => inspectReadingPdf({ store, mount: pdfExportHost.current, currentPapers,
          paper: target, reference, isCurrent, signal: operation.signal }),
      });
      if (JSON.stringify(await controller.read()) !== JSON.stringify(latest) || !isCurrent()) throw Error('READING_SOURCE_CHANGED');
      currentPapers();
      download(JSON.stringify({
        schema: 'prism-reading-excerpt-report/v1', scope, excerpts: latest.excerpts,
        sourceChecks: checked.papers[0].excerpts.map(({ record, sourceCheck }) => ({ excerptId: record.id, ...sourceCheck })),
      }, null, 2), 'PRISM-reading-excerpts.json');
    } catch {
      if (mounted.current) setMessage({ error: '摘录或论文范围已变化，或记录无法读取。请刷新后再导出。' });
    } finally {
      exportFlight.current = null;
      if (mounted.current) setExporting(false);
    }
  }

  return h('section', { className: 'prism-reader prism-tile', 'data-testid': 'paper-reader', 'aria-labelledby': 'prism-reader-title' },
    h('header', { className: 'prism-reader-header' },
      h('div', null, h('h2', { id: 'prism-reader-title', tabIndex: -1 }, paper.title),
        source ? h('div', { className: 'prism-muted' }, source.filename,
         pdfIndex?' · PDF 文件内页 '+pdfIndex.pagesRead+'/'+pdfIndex.pages+' 已检查，'+pdfIndex.pageSpans.length+' 页留有文字'+(pdfIndex.truncated?' · 提取已截断':''):'') : null),
      guidedButton('返回导入', onExit)),
    h('div', { className: 'prism-reader-grid' },
      h('div', { className: 'prism-reading-text' },
        h(PrismButtonToolbar, { label: '正文阅读工具', controls: 'prism-reader-content',
          actions: [
            ...[['formatted', '排版'], ['raw', '原文']].map(([id, label]) => ({
              label, disabled: !source, pressed: display === id, onClick: () => setDisplay(id),
            })),
            ...(display === 'raw' ? [{ label: stale ? '用选区重核' : '摘录选区', id: 'reading-capture',
              disabled: !canCreate || !!draft && !stale, onClick: capture }] : []),
          ],
        }),
        pdfIndex?h('div',{className:'prism-actions'},
          h('label',{htmlFor:pagePickerId},'PDF 文件内页'),
          h('select',{id:pagePickerId,value:readingPage,onChange:e=>setReadingPage(Number(e.target.value))},
            h('option',{value:0},'全部已提取正文'),Array.from({length:pdfIndex.pages},(_,i)=>h('option',{key:i+1,value:i+1},'第 '+(i+1)+' / '+pdfIndex.pages+' 页'))),
          guidedButton('上一页',()=>setReadingPage(readingPage-1),{disabled:readingPage<=1}),
          guidedButton('下一页',()=>setReadingPage(readingPage+1),{disabled:readingPage>=pdfIndex.pages})):null,
        h('div', { id: 'prism-reader-content' },
        !source ? h('p', { className: 'prism-muted' }, '此档案还没有正文。可在论文工具中挂接正文。')
          : paged&&!span?h('p',{role:'status'},readingPage>pdfIndex.pagesRead?'此页未提取，正文达到保存上限。':'此页没有保留可提取文字。未做 OCR。')
          : display === 'raw' ? h(React.Fragment, null,
            h('p', { className: 'prism-muted', id: 'prism-reader-hint' }, stale ? '选中当前原文后点击「用选区重核」。' : '选中原文后点击「摘录选区」。'),
            h('textarea', {
              ref: rawText, 'aria-label': '论文原文', 'aria-describedby': 'prism-reader-hint',
              readOnly: true, value: displayedText, rows: 16, spellCheck: false, 'data-testid': 'reading-raw',
            }))
            : h(ResearchContent, { text: displayedText, showRawToggle: false, 'data-testid': 'reading-formatted' }))),
      h('section', { className: 'prism-reading-evidence', 'aria-label': '摘录与判断' },
        h('h3', null, '摘录与判断'),
        entry.damaged !== undefined ? h(React.Fragment, null,
          h('p', { role: 'alert' }, '此标签的草稿记录需要核对。请先保留原始文件。'),
          guidedButton('导出草稿原始记录', () => download(entry.damaged, 'PRISM-reading-draft-original.json'))) : null,
        draft ? h('form', { className: 'prism-form', 'aria-label': '摘录草稿', 'data-testid': 'reading-draft',
          onSubmit: event => { event.preventDefault(); void save(); } },
          h('div', { className: 'prism-muted' }, readingSourceLabel(draft)),
          stale ? h('p', { role: 'alert' }, source ? '当前正文与草稿来源不同。请切到原文，选中对应段落后重核。' : '此档案缺少正文。挂接正文后才能重核。') : null,
          h('blockquote', { className: 'prism-reading-quote' }, draft.quote),
          h('label', { htmlFor: 'prism-reader-judgment' }, '研究者判断'), h('textarea', {
            id: 'prism-reader-judgment', name: 'judgment', ref: judgment, rows: 4, value: draft.judgment, disabled: busy,
            maxLength: readingEvidenceCore.READING_QUOTE_LIMIT,
            onChange: event => changeDraft({ ...draft, judgment: event.target.value }),
          }),
          h('p', { className: 'prism-muted' }, entry.volatile ? '草稿只在当前会话内存。刷新前可先导出。' : '草稿已暂存，重开后可继续编辑。'),
          h('div', { className: 'prism-actions' },
            h('button', { type: 'submit', className: 'prism-primary', disabled: busy || stale || !ledger || !!readError }, busy ? '保存中…' : '保存摘录'),
            guidedButton('导出草稿', () => download(readingEvidenceCore.exportReadingDraft(scope, draft), 'PRISM-reading-draft.json'), { disabled: busy }))) : null,
        !draft && entry.damaged === undefined && source ? h('p', { className: 'prism-muted' }, '切到原文并选中文段，开始摘录。') : null,
        !draft && entry.damaged === undefined ? guidedHelp('恢复摘录草稿',
          h('div', { className: 'prism-form' },
            h('label', null, '选择草稿 JSON', h('input', { type: 'file', accept: '.json,application/json', onChange: chooseBackup })),
            restore?.status === 'loading' ? h('p', { role: 'status' }, '正在读取草稿…') : null,
            restore?.error ? h('p', { role: 'alert' }, restore.error) : null,
            restore?.draft ? h(React.Fragment, null,
              h('div', { className: 'prism-muted' }, readingSourceLabel(restore.draft)),
              h('blockquote', { className: 'prism-reading-quote' }, restore.draft.quote),
              h('p', { className: 'prism-reading-quote' }, restore.draft.judgment),
              !readingEvidenceCore.readingSourceMatches(restore.draft, source) ? h('p', { role: 'status' }, source ? '来源已变更，恢复后需要重核原文。' : '当前档案缺少正文，可先恢复草稿。') : null,
              h('div', { className: 'prism-actions' },
                guidedButton('恢复为草稿', restoreBackup, { primary: true, disabled: !ledger && !readError }),
                guidedButton('取消恢复', cancelRestore))) : null),
          { onToggle: event => { if (!event.currentTarget.open) cancelRestore(); } }) : null,
        message ? h('p', { role: message.error ? 'alert' : 'status' }, message.error ?? message.status) : null,
        h('div', { className: 'prism-reader-saved' },
          h('h3', null, '已保存摘录' + (ledger ? ' · ' + ledger.excerpts.length : '')),
          readError ? h(React.Fragment, null,
            h('p', { role: 'alert' }, readError), guidedButton('重新读取摘录', () => setReload(value => value + 1))) : null,
          !readError && !ledger ? h('p', { role: 'status' }, '正在读取摘录…') : null,
          !readError && ledger?.excerpts.length ? guidedButton('导出摘录 JSON', downloadExcerpts, { disabled: exporting }) : null,
          exporting ? h('p', { role: 'status' }, '正在复核摘录出处…') : null,
          h('div', { ref: pdfExportHost, hidden: true }),
          ledger?.excerpts.slice().reverse().map(item => {
            const context = readingEvidenceCore.readingSourceContext(item, source);
            return h('article', { key: item.id, className: 'prism-reading-record', 'data-testid': 'reading-excerpt' },
              h('small', { className: 'prism-muted' }, readingSourceLabel(item), context ? '' : ' · 历史来源'),
              h('blockquote', { className: 'prism-reading-quote' }, item.quote),
              item.judgment ? h(ResearchContent, { text: item.judgment, showRawToggle: false }) : null,
              guidedHelp('核对出处', h(React.Fragment, null,
                context ? h('pre', { className: 'prism-reading-context' }, context.before, h('mark', null, context.match), context.after)
                  : h('p', null, '当前正文找不到这份原文版本。'),
                h('small', { className: 'prism-muted' }, '论文 ', scope.paperId, ' · 摘录 ', item.id, ' · SHA-256 ', item.source.sha256))));
          })))));
}
