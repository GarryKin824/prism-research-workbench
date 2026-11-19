/** Read-only inspection of the existing project backup format. Hashes and namespace
 * labels describe bytes, not provenance, identity, permissions or execution authority. */
import {loadProjects} from './project-planning-core.mjs';
const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}return o;};
const fail=code=>{throw Error(code);};
function parse(raw){
 // Bound lexical work before native parsing/materialization. Nested template and
 // discussion archives are strings here and remain validated by loadProjects.
 const tokens=raw.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]|[^\s{}\[\]:,]+/g),stack=[];
 let count=0,previous;
 for(const match of tokens){
  if(++count>100000)fail('PROJECT_TRANSFER_TOKEN_LIMIT');const t=match[0];
  if(t==='{'||t==='['){if(stack.length>=64)fail('PROJECT_TRANSFER_DEPTH_LIMIT');stack.push(t==='{'?new Set():null);}
  else if(t==='}'||t===']')stack.pop();
  else if(t===':'&&previous?.startsWith('"')){const keys=stack.at(-1),key=JSON.parse(previous);if(!keys||keys.has(key))fail('PROJECT_TRANSFER_DUPLICATE_MEMBER');keys.add(key);}
  previous=t;
 }
 // Lexical checks add limits/duplicate refusal, not a replacement JSON grammar.
 return JSON.parse(raw);
}
export async function inspectProjectTransfer(raw,{expectedNamespace,crypto=globalThis.crypto}={}){
 if(typeof raw!=='string')fail('PROJECT_TRANSFER_RAW_INVALID');const bytes=new TextEncoder().encode(raw);if(bytes.length>4000000)fail('PROJECT_TRANSFER_TOO_LARGE');
 const archive=parse(raw),namespace=archive?.state?.namespace;
 if(typeof namespace!=='string'||(expectedNamespace!==undefined&&namespace!==expectedNamespace))fail('PROJECT_TRANSFER_NAMESPACE_MISMATCH');
 const state=await loadProjects(raw,namespace,crypto),rawSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 const projects=state.projects.map(p=>{const head=p.revisions.at(-1);return {projectId:p.id,title:head.title,revisionCount:p.revisions.length,headRevisionSha256:head.sha256,templateVersion:head.templateVersion,revisions:p.revisions.map(r=>({id:r.id,seq:r.seq,kind:r.kind,sha256:r.sha256}))};});
 return freeze({kind:'project-transfer-inspection',raw,rawSha256,bytes:bytes.length,namespace,archiveSha256:archive.sha256,state,projects,projectCount:projects.length,revisionCount:projects.reduce((n,p)=>n+p.revisionCount,0),authority:'none'});
}
