/** Trusted in-process Host composition seam; NEVER expose factory dependencies to a browser.
 * No prompt/submit method or transport is accepted. Read capability must be produced by
 * the authenticated official gateway integration, NOT by JSON from a caller.
 * This module validates scope and freshness, not the authenticity of injected Host code.
 */
import {webcrypto} from 'node:crypto';
import {loadProjects} from '../../src/project-planning-core.mjs';
const fail=c=>{throw Error(c);};
const exact=(o,keys)=>o&&[Object.prototype,null].includes(Object.getPrototypeOf(o))&&Reflect.ownKeys(o).length===keys.length&&keys.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(o,k)??{},'value'));
const frozen=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(frozen);Object.freeze(o);}return o;};
const str=x=>typeof x==='string'&&x.length>0&&x.length<=300&&!/[\x00-\x1f]/.test(x);
export function createReadonlyNodeCoordinator(options={}){
 if(options.enabled!==true)return Object.freeze({inspect:()=>Object.freeze({enabled:false,submitEnabled:false}),close(){}});
 const {source,namespace,projectId,nodeId,capability,crypto=webcrypto}=options;
 if(![namespace,projectId,nodeId].every(str)||!source||typeof source.getSnapshot!=='function'||typeof source.subscribe!=='function'||!capability||typeof capability.getSnapshot!=='function'||typeof capability.subscribe!=='function'||typeof capability.readState!=='function')fail('NODE_CONFIGURATION_INVALID');
 let closed=false,busy=false,stopSource,stopCapability,sourceSnapshot,access;
 const close=()=>{closed=true;try{stopSource?.();}finally{stopCapability?.();}};
 const current=()=>{if(closed)fail('NODE_REVOKED');if(source.getSnapshot()!==sourceSnapshot||capability.getSnapshot()!==access){close();fail('NODE_SCOPE_CHANGED');}};
 try{
  sourceSnapshot=source.getSnapshot();access=capability.getSnapshot();
  if(!exact(sourceSnapshot,['epoch','raw'])||!Object.isFrozen(sourceSnapshot)||!Number.isSafeInteger(sourceSnapshot.epoch)||sourceSnapshot.epoch<0||typeof sourceSnapshot.raw!=='string'||Buffer.byteLength(sourceSnapshot.raw)>4000000)fail('NODE_SOURCE_INVALID');
  // Independent generation and identity facts must come from trusted Host admission.
  if(!exact(access,['generation','namespace','projectId','nodeId','sessionId','workspaceId','provider','model','principalId','readStateAllowed','isSeeded'])||!Object.isFrozen(access)||!['generation','namespace','projectId','nodeId','sessionId','workspaceId','provider','model','principalId'].every(k=>str(access[k]))||access.namespace!==namespace||access.projectId!==projectId||access.nodeId!==nodeId||access.readStateAllowed!==true||access.isSeeded!==false)fail('NODE_RESOURCE_PERMISSION_REQUIRED');
  stopSource=source.subscribe(close);if(typeof stopSource!=='function')fail('NODE_LIFECYCLE_INVALID');
  stopCapability=capability.subscribe(close);if(typeof stopCapability!=='function')fail('NODE_LIFECYCLE_INVALID');current();
 }catch(e){close();throw e;}
 return Object.freeze({
  inspect:()=>Object.freeze({enabled:true,closed,busy,submitEnabled:false,routeInstalled:false,productionReady:false}),close,
  async preview(){
   current();if(busy)fail('NODE_BUSY');busy=true;
   try{
    const state=await loadProjects(sourceSnapshot.raw,namespace,crypto);current();
    const revision=state.projects.find(p=>p.id===projectId)?.revisions.at(-1);
    const node=revision?.templateRaw?JSON.parse(revision.templateRaw).state.graphs.at(-1)?.nodes.find(n=>n.id===nodeId):null;
    if(!node)fail('NODE_NOT_FOUND');
    // Capability owns officially authorized remote.state call and exact projection.
    // No caller can choose a new session or inject principal into its wire request.
    const result=await capability.readState(Object.freeze({sessionId:access.sessionId}));current();
    if(!exact(result,['sessionId','workspaceId','provider','model','generation','quiescent','isSeeded','cursor'])||!['sessionId','workspaceId','provider','model','generation'].every(k=>result[k]===access[k])||result.quiescent!==true||result.isSeeded!==false||!Number.isSafeInteger(result.cursor)||result.cursor< -1)fail('NODE_STATE_UNSUPPORTED');
    return frozen({schema:'prism-readonly-node-preview/v1',namespace,projectId,nodeId,sourceEpoch:sourceSnapshot.epoch,revisionSha256:revision.sha256,promptVersion:node.promptVersion,prompt:node.prompt,target:{sessionId:access.sessionId,workspaceId:access.workspaceId,provider:access.provider,model:access.model,generation:access.generation},cursor:result.cursor,authority:'none',submitEnabled:false,admission:'trusted-host-read-capability-only',scope:'project-template-node-only',paperContextIncluded:false,persistentIntentCreated:false,productionReady:false});
   }finally{busy=false;}
  }
 });
}

/** Pure projection of official session/state output. It cannot attest admission.
 * trustedTarget MUST be Host-selected, permission-checked, versioned facts.
 * queue:null or pending approvals are NOT proven idle; active means live Agent, not running.
 */
export function projectOfficialReadonlyState(trustedTarget, state){
 if(!exact(trustedTarget,['sessionId','workspaceId','provider','model','generation','isSeeded'])||!['sessionId','workspaceId','provider','model','generation'].every(k=>str(trustedTarget[k]))||trustedTarget.isSeeded!==false)fail('NODE_TARGET_INVALID');
 if(!exact(state,['cursor','active','running','queue','pendingInput'])||!Number.isSafeInteger(state.cursor)||state.cursor< -1||typeof state.active!=='boolean'||typeof state.running!=='boolean'||!Array.isArray(state.queue)||state.queue.length!==0||!Array.isArray(state.pendingInput)||state.pendingInput.length!==0||state.active!==true||state.running!==false)fail('NODE_OFFICIAL_STATE_NOT_PROVEN_IDLE');
 return frozen({...trustedTarget,cursor:state.cursor,quiescent:true});
}
