function WorkspaceRecovery({ recovery, store, onRestore, canSave }) {
  const state = React.useSyncExternalStore(recovery.subscribe, recovery.getSnapshot, recovery.getSnapshot);
  React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [confirm, setConfirm] = React.useState(false);
  const [version, setVersion] = React.useState('current');
  const busy = ['checking', 'saving', 'restoring'].includes(state.phase);
  React.useEffect(() => {
    void recovery.inspect();
    const save = () => { if (canSave()) void recovery.save(); };
    const timer = setInterval(save, 8000);
    const visibility = () => { if (document.visibilityState === 'hidden') save(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [recovery, canSave]);
  const status = state.phase === 'checking' ? '正在检查本机副本'
    : state.phase === 'saving' ? '正在保存本机副本'
    : state.phase === 'restoring' ? '正在核验恢复'
    : state.phase === 'error' ? '本机副本未更新'
    : state.empty && state.current ? '找到可恢复的本机副本'
    : state.paused ? '本机副本已暂停'
    : state.paired && state.current ? (state.current.summary?.version === 1 ? '旧版副本已保存 · ' : '本机副本已保存 · ') + new Date(state.current.savedAt).toLocaleString()
    : '本机副本未启用';
  const snapshots = [state.current, state.previous, ...(state.legacy ?? [])].filter(Boolean);
  const snapshot = snapshots.find(row => row.fingerprint === version) ?? state.current;
  const coverage = info => !info ? null : info.version === 1
    ? 'exp.3 副本含正文、项目、流程与请求记录。PDF 原件、阅读摘录、论证和编辑草稿未包含。'
    : '含正文、项目、流程与请求记录 · PDF 原件 ' + info.originals + ' 份 · 阅读摘录 ' + info.excerpts + ' 条 · 论证 ' + info.arguments
       + ' 个版本 · 编辑草稿 ' + info.drafts + ' 份。' + (info.missingOriginals ? '当前正文引用的原件有 ' + info.missingOriginals + ' 份不在原件库，请用匹配的原 PDF 补存。' : '');
  return h('details', { className: 'prism-workspace prism-recovery', open: state.empty && !!state.current ? true : undefined },
    h('summary', null, h('span', { role: 'status' }, status)),
    h('div', { className: 'prism-recovery-content' },
      state.phase === 'error' ? h('p', null, ({
        RECOVERY_CONFLICT: '本机已有不同版本。请在原浏览器档案继续使用，或在空档案恢复。本次未覆盖。',
        RECOVERY_OLD_CLIENT: '这个标签使用旧版工作台。请重新打开新版；统一副本仍保留。',
        RECOVERY_DESTINATION_OCCUPIED: '当前浏览器已有 PRISM 资料，未恢复。请在空档案操作。',
        RECOVERY_LOCK_UNAVAILABLE: '此浏览器不能安全写入本机副本。请使用项目便携备份。',
        RECOVERY_PDF_LIMIT: '原件超过统一副本的 40 MiB 总量。先从原件库逐份下载到独立目录，并保留项目便携备份。本次副本未更新。',
        RECOVERY_TEXT_SIZE: '正文、账本和草稿超过 12 MiB。本次副本未更新，请先分开导出项目资料。',
        RECOVERY_SIZE: '整份副本超过 70 MiB。本次副本未更新，请另存原件和项目资料。',
        RECOVERY_DISK_FULL: '宿主磁盘空间不足。本次副本未更新。释放磁盘空间后重新保存，原资料保留。',
        RECOVERY_PDF_READ: '有 PDF 字节未能核验或读取。原副本仍在，请到 PDF 原件库核对后重试。',
        RECOVERY_DRAFT_NOT_STORED: '有草稿只在本页内存，本次副本未更新。请先下载或复制这些草稿，再释放浏览器存储空间。',
        RECOVERY_DRAFT_CONFLICT: '当前标签草稿与浏览器存档不同。请先分别保留原文并核对，本次副本未更新。',
        RECOVERY_CHANGED: '核对时资料刚有变化。原副本仍在，请再点一次保存。',
        RECOVERY_ROLLBACK_UNCONFIRMED: '恢复结果待核对。请保留宿主副本，在另一个空白浏览器档案重试。',
        QuotaExceededError: '浏览器剩余空间不足。本次操作未完成，请先保留宿主副本并使用空白档案或释放空间。',
      }[state.error] ?? '本机副本操作未完成。请保留此页和便携备份，检查宿主后再试。')) : null,
      state.current?h('p',{className:'prism-muted'},'最近成功保存于 '+new Date(state.current.savedAt).toLocaleString()+'。'+coverage(state.current.summary)):null,
      state.occupiedMaterials?h('p',{role:'status'},'这个浏览器已存有原件或摘录。整份恢复只在空档案中开放，请使用另一个空白档案。'):null,
      h('p', { className: 'prism-muted' }, '草稿覆盖摘录、论证、研究步骤、统一输出要求及答复。账号、临时文件和高级人工工具中的预览需另行保管。'),
      state.empty && state.current
        ? h('div', { className: 'prism-recovery-actions' },
          h('label', null, '恢复版本 ', h('select', { value: snapshot?.fingerprint, disabled: busy, onChange: event => { setConfirm(false); setVersion(event.target.value); } },
            snapshots.map((row, index) => h('option', { key: row.fingerprint, value: row.fingerprint }, (index===0?'最近副本':index===1?'上一份副本':'旧版备份')+' · '+new Date(row.savedAt).toLocaleDateString())))),
          h('button', { type: 'button', disabled: busy || !snapshot, onClick: () => {
            if (!confirm) return setConfirm(true);
            setConfirm(false);
            void recovery.restore(snapshot.fingerprint).then(ok => { if (ok) onRestore(); });
          } }, confirm ? '确认恢复到本浏览器' : '核对并恢复'),
          confirm ? h('button', { type: 'button', onClick: () => setConfirm(false) }, '取消') : null,
          confirm ? h('span', null, '副本时间 ' + new Date(snapshot.savedAt).toLocaleString() + '。'+coverage(snapshot.summary)+' 待查回请求仍需核查。') : null)
        : h('div', { className: 'prism-recovery-actions' },
          h('button', { type: 'button', disabled: busy || !canSave(), onClick: () => void recovery.save({ explicit: true }) },
            state.paused ? '恢复保存本机副本' : state.paired ? '立即保存本机副本' : '启用本机副本'),
          state.paired&&!state.paused?h('button',{type:'button',disabled:busy,onClick:()=>void recovery.pause()},'暂停更新副本'):null,
          h('button', { type: 'button', disabled: busy, onClick: () => void recovery.inspect() }, '检查状态')),
    ));
}
