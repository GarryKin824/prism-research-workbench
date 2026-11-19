// Schema 12 stores each component once. Never constructs the escaped v1-v11 wrapper chain.
// The semantic validators/view enrichers below are also used by the legacy readers.
import * as baseProjectCore from './base-project-archive-core.mjs';
import * as platformProjectCore from './platform-project-archive-core.mjs';
import * as evidenceProjectCore from './evidence-project-archive-core.mjs';
import * as multiProjectCore from './multi-project-archive-core.mjs';
import * as nodeProjectCore from './node-project-archive-core.mjs';
import * as planningProjectCore from './planning-project-archive-core.mjs';
import * as entitiesProjectCore from './entities-project-archive-core.mjs';
import * as membershipCore from './membership-project-archive-core.mjs';
import * as ownershipCore from './ownership-project-archive-core.mjs';
import * as instancesArchiveCore from './instances-project-archive-core.mjs';
import * as instanceReviewArchiveComponents from './instance-review-project-archive-components.mjs';
import {loadProjects} from './project-planning-core.mjs';
import {sha256} from './custom-core.mjs';

export const PROJECT_LIMIT=32000000;
export const COMPACT_PROJECT_SCHEMA='prism-project-archive/v12';
export const OPTIONAL_COMPONENTS=Object.freeze(['platformPlanRaw','evidenceMapRaw','multiEvidenceRaw','nodeReviewRaw','planningRaw','projectsRaw','membershipRaw','projectQueuesRaw','ownershipRaw','instancesRaw','instanceReviewsRaw']);
const bytes=s=>new TextEncoder().encode(s).length;
const exact=(o,names)=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===[...names].sort().join(',');
const fail=code=>{throw Error(code)};
const fields=['workflowArchiveRaw','sidecars',...OPTIONAL_COMPONENTS];
function checkComponents(p){
 if(typeof p.workflowArchiveRaw!=='string'||!exact(p.sidecars,baseProjectCore.SIDECARS))fail('INVALID_PROJECT_COMPONENTS');
 if(p.workflowArchiveRaw.length>PROJECT_LIMIT)fail('PROJECT_TOO_LARGE');
 let total=bytes(p.workflowArchiveRaw);
 for(const raw of [...Object.values(p.sidecars),...OPTIONAL_COMPONENTS.map(k=>p[k])]){
  if(raw!==null&&typeof raw!=='string')fail('INVALID_PROJECT_COMPONENTS');
  if(raw!==null){if(raw.length>PROJECT_LIMIT)fail('PROJECT_TOO_LARGE');total+=bytes(raw);}
  if(total>PROJECT_LIMIT)fail('PROJECT_TOO_LARGE');
 }
 if(total>PROJECT_LIMIT)fail('PROJECT_TOO_LARGE');
}
// Count JSON UTF-8 bytes without first materializing an oversized escaped envelope.
// Only our fixed shallow envelope and string/null leaf inventory reach this helper.
function serializedBytes(value){
 if(value===null)return 4;
 if(typeof value==='string'){
  let size=2;
  for(let i=0;i<value.length;i++){
   const code=value.charCodeAt(i);
   if(code===34||code===92)size+=2;
   else if(code<32)size+=[8,9,10,12,13].includes(code)?2:6;
   else if(code<128)size++;
   else if(code<2048)size+=2;
   else if(code>=0xd800&&code<=0xdbff){const next=value.charCodeAt(i+1);if(next>=0xdc00&&next<=0xdfff){size+=4;i++}else size+=6}
   else size+=code>=0xdc00&&code<=0xdfff?6:3;
   if(size>PROJECT_LIMIT)fail('PROJECT_TOO_LARGE');
  }
  return size;
 }
 let size=2,first=true;
 for(const [key,entry]of Object.entries(value)){size+=(first?0:1)+serializedBytes(key)+1+serializedBytes(entry);first=false;if(size>PROJECT_LIMIT)fail('PROJECT_TOO_LARGE')}
 return size;
}
function parse(raw){
 if(typeof raw!=='string'||raw.length>PROJECT_LIMIT||bytes(raw)>PROJECT_LIMIT)fail('PROJECT_TOO_LARGE');
 let p;try{p=JSON.parse(raw)}catch{fail('INVALID_JSON')}
 if(!exact(p,['schema','createdAt',...fields,'sha256'])||p.schema!==COMPACT_PROJECT_SCHEMA||typeof p.createdAt!=='string'||!Number.isFinite(Date.parse(p.createdAt))||new Date(p.createdAt).toISOString()!==p.createdAt||typeof p.sha256!=='string'||!/^[a-f0-9]{64}$/.test(p.sha256))fail('INVALID_PROJECT_ARCHIVE');
 checkComponents(p);return p;
}
async function inspectComponents(p,c){
 let b=await baseProjectCore.inspectProjectComponents(p.workflowArchiveRaw,p.sidecars,c);
 b=await platformProjectCore.inspectPlatformComponents(b,p.workflowArchiveRaw,p.platformPlanRaw,c);
 b=await evidenceProjectCore.inspectEvidenceComponents(b,p.workflowArchiveRaw,p.evidenceMapRaw,c);
 b=await multiProjectCore.inspectMultiComponents(b,p.workflowArchiveRaw,p.multiEvidenceRaw,c);
 b=await nodeProjectCore.inspectNodeComponents(b,await nodeProjectCore.nodeComponentData(p.workflowArchiveRaw,p.sidecars,c),p.nodeReviewRaw,c);
 b=await planningProjectCore.inspectPlanningComponents(b,p.planningRaw,c);
 b=await entitiesProjectCore.inspectEntitiesComponents(b,p.projectsRaw,c);
 b=await membershipCore.inspectMembershipComponents(b,p.membershipRaw,p.projectQueuesRaw,c);
 b=await ownershipCore.inspectOwnershipComponents(b,p.ownershipRaw,c);
 // Match legacy semantic identity, including its omitted v10/v11 optional layers.
 // This allows duplicate detection across compact and historical representations.
 if(p.instancesRaw!==null){
  const projects=p.projectsRaw===null?[]:(await loadProjects(p.projectsRaw,b.summary.namespace,c)).projects;
  b=await instancesArchiveCore.inspectInstancesComponents(b,p.instancesRaw,projects,c);
 }else b={...b,summary:{...b.summary,presence:{...b.summary.presence,instancesRaw:false},warnings:[...b.summary.warnings,{code:'LEGACY_ARCHIVE_NO_RESEARCH_INSTANCES'}]}};
 if(p.instanceReviewsRaw!==null)b=await instanceReviewArchiveComponents.inspectInstanceReviewComponents(b,p.instanceReviewsRaw,p.instancesRaw,c);
 else b={...b,summary:{...b.summary,presence:{...b.summary.presence,instanceReviewsRaw:false}}};
 return b;
}
export async function createProjectArchive(input,c=globalThis.crypto){
 if(input===null||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!fields.includes(k)))fail('INVALID_PROJECT_COMPONENTS');
 // Snapshot string references and the small sidecar inventory before the first await.
 // No serialization of an earlier project archive is needed, even for large papers.
 const p={schema:COMPACT_PROJECT_SCHEMA,createdAt:new Date().toISOString(),workflowArchiveRaw:input.workflowArchiveRaw,sidecars:{...input.sidecars}};
 for(const k of OPTIONAL_COMPONENTS)p[k]=input[k]??null;
 checkComponents(p);
 if(serializedBytes({...p,sha256:'0'.repeat(64)})>PROJECT_LIMIT)fail('PROJECT_TOO_LARGE');
 const body=JSON.stringify(p);
 await inspectComponents(p,c);
 return JSON.stringify({...p,sha256:await sha256(body,c)});
}
export async function inspectProjectArchive(raw,c=globalThis.crypto){
 const p=parse(raw),{sha256:hash,...body}=p;
 if(hash!==await sha256(JSON.stringify(body),c))fail('PROJECT_HASH_MISMATCH');
 const checked=await inspectComponents(p,c);
 return {raw,byteSha256:await sha256(raw,c),fingerprint:checked.fingerprint,summary:{...checked.summary,byteLength:bytes(raw)}};
}
export async function readOnlyProjectView(raw,c=globalThis.crypto){
 const inspected=await inspectProjectArchive(raw,c),p=parse(raw);
 let view=await multiProjectCore.readOnlyBaseComponents(p,inspected,c);
 view=await nodeProjectCore.readOnlyNodeComponents(view,inspected,await nodeProjectCore.nodeComponentData(p.workflowArchiveRaw,p.sidecars,c),p.nodeReviewRaw,c);
 view=await planningProjectCore.readOnlyPlanningComponents(view,inspected,p.planningRaw,c);
 view=await entitiesProjectCore.readOnlyEntitiesComponents(view,inspected,p.projectsRaw,c);
 view=await membershipCore.readOnlyMembershipComponents(view,inspected,p.membershipRaw,p.projectQueuesRaw,c);
 view=await ownershipCore.readOnlyOwnershipComponents(view,inspected,p.ownershipRaw,c);
 view=await instancesArchiveCore.readOnlyInstancesComponents(view,inspected,p.instancesRaw,c);
 return instanceReviewArchiveComponents.readOnlyInstanceReviewComponents(view,inspected,p.instanceReviewsRaw,c);
}
