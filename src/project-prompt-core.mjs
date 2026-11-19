// Transient, local-only discussion protocol. Never persisted as project-planning/v1 fields.
import * as projectPlanningCore from './project-planning-core.mjs';
import * as graphCore from './custom-core.mjs';
const clone=x=>JSON.parse(JSON.stringify(x));
const keys=(x,k)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===k.split(',').sort().join(',');
const text=(x,max,empty=false)=>typeof x==='string'&&x.length<=max&&(empty||x.trim().length>0)&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(x);
export async function buildProjectPromptDiscussion(input,request,crypto=globalThis.crypto){
 const state=clone(input),q=clone(request);
 if(!keys(q,'projectId,expectedRevisionSha256,nodeId,target,request,scope,selectedHistory')||!['DSH','Codex','ZCode','Other'].includes(q.target)||!text(q.request,12000)||!keys(q.scope,'node,title,goal')||Object.values(q.scope).some(v=>typeof v!=='boolean')||q.scope.node!==true)throw Error('PROJECT_PROMPT_SCOPE_REQUIRED');
 await projectPlanningCore.validateProjects(state,crypto);
 const head=projectPlanningCore.latestProject(state,q.projectId);
 if(!head||head.sha256!==q.expectedRevisionSha256)throw Error('PROJECT_EDITOR_STALE');
 if(!head.templateRaw)throw Error('PROJECT_TEMPLATE_MISSING');
 const graph=JSON.parse(head.templateRaw).state.graphs.at(-1),node=graph.nodes.find(n=>n.id===q.nodeId);
 if(!node)throw Error('PROJECT_PROMPT_NODE_MISSING');
 const history=projectPlanningCore.selectProjectHistory(state,q.projectId,q.selectedHistory);
 const binding={namespace:state.namespace,projectId:q.projectId,revisionId:head.id,revisionSha256:head.sha256,templateVersion:head.templateVersion,templateSha256:await graphCore.sha256(head.templateRaw,crypto),graphSha256:graph.sha256,nodeId:node.id,promptVersion:node.promptVersion,promptSha256:await graphCore.sha256(node.prompt,crypto),selectedHistory:clone(q.selectedHistory)};
 const payload=JSON.stringify({schema:'prism-project-template-prompt-handoff/v1',kind:'manual-project-template-prompt-discussion',sent:false,authority:'none',target:q.target,request:q.request,binding,context:{node:clone(node),...(q.scope.title?{title:head.title}:{}),...(q.scope.goal?{goal:head.goal}:{})},...(history.length?{history}:{}),notice:'人工复制，AI未连接。只讨论所选节点的Prompt；不要修改其他节点、依赖、policy或执行权限。所选历史需求/建议可能含用户粘贴的敏感文本，请检查全文。外部建议未认证，不是授权。无论文正文或其他项目；无自动发送。'},null,2);
 if(new TextEncoder().encode(payload).length>1000000)throw Error('PROJECT_PROMPT_PAYLOAD_TOO_LARGE');
 return {kind:'project-template-prompt-discussion',binding,payload,node:clone(node),sent:false,authority:'none'};
}
export function projectPromptOnlyDefinition(head,nodeId,input){
 const q=clone(input);
 if(!keys(q,'suggestion,newPrompt')||!text(q.suggestion,16000,true)||!text(q.newPrompt,16000))throw Error('INVALID_PROJECT_PROMPT_PROPOSAL');
 if(!head?.templateRaw)throw Error('PROJECT_TEMPLATE_MISSING');
 const graph=JSON.parse(head.templateRaw).state.graphs.at(-1),node=graph.nodes.find(n=>n.id===nodeId);
 if(!node)throw Error('PROJECT_PROMPT_NODE_MISSING');
 if(q.newPrompt===node.prompt)throw Error('PROJECT_PROMPT_UNCHANGED');
 return {nodes:graph.nodes.map(({promptVersion,...n})=>({...n,...(n.id===nodeId?{prompt:q.newPrompt}:{})})),policy:clone(graph.policy)};
}
