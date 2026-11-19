function DerivedDraftPanel({store}) {
 const ns=store.getStorageKey(),locks=globalThis.navigator?.locks,withLock=locks?(n,f)=>locks.request(n,{mode:'exclusive'},f):undefined;
 const ac=React.useMemo(()=>createProjectArchiveController({store,storage:globalThis.localStorage,crypto:globalThis.crypto,withLock}),[store]);
 const c=React.useMemo(()=>createDerivedDraftController({archiveController:ac,storage:globalThis.localStorage,namespace:ns,crypto:globalThis.crypto,withLock}),[ac]);
 const [slots,S]=React.useState([]),[slot,SS]=React.useState(''),[view,V]=React.useState(null),[paper,SP]=React.useState(''),[graph,SG]=React.useState(''),[preview,P]=React.useState(null),[ack,A]=React.useState(false),[rows,R]=React.useState([]),[opened,O]=React.useState(null),[message,M]=React.useState(''),[busy,B]=React.useState(false);
 const epoch=React.useRef(0),token=React.useRef(null),active=React.useRef(false);
 function cancel(){epoch.current++;if(token.current)c.cancel(token.current);token.current=null;P(null);A(false);B(false);active.current=false;}
 React.useEffect(()=>()=>{epoch.current++;if(token.current)c.cancel(token.current);active.current=false},[c]);
 const run=async fn=>{if(active.current)return;const e=++epoch.current;active.current=true;B(true);M('');try{await fn(()=>e===epoch.current)}catch(err){if(e===epoch.current)M(err.message)}finally{if(e===epoch.current){active.current=false;B(false)}}};
 const button=(text,f,disabled=false)=>h('button',{type:'button',style:secondary,disabled:busy||disabled,onClick:f},text),pre=x=>h('pre',{style:{whiteSpace:'pre-wrap',maxHeight:350,overflow:'auto'}},JSON.stringify(x,null,2));
 const row=view?.papers.find(x=>x.id===paper),choices=(row?.workflows||[]).flatMap(w=>w.graphs.map(g=>({value:JSON.stringify([w.id,g.version]),label:w.id+' / 图 v'+g.version})));
 return h('section',{'data-testid':'derived-draft-panel',style:box},h('h3',null,'从只读归档派生独立草稿'),h('p',null,'不是恢复活动项目。只复制所选论文与流程定义，创建新 ID；不复制历史结果、权限、Host 或凭据。草稿明文存于此浏览器，当前只能只读重开，不自动进入论文库或执行。独立草稿不包含在基础或项目整合归档中，请重开后单独下载留存。每个工作区最多保存 50 个；内容哈希仅用于一致性检查，不是来源认证。'),
 button('列出可选只读归档',()=>{cancel();run(async ok=>{const s=await ac.list();if(ok()){S(s);SS('');V(null);SP('');SG('')}})}),
 h('select',{'data-testid':'derive-slot',value:slot,disabled:busy,onChange:e=>{cancel();SS(e.target.value);V(null);SP('');SG('')}},h('option',{value:''},'明确选择来源归档'),slots.map(s=>h('option',{key:s.id,value:s.id},s.id))),
 button('读取派生来源',()=>{cancel();run(async ok=>{const v=await ac.readContents(slot);if(ok()){V(v);SP('');SG('')}})},!slot),
 view?h('div',null,h('select',{'data-testid':'derive-paper',value:paper,disabled:busy,onChange:e=>{cancel();SP(e.target.value);SG('')}},h('option',{value:''},'明确选择论文'),view.papers.filter(x=>x.paper).map(x=>h('option',{key:x.id,value:x.id},x.paper.title))),h('select',{'data-testid':'derive-graph',value:graph,disabled:busy,onChange:e=>{cancel();SG(e.target.value)}},h('option',{value:''},'明确选择流程版本'),choices.map(x=>h('option',{key:x.value,value:x.value},x.label))),
 button('预览派生内容与差异',()=>run(async ok=>{if(token.current)c.cancel(token.current);P(null);A(false);const [workflowId,graphVersion]=JSON.parse(graph),p=await c.prepare({slotId:slot,paperId:paper,workflowId,graphVersion});if(ok()){token.current=p;P(p)}else c.cancel(p)}),!paper||!graph)):null,
 preview?h('div',{'data-testid':'derive-preview'},h('p',null,'完整内容与差异如下；未写入。历史及权限不恢复。'),pre(preview),h('label',null,h('input',{'data-testid':'derive-ack',type:'checkbox',checked:ack,disabled:busy,onChange:e=>A(e.target.checked)}),' 我已核对差异，同意仅创建明文独立草稿，不激活项目'),button('确认保存独立派生草稿',()=>run(async ok=>{const result=await c.confirm(preview,{explicitConfirmation:true});if(ok()){token.current=null;P(null);A(false);M('已保存独立草稿，未激活：'+result.key)}}),!ack||!withLock)):null,
 h('button',{type:'button',style:secondary,onClick:cancel},'取消派生预览'),
 button('核验并刷新派生草稿列表',()=>run(async ok=>{const r=await c.list();if(ok()){R(r);O(null)}})),
 rows.map(r=>h('div',{key:r.key},button('只读重开 '+r.packet.paper.title,()=>run(async ok=>{const result=await c.open(r.key);if(ok())O(result)})))),
 opened?h('div',{'data-testid':'derived-opened'},h('p',null,'独立草稿只读内容；未进入活动项目，无执行权限。'),pre(opened.packet),h(RestrictedEditorPanel,{key:opened.key,draftKey:opened.key,drafts:c}),button('下载此独立草稿 JSON',()=>run(async ok=>{const current=await c.open(opened.key);if(!ok())return;const url=URL.createObjectURL(new Blob([current.raw],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='PRISM-derived-draft-'+current.packet.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}))):null,
 !withLock?h('p',null,'缺少 Web Locks，禁止保存；可只读查看。'):null,message?h('p',{role:'status'},message):null);
}
