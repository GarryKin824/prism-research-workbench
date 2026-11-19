/** Dedicated minimal Host test UI. It is not the full DSH web shell. */
function DedicatedPanel({controller,paper}){
 const s=React.useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);
 const [workspaceId,setWorkspaceId]=React.useState(''),[step,setStep]=React.useState(0),[confirmedKey,setConfirmedKey]=React.useState(null),[message,setMessage]=React.useState('');
 const key=r=>JSON.stringify([r.requestId,r.bindingHash]);
 const fingerprint=JSON.stringify([workspaceId,paper?.id,step,paper?.steps?.[step]?.prompt,paper?.steps?.[step]?.promptVersion,s.records.map(r=>[r.requestId,r.bindingHash,r.canConfirm])]);
 React.useEffect(()=>setConfirmedKey(null),[fingerprint]);
 React.useEffect(()=>{setStep(0);setConfirmedKey(null)},[paper?.id]);
 const act=async fn=>{setMessage('');try{await fn()}catch(e){setMessage(e.message)}};
 const b=(label,fn,disabled=false)=>h('button',{type:'button',style:secondary,disabled:disabled||s.busy||!s.available,onClick:()=>act(fn)},label);
 return h('section',{'data-testid':'dedicated-host',style:{...box,marginBottom:20}},h('h2',null,'专用 Host 普通会话 · 本地合成验证'),
 h('p',null,'独立最小 Host，经官方 Gateway 调用普通会话；固定 provider prism-local-proof / model local-proof，不调用真实模型。不是完整 DSH Web shell 安装或视觉验收。论文研究状态只读，不把合成结果记为研究成果。'),
 h('p',{'data-testid':'local-consent-boundary'},'一次许可仅针对本预览绑定的本地合成 body：最多执行一次，0 次外发，费用不适用。不是任何真实模型、工具或后续请求的授权。Host 在执行前持久化 attempted；超时、断连或重启后未知状态只能回查，不能把未知当失败重发。'),
 h('p',null,'仅点击后请求当前 Host。预览会保存精确 Prompt；确认才受理执行，受理不等于完成。勾选不是权限凭证，Host 独立验证 owner。断连或未知结果不能自动重发；取消已请求不代表已停止。'),
 b('检查专用 Host 能力',()=>controller.checkCapability()),b('加载专用 Host 注册项目',()=>controller.listRegisteredWorkspaces(),!s.capability),
 h('label',null,'明确选择正式注册项目 ',h('select',{'data-testid':'dedicated-workspace',value:workspaceId,disabled:s.busy,onChange:e=>{setWorkspaceId(e.target.value);setConfirmedKey(null)},style:secondary},h('option',{value:''},'请选择，不自动选首项'),s.workspaces.map(w=>h('option',{key:w.id,value:w.id},w.title+' · '+w.id+' · '+w.path)))),
 h('label',null,'选中论文节点 ',h('select',{'data-testid':'dedicated-step',value:step,disabled:s.busy,onChange:e=>{setStep(Number(e.target.value));setConfirmedKey(null)},style:secondary},(paper?.steps||[]).map((n,i)=>h('option',{key:i,value:i},n.name+' · v'+n.promptVersion)))),
 h('div',{style:{display:'flex',gap:8,marginTop:12}},b('读取专用节点台账',()=>controller.inspectNode(workspaceId,paper.id,step),!workspaceId||!paper||!s.capability),b('生成专用会话预览',()=>controller.preview(workspaceId,paper.id,step),!workspaceId||!paper||!s.capability)),
 message||s.error?h('p',{role:'alert'},message||s.error):null,
 s.records.filter(r=>r.workspaceId===workspaceId&&r.paperId===paper?.id&&r.stepIndex===step).map(r=>h('article',{key:r.requestId,style:{borderTop:'1px solid #444',marginTop:16}},h('p',null,'请求 ',r.requestId,' · ',r.status),h('pre',{'data-testid':'dedicated-payload',style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},JSON.stringify({payload:r.payload,bindingHash:r.bindingHash},null,2)),r.adapterAttempted?h('p',{'data-testid':'adapter-attempted'},'Host 已持久化本次 adapter 许可消费标记。它不证明 body 已执行或已完成；未知状态不重发。'):null,r.payload.adapterCallLimit!==1?h('p',null,'旧版记录没有一次许可绑定：仅可回查；旧草稿可放弃后重新生成，不可确认执行。'):null,r.sessionId?h('p',null,'实际 / 预留 Session ID：',r.sessionId,'；状态以只读回查为准。'):null,
 r.canConfirm?h('label',null,h('input',{type:'checkbox',checked:confirmedKey===key(r),onChange:e=>setConfirmedKey(e.target.checked?key(r):null)}),' 我已核对完整预览、项目、节点和精确 Prompt，同意本请求最多一次本地合成 body，0 外发，费用不适用'):null,
 h('div',{style:{display:'flex',gap:8,flexWrap:'wrap'}},b('确认专用合成会话',()=>{setConfirmedKey(null);return controller.confirm(r.requestId,true)},!r.canConfirm||confirmedKey!==key(r)),b('回查专用会话状态',()=>controller.read(r.requestId)),b('请求取消专用会话',()=>controller.cancel(r.requestId),!r.canCancel),b('读取专用会话事件',()=>controller.events(r.requestId,0,25),!r.canReadEvents)),
 r.eventPage?h('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:300,overflow:'auto'}},JSON.stringify(r.eventPage,null,2)):null,r.result?h('p',null,'本地合成观测：',JSON.stringify(r.result),'。仅为协议测试，不是论文结论。'):null)));
}
