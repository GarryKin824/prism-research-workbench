// Shared lifecycle for the comparison and dictionary editors in the generated client.
function useAnnotationEditor(controller, store, disabled) {
  const [info, setInfo] = React.useState(null);
  const [draft, renderDraft] = React.useState(null);
  const [preview, renderPreview] = React.useState(null);
  const [pending, setPending] = React.useState(null);
  const [notice, setNotice] = React.useState(null);
  const draftRef = React.useRef(null);
  const previewRef = React.useRef(null);
  const life = React.useMemo(() => ({ live: false, action: null }), [controller, disabled]);
  const doc = typeof document === 'undefined' ? null : document;
  const win = doc?.defaultView;

  function setDraft(value) {
    draftRef.current = value;
    renderDraft(value);
  }

  function setPreview(value) {
    previewRef.current = value;
    renderPreview(value);
  }

  function signature(value) {
    return JSON.stringify([value.label ?? null, value.fields]);
  }

  function dirty() {
    const current = draftRef.current;
    return current !== null && signature(current) !== current.initialValue;
  }

  function discardConfirmed() {
    try {
      return win?.confirm('此编辑器有未保存草稿。确定放弃当前草稿？') === true;
    } catch {
      return false;
    }
  }

  function cancelPreview() {
    if (!life.live || disabled || (life.action && life.action.kind !== 'preview')) return;
    life.action = null;
    setPending(null);
    setPreview(null);
  }

  function replaceDraft(next) {
    if (!life.live || disabled || (life.action && life.action.kind !== 'preview')) return false;
    if (next && controller.writeRecovery()) return false;
    if (dirty() && !discardConfirmed()) return false;
    cancelPreview();
    setDraft(next ? { ...next, initialValue: signature(next) } : null);
    setNotice(null);
    return true;
  }

  function changeDraft(update) {
    if (!life.live || disabled || life.action || controller.writeRecovery() || !draftRef.current) return;
    setDraft(update(draftRef.current));
    setPreview(null);
    setNotice(null);
  }

  async function run(kind, action) {
    if (!life.live || disabled || life.action || (kind !== 'load' && controller.writeRecovery())) return;
    const operation = { kind };
    life.action = operation;
    setPending(kind);
    setNotice(null);
    const current = () => life.live && life.action === operation;
    try {
      await action(current);
    } catch (error) {
      if (!current()) return;
      setPreview(null);
      if (error?.outcome === 'not-saved') {
        const retained = draftRef.current ? '草稿已保留。' : '';
        setNotice({ kind: 'not-saved', text: '未保存。回读确认原版本仍在。' + retained + '请重新预览后再确认。' });
      } else if (error?.outcome === 'unknown') {
        setNotice({ kind: 'unknown' });
      } else {
        setNotice({ kind: 'error', text: error?.message || '操作未完成。' });
      }
    } finally {
      if (current()) {
        life.action = null;
        setPending(null);
      }
    }
  }

  async function readList(current) {
    const list = await controller.snapshot();
    if (current()) setInfo(list);
  }

  React.useLayoutEffect(() => {
    life.live = true;
    setInfo(null);
    setPending(null);
    setPreview(null);
    if (!disabled) {
      void run('load', async current => {
        await controller.initialize();
        if (current()) await readList(current);
      });
    }
    const beforeUnload = event => {
      if (dirty() || controller.writeRecovery() || life.action?.kind === 'save') {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const leave = event => {
      if (event.defaultPrevented || event.detail?.kind !== 'slot' || event.detail.namespace !== store.getStorageKey()) return;
      if (life.action?.kind === 'save') {
        event.preventDefault();
        return;
      }
      if (controller.writeRecovery()) {
        let accepted = false;
        try {
          accepted = win?.confirm('此表保存结果未知。请先复制本次尝试内容。仍要切换档案？') === true;
        } catch {}
        if (!accepted) event.preventDefault();
      } else if (dirty() && !discardConfirmed()) {
        event.preventDefault();
      }
    };
    win?.addEventListener('beforeunload', beforeUnload);
    doc?.addEventListener('prism-planning-leave', leave);
    return () => {
      life.live = false;
      life.action = null;
      win?.removeEventListener('beforeunload', beforeUnload);
      doc?.removeEventListener('prism-planning-leave', leave);
    };
  }, [life, store]);

  function prepare(makePreview) {
    return run('preview', async current => {
      setPreview(null);
      const value = await makePreview();
      if (current()) setPreview(value);
    });
  }

  function save() {
    const value = previewRef.current;
    if (!value) return;
    return run('save', async current => {
      await controller.confirm(value, { isCurrent: current });
      if (!current()) return;
      setDraft(null);
      setPreview(null);
      setNotice({ kind: 'saved', text: '已保存。浏览器存储回读与本次版本一致。' });
      try {
        await readList(current);
      } catch {
        if (current()) {
          setInfo(null);
          setNotice({ kind: 'saved', text: '已保存并核对本次版本。列表刷新失败，请刷新列表核对。' });
        }
      }
    });
  }

  return { info, draft, preview, pending, notice, recovery: controller.writeRecovery(),
    replaceDraft, changeDraft, prepare, save, cancelPreview, run,
    refresh: () => run('refresh', async current => {
      setPreview(null);
      await controller.refresh();
      if (current()) await readList(current);
    }),
  };
}

function AnnotationWriteStatus({ notice, recovery }) {
  if (recovery) {
    return h('div', { 'data-testid': 'annotation-write-recovery' },
      h('p', { role: 'alert' }, '保存结果未知。已暂停此表的写入。请复制本次尝试内容，再刷新页面核对已保存历史。'),
      h('details', null, h('summary', null, '查看本次尝试内容'),
        h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 300, overflow: 'auto' } },
          recovery.attemptedRevisionRaw)));
  }
  if (!notice?.text) return null;
  return h('p', { role: notice.kind === 'saved' ? 'status' : 'alert', 'data-write-outcome': notice.kind }, notice.text);
}
