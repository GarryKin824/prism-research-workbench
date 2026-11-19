function ProviderPanel({controller,paper}){
 const s=React.useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot),[step,setStep]=React.useState(0),[error,setError]=React.useState(''),[exported,setExported]=React.useState('');
 const boundary=providerAuthBoundary(),p=s.prepared,fingerprint=JSON.stringify([paper?.id,step,paper?.steps?.[step]?.prompt,paper?.steps?.[step]?.promptVersion]);
 React.useEffect(()=>{controller.clear();setExported('')},[fingerprint]);React.useEffect(()=>setStep(0),[paper?.id]);
 const act=async fn=>{setError('');try{await fn()}catch(e){setError(e.message)}};
 const same=p&&p.payload.paperId===paper?.id&&p.payload.stepIndex===step&&p.payload.prompt===paper?.steps?.[step]?.prompt&&p.payload.promptVersion===paper?.steps?.[step]?.promptVersion;
 const ack=p&&s.checked===JSON.stringify([p.payload.requestId,p.bindingHash]);
 return h('section',{'data-testid':'provider-review',style:{...box,marginBottom:20}},h('h2',null,'Provider 连接与发送前检查'),
 h('p',null,'外部发送默认禁用。未连接任何真实 provider；没有可选择的已核验模型。configured 只表示配置存在，不等于 verified，也不证明账号额度、认证或模型可用。费用未知；tools = 0。'),
 h('p',{'data-testid':'provider-auth-boundary'},boundary.reason),h('button',{type:'button',disabled:true,style:secondary},'官方认证入口：未安全接通'),h('button',{type:'button',disabled:true,style:secondary},'模型目录：尚未核验'),
 h('p',null,'下面可实际生成、核对并导出本地节点预审 JSON，不联网，不是最终 HTTP 内容，不是外发许可。最终预览必须补齐真实 provider/model、目标、完整 system/messages、参数和传输内容后重新计算 hash 并重新征求同意。'),
 h('label',null,'本地预审节点 ',h('select',{'data-testid':'provider-review-step',value:step,onChange:e=>setStep(Number(e.target.value)),style:secondary},(paper?.steps||[]).map((n,i)=>h('option',{key:i,value:i},n.name+' · v'+n.promptVersion)))),
 h('button',{type:'button',style:secondary,disabled:!paper||s.busy,onClick:()=>act(()=>{setExported('');return controller.prepare(paper.id,step)})},'生成本地发送前检查'),
 error||s.error?h('p',{role:'alert'},error||s.error):null,
 p?h('div',null,h('pre',{'data-testid':'provider-review-payload',style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:350,overflow:'auto'}},JSON.stringify(p,null,2)),!same?h('p',{role:'alert'},'选中节点或 Prompt 已变化，此预审不可确认或导出。'):null,
 h('label',null,h('input',{type:'checkbox',disabled:!same||s.busy,checked:!!ack,onChange:e=>act(()=>e.target.checked?controller.check(p.payload.requestId,p.bindingHash):controller.clear())}),' 我仅确认已核对这份本地预审；不授权外发或执行'),
 h('button',{type:'button',style:secondary,disabled:!same||!ack||s.busy,onClick:()=>act(()=>setExported(controller.exportReview()))},'生成可保存的预审 JSON'),h('button',{type:'button',disabled:true,style:secondary},'发送到 provider：尚未接通'),
 exported?h('textarea',{'data-testid':'provider-review-export',readOnly:true,value:exported,style:{...field,minHeight:220},'aria-label':'本地预审JSON，可自行保存'}):null):null);
}
