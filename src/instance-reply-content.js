// Read-only display projection. Original record bytes and authorities remain untouched.
function InstanceReplyContent({text,execution}){
 const raw=typeof text==='string'?text:'',Content=typeof ResearchContent==='function'?ResearchContent:({text})=>h('pre',null,text);
 const model=execution?.mode==='step'&&execution.state==='returned'&&execution.reply?.answer===raw;
 let view;try{view=model?{kind:'model',text:raw,notice:execution.reply.finish==='max-tokens'?'DeepSeek 部分答复 · 512 token 上限截断':'DeepSeek 原始答复 · 附执行回执'}:instanceReplyLinkCore.projectInstanceReplyText(raw)}catch{view={kind:'invalid-linked',text:null,notice:'无法完成只读显示核验；原文保留，不视作已关联答复。'}}
 return h('section',{'data-testid':'instance-reply-content','data-reply-kind':view.kind},view.notice?h('p',{'data-testid':'instance-reply-display-notice'},view.notice):null,view.kind==='invalid-linked'?h('p',{'data-testid':'instance-reply-invalid'},'关联包格式无法核验，未将内容当作成功关联回复；请查看原文。'):h(Content,{text:view.text??raw}),h('details',null,h('summary',null,'逐字原文 / 完整作品包'),h('pre',{'data-testid':'instance-reply-original',style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:400,overflow:'auto'}},raw)));
}
