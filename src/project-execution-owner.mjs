import * as researchInstancesCore from './research-instances-core.mjs';
import {queueView} from './library-core.mjs';
import {sha256} from './custom-core.mjs';
export async function encodeOwner(body,crypto){const raw=JSON.stringify({body,sha256:await sha256(JSON.stringify(body),crypto)});if(new TextEncoder().encode(raw).length>8000000)throw Error('OWNER_TOO_LARGE');return raw}
export async function decodeOwner(raw,crypto){if(typeof raw!=='string'||new TextEncoder().encode(raw).length>8000000)throw Error('OWNER_INVALID');const x=JSON.parse(raw),b=x.body;if(!b||x.sha256!==await sha256(JSON.stringify(b),crypto)||b.schema!=='prism-project-owner/v1'||!['intent','owned','released'].includes(b.phase)||typeof b.token!=='string'||typeof b.projectId!=='string'||typeof b.targetRaw!=='string'||typeof b.inputsSha256!=='string')throw Error('OWNER_INVALID');return b}
export async function assertOwner(storage,ns,token,crypto){await assertNoInstanceOwner(storage,ns,crypto);const raw=storage.getItem(ns+':project-execution-owner-v1');if(raw===null){if(token)throw Error('OWNER_MISSING');return}const b=await decodeOwner(raw,crypto);if(b.phase!=='owned'||!token||b.token!==token)throw Error('PROJECT_EXECUTION_OWNER_REQUIRED');if(storage.getItem(ns+':project-queues-v1')!==b.projectQueuesRaw||storage.getItem(ns+':project-library-v1')!==b.membershipRaw||storage.getItem(ns+':project-planning-v1')!==b.projectRaw)throw Error('PROJECT_SCOPE_CHANGED');const q=JSON.parse(storage.getItem(ns+':library-queue-v1')||'null')?.queue,target=JSON.parse(b.targetRaw).queue;if(!q||q.id!==target.id||q.configs.at(-1)?.sha256!==target.configs.at(-1)?.sha256)throw Error('PROJECT_EXECUTION_CONFIG_CHANGED');if(storage.getItem(ns+':project-execution-owner-v1')!==raw)throw Error('OWNER_CHANGED')}
export async function assertWorkflowOwner(storage,ns,token,paperId,action,crypto){
 const ownerRaw=storage.getItem(ns+':project-execution-owner-v1');if(ownerRaw!==null&&!token&&(action===null||action==='editGraph')){const owner=await decodeOwner(ownerRaw,crypto);if(storage.getItem(ns+':project-execution-owner-v1')!==ownerRaw)throw Error('OWNER_CHANGED');if(owner.phase==='released')return}
 await assertOwner(storage,ns,token,crypto);if(storage.getItem(ns+':project-execution-owner-v1')===null)return;
 const qraw=storage.getItem(ns+':library-queue-v1'),q=JSON.parse(qraw).queue,pending=queueView(q).pending;
 if((!q.allowed&&action!=='pauseWorkflow')||!pending||pending.kind!=='action'||pending.entry.paperId!==paperId||pending.action!==action)throw Error('PROJECT_WORKFLOW_INTENT_REQUIRED');
 const key=ns+':custom-workflow-v1:'+paperId,raw=storage.getItem(key),w=JSON.parse(raw||'null')?.state;
 if(!w||w.id!==pending.entry.workflowId||w.currentVersion!==pending.graphVersion||w.graphs.find(g=>g.version===w.currentVersion)?.sha256!==pending.entry.graphSha256||await sha256(JSON.stringify(w),crypto)!==pending.workflowDigest)throw Error('PROJECT_WORKFLOW_INTENT_BASE_CHANGED');
 await assertOwner(storage,ns,token,crypto);
 if(storage.getItem(key)!==raw||storage.getItem(ns+':library-queue-v1')!==qraw)throw Error('PROJECT_WORKFLOW_INTENT_CHANGED');
}

export async function assertScopeEditable(storage,ns,crypto){await assertNoInstanceOwner(storage,ns,crypto);const raw=storage.getItem(ns+':project-execution-owner-v1');if(raw===null)return;const b=await decodeOwner(raw,crypto);if(b.phase!=='released')throw Error('PROJECT_EXECUTION_SCOPE_LOCKED');if(storage.getItem(ns+':project-execution-owner-v1')!==raw)throw Error('OWNER_CHANGED')}

export async function assertNoInstanceOwner(storage,ns,crypto){const raw=storage.getItem(ns+':research-instances-v1');if(raw===null)return;const s=await researchInstancesCore.loadInstances(raw,ns,crypto);if(s.activeId!==null||s.queueState?.activeQueueId)throw Error('RESEARCH_INSTANCE_OWNS_RUNNER');if(storage.getItem(ns+':research-instances-v1')!==raw)throw Error('INSTANCE_CONTEXT_CHANGED')}
