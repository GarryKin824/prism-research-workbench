function workbenchContextControllers(store, target, verifyNavigation) {
  const args={store,storage:globalThis.localStorage,projectId:target.projectId,verifyNavigation};
  return {
    results:instanceManualResultsCore.createInstanceManualResultsController(args),
    reviews:instanceReviewDecisionsCore.createInstanceReviewDecisionsController(args),
  };
}

async function readGuidedStepProgress(store, target, graph, verifyNavigation, isCurrent) {
  const {results,reviews}=workbenchContextControllers(store,target,verifyNavigation);
  const options={instanceId:target.instanceId,explicitReadConsent:true,isCurrent};
  const raw=[localStorage.getItem(results.key),localStorage.getItem(reviews.key)];
  const [resultView,reviewView,executions]=await Promise.all([
    results.read(options), reviews.read(options),
    workbenchModelCore.readWorkbenchExecutions(
      localStorage.getItem(workbenchModelCore.workbenchExecutionKey(target.namespace,target.projectId)),target.namespace,target.projectId),
  ]);
  if (resultView.outcome==='unknown'||reviewView.outcome==='unknown') throw Error('RESEARCH_PROGRESS_UNCERTAIN');
  const verify=()=>{
    if(!isCurrent()||localStorage.getItem(results.key)!==raw[0]||localStorage.getItem(reviews.key)!==raw[1]) {
      throw Error('RESEARCH_PROGRESS_CHANGED');
    }
  };
  const {sameWorkbenchVersion,sameWorkbenchStep}=workbenchModelCore;
  const matches=(row,id)=>sameWorkbenchVersion(row.binding.target,target)&&row.binding.target.nodeId===id;
  const saved=Object.fromEntries(graph.nodes.map(node=>[node.id,resultView.records.findLast(row=>matches(row,node.id))]));
  const decisions={};
  for(const node of graph.nodes.filter(node=>node.kind==='review')){
    const record=reviewView.records.findLast(row=>matches(row,node.id));
    if(record&&(await reviews.checkRecord(record,{isCurrent})).status==='current')decisions[node.id]=record;
    verify();
  }
  const returnedTargets=new Set(Object.values(decisions).filter(record=>record.decision==='returned').map(record=>record.binding.reviewTarget));
  const nodeMap=new Map(graph.nodes.map(node=>[node.id,node]));
  const checkedStates=new Map();
  function stale(id){
    if(checkedStates.has(id))return checkedStates.get(id);
    const refs=saved[id]?.execution?.basis?.upstream??[];
    const changed=refs.some(ref=>{
      if(!nodeMap.get(id)?.dependsOn.includes(ref.nodeId))return true;
      const reviewed=nodeMap.get(ref.nodeId)?.kind==='review';
      const actual=reviewed?decisions[ref.nodeId]:saved[ref.nodeId];
      return actual?.id!==ref.id||actual?.sha256!==ref.sha256||(!reviewed&&stale(ref.nodeId));
    });
    checkedStates.set(id,changed);
    return changed;
  }
  const rows=Object.fromEntries(graph.nodes.map(node=>{
    const value=saved[node.id], judgment=decisions[node.id];
    const revision=Object.values(decisions).find(decision=>decision.decision==='returned'
      &&decision.binding.reviewTarget===node.id&&decision.upstream.some(result=>result.id===value?.id));
    const attempts=executions.records.filter(row=>row.mode==='step'&&sameWorkbenchStep(row.input.target,{...target,nodeId:node.id}));
    const uncertain=attempts.find(row=>['pending','unknown'].includes(row.state));
    const attempt=attempts.findLast(row=>sameWorkbenchVersion(row.input.target,target));
    const blocked=node.dependsOn.filter(id=>{
      const dependency=graph.nodes.find(step=>step.id===id);
      if(dependency?.kind==='review')return decisions[id]?.decision!=='approved'||dependency.dependsOn.some(stale);
      return !saved[id] || stale(id) || (node.kind==='work'&&(returnedTargets.has(id)||saved[id].execution?.reply.finish==='max-tokens'));
    });
    const outstandingResult=attempt?.state==='returned'&&attempt.input.requestId!==value?.execution?.input.requestId
      &&(!revision||attempt.basis?.revision?.review?.id===revision.id);
    const state=uncertain?'请求待查回':outstandingResult?'答复待保存':revision?'待返修'
      :judgment?({approved:'人工复核通过',returned:'人工退回',revoked:'审核已撤销'})[judgment.decision]
      :stale(node.id)?'上游已变化，待重新执行':value?(value.execution?.reply.finish==='max-tokens'?'部分答复':'已保存答复')
      :attempt?.state==='failed'?'调用失败':attempt?.state==='cancelled'?'调用已取消'
      :attempt?.state==='refused'?'请求未发送':blocked.length?'等待上游':node.kind==='review'?'等待人工复核':'待执行';
    return [node.id,{state,blocked,revision,attempt,uncertain,value,judgment,outstandingResult,stale:stale(node.id)}];
  }));
  verify();
  return {rows,saved,decisions,results,reviews,verify};
}

async function prepareGuidedStepBasis(store,target,checked,verifyNavigation,range,isCurrent){
  const graph=checked.workflow.graphs.at(-1);
  const progress=await readGuidedStepProgress(store,target,graph,verifyNavigation,isCurrent);
  const step=progress.rows[target.nodeId];
  if(!step||step.blocked.length)throw Error('RESEARCH_STEP_WAITING');
  const reviewing=checked.node.kind==='review';
  if(step.uncertain)throw Error('RESEARCH_CHECK_RECEIPT');
  if(!reviewing&&step.value&&!step.revision&&!step.stale&&step.value.execution?.reply.finish!=='max-tokens')throw Error('RESEARCH_RESULT_ALREADY_SAVED');
  if(step.outstandingResult)throw Error('RESEARCH_RESULT_PENDING_SAVE');
  const guards=[checked.verify,progress.verify];
  const upper=async id=>{
    const result=progress.saved[id];
    if(result)return workbenchModelCore.workbenchReference(result);
    const review=progress.decisions[id];
    const checked=await progress.reviews.verifyApproved(review.id,review.binding.target,{isCurrent});
    guards.push(checked.verify);
    return workbenchModelCore.workbenchReference(review,true);
  };
  const upstream=[];
  for(const id of checked.node.dependsOn)upstream.push(await upper(id));
  let revision=null;
  if(step.revision&&!reviewing){
    const decision=step.revision;
    const verified=await progress.reviews.verifyReturned(decision.id,decision.binding.target,{isCurrent});
    if(!decision.reason.trim())throw Error('RESEARCH_REVISION_INSTRUCTION_REQUIRED');
    guards.push(verified.verify);
    revision={original:workbenchModelCore.workbenchReference(step.value),review:workbenchModelCore.workbenchReference(decision,true)};
  }
  const verify=()=>guards.forEach(guard=>guard());
  verify();
  return {basis:{range,upstream,revision},verify};
}

function guidedPlanDraft(answer, currentGraph) {
  const raw=answer.trim();
  const decoded=JSON.parse(raw.startsWith('```')?raw.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''):raw);
  if(!Array.isArray(decoded)||decoded.length<1||decoded.length>29)throw Error('RESEARCH_PLAN_FORMAT');
  const proposals=decoded.map(row=>{
    const pair=Array.isArray(row)?row:
      row&&typeof row==='object'&&Object.keys(row).sort().join(',')==='Prompt,步骤名'?[row.步骤名,row.Prompt]:null;
    if(pair?.length!==2||pair.some(value=>typeof value!=='string'||!value.trim())
      ||pair[0].length>100||pair[1].length>16000)throw Error('RESEARCH_PLAN_FORMAT');
    return pair;
  });
  const currentWork=currentGraph.nodes.filter(node=>node.kind==='work');
  const currentReview=currentGraph.nodes.find(node=>node.kind==='review');
  const work=proposals.map(([name,prompt],index)=>({
    id:currentWork[index]?.id??'node-'+globalThis.crypto.randomUUID(), name:name.trim(), prompt:prompt.trim(),
    kind:'work',dependsOn:[],reviewTarget:null,
  }));
  work.forEach((node,index)=>{if(index)node.dependsOn=[work[index-1].id];});
  const last=work.at(-1).id;
  const review={id:currentReview?.id??'node-'+globalThis.crypto.randomUUID(),name:'复核结论',kind:'review',
    prompt:'按论文正文核对证据与适用范围，记录通过或具体返修意见。',
    dependsOn:work.map(node=>node.id),reviewTarget:last};
  return {nodes:[...work,review],policy:{...currentGraph.policy,checkpoints:[],
    completion:{nodeIds:[last],reviewIds:[review.id]}}};
}
