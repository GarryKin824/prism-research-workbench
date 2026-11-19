const argumentFieldLabels = {
  question: '研究问题（必填）', conclusion: '阶段性结论', alternatives: '竞争解释', openQuestions: '尚未解决的问题',
};
const argumentMessages = {
  ARGUMENT_CONFLICT: '已保存版本发生变化。当前草稿仍在，可另存为新问题或放弃修改后重开。',
  ARGUMENT_LIMIT: '项目论证已达到保存容量。草稿和已保存版本均保留。',
  ARGUMENT_SAVE_UNKNOWN: '本次保存待核对。草稿仍在，请重开论证区核对已保存版本。',
  ARGUMENT_SCOPE_CHANGED: '项目或来源发生变化，请重新核对。草稿仍在。',
};

function ResearchArgumentPanel({ store, projectId, papers, currentPapers, active, ready, scopeToken, libraryRevision, draftMemory }) {
  const core = readingEvidenceCore.researchArgument;
  const namespace = store.getStorageKey();
  const storage = store.annotationStorage;
  const sessionKey = core.argumentKey(namespace, projectId) + ':tab-draft';
  const ledger = React.useMemo(() => core.createResearchArguments({ namespace, projectId, storage }), [store, projectId]);
  const [entry, setEntry] = React.useState(() => readWorkspaceTabDraft(sessionKey, draftMemory, core.parseArgumentDraft));
  const [versions, setVersions] = React.useState(null);
  const [message, setMessage] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [selectedPaper, setSelectedPaper] = React.useState('');
  const [candidates, setCandidates] = React.useState(null);
  const [sourceStates, setSourceStates] = React.useState(null);
  const [inspection, setInspection] = React.useState(null);
  const [recovery, setRecovery] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const composingSearch = React.useRef(false);
  const fieldAnnouncement = usePrismFieldAnnouncement();
  const operation = React.useRef(null);
  const pdfHost = React.useRef(null);
  const questionField = React.useRef(null);
  const newQuestionButton = React.useRef(null);
  const focusQuestion = React.useRef(false);
  const editorId = React.useId();
  const { draft } = entry;
  const linkedIdentity = JSON.stringify(draft?.links.map(link => [link.paperId, link.record.id, link.record.savedAt, link.record.source.sha256]));
  const savedBase = versions?.find(row => row.draft.id === draft?.id && row.revision === draft.base);
  const dirty = !!draft && (savedBase
    ? JSON.stringify(draft) !== JSON.stringify({ ...savedBase.draft, base: savedBase.revision })
    : !!draft.links.length || Object.keys(argumentFieldLabels).some(field => draft[field]));
  const latestById = new Map(versions?.map(row => [row.draft.id, row]));
  const historical = savedBase && latestById.get(draft.id)?.revision !== draft.base;
  const titleCounts = new Map();
  for (const paper of papers) titleCounts.set(paper.title, (titleCounts.get(paper.title) ?? 0) + 1);
  const canEdit = active && ready && versions !== null && entry.damaged === undefined;
  const scope = { namespace, projectId, storage, currentPapers };
  const chosenPaper = papers.find(paper => paper.id === selectedPaper);

  function updateDraft(next) {
    setEntry(writePaperDraft(sessionKey, draftMemory, next));
  }

  React.useLayoutEffect(() => {
    setBusy(false);
    setCandidates(null);
    setInspection(null);
    setRecovery(false);
    setSourceStates(null);
    return () => {
      operation.current?.abort();
      operation.current = null;
    };
  }, [active, ready, scopeToken, libraryRevision]);

  React.useEffect(() => {
    if (!active || !ready) return;
    let live = true;
    ledger.read().then(rows => { if (live) setVersions(rows); }, () => {
      if (!live) return;
      setVersions(null);
      setMessage({ error: '无法读取已保存论证。现有记录和草稿已保留。' });
    });
    return () => { live = false; };
  }, [active, ready, scopeToken, libraryRevision, ledger]);

  React.useLayoutEffect(() => {
    if (!focusQuestion.current) return;
    focusQuestion.current = false;
    questionField.current?.focus();
  }, [draft?.id]);

  React.useEffect(() => {
    if (!active || !ready || !draft?.links.length) return;
    let live = true;
    const links = draft.links;
    core.resolveArgumentSources(links, scope).then(states => {
      if (live) setSourceStates({ linkedIdentity, states });
    }, () => { if (live) setSourceStates(null); });
    return () => { live = false; };
  }, [active, ready, linkedIdentity, scopeToken, libraryRevision]);

  async function run(task, fallback) {
    if (!canEdit || operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    const isCurrent = () => operation.current === controller && !controller.signal.aborted;
    const guard = () => {
      if (!isCurrent()) throw Error('ARGUMENT_SCOPE_CHANGED');
      currentPapers();
    };
    setBusy(true);
    setMessage(null);
    try {
      guard();
      await task({ isCurrent, guard, signal: controller.signal });
    } catch (error) {
      const conflict = error.message === 'ARGUMENT_CONFLICT';
      if (conflict && isCurrent()) {
        const rows = await ledger.read().catch(() => null);
        if (isCurrent() && rows) setVersions(rows);
      }
      if (isCurrent()) setMessage({ error: argumentMessages[error.message] ?? fallback, conflict });
    } finally {
      if (isCurrent()) {
        operation.current = null;
        setBusy(false);
      }
    }
  }

  function openDraft(next) {
    setMessage(null);
    setRecovery(false);
    setCandidates(null);
    setSourceStates(null);
    setQuery('');
    focusQuestion.current = next !== null;
    updateDraft(next);
  }
  function openVersion(row) { openDraft({ ...row.draft, base: row.revision }); }
  function newQuestion() { openDraft(core.newArgumentDraft(globalThis.crypto.randomUUID())); }

  function save(event) {
    event.preventDefault();
    if (!draft?.question.trim() || !dirty) return;
    void run(async ({ guard, isCurrent }) => {
      const { row, versions: readBack } = await ledger.save(draft, guard);
      if (!isCurrent()) return;
      setVersions(readBack);
      updateDraft({ ...row.draft, base: row.revision });
      setMessage({ status: '已保存版本 ' + row.revision + '，并读回核验。' });
    }, '无法保存研究论证。草稿仍在。');
  }

  function loadCandidates() {
    if (!chosenPaper) return;
    void run(async ({ guard }) => {
      const recordScope = { namespace, projectId, paperId: chosenPaper.id };
      const { excerpts } = await readingEvidenceCore.createReadingEvidence({ scope: recordScope, storage }).read();
      guard();
      setCandidates({ paperId: chosenPaper.id, excerpts });
    }, '无法读取这篇论文的已保存摘录。');
  }

  async function checkLink(link, guard) {
    const [result] = await core.resolveArgumentSources([link], scope);
    guard();
    return result;
  }

  function inspect(link, trigger) {
    void run(async ({ guard }) => {
      const { status, paper } = await checkLink(link, guard);
      if (status === 'current') setInspection({ paper, record: link.record, trigger });
      else setMessage({ error: '出处待核对 · ' + core.ARGUMENT_SOURCE_ISSUES[status] + '。' });
    }, '无法重新核对原文出处。');
  }

  function attach(link) {
    if (draft.links.length >= core.ARGUMENT_MAX_LINKS) return;
    void run(async ({ guard }) => {
      const { status } = await checkLink(link, guard);
      if (status !== 'current' && status !== 'textChanged') {
        setMessage({ error: '摘录未加入。' + core.ARGUMENT_SOURCE_ISSUES[status] + '。' });
        return;
      }
      updateDraft({ ...draft, links: [...draft.links, link] });
      setMessage({ status: status === 'current' ? '摘录已加入草稿。' : '摘录已加入草稿，正文出处待核对。' });
    }, '摘录未加入。请重新读取候选摘录。');
  }

  function exportSaved() {
    if (!savedBase || dirty) return;
    void run(async ({ guard, isCurrent, signal }) => {
      const markdown = await core.exportResearchArgument(savedBase, { ...scope, isCurrent,
        readPdfMap: (paper, reference) => inspectReadingPdf({
          store, mount: pdfHost.current, currentPapers, paper, reference, isCurrent, signal,
        }),
      });
      guard();
      downloadReadingData(markdown, 'PRISM-research-argument.md', 'text/markdown;charset=utf-8');
      setMessage({ status: '已请求下载版本 ' + savedBase.revision + ' 的论证 Markdown。' });
    }, '无法导出研究论证。已保存版本仍在。');
  }

  const button = (text, onClick, disabled = false) => h('button', { type: 'button', onClick, disabled }, text);
  const label = (text, control) => h('label', null, text, control);
  const clean = !dirty && !busy;
  const filter = query.trim().toLowerCase();
  const matching = candidates && candidates.paperId === selectedPaper
    ? candidates.excerpts.filter(record => (record.quote + '\n' + record.judgment).toLowerCase().includes(filter)) : null;
  const picker = draft && h('details', { className: 'prism-argument-picker' },
    h('summary', null, '从论文摘录选材'),
    h('div', { className: 'prism-actions' }, label('论文', h('select', { value: chosenPaper?.id ?? '',
      onChange: event => { setSelectedPaper(event.target.value); setCandidates(null); setQuery(''); } },
    h('option', { value: '' }, '选择项目论文'),
    papers.map(paper => h('option', { key: paper.id, value: paper.id }, titleCounts.get(paper.title) > 1
      ? paper.title + ' · ' + paper.id : paper.title)))), button('读取论文摘录', loadCandidates, !chosenPaper)),
    matching !== null ? h(PrismSearch, { 'aria-label': '筛选论证候选' }, label('搜索摘录或判断', h('input', { type: 'search', name: 'excerptSearch',
      autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false, defaultValue: query,
      onCompositionStart: () => { composingSearch.current = true; },
      onCompositionEnd: event => { composingSearch.current = false; setQuery(event.currentTarget.value); },
      onChange: event => { if (!composingSearch.current && !event.nativeEvent.isComposing) setQuery(event.currentTarget.value); },
      onKeyDown: event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) event.preventDefault(); },
    }))) : null,
    matching?.length === 0 ? h('p', { className: 'prism-muted' }, '没有匹配的已保存摘录。') : null,
    draft.links.length >= core.ARGUMENT_MAX_LINKS ? h('p', { role: 'status' }, '此问题最多关联 ' + core.ARGUMENT_MAX_LINKS + ' 条摘录。') : null,
    matching?.map(record => {
      const link = { paperId: chosenPaper.id, title: chosenPaper.title, record, relation: 'other', note: '' };
      const added = draft.links.some(item => core.argumentLinkKey(item) === core.argumentLinkKey(link));
      return h('article', { className: 'prism-argument-link', key: core.argumentLinkKey(link), 'data-testid': 'argument-candidate' },
        h('p', { className: 'prism-muted' }, readingSourceLabel(record)),
        h('blockquote', { className: 'prism-reading-quote' }, record.quote),
        record.judgment ? h(ResearchContent, { text: record.judgment, showRawToggle: false }) : null,
        h('div', { className: 'prism-actions' }, button('核对原文', event => inspect(link, event.currentTarget)),
          button(added ? '已关联' : '加入论证', () => attach(link), added || draft.links.length >= core.ARGUMENT_MAX_LINKS)));
    }));

  return h('section', { className: 'prism-argument', 'data-testid': 'research-argument', 'aria-label': '研究论证' },
    h('div', { className: 'prism-actions' },
      h('button', { type: 'button', ref: newQuestionButton, onClick: newQuestion, disabled: !canEdit || !clean }, '新建研究问题'),
      versions?.length ? label('已保存问题', h('select', {
        value: savedBase?.draft.id ?? '', disabled: !canEdit || !clean,
        onChange: event => { if (event.target.value) openVersion(latestById.get(event.target.value)); },
      }, h('option', { value: '' }, '选择要打开的问题'), [...latestById.values()].reverse().map(row =>
        h('option', { key: row.draft.id, value: row.draft.id }, row.draft.question)))) : null,
      draft && savedBase ? label('已保存版本', h('select', {
        value: draft.base, disabled: !canEdit || !clean,
        onChange: event => openVersion(versions.find(row => row.draft.id === draft.id && row.revision === Number(event.target.value))),
      }, versions.filter(row => row.draft.id === draft.id)
        .map(row => h('option', { key: row.revision, value: row.revision }, '版本 ' + row.revision)))) : null),
    !ready ? h('p', { role: 'status' }, '正在核对项目范围。') : null,
    entry.damaged !== undefined ? h('p', { role: 'alert' }, '此标签的论证草稿无法解析。原始内容已保留。 ',
      button('下载原始草稿', () => downloadReadingData(entry.damaged, 'PRISM-argument-draft.json'))) : null,
    entry.volatile && dirty ? h('p', { role: 'alert' }, '草稿仅在当前窗口内存中。请保存后再关闭或刷新。') : null,
    busy ? h('p', { className: 'prism-muted' }, '正在读取或核对…') : null,
    fieldAnnouncement.region,
    h('div', { role: 'status' }, message?.status ?? ''),
    h('div', { role: 'alert' }, message?.error ?? ''),
    draft ? h('form', { 'aria-labelledby': editorId, onSubmit: save },
      h('fieldset', { disabled: !canEdit || busy, className: 'prism-argument-editor' },
        h('legend', { id: editorId }, dirty ? '论证草稿 · 有未保存修改' : savedBase ? '论证 · 版本 ' + draft.base : '论证草稿'),
        h('div', { className: 'prism-argument-grid' },
          h('div', null, h(PrismRequiredText, { key: draft.id, as: 'textarea', name: 'question', rows: 2,
            label: argumentFieldLabels.question, inputRef: questionField, value: draft.question, maxLength: core.ARGUMENT_FIELDS.question,
            message: '请输入具体的研究问题。', onFieldError: fieldAnnouncement.say,
            onChange: event => updateDraft({ ...draft, question: event.target.value }) }),
            Object.entries(argumentFieldLabels).filter(([field]) => field !== 'question').map(([field, text]) => h('label', { key: field }, text,
              h('textarea', { name: field, rows: 3, value: draft[field], maxLength: core.ARGUMENT_FIELDS[field],
                onChange: event => updateDraft({ ...draft, [field]: event.target.value }) }))),
            h('div', { className: 'prism-actions' },
              h('button', { type: 'submit', className: 'prism-primary', disabled: (!!savedBase && !dirty) || !!historical }, '保存论证'),
              button('导出论证 Markdown', exportSaved, !savedBase || dirty),
              dirty ? button('放弃修改', () => setRecovery(true)) : button('关闭编辑', () => openDraft(null)),
              message?.conflict || historical
                ? button('作为新问题编辑', () => openDraft({ ...draft, id: globalThis.crypto.randomUUID(), base: 0 })) : null),
            historical ? h('p', { className: 'prism-muted' }, '当前打开的是历史版本。可导出此版本或作为新问题继续编辑。') : null,
            ),
          h('section', { 'aria-label': '论证材料' },
            h('h3', null, '关联摘录', draft.links.length ? '（' + draft.links.length + '）' : ''),
            picker,
            draft.links.map((link, index) => {
              const key = core.argumentLinkKey(link);
              const state = sourceStates?.linkedIdentity === linkedIdentity ? sourceStates.states[index]?.status : null;
              const changeLink = values => updateDraft({ ...draft, links: draft.links.map(item => item === link ? { ...item, ...values } : item) });
              return h('article', { className: 'prism-argument-link', key, 'data-testid': 'argument-link' },
                h('strong', null, link.title), h('blockquote', { className: 'prism-reading-quote' }, link.record.quote),
                link.record.judgment ? h(ResearchContent, { text: link.record.judgment, showRawToggle: false }) : null,
                h('p', { className: 'prism-muted' }, state === 'current' ? '正文可定位' : state
                  ? '出处待核对 · ' + core.ARGUMENT_SOURCE_ISSUES[state] : '出处待核对'),
                guidedHelp('来源标识', h('dl', { className: 'prism-source-identifiers' },
                  h('dt', null, '正文来源'), h('dd', null, readingSourceLabel(link.record)),
                  h('dt', null, '正文 SHA-256'), h('dd', null, link.record.source.sha256),
                  h('dt', null, '论文 ID'), h('dd', null, link.paperId),
                  h('dt', null, '摘录 ID'), h('dd', null, link.record.id),
                  link.record.source.pdfOriginal ? h(React.Fragment, null,
                    h('dt', null, 'PDF 原件'), h('dd', null, link.record.source.pdfOriginal.filename),
                    h('dt', null, 'PDF SHA-256'), h('dd', null, link.record.source.pdfOriginal.sha256)) : null)),
                label('与研究问题的关系', h('select', { value: link.relation,
                  onChange: event => changeLink({ relation: event.target.value }) }, Object.entries(core.ARGUMENT_RELATIONS)
                  .map(([value, name]) => h('option', { key: value, value }, name)))),
                label('论证说明', h('textarea', { rows: 2, maxLength: 1500, value: link.note, onChange: event => changeLink({ note: event.target.value }) })),
                h('div', { className: 'prism-actions' }, button('核对原文', event => inspect(link, event.currentTarget)),
                  button('移出关联', () => updateDraft({ ...draft, links: draft.links.filter(item => item !== link) }))));
            }))))) : null,
    h('div', { ref: pdfHost, hidden: true }),
    recovery ? h(PrismDiscardDialog, { onClose: discard => {
      setRecovery(false);
      if (!discard) return;
      if (savedBase) openVersion(latestById.get(draft.id));
      else openDraft(null);
      requestAnimationFrame(() => (savedBase ? questionField.current : newQuestionButton.current)?.focus());
    } }) : null,
    inspection ? h(ReadingSourceDialog, { paper: inspection.paper, record: inspection.record, store, projectId, currentPapers,
      onDismiss: () => {
        if (document.activeElement !== inspection.trigger) inspection.trigger.focus({ preventScroll: true });
        setInspection(null);
      }, returnLabel: '返回论证' }) : null);
}
