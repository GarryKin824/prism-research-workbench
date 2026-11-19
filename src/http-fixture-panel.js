/** Dedicated minimal Host test UI. It is not the full DSH web shell. */
function HttpFixturePanel({controller,paper}){
 const s=React.useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);
 const [workspaceId,setWorkspaceId]=React.useState(''),[providerId,setProviderId]=React.useState(''),[step,setStep]=React.useState(0),[confirmedKey,setConfirmedKey]=React.useState(null),[message,setMessage]=React.useState('');
 const key=r=>JSON.stringify([r.requestId,r.bindingHash]);
 const fingerprint=JSON.stringify([providerId,workspaceId,paper?.id,step,paper?.steps?.[step]?.prompt,paper?.steps?.[step]?.promptVersion,s.records.map(r=>[r.requestId,r.bindingHash,r.canConfirm])]);
 React.useEffect(()=>setConfirmedKey(null),[fingerprint]);
 React.useEffect(()=>{setStep(0);setConfirmedKey(null)},[paper?.id]);
 const act=async fn=>{setMessage('');try{await fn()}catch(e){setMessage(e.message)}};
 const b=(label,fn,disabled=false)=>h('button',{type:'button',style:secondary,disabled:disabled||s.busy||!s.available,onClick:()=>act(fn)},label);
 return h('section',{'data-testid':'http-fixture-host',style:{...box,marginBottom:20}},h('h2',null,'受控 loopback HTTP 测试 · 非真实账号'),
 h('p',null,'仅由明确的本地测试启动器注册假 HTTP provider，经官方 HTTP adapter 发送到 Host 创建的 127.0.0.1 服务。不是任何真实账户连接或真实模型调用。论文研究状态只读，不把测试结果记为研究成果。'),
 h('p',{'data-testid':'local-consent-boundary'},'一次许可仅针对预览绑定的 loopback HTTP body：最多一次 POST HTTP 请求，0 次外部网络发送，测试费用不适用。真实 provider 费用仍未知。完整 body 和 endpoint 会展示，展示并绑定 SDK metadata headers；authorization 只显示固定测试占位符，不是用户凭据。传输层可能另加 Host / Content-Length / Connection，因此不是完整网络字节审核。不是任何真实模型、工具或后续请求的授权。Host 在执行前持久化 attempted；超时、断连或重启后未知状态只能回查，不能把未知当失败重发。'),
 h('p',null,'仅点击后请求当前 Host。预览会保存精确 Prompt；确认才受理执行，受理不等于完成。勾选不是权限凭证，Host 独立验证 owner。断连或未知结果不能自动重发；取消已请求不代表已停止。'),
 b('检查 HTTP 测试能力',()=>controller.checkCapability()),b('加载测试 provider',()=>controller.listProviders(),!s.capability),b('加载 HTTP 测试注册项目',()=>controller.listRegisteredWorkspaces(),!s.capability),
 h('label',null,'明确选择测试 provider / model ',h('select',{'data-testid':'http-fixture-provider',value:providerId,disabled:s.busy,onChange:e=>{setProviderId(e.target.value);setConfirmedKey(null)},style:secondary},h('option',{value:''},'请选择，不自动选首项'),s.providers.map(p=>h('option',{key:p.id,value:p.id},p.id+' · '+p.provider+' / '+p.model+' · '+p.endpoint)))),
 h('label',null,'明确选择正式注册项目 ',h('select',{'data-testid':'http-fixture-workspace',value:workspaceId,disabled:s.busy,onChange:e=>{setWorkspaceId(e.target.value);setConfirmedKey(null)},style:secondary},h('option',{value:''},'请选择，不自动选首项'),s.workspaces.map(w=>h('option',{key:w.id,value:w.id},w.title+' · '+w.id+' · '+w.path)))),
 h('label',null,'选中论文节点 ',h('select',{'data-testid':'http-fixture-step',value:step,disabled:s.busy,onChange:e=>{setStep(Number(e.target.value));setConfirmedKey(null)},style:secondary},(paper?.steps||[]).map((n,i)=>h('option',{key:i,value:i},n.name+' · v'+n.promptVersion)))),
 h('div',{style:{display:'flex',gap:8,marginTop:12}},b('读取 HTTP 节点台账',()=>controller.inspectNode(workspaceId,paper.id,step),!workspaceId||!paper||!s.capability),b('生成 HTTP 完整预览',()=>controller.preview(workspaceId,paper.id,step,providerId),!providerId||!workspaceId||!paper||!s.capability)),
 message||s.error?h('p',{role:'alert'},message||s.error):null,
 s.records.filter(r=>r.workspaceId===workspaceId&&r.paperId===paper?.id&&r.stepIndex===step).map(r=>h('article',{key:r.requestId,style:{borderTop:'1px solid #444',marginTop:16}},h('p',null,'请求 ',r.requestId,' · ',r.status),h('pre',{'data-testid':'http-fixture-payload',style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},JSON.stringify({payload:r.payload,bindingHash:r.bindingHash},null,2)),r.adapterAttempted?h('p',{'data-testid':'adapter-attempted'},'Host 已持久化本次 adapter 许可消费标记。它不证明 body 已执行或已完成；未知状态不重发。'):null,r.payload.adapterCallLimit!==1?h('p',null,'旧版记录没有一次许可绑定：仅可回查；旧草稿可放弃后重新生成，不可确认执行。'):null,r.sessionId?h('p',null,'实际 / 预留 Session ID：',r.sessionId,'；状态以只读回查为准。'):null,
 r.canConfirm?h('label',null,h('input',{type:'checkbox',checked:confirmedKey===key(r),onChange:e=>setConfirmedKey(e.target.checked?key(r):null)}),' 我已核对完整预览、项目、节点和精确 Prompt，同意本请求最多一次所示 loopback HTTP body，0 外部网络发送，测试费用不适用'):null,
 h('div',{style:{display:'flex',gap:8,flexWrap:'wrap'}},b('确认一次 loopback HTTP 请求',()=>{setConfirmedKey(null);return controller.confirm(r.requestId,true)},!r.canConfirm||confirmedKey!==key(r)),b('回查 HTTP 会话状态',()=>controller.read(r.requestId)),b('请求取消 HTTP 会话',()=>controller.cancel(r.requestId),!r.canCancel),b('读取 HTTP 会话事件',()=>controller.events(r.requestId,0,25),!r.canReadEvents)),
 r.eventPage?h('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:300,overflow:'auto'}},JSON.stringify(r.eventPage,null,2)):null,r.result?h('p',null,'假 HTTP 观测：',JSON.stringify(r.result),'。仅为协议测试，不是论文结论。'):null)));
}
