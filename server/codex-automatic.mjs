import path from 'node:path';
import {lstat,realpath} from 'node:fs/promises';
import {connectCodexAppServer,codexQuota,codexTurnStartRejection,validCodexExecutable} from './codex-app-server.mjs';
import {executionSessionId} from '../src/execution-targets.mjs';
import {WORKBENCH_MODEL_OUTPUT_LIMIT,workbenchModelHash} from '../src/workbench-model-contract.mjs';

const plans=new Set(['free','go','plus','pro','prolite','proLite']);
const textOnly='Execute the user research request on its supplied text only. Use no tools, skills, browsing, files, connectors, or agents. Return the answer directly. Follow the requested output structure and distinguish evidence from inference.';
const permittedItems=new Set(['userMessage','agentMessage','reasoning','plan']);
const permissionProfile='prism-text-only';
const accountReadTimeoutMs=25000;
const transientPreflight=error=>['CODEX_RPC_TIMEOUT','CODEX_TRANSPORT_LOST','CODEX_RUNTIME_BUSY'].includes(error.message);
const preDispatchCode=(error,stage='connection')=>error.message==='CODEX_ISOLATED_HOME_REQUIRED'?error.message:
  error.message==='CODEX_RPC_TIMEOUT'?'CODEX_PREFLIGHT_TIMEOUT':
  ({connection:'CODEX_PREFLIGHT_CONNECTION',account:'CODEX_PREFLIGHT_ACCOUNT',session:'CODEX_PREFLIGHT_SESSION'})[stage];
const workspacePermissions=cwd=>({
  [permissionProfile]:{filesystem:{[cwd]:'read'},network:{enabled:false}},
});
const limited=text=>String(text??'').slice(0,WORKBENCH_MODEL_OUTPUT_LIMIT).toWellFormed();
const unit=value=>Number.isSafeInteger(value)&&value>=0;

function usageFrom(value){
  if(!value)return null;
  const fields={inputTokens:'inputTokens',outputTokens:'outputTokens',totalTokens:'totalTokens',
    cacheReadTokens:'cachedInputTokens',reasoningTokens:'reasoningOutputTokens'};
  return Object.fromEntries(Object.entries(fields).flatMap(([key,source])=>unit(value[source])?[[key,value[source]]]:[]));
}

function nativeFailure(error) {
  const info=error?.codexErrorInfo;
  if(info==='usageLimitExceeded')return 'CODEX_LIMIT';
  if(info==='unauthorized')return 'CODEX_SIGN_IN';
  if(info==='contextWindowExceeded')return 'CODEX_INPUT_LIMIT';
  return 'CODEX_TURN_FAILED';
}

export function classifyCodexTurn(turn,output,usage=null,stopReason=null){
  const answer=limited(output);
  if(stopReason)return {state:'failed',code:stopReason,partial:answer||null};
  if(turn?.status==='interrupted')return {state:'cancelled',code:'CODEX_INTERRUPTED',partial:answer||null};
  if(turn?.status==='failed'||turn?.error){
    return {state:'failed',code:nativeFailure(turn.error),partial:answer||null};
  }
  if(turn?.status!=='completed'||!answer.trim())return {state:'unknown',code:'CODEX_NO_FINAL_ANSWER',partial:answer||null};
  const incomplete=output.length>WORKBENCH_MODEL_OUTPUT_LIMIT;
  return {state:'returned',answer,usage,finish:incomplete?'max-tokens':'stop',finishReason:incomplete?'prism-output-limit':'completed'};
}

export function createCodexAutomaticAdapter({executable,home,includedOnly=false,connect=connectCodexAppServer,turnTimeoutMs=85000}={}){
  const configured=Boolean(validCodexExecutable(executable)&&typeof home==='string'&&path.isAbsolute(home));

  async function verifyHome(){
    const actual=await realpath(home);
    const normalize=value=>process.platform==='win32'?value.toLowerCase():value;
    const defaultHome=path.join(process.env.USERPROFILE??process.env.HOME??'', '.codex');
    const desktopHomes=await Promise.all([defaultHome,process.env.CODEX_HOME].filter(Boolean)
      .map(value=>realpath(value).catch(()=>path.resolve(value))));
    if(normalize(path.resolve(home))!==normalize(actual)||!(await lstat(actual)).isDirectory()
       || desktopHomes.some(value=>normalize(value)===normalize(actual))) {
      throw Error('CODEX_ISOLATED_HOME_REQUIRED');
    }
    return actual;
  }

  async function accountGate(rpc,model,{allowanceCheck=true}={}) {
    const {account}=await rpc.request('account/read',{refreshToken:false},accountReadTimeoutMs);
    if(account?.type!=='chatgpt')return 'CODEX_SIGN_IN';
    if(!allowanceCheck)return 'CODEX_ALLOWANCE_UNCONFIRMED';
    if(!plans.has(account.planType))return 'CODEX_ALLOWANCE_UNCONFIRMED';
    const quota=codexQuota(await rpc.request('account/rateLimits/read',{},accountReadTimeoutMs));
    if(quota?.limitReached||quota?.windows.some(window=>window.usedPercent>=100))return 'CODEX_LIMIT';
    if(!quota?.windows.length||quota.hasCredits!==false||quota.unlimited!==false)return 'CODEX_ALLOWANCE_UNCONFIRMED';
    if(model){
      const catalog=await rpc.request('model/list',{includeHidden:false,limit:100});
      if(!catalog.data?.some(row=>row.model===model&&row.hidden!==true))return 'MODEL_ROUTE_CHANGED';
    }
    return null;
  }

  const capability=()=>({platform:'codex',configured,ready:configured&&includedOnly,
    code:configured?(includedOnly?null:'CODEX_ALLOWANCE_UNCONFIRMED'):'CODEX_UNCONFIGURED'});
  let readiness;
  let checkedAt=0;
  function readCapability(signal){
    const base=capability();
    if(!configured)return base;
    if(readiness&&Date.now()-checkedAt<15000)return readiness;
    checkedAt=Date.now();
    readiness=(async()=>{
      let rpc,code;
      try{
        rpc=await connect(executable,{home:await verifyHome(),signal});
        code=await accountGate(rpc,undefined,{allowanceCheck:includedOnly});
      }catch(error){code=preDispatchCode(error)}
      finally{await rpc?.close()}
      return {...base,ready:!code,code};
    })();
    return readiness;
  }

  async function run(input,context){
    if(!configured||!includedOnly)return {state:'refused',code:configured?'CODEX_ALLOWANCE_UNCONFIRMED':'CODEX_UNCONFIGURED'};
    let rpc,dispatched=false,stage='connection';
    try{
      const model=input.execution.model;
      for(let attempt=0;attempt<2;attempt++){
        stage='connection';
        try{
          rpc=await connect(executable,{home:await verifyHome(),signal:context.signal});
          stage='account';
          const refusal=await accountGate(rpc,model);
          if(refusal)return {state:'refused',code:refusal};
          break;
        }catch(error){
          if(attempt||context.signal?.aborted||!transientPreflight(error))throw error;
          await rpc?.close();
          rpc=null;
        }
      }
      stage='session';
      const opened=await rpc.request('thread/start',{cwd:rpc.cwd,model,modelProvider:'openai',allowProviderModelFallback:false,
        approvalPolicy:'never',permissions:permissionProfile,serviceTier:'default',environments:[],
        config:{default_permissions:permissionProfile,permissions:workspacePermissions(rpc.cwd)},
        runtimeWorkspaceRoots:[rpc.cwd],selectedCapabilityRoots:[],dynamicTools:[],ephemeral:false,
        baseInstructions:textOnly,developerInstructions:textOnly});
      const sessionId=opened.thread?.id;
      if(!executionSessionId(sessionId)||opened.model!==model||opened.modelProvider!=='openai'||opened.approvalPolicy!=='never'
          || opened.sandbox?.type!=='readOnly'||opened.sandbox.networkAccess!==false
          || opened.activePermissionProfile?.id!==permissionProfile
          || opened.thread.ephemeral!==false||opened.instructionSources?.length
          || opened.serviceTier&&opened.serviceTier!=='default')return {state:'refused',code:'CODEX_RUNTIME_POLICY_MISMATCH'};
      await context.session(sessionId);
      let turnId=null,stopReason=null,completion,usage=null,output='',interrupted=false;
      let done;
      const finished=new Promise(resolve=>{done=resolve});
      async function cancel(){
        if(!turnId)return false;
        if(interrupted)return true;
        interrupted=true;
        try{await rpc.request('turn/interrupt',{threadId:sessionId,turnId});return true}
        catch{interrupted=false;return false}
      }
      const earlyEvents=[];
      function onTurnEvent({method,params={},id}){
        const eventTurnId=params.turnId??params.turn?.id;
        if(eventTurnId!==turnId)return;
        if(method==='model/rerouted'||method==='model/verification'||id!==undefined
          || ['item/started','item/completed'].includes(method)&&!permittedItems.has(params.item?.type)){
          stopReason=method==='model/rerouted'?'MODEL_ROUTE_CHANGED':method==='model/verification'?'CODEX_VERIFICATION_REQUIRED':'CODEX_TOOL_REFUSED';
          context.block(stopReason);
          void cancel();
        }
        if(method==='item/completed'&&params.item?.type==='agentMessage'&&typeof params.item.text==='string')output=params.item.text;
        if(method==='item/agentMessage/delta'&&typeof params.delta==='string'&&output.length<WORKBENCH_MODEL_OUTPUT_LIMIT+1){
          output=(output+params.delta).slice(0,WORKBENCH_MODEL_OUTPUT_LIMIT+1);
        }
        if(method==='thread/tokenUsage/updated')usage=usageFrom(params.tokenUsage?.last);
        if(method==='turn/completed'){completion=params.turn;done()}
      }
      rpc.onEvent(event=>{
        if(event.params?.threadId!==sessionId)return;
        if(turnId){onTurnEvent(event);return}
        earlyEvents.push(event);
      });
      await context.dispatched();
      dispatched=true;
      let openedTurn;
      try{
        openedTurn=await rpc.request('turn/start',{
          threadId:sessionId,clientUserMessageId:input.requestId,model,serviceTierForTurn:'default',effort:'low',environments:[],
          approvalPolicy:'never',
          input:[{type:'text',text:input.text,text_elements:[]}],
        });
      }catch(error){
        const {rpcMethod:method,rpcCode,rejectionKind:kind}=error;
        const activity=earlyEvents.some(({params})=>params?.turnId||params?.turn?.id);
        const refusal=!activity&&method==='turn/start'&&codexTurnStartRejection(rpcCode,kind);
        if(refusal){
          await context.refusedBeforeTurn({method,rpcCode,kind});
          return {state:'refused',code:refusal};
        }
        const ackCode=error.message==='CODEX_RPC_TIMEOUT'||error.message==='CODEX_TRANSPORT_LOST'
          ?error.message:'CODEX_TURN_ACK_UNCONFIRMED';
        return {state:'unknown',code:ackCode};
      }
      const nativeTurnId=openedTurn?.turn?.id;
      if(!executionSessionId(nativeTurnId))return {state:'unknown',code:'CODEX_TURN_ID_UNCONFIRMED'};
      await context.turn(nativeTurnId,cancel);
      turnId=nativeTurnId;
      for(const event of earlyEvents)onTurnEvent(event);
      earlyEvents.length=0;
      if(stopReason)await cancel();
      let timer;
      try{
        if(openedTurn.turn.status==='inProgress'){
          await Promise.race([finished,rpc.exited,new Promise(resolve=>{timer=setTimeout(resolve,turnTimeoutMs)})]);
        }else completion??=openedTurn.turn;
      }finally{clearTimeout(timer)}
      if(!completion)return {state:'unknown',code:'CODEX_WAIT_EXPIRED',partial:limited(output)||null};
      if(completion.id!==turnId)return {state:'unknown',code:'CODEX_TURN_ID_UNCONFIRMED'};
      if(!output&&!stopReason&&completion.status==='completed'&&!completion.error){
        const history=await rpc.request('thread/read',{threadId:sessionId,includeTurns:true}).catch(()=>null);
        const turn=history?.thread?.id===sessionId?history.thread.turns?.find(item=>item.id===turnId):null;
        if(turn?.items?.some(item=>!permittedItems.has(item.type)))stopReason='CODEX_TOOL_REFUSED';
        output=turn?.items?.findLast(item=>item.type==='agentMessage')?.text??'';
      }
      return classifyCodexTurn(completion,output,usage,stopReason);
    }catch(error){
      return dispatched?{state:'unknown',code:'CODEX_TRANSPORT_LOST'}:
        {state:'refused',code:preDispatchCode(error,stage)};
    }finally{await rpc?.close()}
  }

  async function recover(intent,locator,signal){
    if(!configured||!locator.sessionId||!locator.dispatched)return null;
    let rpc;
    try{
      rpc=await connect(executable,{home:await verifyHome(),signal});
      const result=await rpc.request('thread/read',{threadId:locator.sessionId,includeTurns:true});
      if(result.thread?.id!==locator.sessionId||result.thread.modelProvider!=='openai'||result.thread.turns?.length!==1)return null;
      const [turn]=result.thread.turns;
      if(!executionSessionId(turn.id)||locator.turnId&&turn.id!==locator.turnId)return null;
      const message=turn.items?.find(item=>item.type==='userMessage')?.content;
      if(message?.length!==1||message[0].type!=='text'||await workbenchModelHash(message[0].text)!==intent.promptSha256)return null;
      const answer=turn.items?.findLast(item=>item.type==='agentMessage')?.text??'';
      const status=classifyCodexTurn(turn,answer,null,locator.blocked);
      // Stored thread history need not retain service-side model reroute events.
      // Preserve text but require a live bound terminal receipt to adopt it.
      return {...(status.state==='returned'?{state:'unknown',code:'CODEX_REVERIFY_ROUTE',partial:limited(answer)||null}:status),turnId:turn.id};
    }catch{return null}
    finally{await rpc?.close()}
  }

  return {capability,readCapability,run,recover};
}
