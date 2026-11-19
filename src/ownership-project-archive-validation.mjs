import {decodeOwner} from './project-execution-owner.mjs';
import {importQueue,queueView} from './library-core.mjs';
import {loadProjects} from './project-planning-core.mjs';
import {loadLibrary} from './project-library-core.mjs';
import {loadProjectQueues} from './project-queue-core.mjs';
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===keys.split(',').sort().join(','),id=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(x),hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),fail=()=>{throw Error('INVALID_ARCHIVED_OWNERSHIP')};
export async function validateArchivedOwnership(raw,namespace,c){
 const owner=await decodeOwner(raw,c),envelope=JSON.parse(raw);if(!exact(envelope,'body,sha256'))fail();
 const base='schema,history,previousOwnerSha256,phase,token,projectId,planVersion,planSha256,inputsSha256,projectQueuesRaw,membershipRaw,projectRaw,targetRaw';
 if(!exact(owner,base+(owner.phase==='released'?',finalQueueRaw':''))||!id(owner.token)||!id(owner.projectId)||!Number.isSafeInteger(owner.planVersion)||owner.planVersion<1||!hash(owner.planSha256)||!hash(owner.inputsSha256)||!(owner.previousOwnerSha256===null||hash(owner.previousOwnerSha256))||!Array.isArray(owner.history)||owner.history.length>1000)fail();
 const projects=await loadProjects(owner.projectRaw,namespace,c),members=await loadLibrary(owner.membershipRaw,namespace,c),plans=await loadProjectQueues(owner.projectQueuesRaw,namespace,c);
 if(!projects.projects.some(p=>p.id===owner.projectId)||!members.projects.some(p=>p.projectId===owner.projectId))fail();
 const plan=plans.projects.find(p=>p.projectId===owner.projectId)?.revisions.find(r=>r.version===owner.planVersion);if(!plan||plan.sha256!==owner.planSha256||plans.projects.find(p=>p.projectId===owner.projectId).revisions.at(-1).version!==owner.planVersion)fail();
 const memberIds=new Set(members.projects.find(p=>p.projectId===owner.projectId).revisions.at(-1).papers.map(p=>p.id));if(plan.entries.some(e=>!memberIds.has(e.paperId)))fail();
 const priorCount=owner.history.length-(owner.phase==='released'?1:0);if(priorCount<0||(priorCount===0)!==(owner.previousOwnerSha256===null))fail();
 const readQueue=async(raw,terminal)=>{await importQueue(raw,c);const q=JSON.parse(raw).queue;for(const cfg of q.configs)for(const e of cfg.entries)if(e.namespace!==namespace)fail();if(terminal){const v=queueView(q);if(q.allowed||v.active||v.pending||v.nextEntry||Object.values(v.terminal).some(t=>t.status==='abandoned'))fail()}return q};
 const target=await readQueue(owner.targetRaw,false);if(target.allowed||target.events.length||target.configs.length!==1||!['manual','auto'].includes(target.configs[0].mode))fail();
 if(JSON.stringify(target.configs[0].entries.map(e=>e.paperId))!==JSON.stringify(plan.entries.map(e=>e.paperId)))fail();
 for(let i=0;i<plan.entries.length;i++){const p=plan.entries[i],e=target.configs[0].entries[i],w=JSON.parse(p.workflowRaw||'null')?.state;if(!w||w.id!==e.workflowId||w.graphs.find(g=>g.version===w.currentVersion)?.sha256!==e.graphSha256)fail()}
 const tokens=new Set(),queues=new Set();for(const h of owner.history){if(!exact(h,'token,projectId,planVersion,planSha256,inputsSha256,queueRaw,releasedAt')||!id(h.token)||tokens.has(h.token)||!id(h.projectId)||!Number.isSafeInteger(h.planVersion)||h.planVersion<1||!hash(h.planSha256)||!hash(h.inputsSha256)||typeof h.releasedAt!=='string'||!Number.isFinite(Date.parse(h.releasedAt)))fail();tokens.add(h.token);const q=await readQueue(h.queueRaw,true);if(queues.has(q.id))fail();queues.add(q.id)}
 if(owner.phase==='released'){const last=owner.history.at(-1);if(!last||last.token!==owner.token||last.projectId!==owner.projectId||last.planVersion!==owner.planVersion||last.planSha256!==owner.planSha256||last.inputsSha256!==owner.inputsSha256||last.queueRaw!==owner.finalQueueRaw)fail();const final=await readQueue(owner.finalQueueRaw,true);if(final.id!==target.id||final.configs.at(-1).sha256!==target.configs[0].sha256)fail()}else if(tokens.has(owner.token)||queues.has(target.id))fail();
 return owner;
}
