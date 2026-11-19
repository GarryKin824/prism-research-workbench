function workbenchModelNamespace(storageKey) {
  const prefix = 'prism-native-profile-v1:';
  if (!storageKey.startsWith(prefix)) return null;
  const { location, __PRISM_WORKBENCH_MODEL__: configured } = globalThis.window ?? {};
  if (!location) return null;
  if (location.protocol === 'dsh-app:' && location.host === 'app') return storageKey.slice(prefix.length);
  return configured && configured.origin === location.origin && storageKey === prefix + configured.namespace
    ? configured.namespace : null;
}

async function readWorkbenchModelStatus(signal) {
  const state=await readWorkbenchHostStatus(signal);
  return state==='busy'?'ready':state==='unconfigured'?'unavailable':state;
}

async function readWorkbenchHostStatus(signal) {
  const deadline = AbortSignal.timeout(12000);
  const statusSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    const response = await fetch(workbenchModelCore.WORKBENCH_MODEL_STATUS_PATH, {
      credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: statusSignal,
    });
    if (response.status===401) return 'owner-required';
    if (response.status===403 && (await response.json().catch(()=>null))?.code==='MODEL_OWNER_REQUIRED') return 'owner-required';
    const body = response.ok ? await response.json() : null;
    if (!body || JSON.stringify(body.route) !== JSON.stringify(workbenchModelCore.WORKBENCH_MODEL_ROUTE)) {
      return 'unavailable';
    }
    if(['busy','unconfigured','signed-out'].includes(body.state))return body.state;
    return body.ready === true ? 'ready' : body.ready === false ? 'signed-out' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

const automaticStatusLabels={
  MODEL_OWNER_REQUIRED:'本机宿主授权失效。用当前工作台的启动入口重新授权，再只读查回原请求。',
  TRANSPORT:'模型网络连接失败。已保留本次请求。若本机接入模型需要代理，请核对隔离宿主的代理配置后再准备新请求。',
  CODEX_UNCONFIGURED:'Codex 自动执行尚未配置独立工作环境。',
  CODEX_ALLOWANCE_UNCONFIRMED:'含额度执行条件待确认。发送已停用。',
  CODEX_SIGN_IN:'请在独立 Codex 环境完成原生登录。',
  CODEX_PREFLIGHT_TIMEOUT:'Codex 发送前检查超时。本次没有发送；可稍后重新检查连接。',
  CODEX_NOT_DISPATCHED:'暂时无法读取独立 Codex 环境。本次没有发送。',
  CODEX_PREFLIGHT_CONNECTION:'连接独立 Codex 环境失败。本次没有发送；请重新检查连接。',
  CODEX_PREFLIGHT_ACCOUNT:'读取 Codex 账号或额度失败。本次没有发送；请重新检查账号状态。',
  CODEX_PREFLIGHT_SESSION:'Codex 无法建立受限会话。本次没有发送；请核对执行环境。',
  CODEX_LIMIT:'当前 Codex 额度达到限制。',
  CODEX_RUNTIME_POLICY_MISMATCH:'当前 Codex 环境未通过只读文本执行核验。',
  CODEX_ISOLATED_HOME_REQUIRED:'请为 Codex 自动执行选择独立环境。',
  CODEX_TURN_METHOD_UNAVAILABLE:'当前 Codex 版本拒绝了发送命令，未开始生成。',
  CODEX_TURN_INPUT_REJECTED:'Codex 拒绝了本次请求参数，未开始生成。',
  CODEX_TURN_POLICY_REJECTED:'Codex 拒绝了旧版权限参数，未开始生成。',
  CODEX_TURN_ACK_UNCONFIRMED:'Codex 未确认是否开始生成。请只读查回原请求。',
  CODEX_RPC_TIMEOUT:'等待 Codex 接收确认超时。请只读查回原请求。',
  CODEX_TRANSPORT_LOST:'与 Codex 的连接中断。请只读查回原请求。',
  CODEX_REVERIFY_ROUTE:'已取回部分外部记录，实际出答模型仍待确认。',
  MODEL_ROUTE_CHANGED:'外部模型与所选模型不符，本次结果待核对。',
  CODEX_TOOL_REFUSED:'本次请求尝试使用未授权工具，未采纳外部答复。',
};

async function readAutomatic(op,input,signal){
  const response=await fetch(op?executionTargetsCore.AUTOMATIC_EXECUTION_PATH:executionTargetsCore.AUTOMATIC_EXECUTION_STATUS_PATH,{
    credentials:'same-origin',redirect:'error',cache:'no-store',signal,
    ...(op?{method:'POST',body:JSON.stringify({op,input})}:{}),
    headers:{'X-PRISM-Automatic':'1',...(op?{'Content-Type':'application/json'}:{})},
  });
  if(response.status===401)throw Error('MODEL_OWNER_REQUIRED');
  if(!response.ok)throw Error('MODEL_UNAVAILABLE');
  return response.json();
}

function WorkbenchModelPanel({
  namespace, target, verifyNavigation, disabled, existingDraft, onAdopt, discussionText, paperText, pdfText,
  disabledHint, plan=false, review=false, discussionGoalBlank=false, prepareBasis, onHistoryChange, savedRequestId, revisionId,
  requirementsVersion, choice, hostAvailable=true, reviewBasisCurrent, workspaceRecovery,
}) {
  const discussion = discussionText !== undefined;
  const mode = plan ? 'plan' : discussion ? 'discussion' : review?'review':'step';
  const manual=choice?.channel==='manual';
  const automatic=choice?.channel==='automatic';
  const [automaticCapability,setAutomaticCapability]=React.useState(null);
  const [modelStatus, setModelStatus] = React.useState('checking');
  const [preview, setPreview] = React.useState(null);
  const [history, setHistory] = React.useState(null);
  const [dismissed, setDismissed] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [notice, setNotice] = React.useState('');
  const [recoveryText,setRecoveryText]=React.useState('');
  const [recoveryPreview,setRecoveryPreview]=React.useState(null);
  const [recoveryError,setRecoveryError]=React.useState('');
  const recoveryField=React.useRef(null);
  const recoveryHint=React.useId();
  const [includePaper, setIncludePaper] = React.useState(false);
  const [excerptMode,setExcerptMode]=React.useState(false);
  const [range,setRange]=React.useState(null);
  const [firstPage,setFirstPage]=React.useState(()=>String(pdfText?.pageSpans[0]?.page??1));
  const [lastPage,setLastPage]=React.useState(()=>String(pdfText?.pageSpans[0]?.page??1));
  const pageId=React.useId();
  const current = React.useRef(null);
  const active = React.useRef(false);
  const waiting = React.useRef(false);
  const querying=React.useRef(false);
  const waitController = React.useRef(null);
  const targetRaw = JSON.stringify(target);
  const canLock = typeof globalThis.navigator?.locks?.request === 'function';
  const ledger = React.useMemo(() => workbenchModelCore.createWorkbenchExecutionLedger({
    storage: globalThis.localStorage, namespace: target.namespace, projectId: target.projectId,
    withLock: canLock ? (key, fn) => navigator.locks.request(key, { mode: 'exclusive' }, fn) : undefined,
  }), [target.namespace, target.projectId, canLock]);
  const scope = JSON.stringify([targetRaw, disabled, discussionText, includePaper, excerptMode, range, firstPage,lastPage, revisionId, requirementsVersion,choice,hostAvailable]);
  current.current = scope;
  const isCurrent = () => active.current && current.current === scope;
  const path = workbenchModelCore.WORKBENCH_MODEL_PATH;
  const stepHistory = (history ?? []).filter(row => workbenchModelCore.sameWorkbenchStep(row.input.target, target));
  const outstanding = stepHistory.find(row => row.state === 'pending' || row.state === 'unknown');
  const latestReply = stepHistory.findLast(row => row.state === 'returned' && row.mode === mode
    && JSON.stringify(row.input.target) === targetRaw
    && (!revisionId || row.basis?.revision?.review.id===revisionId)
    && (!discussion || discussionGoalBlank || row.input.text===flowOutputRequirementsCore.applyOutputRequirements(discussionText,row.outputRequirements))
    && (!review || (reviewBasisCurrent?.(row.basis?.upstream)??true)));
  const visibleReply = latestReply && ![dismissed,savedRequestId].includes(latestReply.input.requestId) ? latestReply : null;
  const ready=manual||(automatic?automaticCapability?.ready===true:modelStatus==='ready');

  async function readStatus(signal) {
    if(automatic){
      try{
        const response=await readAutomatic(null,null,signal);
        if(!signal?.aborted&&active.current)setAutomaticCapability(
          response.targets.find(item=>item.platform===choice.platform)??{ready:false,code:'CODEX_UNCONFIGURED'});
      }catch(error){if(!signal?.aborted&&active.current)setAutomaticCapability({ready:false,code:
        error.message==='MODEL_OWNER_REQUIRED'?error.message:'MODEL_UNAVAILABLE'})}
      return;
    }
    const state=hostAvailable?await readWorkbenchHostStatus(signal):'unconfigured';
    if (!signal?.aborted && active.current) setModelStatus(state);
  }

  React.useEffect(() => {
    setPreview(null);
    setNotice('');
    setBusy(false);
    setRecoveryPreview(null);
  }, [scope]);

  React.useEffect(() => {
    active.current = true;
    setModelStatus('checking');
    setAutomaticCapability(null);
    const controller = new AbortController();
    if(!manual)void readStatus(controller.signal);
    return () => { active.current = false; controller.abort(); };
  }, [namespace,hostAvailable,manual,automatic]);

  React.useEffect(() => {
    let live = true;
    const refresh = () => ledger.list().then(rows => { if (live) setHistory(rows); }).catch(() => {
      if (live) { setHistory(null); setNotice('执行记录暂时无法核对，发送已暂停。'); }
    });
    setHistory(null);
    void refresh();
    const changed = event => { if (event.key === ledger.key || event.key === null) void refresh(); };
    globalThis.window?.addEventListener?.('storage', changed);
    return () => { live = false; globalThis.window?.removeEventListener?.('storage', changed); };
  }, [ledger, targetRaw]);

  async function refreshHistory() {
    const rows = await ledger.list();
    if (active.current) setHistory(rows);
    onHistoryChange?.();
  }

  async function lookupRecovery(event) {
    event.preventDefault();
    if(disabled||busy||waiting.current||querying.current||outstanding||!canLock||!history) return;
    setRecoveryPreview(null);
    setRecoveryError('');
    let input,savedContext;
    try { ({input,context:savedContext}=workbenchModelCore.readWorkbenchRecoveryKey(recoveryText,namespace,target)); }
    catch(error){
      setRecoveryError(error.message==='MODEL_EXECUTION_SOURCE_CHANGED'
        ?'这份请求属于另一个项目、论文、步骤或版本。请在原档案中查回。'
        :'请选用完整的自动执行请求凭据 JSON。');
      recoveryField.current?.focus();
      return;
    }
    if(input.execution.role!==(revisionId?'revision':'work')){setRecoveryError('请求角色与当前步骤不一致。');return;}
    querying.current=true;
    setBusy(true);
    try {
      const checked=await verifyNavigation(target,isCurrent);
      const document=JSON.parse(checked.instance.sourcePaperRaw).document;
      // A detached record is only adoptable if its exact saved input can be reconstructed.
      const separator='\n\n--- 论文正文片段（仅此范围） ---\n';
      const split=input.text.lastIndexOf(separator);
      const fullSeparator='\n\n--- 论文正文 ---\n';
      const includeDocument=savedContext?.includeDocument??(split>=0||input.text.includes(fullSeparator));
      let picked=savedContext?.range??null;
      if(!savedContext&&split>=0){
        const fragment=input.text.slice(split+separator.length);
        const start=document?.text.indexOf(fragment)??-1;
        if(start<0||!fragment||document.text.indexOf(fragment,start+1)>=0)throw Error('MODEL_RECOVERY_RANGE');
        picked={start,end:start+fragment.length};
      }
      const context=await prepareBasis(target,checked,picked,isCurrent);
      const record=await workbenchModelCore.createWorkbenchExecution(input,checked,'step',includeDocument,globalThis.crypto,context.basis,savedContext?.requirementsVersion);
      const wanted=flowOutputRequirementsCore.applyOutputRequirements(
        workbenchModelCore.composeWorkbenchStepText(checked.node.prompt,document?.text,includeDocument,context.basis),record.outputRequirements);
      if(input.sourceSha256!==checked.instance.sourceSha256||input.text!==wanted)throw Error('MODEL_EXECUTION_SOURCE_CHANGED');
      const result=await readAutomatic('status',{requestId:input.requestId,inputSha256:record.inputSha256},AbortSignal.timeout(10000));
      if(result.state!=='returned'||result.reply?.finish!=='stop')throw Error('MODEL_RECOVERY_NOT_COMPLETE');
      const reply=workbenchModelCore.canonicalWorkbenchReply(input,record.inputSha256,result.reply);
      const verify=()=>{if(!isCurrent())throw Error('MODEL_EXECUTION_SOURCE_CHANGED');checked.verify();context.verify();};
      verify();
      setRecoveryPreview({record,result:{...result,reply},verify});
    }catch(error){
      if(isCurrent())setRecoveryError(error.message==='MODEL_RECOVERY_NOT_COMPLETE'?'宿主账本没有这次请求的已确认完整回执；没有重发。':
        error.message==='MODEL_RECOVERY_RANGE'?'正文片段无法精确、唯一定位；请保留原回执，只读核对。':
        '无法核对原请求的正文、上游、输出要求或宿主账本；没有写入，也没有重发。');
    }finally{querying.current=false;if(active.current)setBusy(false);}
  }

  async function saveRecovery() {
    if(!recoveryPreview||busy||disabled||querying.current||waiting.current||outstanding)return;
    const {record,result,verify}=recoveryPreview;
    querying.current=true;
    setBusy(true);
    try{
      await ledger.recoverReturned(record,result,verify);
      setRecoveryText('');setRecoveryPreview(null);
      await refreshHistory();
      if(isCurrent())setNotice('已把已完成回执追加到当前步骤。可填入结果草稿；没有重新发送。');
    }catch{if(isCurrent())setRecoveryError('当前步骤或执行账本已变化，请重新查回。')}
    finally{querying.current=false;if(active.current)setBusy(false);}
  }

  async function prepare() {
    if (waiting.current || querying.current || outstanding || disabled || !canLock || !history || !ready || visibleReply || discussion&&discussionGoalBlank) return;
    setBusy(true);
    setPreview(null);
    setNotice('');
    try {
      const checked = await verifyNavigation(target, isCurrent);
      const document = JSON.parse(checked.instance.sourcePaperRaw).document;
      const attach = Boolean(!discussion && includePaper && paperText);
      if (attach && document?.text !== paperText) throw Error('MODEL_EXECUTION_SOURCE_CHANGED');
      if (attach && excerptMode && !range) throw Error('MODEL_SOURCE_RANGE');
      const chosenPages=attach&&pdfText&&!excerptMode?readingEvidenceCore.pdfPageRange(document,Number(firstPage),Number(lastPage)):null;
      const pickedRange=chosenPages?{start:chosenPages.start,end:chosenPages.end}:attach&&excerptMode?range:null;
      const context=prepareBasis && !discussion ? await prepareBasis(target,checked,pickedRange,isCurrent) : null;
      const basis=context?.basis??(pickedRange?{range:pickedRange,upstream:[],revision:null}:null);
      const compose=review?workbenchModelCore.composeWorkbenchReviewText:workbenchModelCore.composeWorkbenchStepText;
      const task=discussion ? discussionText : compose(checked.node.prompt,document?.text,attach,basis);
      const requirements=flowOutputRequirementsCore.currentOutputRequirements(checked.instance);
      const text=flowOutputRequirementsCore.applyOutputRequirements(task,requirements);
      const input = await workbenchModelCore.makeWorkbenchModelInput(target, checked, namespace, globalThis.crypto, text,choice);
      const execution = await workbenchModelCore.createWorkbenchExecution(input, checked, mode, attach,globalThis.crypto,basis);
      const verify=()=>{checked.verify();context?.verify();};
      verify();
      if (isCurrent()) setPreview({ execution, verify, pages:chosenPages?.pages??null });
    } catch (error) {
      if (isCurrent()) setNotice({
        MODEL_INPUT_INVALID:'请求超过 24,000 字节或内容无效。长度包含流程输出要求，请缩短正文片段或其他输入。',
        PDF_SOURCE_PAGE_MISSING:'请选择有效的 PDF 起止页，范围内必须有已提取的文字。',
        MODEL_SOURCE_RANGE:'请在正文框中选中一段非空文字，再预览。',
        RESEARCH_STEP_WAITING:'上游结果或人工通过尚未保存。',
        RESEARCH_CHECK_RECEIPT:'请先查回本步骤的请求。',
        RESEARCH_RESULT_ALREADY_SAVED:'当前版本已有答复。人工退回后可以返修。',
        RESEARCH_RESULT_PENDING_SAVE:'请先处理已返回的答复。',
        RESEARCH_REVISION_INSTRUCTION_REQUIRED:'请在复核中填写具体返修意见。',
      }[error.message]||'步骤、正文或上游记录已变化。请重新核对。');
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  async function send() {
    if (waiting.current || querying.current || outstanding || disabled || !canLock || !history || !preview || !ready) return;
    const { execution, verify } = preview;
    const { input } = execution;
    waiting.current = true;
    let recorded = false, submitted = false, protecting = false;
    setBusy(true);
    setPreview(null);
    setNotice('正在保存发送记录。');
    try {
      verify();
      await ledger.begin(execution, verify);
      recorded = true;
      if(input.execution?.channel==='manual'){
        if(isCurrent())setNotice('交接已记入本机。请在外部执行端手动发送，已有外部会话请先查回。');
        return;
      }
      protecting = true;
      await workspaceRecovery?.protectRequest();
      protecting = false;
      verify();
      const controller = new AbortController();
      waitController.current = controller;
      submitted = true;
      setSending(true);
      onHistoryChange?.(target.nodeId);
      setNotice(input.execution?.channel==='automatic'?'正在提交自动执行请求。':'正在等待 DeepSeek 答复。');
      const signal=globalThis.AbortSignal?.any
        ?AbortSignal.any([controller.signal,AbortSignal.timeout(55000)]):controller.signal;
      if(input.execution?.channel==='automatic'){
        const result=await readAutomatic('submit',input,signal);
        const saved=await ledger.settle(input.requestId,result);
        if(isCurrent())setNotice(automaticStatusLabels[saved.code]??(saved.state==='pending'?'已登记自动执行请求，正在查询。':'自动执行状态已更新。'));
        return;
      }
      const response = await fetch(path, {
        method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal,
      });
      if(response.status===401)throw Error('MODEL_OWNER_REQUIRED');
      const result = await response.json();
      if(result.code==='MODEL_OWNER_REQUIRED')throw Error(result.code);
      if (!response.ok) {
        const refused = ['MODEL_BUSY','MODEL_ACCOUNT_SIGN_IN_REQUIRED','MODEL_INPUT_INVALID','MODEL_ROUTE_CHANGED',
          'MODEL_TOOLS_REFUSED','MODEL_REQUEST_NOT_DISPATCHED'].includes(result.code);
        await ledger.settle(input.requestId, { state: refused ? 'refused' : 'unknown', code: refused ? result.code : null });
        if(isCurrent())setNotice(result.code === 'MODEL_ACCOUNT_SIGN_IN_REQUIRED'
          ? '从左下角账号菜单登录 DeepSeek，再刷新账号状态。'
          : refused ? '宿主拒绝了本次请求，未提交模型。' : '答复未确认。请使用「只读查回」核对本次请求。');
        return;
      }
      const saved = await ledger.settle(input.requestId, { state: 'returned', reply: result });
      if (isCurrent()) setNotice(saved.reply.finish === 'max-tokens'
        ? '答复在 512 token 上限截断，已保留收到的部分。' : '答复已写入本机执行记录。');
    } catch (error) {
      if (recorded) {
        try { await ledger.settle(input.requestId, { state: submitted ? 'unknown' : 'refused',
          code: submitted ? (error.message==='MODEL_OWNER_REQUIRED'?error.message:null) : 'MODEL_REQUEST_NOT_DISPATCHED' }); } catch {}
      }
      if (isCurrent()) setNotice(submitted ? (error.message==='MODEL_OWNER_REQUIRED'?automaticStatusLabels.MODEL_OWNER_REQUIRED
        :'答复未确认。请使用「只读查回」，先核对这次请求。')
        : protecting ? '本机副本未能保存本次请求，未提交模型。请检查副本状态。'
          : '发送记录未完成或当前来源已变化，本次没有提交模型。');
    } finally {
      waitController.current = null;
      waiting.current = false;
      if (active.current) {
        setSending(false);
        setBusy(false);
        try { await refreshHistory(); } catch { setHistory(null); onHistoryChange?.(); }
      } else onHistoryChange?.();
    }
  }

  async function checkReceipt(cancel=false,quiet=false) {
    if (!outstanding || outstanding.input.execution?.channel==='manual'||waiting.current||querying.current||busy) return;
    querying.current=true;
    setBusy(true);
    const { input, inputSha256 } = outstanding;
    try {
      if(input.execution?.channel==='automatic'){
        const result=await readAutomatic(cancel?'cancel':'status',{requestId:input.requestId,inputSha256},globalThis.AbortSignal?.timeout?.(8000));
        const saved=await ledger.settle(input.requestId,result.state==='not-found'?{state:'unknown',code:'MODEL_RECEIPT_MISSING'}:result);
        await refreshHistory();
        if(isCurrent()&&(!quiet||saved.state!=='pending'))setNotice(cancel?(result.requested?'已请求外部取消，等待终态。':'当前无法向外部提交取消，仍可查询。'):
          automaticStatusLabels[saved.code]??(saved.state==='returned'?'已取回已完成的答复。':saved.state==='pending'?'外部任务仍在处理。':
            saved.state==='cancelled'?'外部平台确认已中断。':saved.state==='failed'?'外部任务失败，研究流程仍待处理。':'结果待核对。请使用原请求查询。'));
        return;
      }
      const response = await fetch(workbenchModelCore.WORKBENCH_MODEL_RECEIPT_PATH, {
        method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: input.requestId, inputSha256 }),
        signal:globalThis.AbortSignal?.timeout?.(8000),
      });
      if (response.status===401)throw Error('MODEL_OWNER_REQUIRED');
      if (!response.ok) {
        const body=await response.json().catch(()=>null);
        throw Error(body?.code==='MODEL_OWNER_REQUIRED'?body.code:'MODEL_RECEIPT_UNAVAILABLE');
      }
      const result = await response.json();
      if (!['pending','unknown','not-found','returned','failed','cancelled','refused'].includes(result.state)) throw Error('MODEL_RECEIPT_INVALID');
      const saved = await ledger.settle(input.requestId, result.state === 'not-found' ? { state:'unknown' } : result);
      await refreshHistory();
      if (isCurrent()) setNotice(saved.state === 'returned' ? '已从宿主账本取回答复。'
        : saved.state === 'pending' ? '宿主仍在处理。可以稍后继续只读查回。'
        : saved.state === 'unknown' ? '宿主没有已核对的终态。已保留请求，暂不开放再次发送。'
        : automaticStatusLabels[saved.code]??'已核对本次非完成结果。研究步骤未推进。');
    } catch (error) {
      if (isCurrent()) setNotice(error.message==='MODEL_OWNER_REQUIRED'?automaticStatusLabels.MODEL_OWNER_REQUIRED
        :'读取宿主账本失败。原记录已保留，请稍后只读查回。');
    } finally {
      querying.current=false;
      if (active.current) setBusy(false);
    }
  }

  const poll=React.useRef(null);
  poll.current=()=>checkReceipt(false,true);
  const pollingId=outstanding?.state==='pending'&&outstanding.input.execution?.channel==='automatic'?outstanding.input.requestId:null;
  React.useEffect(()=>{
    if(!pollingId)return;
    const timer=setInterval(()=>void poll.current(),1700);
    return ()=>clearInterval(timer);
  },[pollingId]);

  async function adopt() {
    if(review)return;
    if (disabled || busy || existingDraft || !visibleReply || discussion&&visibleReply.reply.finish!=='stop') return;
    const candidate=visibleReply;
    setBusy(true);
    try {
      const checked=await verifyNavigation(target,isCurrent);
      if(!isCurrent())return;
      checked.verify();
      if (onAdopt(candidate.reply, candidate) !== true) throw Error('MODEL_DRAFT_UNAVAILABLE');
      setNotice(plan?'建议已填入计划草稿。':discussion ? '建议已填入 Prompt 草稿。' : '已填入结果草稿。');
      if (discussion) setDismissed(candidate.input.requestId);
    } catch {
      if(isCurrent())setNotice(plan?'建议格式无法核对，原计划草稿未变。':'当前草稿或节点已变化，请核对后再填入。');
    } finally {
      if(isCurrent())setBusy(false);
    }
  }

  async function closeManual(record,details) {
    if(waiting.current||busy||!outstanding||outstanding.input.requestId!==record.input.requestId)return;
    waiting.current=true;
    setBusy(true);
    try {
      const verify=()=>{if(!isCurrent())throw Error('EXECUTION_CONTEXT_CHANGED')};
      if(details){
        const reply=workbenchModelCore.manualWorkbenchReply(record,details);
        const settled=await ledger.settle(record.input.requestId,{state:'returned',reply},verify);
        if(settled.state!=='returned'||JSON.stringify(settled.reply)!==JSON.stringify(reply))throw Error('EXECUTION_CONTEXT_CHANGED');
        if(isCurrent())setNotice(record.mode==='review'?'已登记辅助复核建议。请另行填写你的正式决定。':'已登记外部答复。');
      }else{
        await ledger.settle(record.input.requestId,{state:'cancelled',code:'MANUAL_HANDOFF_CLOSED'},verify);
        if(isCurrent())setNotice('本次交接已结束。外部会话状态由外部平台管理。');
      }
      await refreshHistory();
    }catch{
      if(isCurrent())setNotice('未能登记。请核对会话标识、答复和用量后再试。');
    }finally{
      waiting.current=false;
      if(isCurrent())setBusy(false);
    }
  }

  const pre = text => h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 300, overflow: 'auto' } }, text);
  return h('section', { 'data-testid': 'workbench-node-model', 'aria-busy': busy },
    h('h4', null, plan?'AI 计划建议':discussion?'AI 规划':review?'AI 辅助复核':'模型执行'),
    h('p',{className:'prism-muted'},executionTargetsCore.executionChoiceLabel(choice),manual?' · 人工交接':automatic?' · 自动执行':' · 宿主直连'),
    !discussion && paperText && !preview && !visibleReply && !disabled ? h('div',null,
      h('label', null,h('input', {type:'checkbox', checked:includePaper, disabled:busy,
        onChange:event=>setIncludePaper(event.target.checked)}),'附上论文正文'),
      includePaper&&pdfText&&!excerptMode?h('div',{className:'prism-form'},
        h('p',{className:'prism-muted',id:pageId+'-hint'},'选定页的提取文字才发送。页号按 PDF 文件内顺序；图像页和未提取页不发送。'),
        h('label',{htmlFor:pageId+'-first'},'PDF 起始页',h('input',{id:pageId+'-first',type:'number',min:1,max:pdfText.pagesRead,step:1,'aria-describedby':pageId+'-hint',value:firstPage,disabled:busy,onChange:e=>setFirstPage(e.target.value)})),
        h('label',{htmlFor:pageId+'-last'},'PDF 结束页',h('input',{id:pageId+'-last',type:'number',min:1,max:pdfText.pagesRead,step:1,'aria-describedby':pageId+'-hint',value:lastPage,disabled:busy,onChange:e=>setLastPage(e.target.value)}))):null,
      includePaper ? h('label',null,h('input',{type:'checkbox',checked:excerptMode,disabled:busy,
        onChange:event=>{setExcerptMode(event.target.checked);setRange(null);}}),'只发送我选中的正文片段') : null,
      includePaper&&excerptMode ? h('label',null,'在正文中选中要发送的文字',
        h('textarea',{value:paperText,readOnly:true,rows:8,disabled:busy,'data-testid':'model-source-selection',
          onSelect:event=>{const {selectionStart:start,selectionEnd:end}=event.currentTarget;
            setRange(end>start?{start,end}:null);}}),
        h('span',{role:'status'},range?'已选择 '+(range.end-range.start)+' 个文本位置':'还未选择片段')) : null) : null,
    disabled && !discussion ? h('p', null, disabledHint||'请先保存当前步骤。') : null,
    !manual&&!automatic?h('p',{role:'status'},({checking:'正在读取 DSH 状态。',unconfigured:'此工作台未配置 DSH 直连。',
      unavailable:'暂时无法读取 DSH 连接。', 'signed-out':'DSH 未登录。可从左下角账号菜单登录 DeepSeek。',
      'owner-required':automaticStatusLabels.MODEL_OWNER_REQUIRED,
      busy:'DSH 正在处理请求。请稍后刷新状态。',
      ready:(history??[]).some(row=>row.state==='returned'&&(!row.input.execution||row.input.execution.channel==='host'))
        ?'DSH 账号可用，本项目有已验证的宿主回执。':'DSH 账号可用，本项目尚无成功回执。'})[modelStatus]):null,
    !manual&&!automatic&&modelStatus!=='ready'&&hostAvailable?h('button',{disabled:busy,onClick:()=>readStatus()},'刷新账号状态'):null,
    automatic?h('div',null,
      h('p',{role:'status'},automaticCapability===null?'正在核对自动执行接口。':automaticCapability.ready?
        '独立 Codex 账号和额度窗口已核对。发送时会再次核对额度与所选模型。':
        automaticStatusLabels[automaticCapability.code]??'暂时无法读取自动执行接口。'),
      !automaticCapability?.ready?h('button',{type:'button',disabled:busy,onClick:()=>readStatus()},'刷新自动执行状态'):null):null,
    manual&&choice.platform==='codex'?h(CodexReadinessPanel):null,
    !canLock ? h('p', { role:'status' }, '此环境无法协调执行记录写入，发送已暂停。') : null,
    outstanding?.input.execution?.channel==='manual'?h(WorkbenchManualHandoff,{key:outstanding.input.requestId,record:outstanding,busy:busy||!canLock,onClose:details=>closeManual(outstanding,details)})
    :outstanding ? h('div', null,
      h('p', {role:'status'},outstanding.native?.phase==='running'?'外部正在运行。':
        outstanding.native?.phase==='accepted'?'已接收，等待会话启动。':'有一次请求待核对。',' 请求号 ',outstanding.input.requestId),
      outstanding.native?.sessionId?h('p',null,'外部会话 ',outstanding.native.sessionId,
        outstanding.native.turnId?' · 执行 '+outstanding.native.turnId:''):null,
      h('button', { disabled:busy || !canLock, onClick:()=>checkReceipt() }, '只读查回'),
      outstanding.input.execution?.channel==='automatic'&&outstanding.native?.turnId?
        h('button',{type:'button',disabled:busy,onClick:()=>checkReceipt(true)},'请求取消外部执行'):null) : null,
    sending ? h('button', { 'aria-label':'停止本地等待，外部状态仍以查回为准',onClick:()=>waitController.current?.abort() }, '停止等待') : null,
    mode==='step'&&prepareBasis&&canLock&&!disabled&&!outstanding&&!visibleReply ? h('details',null,
      h('summary',null,'查回未登记的自动执行回执'),
      h('form',{className:'prism-form','aria-label':'查回自动执行回执',onSubmit:lookupRecovery},
        h('p',{id:recoveryHint},'使用原请求凭据，联系同一个宿主账本。查回不会发送模型请求。'),
        h('label',null,'原请求凭据 JSON',h('textarea',{ref:recoveryField,rows:4,required:true,maxLength:64000,value:recoveryText,
          'aria-describedby':recoveryHint+(recoveryError?' '+recoveryHint+'-error':''),
          'aria-invalid':Boolean(recoveryError),disabled:busy,onChange:e=>{setRecoveryText(e.target.value);setRecoveryError('');setRecoveryPreview(null);}})),
        h('p',{id:recoveryHint+'-error',role:'status'},recoveryError),
        h('button',{type:'submit',disabled:busy||!history},'只读查回已完成回执')),
      recoveryPreview?h('div',null,h('p',null,'已核对请求 '+recoveryPreview.record.input.requestId),pre(recoveryPreview.result.reply.answer),
        h('button',{type:'button',disabled:busy,onClick:saveRecovery},'登记这份已完成回执')):null):null,
    !preview && !visibleReply && !outstanding ? h('button', { className:'prism-primary',
      disabled:disabled||busy||!canLock||!history||!ready||discussion&&discussionGoalBlank,onClick:prepare },
      plan?'预览计划请求':discussion?'预览讨论请求':review?'预览辅助复核':revisionId?'预览返修请求':'预览模型请求') : null,
    preview ? h('div', null,
      h('p',{className:'prism-muted'},executionTargetsCore.executionChoiceLabel(preview.execution.input.execution),' · 输入 ',
        new TextEncoder().encode(preview.execution.input.text).length,' / 24,000 字节',manual||automatic?'':' · 输出上限 512 tokens'),
      preview.pages?h('p',{className:'prism-muted'},'本次附正文的 PDF 文件内页：'+preview.pages.join('、')):null,
      h('p',{className:'prism-muted'},manual?'PRISM 交接不发出请求。外部执行端的额度与费用需在该端核对。'
        :automatic?'标准服务级别。仅在独立账号的含额度条件通过时发出请求。'
        :'宿主提供实际用量。当前费用与余额不可见，请核对后确认发送。'),pre(preview.execution.input.text),
      h('button', { className:'prism-primary', disabled: disabled || busy || !ready, onClick: send }, manual?'保存待交接请求':'确认发送一次'),
      h('button', { onClick: () => setPreview(null) }, '取消预览')) : null,
    visibleReply ? h('div', null,
      h('p',{className:'prism-muted'},executionTargetsCore.executionChoiceLabel(visibleReply.input.execution),
        visibleReply.input.execution?.channel==='manual'?' · 手工登记，外部来源待核验':
          visibleReply.input.execution?.channel==='automatic'?' · 外部自动执行回执':' · 宿主回执',
        review?' · 辅助建议':''),
      visibleReply.reply.finish==='max-tokens'?h('p',{role:'status'},visibleReply.input.execution?.channel==='host'||!visibleReply.input.execution
        ?'答复已在 512 token 上限截断。工作步骤可先保存部分答复，再在复核中退回并说明要补查的问题。':'此回执仅保留部分答复。'):null,
      pre(visibleReply.reply.answer),
      !review?h('button', { className:'prism-primary', disabled: disabled || busy || existingDraft || discussion&&visibleReply.reply.finish!=='stop', onClick: adopt }, plan?'填入计划草稿':discussion ? '将建议填入 Prompt 草稿' : '填入本节点原文草稿'):null,
      h('button', {onClick:()=>{setDismissed(visibleReply.input.requestId);setNotice('')}},'关闭答复'),
      existingDraft ? h('p', null, '已有原文或来源草稿。请先保存该草稿。') : null) : null,
    stepHistory.length ? h('details', null, h('summary', null, '本机执行记录'),
      ...stepHistory.map(row=>h('details',{key:row.input.requestId},h('summary',null,executionTargetsCore.executionChoiceLabel(row.input.execution),' · ',
        ({pending:'待查回',unknown:'结果待核对',returned:row.reply?.finish==='max-tokens'?'已返回部分答复':'已返回答复',
          refused:'发送前拒绝',failed:'调用失败',cancelled:'调用取消'})[row.state]),
        h('p',null,row.input.requestId,(row.reply?.externalSessionId??row.native?.sessionId)
          ?' · 外部会话 '+(row.reply?.externalSessionId??row.native?.sessionId):''),
        row.code&&automaticStatusLabels[row.code]?h('p',null,automaticStatusLabels[row.code]):null,
        h('details',null,h('summary',null,row.outputRequirements?.version
          ?'本次使用的流程输出要求 · 第 '+row.outputRequirements.version+' 版':'本次没有保存流程输出要求'),
          row.outputRequirements?.text?pre(row.outputRequirements.text):null),
        row.native?.turnId?h('p',null,'外部执行 '+row.native.turnId):null,
        row.native?.partial?h(React.Fragment,null,h('p',null,'未完成或来源待核对的文字'),pre(row.native.partial)):null,
        row.reply?.usage?h('p',null,'用量 ',JSON.stringify(row.reply.usage)):null,
        JSON.stringify(row.input.target)===targetRaw&&row.basis?.range&&pdfText
          ?h('p',null,'发送的 PDF 文件内页：',workbenchModelCore.describeWorkbenchPdfRange(row.basis,pdfText).join('、')||'待核对'):null,
        row.input.execution?.channel==='automatic'?h('button',{type:'button',onClick:()=>{
          const raw=JSON.stringify(workbenchModelCore.makeWorkbenchRecoveryKey(row));
          downloadReadingData(raw,'PRISM-request-'+row.input.requestId+'.json');
        }},'下载原请求凭据'):null,
        row.reply&&row.input.requestId!==visibleReply?.input.requestId?pre(row.reply.answer):null))) : null,
    notice ? h('p', { role: 'status' }, notice) : null);
}
