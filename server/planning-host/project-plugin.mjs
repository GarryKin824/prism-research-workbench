/** Default-off trusted Host operator plugin. No browser route, connection, model,
 * implicit import or admission. Official deployment owns backend/path routing.
 * One factory activation only: dependency replacement requires a NEW factory.
 */
import {webcrypto} from 'node:crypto';
import {createPlanningHostDomainProjectSource} from './domain-project-source.mjs';
import {createPlanningHostProjectImportCoordinator} from './project-import-coordinator.mjs';
import {createPlanningHostProjectRegistry} from './project-scope-registry.mjs';
const fail=code=>{throw Error(code);};
const exact=(o,ks)=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&Reflect.ownKeys(o).length===ks.length&&ks.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(o,k)??{},'value'));
export function createPlanningHostProjectsPlugin(options={}){
 if(options.enabled!==true)return Object.freeze({name:'prism-host-projects-disabled',inject:[],apply(){}});
 const {defineDomain,z,namespace,targetLabel,onReady,crypto=webcrypto}=options;
 if(typeof defineDomain!=='function'||!z||typeof namespace!=='string'||!namespace.trim()||namespace.length>300||typeof targetLabel!=='string'||!targetLabel.trim()||targetLabel.length>500||typeof onReady!=='function')fail('HOST_PROJECTS_CONFIGURATION_INVALID');
 let activated=false;
 return Object.freeze({name:'prism-host-projects',inject:['storageDomain'],async apply(ctx){
  if(activated)fail('HOST_PROJECTS_ALREADY_ACTIVATED');activated=true;
  let source,imports,closed=false,closing,ready=false,sourceStop,effectStop,registrations=0,cleanupFailed=false;
  const registries=new Map(),handles=new Map();
  const guard=()=>{if(closed||!ready)fail('HOST_PROJECTS_UNAVAILABLE');};
  function retireAll(){const prior=[...handles.values()];handles.clear();for(const entry of prior)try{entry.retire();}catch{cleanupFailed=true;}}
  function close(){
   if(closing)return closing;
   closing=Promise.resolve().then(async()=>{try{await source?.close();}catch{cleanupFailed=true;}finally{try{Promise.resolve(effectStop?.()).catch(()=>{});}catch{cleanupFailed=true;}effectStop=undefined;}if(cleanupFailed)fail('HOST_PROJECTS_DISPOSE_FAILED');});
   closed=true;ready=false;
   // Revoke synchronously before draining; never close a shared catalog/backend.
   try{imports?.close();}catch{cleanupFailed=true;}retireAll();for(const registry of registries.values())try{registry.close();}catch{cleanupFailed=true;}registries.clear();
   try{sourceStop?.();}catch{cleanupFailed=true;}sourceStop=undefined;return closing;
  }
  const operator=Object.freeze({
   prepareImport(raw){guard();return imports.prepare(raw);},
   confirmImport(preview,approval,isCurrent=()=>true){guard();return imports.confirm(preview,approval,()=>{guard();return isCurrent()===true;});},
   cancelImport(preview){imports?.cancel(preview);},
   async registerProject(request){
    guard();const before=source.getSnapshot();if(!exact(request,['projectId','bridge','catalog']))fail('HOST_PROJECTS_REGISTRATION_INVALID');
    const {projectId,bridge,catalog}=request;if(registrations>=32)fail('HOST_PROJECTS_REGISTRATION_LIMIT');
    let registry=registries.get(catalog);if(!registry){if(registries.size>=4)fail('HOST_PROJECTS_CATALOG_LIMIT');registry=createPlanningHostProjectRegistry({catalog,crypto,maxAdmissions:32});registries.set(catalog,registry);}registrations++;
    // Returned selectors can retire/expire immediately; they grant no browser access.
    const admitted=await registry.registerProject({source,namespace,projectId,bridge});
    try{guard();if(source.getSnapshot()!==before)fail('HOST_PROJECTS_SOURCE_CHANGED');const handle=Object.freeze({documentId:admitted.documentId,document:admitted.document,retire(){admitted.retire();handles.delete(handle);}});handles.set(handle,admitted);return handle;}catch(error){admitted.retire();throw error;}
   },
   retireProject(handle){const admitted=handles.get(handle);if(!admitted)return;admitted.retire();handles.delete(handle);},
   inspect(){const status=source?.inspect()??null;return Object.freeze({enabled:true,state:closed?'closed':!ready?'starting':imports?.inspect().state==='unknown-may-be-saved'?'unknown-may-be-saved':!['ready','absent'].includes(status?.state)?'unavailable':'ready',namespace,targetLabel,source:status,imports:imports?.inspect()??null,activeRegistrations:[...registries.values()].reduce((n,r)=>n+r.inspect().activeRegistrations,0),registrationAttempts:registrations,browserAccessGranted:false,routeInstalled:false,realModelConnected:false,authority:'none'});},close
  });
  try{
   effectStop=ctx.effect(()=>close);if(typeof effectStop!=='function')fail('HOST_PROJECTS_LIFECYCLE_INVALID');if(closed)fail('HOST_PROJECTS_UNAVAILABLE');
   source=createPlanningHostDomainProjectSource({enabled:true,ctx,facility:ctx.storageDomain,defineDomain,z,namespace,crypto});await source.initialize();if(closed)fail('HOST_PROJECTS_UNAVAILABLE');
   sourceStop=source.subscribe(retireAll);
   imports=createPlanningHostProjectImportCoordinator({enabled:true,source,namespace,targetLabel,crypto});ready=true;
   await onReady(operator);guard();
  }catch(error){await close().catch(()=>{});throw Error('HOST_PROJECTS_ACTIVATION_FAILED',{cause:error});}
 }});
}
