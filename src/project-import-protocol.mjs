/** Wire shapes only. UUIDs/hashes are correlation/selectors, never authentication. */
export const PROJECT_IMPORT_PROTOCOL='prism-project-import/v1';
export const PROJECT_IMPORT_PATH='/api/prism-project-import/exchange';
export const PROJECT_IMPORT_MAX_BYTES=8388608;
export const PROJECT_IMPORT_ERROR_CODES=Object.freeze(['IMPORT_DISABLED','IMPORT_UNAVAILABLE','IMPORT_ROUTE_REFUSED','IMPORT_MEDIA_TYPE','IMPORT_IDENTITY_REQUIRED','IMPORT_SHARED_BROWSER_REFUSED','IMPORT_PEER_MISMATCH','IMPORT_REQUEST_INVALID','IMPORT_TOO_LARGE','IMPORT_BUSY','IMPORT_LIMIT','IMPORT_REQUEST_REPLAY','IMPORT_PREVIEW_EXPIRED','IMPORT_REFUSED','IMPORT_TIMEOUT','IMPORT_ABORTED','HOST_PROJECT_IMPORT_OUTCOME_UNKNOWN_MAY_BE_SAVED']);
const exact=(o,ks)=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&Reflect.ownKeys(o).length===ks.length&&ks.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(o,k)??{},'value'));
const fail=()=>{throw Error('PROJECT_IMPORT_PROTOCOL_INVALID');};
const uuid=s=>typeof s==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(s);
const hash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const integer=(n,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const text=(s,n)=>typeof s==='string'&&s.trim().length>0&&s.length<=n;
const id=s=>typeof s==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(s);
export function validateProjectImportRequest(q){
 const op=Object.getOwnPropertyDescriptor(q??{},'operation')?.value;
 const fields=op==='prepare'?['protocol','requestId','operation','raw']:op==='confirm'?['protocol','requestId','operation','previewId','previewSha256','explicit']:op==='cancel'?['protocol','requestId','operation','previewId']:[];
 if(!exact(q,fields)||q.protocol!==PROJECT_IMPORT_PROTOCOL||!uuid(q.requestId))fail();
 if(q.operation==='prepare'){if(typeof q.raw!=='string'||q.raw.length>4000000||new TextEncoder().encode(q.raw).length>4000000)fail();}
 else if(!uuid(q.previewId)||(q.operation==='confirm'&&(q.explicit!==true||!hash(q.previewSha256))))fail();return q;
}
function parseBounded(raw){
 if(typeof raw!=='string'||raw.length>PROJECT_IMPORT_MAX_BYTES||new TextEncoder().encode(raw).length>PROJECT_IMPORT_MAX_BYTES)fail();
 const stack=[];let previous,count=0;
 for(const match of raw.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]|[^\s{}\[\]:,]+/g)){
  if(++count>100000)fail();const t=match[0];if(t==='{'||t==='['){if(stack.length>=64)fail();stack.push(t==='{'?new Set():null);}else if(t==='}'||t===']')stack.pop();else if(t===':'&&previous?.startsWith('"')){const keys=stack.at(-1),key=JSON.parse(previous);if(!keys||keys.has(key))fail();keys.add(key);}previous=t;
 }
 return JSON.parse(raw);
}
export function validateProjectImportPreview(p){
 if(!exact(p,['kind','targetLabel','namespace','mode','raw','rawSha256','bytes','archiveSha256','expectedSeq','expectedSha256','targetEpoch','projects','mapping','preservedProjects','newProjects','preservedRevisions','addedRevisions','authority','registered','sent','previewSha256'])||p.kind!=='host-project-import-preview'||!text(p.targetLabel,500)||!text(p.namespace,300)||!['initial-seed','append-only'].includes(p.mode)||typeof p.raw!=='string'||p.raw.length>4000000||new TextEncoder().encode(p.raw).length!==p.bytes||!integer(p.bytes,0,4000000)||!hash(p.rawSha256)||!hash(p.archiveSha256)||!hash(p.previewSha256)||!integer(p.expectedSeq)||!integer(p.targetEpoch)||p.authority!=='none'||p.registered!==false||p.sent!==false)fail();
 if(p.mode==='initial-seed'?(p.expectedSeq!==0||p.expectedSha256!==null||p.preservedProjects!==0||p.preservedRevisions!==0):(!integer(p.expectedSeq,1)||!hash(p.expectedSha256)))fail();
 if(!Array.isArray(p.projects)||p.projects.length>20||!Array.isArray(p.mapping)||p.mapping.length!==p.projects.length||!integer(p.preservedProjects,0,20)||!integer(p.newProjects,0,20)||p.preservedProjects+p.newProjects!==p.projects.length||!integer(p.preservedRevisions,0,200)||!integer(p.addedRevisions,0,200)||p.preservedRevisions+p.addedRevisions>200)fail();
 let revisions=0,preserved=0,added=0;const ids=new Set();
 for(let i=0;i<p.projects.length;i++){
  const project=p.projects[i],m=p.mapping[i];if(!exact(project,['projectId','title','revisionCount','headRevisionSha256','templateVersion','revisions'])||!id(project.projectId)||ids.has(project.projectId)||!text(project.title,500)||!integer(project.revisionCount,1,200)||!integer(project.templateVersion,0,10000)||!hash(project.headRevisionSha256)||!Array.isArray(project.revisions)||project.revisions.length!==project.revisionCount)fail();ids.add(project.projectId);
  for(let j=0;j<project.revisions.length;j++){const r=project.revisions[j];if(!exact(r,['id','seq','kind','sha256'])||!id(r.id)||r.seq!==j+1||!['goal','discussion','template','application'].includes(r.kind)||!hash(r.sha256))fail();}
  if(project.revisions.at(-1).sha256!==project.headRevisionSha256||!exact(m,['projectId','targetProjectId','preservedRevisions','addedRevisions','newProject'])||m.projectId!==project.projectId||m.targetProjectId!==m.projectId||!integer(m.preservedRevisions,0,200)||!integer(m.addedRevisions,0,200)||m.preservedRevisions+m.addedRevisions!==project.revisionCount||m.newProject!==(i>=p.preservedProjects)||(m.newProject&&m.preservedRevisions!==0))fail();
  revisions+=project.revisionCount;preserved+=m.preservedRevisions;added+=m.addedRevisions;
 }
 if(revisions>200||preserved!==p.preservedRevisions||added!==p.addedRevisions)fail();return p;
}
export function validateProjectImportResponse(response,operation,expectedRequestId){
 const ok=Object.getOwnPropertyDescriptor(response??{},'ok')?.value;
 if(!['prepare','confirm','cancel'].includes(operation)||!exact(response,ok===true?['protocol','requestId','ok','value']:Object.hasOwn(response??{},'protocol')?['protocol','requestId','ok','error']:['ok','error']))fail();
 if(response.ok!==true){if(response.ok!==false||!exact(response.error,['code'])||!PROJECT_IMPORT_ERROR_CODES.includes(response.error.code))fail();if(Object.hasOwn(response,'protocol')&&(response.protocol!==PROJECT_IMPORT_PROTOCOL||!uuid(response.requestId)||(expectedRequestId!==undefined&&response.requestId!==expectedRequestId)))fail();return response;}
 if(response.protocol!==PROJECT_IMPORT_PROTOCOL||!uuid(response.requestId)||(expectedRequestId!==undefined&&response.requestId!==expectedRequestId))fail();
 const v=response.value;
 if(operation==='prepare'){if(!exact(v,['previewId','preview'])||!uuid(v.previewId))fail();validateProjectImportPreview(v.preview);}
 else if(operation==='cancel'){if(!exact(v,['cancelled'])||v.cancelled!==true)fail();}
 else if(!exact(v,['kind','saved','namespace','targetLabel','seq','rawSha256','epoch','registered','modelInvoked','authority'])||v.kind!=='host-project-import-result'||v.saved!==true||!text(v.namespace,300)||!text(v.targetLabel,500)||!integer(v.seq,1)||!hash(v.rawSha256)||!integer(v.epoch,1)||v.registered!==false||v.modelInvoked!==false||v.authority!=='none')fail();
 return response;
}

export function parseProjectImportRequest(raw){return validateProjectImportRequest(parseBounded(raw));}
export function parseProjectImportResponse(raw,operation,expectedRequestId){return validateProjectImportResponse(parseBounded(raw),operation,expectedRequestId);}
