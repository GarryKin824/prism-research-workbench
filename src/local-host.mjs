import { installWorkbenchModelRoute } from '../server/workbench-model.mjs';
import { admitZoteroBrowser, createZoteroHandler } from '../server/zotero-local.mjs';
import { ZOTERO_ROUTE } from './zotero-import-core.mjs';
import path from 'node:path';
import { open as openFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { LIMITS as pdfLimits } from './pdf-intake/policy.mjs';
import { AUTOMATIC_EXECUTION_PATH,AUTOMATIC_EXECUTION_STATUS_PATH } from './execution-targets.mjs';
import { createAutomaticExecutionGateway,createAutomaticHttpHandler } from '../server/automatic-execution.mjs';
import { createCodexAutomaticAdapter } from '../server/codex-automatic.mjs';
import { validCodexExecutable } from '../server/codex-app-server.mjs';
import { createWorkspaceRecoveryHandler } from '../server/workspace-recovery.mjs';
import { recoveryDataPath, recoveryStatusPath } from './workspace-recovery-core.mjs';

/** Non-secret local configuration through the official structured boot event. */
export const name='prism-local-workbench';
function validateLocalConfig(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(key=>!['storageNamespace','accountModel','zoteroOrigin','codexExecution','workspaceRecovery','localReferencePdf'].includes(key))||typeof raw.storageNamespace!=='string'||! /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(raw.storageNamespace))throw Error('EXPLICIT_LOCAL_NAMESPACE_REQUIRED');
 const result={storageNamespace:raw.storageNamespace};
 if(raw.accountModel!==undefined){
  const option=raw.accountModel;
  if(!option||typeof option!=='object'||Array.isArray(option)||Object.keys(option).sort().join(',')!=='journal,origin'||typeof option.journal!=='string'||(option.origin!=='dsh-app://app'&&!/^http:\/\/127\.0\.0\.1:[0-9]{1,5}$/.test(option.origin)))throw Error('MODEL_LOCAL_OWNER_REQUIRED');
  result.accountModel={journal:option.journal,origin:option.origin};
 }
 if(raw.zoteroOrigin!==undefined){
  if(typeof raw.zoteroOrigin!=='string'||!/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(raw.zoteroOrigin)
    || new URL(raw.zoteroOrigin).origin!==raw.zoteroOrigin)throw Error('ZOTERO_LOCAL_ORIGIN_REQUIRED');
  result.zoteroOrigin=raw.zoteroOrigin;
 }
 if(raw.codexExecution!==undefined){
  const entry=raw.codexExecution;
  if(!entry||Object.keys(entry).sort().join(',')!=='executable,home,includedOnly'||!validCodexExecutable(entry.executable)
    ||typeof entry.home!=='string'||!path.isAbsolute(entry.home)||typeof entry.includedOnly!=='boolean'||!result.accountModel){
   throw Error('CODEX_EXECUTION_CONFIG');
  }
  result.codexExecution=entry;
 }
 if(raw.workspaceRecovery!==undefined){
  const recovery=raw.workspaceRecovery;
  if(!recovery||Object.keys(recovery).sort().join(',')!=='directory,origin'
   ||typeof recovery.directory!=='string'||!path.isAbsolute(recovery.directory)
   ||typeof recovery.origin!=='string'||!/^http:\/\/127\.0\.0\.1:[0-9]{1,5}$/.test(recovery.origin)
   ||new URL(recovery.origin).origin!==recovery.origin)throw Error('LOCAL_RECOVERY_CONFIG');
  result.workspaceRecovery=recovery;
 }
 if(raw.localReferencePdf!==undefined){
  const reference=raw.localReferencePdf;
  if(!reference||Object.keys(reference).sort().join(',')!=='filename,origin,sha256'
   ||typeof reference.filename!=='string'||!path.isAbsolute(reference.filename)
   ||!/^[^\u0000-\u001f\u007f/\\]{1,251}\.pdf$/i.test(path.basename(reference.filename))
   ||typeof reference.origin!=='string'||!/^http:\/\/127\.0\.0\.1:[0-9]{1,5}$/.test(reference.origin)
   ||new URL(reference.origin).origin!==reference.origin
   ||typeof reference.sha256!=='string'||! /^[a-f0-9]{64}$/.test(reference.sha256))throw Error('LOCAL_REFERENCE_CONFIG');
  result.localReferencePdf=reference;
 }
 return result;
}
export const Config={'~standard':{version:1,vendor:'prism-local-workbench',validate(raw){try{return {value:validateLocalConfig(raw)}}catch{return {issues:[{message:'EXPLICIT_LOCAL_NAMESPACE_REQUIRED'}]}}}}};
export function apply(ctx,config){
 const {storageNamespace,accountModel,zoteroOrigin,codexExecution,workspaceRecovery,localReferencePdf}=validateLocalConfig(config);
 ctx.on('webserver/index-inject',table=>{
  if(table.some(row=>row.kind==='global'&&row.name==='__PRISM_LOCAL_PROFILE__'))throw Error('LOCAL_PROFILE_BOOTSTRAP_CONFLICT');
  table.push({kind:'global',name:'__PRISM_LOCAL_PROFILE__',value:{storageNamespace,required:true}});
  if(accountModel)table.push({kind:'global',name:'__PRISM_WORKBENCH_MODEL__',value:{namespace:storageNamespace,origin:accountModel.origin}});
  if(zoteroOrigin)table.push({kind:'global',name:'__PRISM_ZOTERO_LOCAL__',value:true});
  if(workspaceRecovery)table.push({kind:'global',name:'__PRISM_WORKSPACE_RECOVERY__',value:workspaceRecovery.origin});
  if(localReferencePdf)table.push({kind:'global',name:'__PRISM_LOCAL_REFERENCE_PDF__',value:{
   origin:localReferencePdf.origin,name:path.basename(localReferencePdf.filename),sha256:localReferencePdf.sha256,
  }});
 });
 if(localReferencePdf)ctx.inject(['connection','webServer'],child=>{
  if(child.webServer.host!=='127.0.0.1'||child.connection.allowsRemoteAuthorities)throw Error('LOCAL_REFERENCE_CONFIG');
  const {origin,filename,sha256}=localReferencePdf,authority=new URL(origin).host;
  const headers={'cache-control':'no-store','x-content-type-options':'nosniff'};
  child.connection.fetch.register({path:'/api/prism-reference-pdf',methods:['GET'],requestBody:'buffered',fetch:async request=>{
   if(request.headers.get('host')!==authority||request.headers.get('sec-fetch-site')!=='same-origin'
    ||new URL(request.url).search)return new Response(null,{status:403,headers});
   const {peer}=child.connection.admit(request);
   if(!peer||peer!==child.connection.browserPeer||peer.principal.kind!=='owner'||peer.signal.aborted)
    return new Response(null,{status:403,headers});
   try{
    const file=await openFile(filename,'r');
    try{
     const {size}=await file.stat();
     if(size<5||size>pdfLimits.maxBytes)return new Response(null,{status:413,headers});
     const bytes=Buffer.alloc(size);
     // Read at most the configured PDF size, even if the file is replaced during read.
     let offset=0;
     while(offset<size){
      const {bytesRead}=await file.read(bytes,offset,size-offset,offset);
      if(!bytesRead)break;
      offset+=bytesRead;
     }
     if(offset!==size||bytes.subarray(0,5).toString('ascii')!=='%PDF-'||createHash('sha256').update(bytes).digest('hex')!==sha256)
      return new Response(null,{status:409,headers});
     if(peer.signal.aborted||request.signal.aborted)return new Response(null,{status:403,headers});
     return new Response(bytes,{headers:{...headers,'content-type':'application/pdf','content-length':String(size)}});
    }finally{await file.close()}
   }catch{return new Response(null,{status:503,headers})}
  }});
 });
 if(workspaceRecovery)ctx.inject(['connection','webServer'],child=>{
  const {origin,directory}=workspaceRecovery;
  if(child.webServer.host!=='127.0.0.1'||child.connection.allowsRemoteAuthorities)throw Error('LOCAL_RECOVERY_CONFIG');
  const authority=new URL(origin).host;
  const fetch=createWorkspaceRecoveryHandler({directory,namespace:'prism-native-profile-v1:'+storageNamespace,admit:request=>{
   if(request.headers.get('host')!==authority||request.headers.get('sec-fetch-site')!=='same-origin'
    ||request.method==='POST'&&request.headers.get('origin')!==origin)return false;
   const {peer}=child.connection.admit(request);
   return peer&&peer===child.connection.browserPeer&&peer.principal.kind==='owner'&&!peer.signal.aborted;
  }});
  child.connection.fetch.register({path:recoveryStatusPath,methods:['GET'],requestBody:'buffered',fetch});
  // DSH selects the body mode per route path. Use separate paths for read and write.
  child.connection.fetch.register({path:recoveryDataPath,methods:['GET'],requestBody:'buffered',fetch});
  child.connection.fetch.register({path:recoveryDataPath+'/write',methods:['POST'],requestBody:'streaming',fetch});
 });
 if(accountModel)ctx.inject(['connection','deepseekAccount','llm','webServer'],child=>{
  const desktop=accountModel.origin==='dsh-app://app';
  if(desktop&&(child.get('profileContext')?.name!=='desktop'||child.webServer.host!=='127.0.0.1'))throw Error('MODEL_DESKTOP_HOST_REQUIRED');
  const origin=desktop?()=>child.webServer.getOrigin():accountModel.origin;
  installWorkbenchModelRoute(child,{origin,desktop,journal:accountModel.journal,namespace:storageNamespace});
  if(codexExecution){
   if(child.webServer.host!=='127.0.0.1'||child.connection.allowsRemoteAuthorities)throw Error('CODEX_EXECUTION_CONFIG');
   const automatic=createAutomaticExecutionGateway({namespace:storageNamespace,journal:path.join(codexExecution.home,'prism-automatic-journal'),
    adapters:{codex:createCodexAutomaticAdapter(codexExecution)}});
   const fetch=createAutomaticHttpHandler({automatic,admit:request=>{
    const authority=new URL(typeof origin==='function'?origin():origin);
    if(authority.hostname!=='127.0.0.1'||request.headers.get('host')!==authority.host)return false;
    const sameOrigin=desktop?request.headers.get('sec-fetch-site')===null&&request.headers.get('origin')===null:
     request.headers.get('sec-fetch-site')==='same-origin'&&(request.method==='GET'||request.headers.get('origin')===authority.origin);
    if(!sameOrigin)return false;
    const {peer}=child.connection.admit(request);
    return peer&&peer===child.connection.browserPeer&&peer.principal.kind==='owner'&&!peer.signal.aborted;
   }});
   // The installed DSH carrier assigns the body mode by path, and cannot construct a GET with a stream.
   child.connection.fetch.register({path:AUTOMATIC_EXECUTION_STATUS_PATH,methods:['GET'],requestBody:'buffered',fetch});
   child.connection.fetch.register({path:AUTOMATIC_EXECUTION_PATH,methods:['POST'],requestBody:'streaming',fetch});
   child.effect(()=>()=>{void automatic.close()});
  }
 });
 if(zoteroOrigin)ctx.inject(['connection','webServer'],child=>{
  if(child.webServer.host!=='127.0.0.1'||!child.connection?.fetch||child.connection.allowsRemoteAuthorities)throw Error('ZOTERO_LOCAL_ORIGIN_REQUIRED');
  const fetch=createZoteroHandler({admit:request=>{
   if(!admitZoteroBrowser(request,zoteroOrigin))return false;
   const {peer}=child.connection.admit(request);
   return peer&&peer===child.connection.browserPeer&&peer.principal.kind==='owner'&&!peer.signal.aborted;
  }});
  child.connection.fetch.register({path:ZOTERO_ROUTE,methods:['GET'],requestBody:'buffered',fetch});
 });
}
