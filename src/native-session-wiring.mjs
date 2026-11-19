import {createNativeSessionController} from './native-sessions.mjs';
/** Optional runtime injection; missing services leave the local workbench usable. */
export function mountNativeSessionController(ctx,onController){
 let active=createNativeSessionController(),disposed=false;
 onController(active);
 const uninject=ctx.inject(['remote.session','workspaces','connection','uiWorkspace'],scope=>{
  active.close();const next=createNativeSessionController({sessionRemote:scope.remote.session,workspaceStore:scope.workspaces.list,connection:scope.connection,watchWorkspaceAccess:(id,listener)=>{
   listener(false);
   return scope.uiWorkspace.whenAccess(id,'session/create',()=>{listener(true);return()=>listener(false)});
  }});active=next;onController(next);
  scope.effect(()=>()=>{next.close();if(!disposed&&active===next){active=createNativeSessionController();onController(active)}});
 });
 return async()=>{disposed=true;active.close();await uninject.dispose();};
}
/** Manifest metadata names packages, not Cordis service keys. It is not apply ordering. */
export const nativeClientDependencies=[
 '@deepseek-ai/dsh-api-session-controller',
 '@deepseek-ai/dsh-api-workspace-controller',
 '@deepseek-ai/dsh-client-connection',
 '@deepseek-ai/dsh-client-ui-workspace',
];
