// Pure local handoff. No network, clipboard, model, or research-state mutations.
export function handoffSelection(snapshot,paperId,stepIndex){
 const paper=snapshot.papers.find(p=>p.id===paperId),step=paper?.steps[stepIndex];
 if(!paper||!Number.isInteger(stepIndex)||!step)throw Error('HANDOFF_NODE_MISSING');
 return {paperId:paper.id,stepIndex,promptVersion:step.promptVersion,prompt:step.prompt};
}
export async function createHandoff(snapshot,paperId,stepIndex,crypto=globalThis.crypto){
 if(!crypto?.subtle)throw Error('CRYPTO_UNAVAILABLE');
 const payload=handoffSelection(snapshot,paperId,stepIndex);
 const bytes=new TextEncoder().encode(JSON.stringify(payload));
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
 if(digest.length!==32)throw Error('INVALID_DIGEST');
 return {schema:'prism-manual-handoff/v1',notice:'仅供用户自行复制到任意平台；未连接、未发送、未执行。只含选中节点的精确 Prompt 和标识；不自动附带论文全文或上游产物。Prompt 自身若含敏感内容也会原样导出，请先核对。',payload,sha256:Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('')};
}
export function assertCurrentHandoff(snapshot,handoff){
 if(!handoff?.payload||JSON.stringify(handoffSelection(snapshot,handoff.payload.paperId,handoff.payload.stepIndex))!==JSON.stringify(handoff.payload))throw Error('HANDOFF_STALE');
 return true;
}
export function handoffJSON(handoff){return JSON.stringify(handoff,null,2);}
