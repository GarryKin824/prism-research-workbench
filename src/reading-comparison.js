const pdfReviewMessages = {
  VAULT_ABSENT: 'PDF 原件库没有这份原件。可在原件库保存同一份 PDF 后再试。',
  NOT_FOUND: '原件库没有匹配 SHA-256 的 PDF。可保存同一份 PDF 后再试。',
  VERIFY_FAILED: '原件库中的文件未通过字节校验，无法打开原页。',
  SOURCE_CHANGED: '论文范围或正文版本已变化，无法打开原页。',
  READING_SOURCE_CHANGED: '摘录或正文版本已变化，无法打开原页。',
  READING_COMPARISON_SCOPE_CHANGED: '论文范围已变化，无法打开原页。',
  PDF_SOURCE_MISMATCH: '原件和当前提取正文的来源无法核对，无法打开原页。',
  PDF_ORIGINAL_VERSION_CHANGED: '当前 PDF 指纹与摘录记录不同。可继续核对文本出处。',
  PDF_SOURCE_PAGE_MISSING: '这个选区没有可定位的 PDF 正文字符。提取页标和分隔符没有原页位置。',
  PDF_PAGE_RENDER_FAILED: '暂时无法渲染此 PDF 原页。可继续核对文本出处。',
  PDF_TIMEOUT: 'PDF 原页核对超时。可继续查看文本出处或重试。',
};

function ReadingPdfImage({ page, onError }) {
  const image = React.useRef(null);
  React.useLayoutEffect(() => {
    const node = image.current;
    const url = URL.createObjectURL(page.blob);
    node.src = url;
    return () => URL.revokeObjectURL(url);
  }, [page.blob]);
  return h('img', { ref: image, alt: 'PDF 原页第 ' + page.number + ' 页',
    width: page.width, height: page.height, onError });
}

function ReadingSourceDialog({ paper, record, store, projectId, currentPapers, onDismiss, returnLabel = '返回对照', request }) {
  const [full, setFull] = React.useState(false);
  const [pdf, setPdf] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [pdfError, setPdfError] = React.useState('');
  const [downloadError, setDownloadError] = React.useState('');
  const dialog = React.useRef(null);
  const text = React.useRef(null);
  const match = React.useRef(null);
  const pdfHost = React.useRef(null);
  const flight = React.useRef(null);
  const titleId = React.useId();
  const context = readingEvidenceCore.readingSourceContext(record, paper.document, full);
  let reference, referenceError = '';
  try { reference = readingEvidenceCore.pdfReferenceForExcerpt(paper, record); }
  catch (error) { referenceError = pdfReviewMessages[error.message] ?? '此档案的 PDF 来源声明无法核对。'; }
  const canOpenPdf = reference && (!request || request.current);

  function cancelPdf() {
    const operation = flight.current;
    flight.current = null;
    operation?.abort();
  }

  React.useLayoutEffect(() => {
    const element = dialog.current;
    if (!element.open) element.showModal();
    return cancelPdf;
  }, []);
  React.useLayoutEffect(() => {
    const pane = text.current;
    if (!pane) return;
    pane.scrollTop += match.current.getBoundingClientRect().top
      - pane.getBoundingClientRect().top - pane.clientHeight / 4;
  }, [full, !!pdf]);

  async function readPdfPage(page = null) {
    if (!canOpenPdf || flight.current) return;
    const namespace = store.getStorageKey();
    const operation = new AbortController();
    flight.current = operation;
    const active = () => flight.current === operation && dialog.current?.open;
    setBusy(true);
    setPdfError('');
    try {
      if (request) request.verify();
      else await readingEvidenceCore.verifyComparisonSource({
        scope: { namespace, projectId, paperId: paper.id }, storage: store.annotationStorage, record, currentPapers,
      });
      const result = await inspectReadingPdf({
        store, mount: pdfHost.current, currentPapers, paper, reference, isCurrent: active, signal: operation.signal,
        range: { start: record.source.start, end: record.source.end, page },
      });
      if (active()) setPdf({ pages: result.pages, documentPages: result.documentPages, includesDisplayText: result.includesDisplayText,
        truncated: result.truncated, image: result.pageImage });
    } catch (error) {
      if (active()) {
        setPdf(null);
        setPdfError(pdfReviewMessages[error.message] ?? '暂时无法核对 PDF 原页。文本出处仍可查看。');
      }
    } finally {
      if (active()) {
        flight.current = null;
        setBusy(false);
      }
    }
  }

  function togglePdf() {
    if (busy) { cancelPdf(); setBusy(false); return; }
    if (pdf) { setPdf(null); return; }
    void readPdfPage();
  }

  function pdfLocationLabel() {
    const first = pdf.pages[0], last = pdf.pages.at(-1);
    const pages = pdf.pages.length === last - first + 1 && first !== last ? first + '–' + last : pdf.pages.join('、');
    return '命中第 ' + pages + ' 页 · 原件共 ' + pdf.documentPages + ' 页';
  }

  return h('dialog', { ref: dialog, className: 'prism-dialog prism-reading-source-dialog', 'aria-labelledby': titleId,
    onClose: () => { cancelPdf(); onDismiss(); }, 'data-testid': request ? 'result-source-dialog' : 'comparison-source-dialog' },
    h('header', { className: 'prism-reading-source-header' },
      h('h2', { id: titleId }, request ? '研究结果的输入出处' : '原文出处'),
      h('form', { method: 'dialog' }, h('button', { type: 'submit', autoFocus: true }, returnLabel))),
    h('p', null, h('strong', null, paper.title)),
    h('p', { className: 'prism-muted' }, readingSourceLabel(record)),
    request ? h('p', null, request.description) : null,
    guidedHelp('来源标识', h('dl', { className: 'prism-source-identifiers' },
      h('dt', null, '论文 ID'), h('dd', null, paper.id),
      h('dt', null, request ? '请求号' : '摘录 ID'), h('dd', null, record.id),
      h('dt', null, '正文 SHA-256'), h('dd', null, record.source.sha256),
      record.source.pdfOriginal || reference ? h(React.Fragment, null,
        h('dt', null, 'PDF SHA-256'), h('dd', null, record.source.pdfOriginal?.sha256 ?? reference.pdfSha256)) : null)),
    h('div', { className: 'prism-source-actions' },
      !pdf ? h('button', { type: 'button', onClick: () => setFull(value => !value) }, full ? '只看附近原文' : '展开整篇原文') : null,
      canOpenPdf ? h('button', { key: 'pdf', type: 'button', onClick: togglePdf },
        busy ? '取消 PDF 核对' : pdf ? '返回文本出处' : '打开 PDF 原页') : null,
      request ? h('button', { type: 'button', onClick: () => {
        setDownloadError('');
        try { request.download(); }
        catch { setDownloadError('记录或项目已变化，请关闭后重新打开输入出处再导出。'); }
      } }, '下载研究结果 Markdown') : null),
    busy ? h('p', { role: 'status' }, '正在核对 PDF 原件与提取正文…') : null,
    referenceError || pdfError ? h('p', { role: 'alert' }, referenceError || pdfError) : null,
    downloadError ? h('p', { role: 'alert' }, downloadError) : null,
    pdf ? h(React.Fragment, null,
      h('div', { className: 'prism-pdf-page-tools' },
        h('p', { role: 'status', 'data-testid': 'pdf-evidence-pages' }, pdfLocationLabel()),
        pdf.pages.length > 1
          ? h('label', null, 'PDF 原页', h('select', { value: pdf.image.number, disabled: busy,
            onChange: event => void readPdfPage(Number(event.target.value)) },
            pdf.pages.map(number => h('option', { key: number, value: number }, '第 ' + number + ' 页'))))
          : null),
      pdf.includesDisplayText || pdf.truncated ? h('small', { className: 'prism-muted' },
        pdf.includesDisplayText ? '选区含提取分隔符，页码按可核对的正文字符计算。 ' : '',
        pdf.truncated ? '提取曾截断，范围限于已保存正文。' : '') : null,
      h('div', { className: 'prism-pdf-page', tabIndex: 0, role: 'region', 'aria-label': 'PDF 原页阅读区',
        'data-testid': 'pdf-evidence-page', 'data-page': pdf.image.number, key: pdf.image.number },
        h(ReadingPdfImage, { page: pdf.image, onError: () => {
          setPdf(null);
          setPdfError(pdfReviewMessages.PDF_PAGE_RENDER_FAILED);
        } }))) : h('pre', { ref: text, tabIndex: 0, role: 'region', 'aria-label': '原文阅读区',
          className: 'prism-reading-context', 'data-testid': 'comparison-source-text' },
        context.before, h('mark', { ref: match }, context.match), context.after),
    h('div', { ref: pdfHost, hidden: true }));
}

function ReadingComparison({ store, projectId, scopeToken, libraryRevision, papers, currentPapers, active, ready }) {
  const namespace = store.getStorageKey();
  const tableId = 'prism-reading-comparison' + React.useId();
  const [selected, setSelected] = React.useState([]);
  const [snapshot, setSnapshot] = React.useState(null);
  const [query, setQuery] = React.useState('');
  const [mode, setMode] = React.useState('all');
  const [filter, setFilter] = React.useState('all');
  const [notice, setNotice] = React.useState(null);
  const [inspection, setInspection] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [citationFallback, setCitationFallback] = React.useState('');
  const pdfExportHost = React.useRef(null);
  const citationText = React.useRef(null);
  const composing = React.useRef(false);
  const inFlight = React.useRef(null);
  const latest = React.useRef(null);
  latest.current = { selected, scopeToken, libraryRevision, ready, active };
  const available = new Map(papers.map(paper => [paper.id, paper]));
  const titles = new Map();
  for (const paper of papers) titles.set(paper.title, (titles.get(paper.title) ?? 0) + 1);
  const labelFor = (title, id) => titles.get(title) > 1 ? title + ' · ' + id : title;
  const lost = ready ? selected.filter(id => !available.has(id)) : [];
  const view = ready && snapshot?.selected === selected && snapshot.scopeToken === scopeToken
    && snapshot.libraryRevision === libraryRevision ? snapshot.data : null;
  const canRead = ready && selected.length >= 2 && lost.length === 0;
  const count = view?.papers.reduce((total, paper) => total + paper.excerpts.length, 0) ?? 0;
  const canExport = count > 0 && view.papers.every(paper => paper.readable);

  function cancelComparison() {
    inFlight.current?.abort.abort();
    inFlight.current = null;
  }
  React.useLayoutEffect(() => {
    cancelComparison();
    setCitationFallback('');
    setBusy(false);
  }, [scopeToken, libraryRevision, ready, active]);

  React.useEffect(() => {
    if (citationFallback) citationText.current?.focus();
  }, [citationFallback]);

  React.useEffect(() => {
    const listen = event => {
      if (event.key !== null && event.key !== namespace && event.key !== namespace + ':project-library-v1') return;
      cancelComparison();
      setCitationFallback('');
      setSnapshot(null);
      setInspection(null);
      setBusy(false);
      setNotice({ error: '资料或项目范围已在其他标签变化。请重新核对当前范围。' });
    };
    globalThis.window?.addEventListener('storage', listen);
    return () => {
      cancelComparison();
      globalThis.window?.removeEventListener('storage', listen);
    };
  }, [namespace]);

  const inspectionPaper = active && ready && inspection && inspection.scopeToken === scopeToken
    && inspection.libraryRevision === libraryRevision
    ? available.get(inspection.paperId) : null;
  const inspectionValid = inspectionPaper && readingEvidenceCore.readingSourceMatches(inspection.record, inspectionPaper.document);
  React.useEffect(() => {
    if (inspection && !inspectionValid) {
      setInspection(null);
      setNotice({ error: '论文范围或正文已变化。请重新读取对照。' });
    }
  }, [inspection, inspectionValid]);

  function changeSelection(ids) {
    setSelected(ids);
    setNotice(null);
    setCitationFallback('');
  }

  async function run(operation, fallback) {
    if (!active || !ready || inFlight.current) return;
    const token = { selected, scopeToken, libraryRevision, abort: new AbortController() };
    inFlight.current = token;
    const valid = () => {
      const now = latest.current;
      return inFlight.current === token && now.active && now.ready && now.selected === token.selected
        && now.scopeToken === token.scopeToken && now.libraryRevision === token.libraryRevision;
    };
    setBusy(true);
    setNotice(null);
    setCitationFallback('');
    try {
      await operation(valid, token.abort.signal);
    } catch (error) {
      if (valid()) {
        setNotice({ error: error.message === 'READING_COMPARISON_SCOPE_CHANGED'
          ? '论文范围已变化。请重新核对所选文献。' : fallback });
      }
    } finally {
      if (inFlight.current === token) {
        inFlight.current = null;
        setBusy(false);
      }
    }
  }

  function readSelection() {
    return readingEvidenceCore.readReadingComparison({
      namespace, projectId, paperIds: selected, storage: store.annotationStorage, currentPapers,
    });
  }

  function accept(data) {
    setSnapshot({ selected, scopeToken, libraryRevision, data });
  }

  function load() {
    if (!canRead) return;
    return run(async valid => {
      const data = await readSelection();
      if (valid()) accept(data);
    }, '暂时无法读取当前范围的摘录。请重新读取。');
  }

  function locate(event, group, record) {
    if (typeof globalThis.HTMLDialogElement?.prototype.showModal !== 'function') {
      setNotice({ error: '当前浏览器无法打开出处窗口。可到对应论文的已保存摘录中核对。' });
      return;
    }
    event.currentTarget.focus({ preventScroll: true });
    return run(async valid => {
      await readingEvidenceCore.verifyComparisonSource({
        scope: { namespace, projectId, paperId: group.paperId }, storage: store.annotationStorage,
        record, currentPapers,
      });
      if (valid()) setInspection({ paperId: group.paperId, record, scopeToken, libraryRevision });
    }, '已保存摘录或正文来源已变化。请重新读取对照。');
  }

  function output(format, target = null) {
    if (!view || !target && !canExport) return;
    return run(async (valid, signal) => {
      const latestData = await readSelection();
      if (!valid()) return;
      if (JSON.stringify(latestData) !== JSON.stringify(view)) {
        accept(latestData);
        setNotice({ status: '已刷新摘录和出处状态。核对后可再次导出。' });
        return;
      }
      const requested = target ? { ...latestData, papers: latestData.papers
        .filter(group => group.paperId === target.paperId)
        .map(group => ({ ...group, excerpts: group.excerpts.filter(item => item.record.id === target.excerptId) })),
      } : latestData;
      const checked = await readingEvidenceCore.checkReadingSources(requested, {
        currentPapers, isCurrent: valid,
        readPdfMap: (paper, reference) => inspectReadingPdf({ store, mount: pdfExportHost.current,
          currentPapers, paper, reference, isCurrent: valid, signal }),
      });
      const readBack = await readSelection();
      if (!valid()) return;
      if (JSON.stringify(readBack) !== JSON.stringify(latestData)) {
        accept(readBack);
        setNotice({ status: '已刷新摘录和出处状态。核对后可再次导出。' });
        return;
      }
      const file = readingEvidenceCore.exportReadingComparison(checked, format);
      if (target) {
        const pending = checked.papers[0].excerpts[0].sourceCheck.status === 'pending';
        const sourceStatus = pending ? '此条出处待核对。' : '';
        try {
          await globalThis.navigator.clipboard.writeText(file);
          if (valid()) setNotice({ status: '已复制 Markdown 引用，可粘贴到研究稿。' + sourceStatus });
        } catch {
          if (valid()) {
            setCitationFallback(file);
            setNotice({ status: '剪贴板不可用，请在下方手动复制本次复核快照。' + sourceStatus });
          }
        }
      } else {
        downloadReadingData(file, 'PRISM-reading-comparison.' + format,
          format === 'md' ? 'text/markdown;charset=utf-8' : 'application/json');
        setNotice({ status: '已请求下载所选论文的全部已保存摘录及出处核对结果。' });
      }
    }, '暂时无法输出摘录。请重新读取并核对。');
  }

  const term = query.trim().toLowerCase();
  function entries(group) {
    return group.excerpts.filter(({ record, location }) =>
      (filter === 'all' || filter === location)
      && (mode !== 'judgment' || record.judgment.trim())
      && [group.title, record.quote, record.judgment].some(value => value.toLowerCase().includes(term)));
  }

  function evidenceCell(group) {
    if (!group.readable) return h('p', { role: 'alert' }, '无法读取此篇摘录。全部导出已暂停。');
    if (!group.excerpts.length) return h('p', { className: 'prism-muted' }, '暂无已保存摘录。');
    const visible = entries(group);
    if (!visible.length) return h('p', { className: 'prism-muted' }, '没有符合筛选的摘录。');
    return visible.map(({ record, location }) => h('article', {
      key: record.id, className: 'prism-reading-record', 'data-testid': 'comparison-reading-excerpt',
    },
      h('small', { className: 'prism-muted' }, readingSourceLabel(record)),
      mode === 'all' ? h('blockquote', { className: 'prism-reading-quote' }, record.quote) : null,
      record.judgment ? h(React.Fragment, null,
        h('strong', null, '研究者判断'), h(ResearchContent, { text: record.judgment, showRawToggle: false })) : null,
      h('button', { type: 'button', 'aria-disabled': busy || !active || undefined,
        'aria-label': '复制研究稿引用 ' + labelFor(group.title, group.paperId) + ' · 字符 ' + (record.source.start + 1),
        onClick: () => output('md', { paperId: group.paperId, excerptId: record.id }) }, '复制研究稿引用'),
      location === 'current'
        ? h('button', { type: 'button', 'aria-disabled': busy || !active || undefined,
          'aria-label': '核对原文 ' + labelFor(group.title, group.paperId) + ' · 字符 ' + (record.source.start + 1),
          onClick: event => locate(event, group, record) }, '核对原文')
        : guidedHelp('出处待核对', h(React.Fragment, null,
          h('p', { className: 'prism-muted' }, '当前正文与原摘录来源不一致或缺失，无法定位。'),
          h('small', null, '论文 ', group.paperId, ' · 摘录 ', record.id, ' · 正文 SHA-256 ', record.source.sha256)))));
  }

  return h('section', { className: 'prism-evidence-comparison', 'data-testid': 'reading-comparison' },
    h('p', { className: 'prism-muted' }, projectId ? '当前项目 · 已保存摘录' : '共享论文库 · 已保存摘录'),
    !ready ? h('p', { role: 'status' }, '当前论文范围等待核验。')
      : papers.length < 2 ? h('p', { className: 'prism-muted' }, '当前范围至少有两篇论文时可以对照。')
        : guidedHelp('选择文献（' + selected.length + ' 篇）',
          h('fieldset', { className: 'prism-evidence-choice', disabled: busy },
            h('legend', null, '参与对照的论文'),
            papers.map(paper => h('label', { key: paper.id },
              h('input', { type: 'checkbox', checked: selected.includes(paper.id), onChange: event =>
                changeSelection(event.target.checked ? [...selected, paper.id] : selected.filter(id => id !== paper.id)) }),
              h('span', null, labelFor(paper.title, paper.id))))), { open: true }),
    lost.length ? h('div', null,
      h('p', { role: 'alert' }, lost.length + ' 篇已选论文不在当前范围。'),
      guidedButton('移除不可用选项', () => changeSelection(selected.filter(id => available.has(id))), { disabled: busy })) : null,
    h(PrismTableToolbar, {
      label: '摘录对照操作', controls: view ? tableId : undefined,
      refresh: { label: '读取对照', disabled: !active || busy || !canRead, onClick: load },
      exportLabel: '所选论文完整摘录',
      exports: [
        { label: '导出引用 Markdown', disabled: !active || busy || !canExport, onClick: () => output('md') },
        { label: '导出完整 JSON', disabled: !active || busy || !canExport, onClick: () => output('json') },
      ],
    }),
    busy ? h('p', { className: 'prism-muted' }, '正在核对已保存摘录…') : null,
    h('div', { role: 'status' }, notice?.status ?? ''),
    h('div', { role: 'alert' }, notice?.error ?? ''),
    citationFallback ? h('label', null, '研究稿引用 Markdown',
      h('textarea', { ref: citationText, readOnly: true, value: citationFallback, rows: 5 })) : null,
    h('div', { ref: pdfExportHost, hidden: true }),
    snapshot && !view && snapshot.selected === selected && ready
      ? h('p', { className: 'prism-muted' }, '论文档案已更新。请重新读取对照。') : null,
    view ? h(React.Fragment, null,
      h(PrismSearch, { className: 'prism-evidence-filters', 'aria-label': '筛选摘录对照' },
        h('label', null, '搜索原文或判断', h('input', {
          type: 'search', name: 'excerptSearch', autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false, defaultValue: query,
          onCompositionStart: () => { composing.current = true; },
          onCompositionEnd: event => { composing.current = false; setQuery(event.currentTarget.value); },
          onChange: event => { if (!composing.current && !event.nativeEvent.isComposing) setQuery(event.currentTarget.value); },
        })),
        h('label', null, '显示内容', h('select', { value: mode, onChange: event => setMode(event.target.value) },
          h('option', { value: 'all' }, '摘录与判断'), h('option', { value: 'judgment' }, '仅研究者判断'))),
        h('label', null, '出处状态', h('select', { value: filter, onChange: event => setFilter(event.target.value) },
          h('option', { value: 'all' }, '全部'), h('option', { value: 'current' }, '当前正文可定位'),
          h('option', { value: 'unavailable' }, '待核出处')))),
      h('p', { className: 'prism-table-note', role: 'status' },
        '显示 ' + view.papers.reduce((total, paper) => total + entries(paper).length, 0)
        + ' 条 · 导出包含所选论文的全部已保存摘录'),
      h(PrismResearchTable, {
        id: tableId, caption: '文献摘录对照', sourceHeading: '内容', scrollHint: '左右滚动可看其余论文。',
        headers: view.papers.map(group => {
          const title = labelFor(group.title, group.paperId);
          return h('span', { className: 'prism-evidence-column-title', title }, title);
        }),
        rows: h('tr', null, h('th', { scope: 'row' }, '摘录'),
          view.papers.map(group => h('td', { key: group.paperId }, evidenceCell(group)))),
      })) : null,
    inspectionValid ? h(ReadingSourceDialog, {
      paper: inspectionPaper, record: inspection.record, store, projectId, currentPapers, onDismiss: () => setInspection(null),
    }) : null);
}
