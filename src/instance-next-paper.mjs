import {createProjectLibraryController} from './project-library-controller.mjs';
import {createResearchInstancesController} from './research-instances-controller.mjs';
const fail=c=>{throw Error(c)},clone=x=>JSON.parse(JSON.stringify(x));
export function createInstanceNextPaperController({store,storage,projectId,crypto=globalThis.crypto,reviewController}){
 const namespace=store.getStorageKey(),receipts=new WeakMap(),previews=new WeakMap();let generation=0,busy=false;
 async function confirmReview(preview,options){const receipt=await reviewController.confirm(preview,options);if(receipt.committed===true&&receipt.record?.decision==='approved'&&receipt.record.binding.target.namespace===namespace&&receipt.record.binding.target.projectId===projectId)receipts.set(receipt,JSON.stringify(receipt));return receipt}
 async function resolve(target,receipt,isCurrent){
  if(!receipts.has(receipt)||receipts.get(receipt)!==JSON.stringify(receipt)||JSON.stringify(receipt.record.binding.target)!==JSON.stringify(target))fail('INSTANCE_NEXT_FRESH_RECEIPT_REQUIRED');
  const keys=[namespace,namespace+':project-planning-v1',namespace+':project-library-v1',namespace+':research-instances-v1',...['instance-manual-results-v1','instance-review-decisions-v1'].flatMap(k=>{const key=namespace+':'+k+':'+JSON.stringify(projectId);return [key,key+':intent-v1']})],raws=keys.map(k=>storage.getItem(k)),papers=JSON.stringify(store.getSnapshot().papers),guards=[];
  const stable=()=>{store.assertCurrentStorage();if(!isCurrent()||store.getStorageKey()!==namespace||JSON.stringify(store.getSnapshot().papers)!==papers||keys.some((k,i)=>storage.getItem(k)!==raws[i]))fail('INSTANCE_NEXT_CHANGED');for(const g of guards)g()};stable();
  const instances=createResearchInstancesController({store,storage,crypto});await instances.initialize();stable();const state=instances.snapshot().state;if(state.activeId||state.queueState?.activeQueueId)fail('INSTANCE_NEXT_SYNTHETIC_OWNER_ACTIVE');const current=await instances.verifyNavigation(target,isCurrent);stable();guards.push(current.verify);const graph=current.workflow.graphs.find(g=>g.version===target.graphVersion),sinks=graph.nodes.filter(n=>!graph.nodes.some(other=>other.dependsOn.includes(n.id)));
  if(sinks.length!==1||sinks[0].id!==target.nodeId||sinks[0].kind!=='review')fail('INSTANCE_NEXT_UNIQUE_TERMINAL_REVIEW_REQUIRED');
  const approved=await reviewController.verifyApproved(receipt.record.id,target,{isCurrent});stable();approved.verify();guards.push(approved.verify);
  const library=createProjectLibraryController({store,storage,crypto});await library.initialize();stable();const scope=await library.snapshot(projectId);stable();scope.stable();guards.push(scope.stable);const index=scope.paperIds.indexOf(target.paperId);if(index<0)fail('INSTANCE_NEXT_CURRENT_NOT_MEMBER');const paperId=scope.paperIds[index+1];if(!paperId)fail('INSTANCE_NEXT_END_OF_MEMBERS');
  const available=[];for(const instance of instances.snapshot().state.instances.filter(i=>i.projectId===projectId&&i.sourcePaperId===paperId)){
   const env=JSON.parse(instance.versions.at(-1)),g=env.state.graphs.find(x=>x.version===env.state.currentVersion),roots=g.nodes.filter(n=>!n.dependsOn.length&&n.kind==='work');if(!roots.length)continue;
   const nextTarget={namespace,projectId,paperId,instanceId:instance.id,workflowSha256:env.sha256,graphVersion:g.version,graphSha256:g.sha256,nodeId:roots[0].id};
   let checked;try{checked=await instances.verifyNavigation(nextTarget,isCurrent)}catch{stable();continue}stable();checked.verify();available.push({target:nextTarget,verify:checked.verify});
  }
  if(available.length!==1)fail('INSTANCE_NEXT_UNIQUE_CURRENT_INSTANCE_REQUIRED');guards.push(available[0].verify);stable();return {nextTarget:available[0].target,stable};
 }
 async function prepareNext({target,receipt},{isCurrent=()=>true}={}){if(busy)fail('INSTANCE_NEXT_BUSY');const g=++generation,valid=()=>g===generation&&isCurrent(),r=await resolve(target,receipt,valid);r.stable();const preview={kind:'instance-next-paper-navigation',currentTarget:clone(target),nextTarget:clone(r.nextTarget),decisionId:receipt.record.id,authority:'navigation-only',executionAllowed:false,notice:'按本项目文献关联顺序打开下一篇；人工终审不代表科学验证或自动研究完成。'};previews.set(preview,{receipt,target:clone(target),valid,stable:r.stable,display:JSON.stringify(preview)});return preview}
 async function navigate(preview,{explicitConfirmation=false,onNavigate,isCurrent=()=>true}={}){
  if(explicitConfirmation!==true||typeof onNavigate!=='function')fail('INSTANCE_NEXT_CONFIRM_REQUIRED');if(busy)fail('INSTANCE_NEXT_BUSY');const p=previews.get(preview);if(!p)fail('INSTANCE_NEXT_PREVIEW_EXPIRED');previews.delete(preview);busy=true;
  const stable=()=>{if(!p.valid()||!isCurrent()||JSON.stringify(preview)!==p.display)fail('INSTANCE_NEXT_PREVIEW_EXPIRED');p.stable()};
  try{stable();const r=await resolve(p.target,p.receipt,()=>{try{stable();return true}catch{return false}});stable();r.stable();if(JSON.stringify(r.nextTarget)!==JSON.stringify(preview.nextTarget))fail('INSTANCE_NEXT_CHANGED');const verify=()=>{stable();r.stable();return true};verify();const result=onNavigate(clone(r.nextTarget),verify);if(typeof result!=='boolean')fail('INSTANCE_NEXT_SYNCHRONOUS_CALLBACK_REQUIRED');return result}finally{receipts.delete(p.receipt);busy=false}
 }
 return {confirmReview,prepareNext,navigate,cancel:()=>{generation++}};
}
