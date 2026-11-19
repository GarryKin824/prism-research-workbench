import path from 'node:path';
import {mkdir,open,readFile,link,unlink} from 'node:fs/promises';
import {
  canonicalWorkbenchModelInput,canonicalWorkbenchReceiptSelector,canonicalWorkbenchReply,workbenchModelHash,
} from '../src/workbench-model-contract.mjs';
import {canonicalNativeProgress} from '../src/workbench-model-execution.mjs';
import {AUTOMATIC_EXECUTION_PATH,AUTOMATIC_EXECUTION_STATUS_PATH} from '../src/execution-targets.mjs';
import {codexTurnStartRejection} from './codex-app-server.mjs';

const terminal=new Set(['returned','failed','refused','cancelled']);
const code=value=>typeof value==='string'&&/^[A-Z0-9_]{1,64}$/.test(value)?value:null;

export function createAutomaticExecutionGateway({journal,namespace,adapters}){
  if(!path.isAbsolute(journal))throw Error('MODEL_JOURNAL_INVALID');
  const lifetime=new AbortController();
  let live=null;
  const recovering=new Set();
  const file=(id,kind)=>path.join(journal,id+'.'+kind+'.json');
  async function get(id,kind){
    try{
      const raw=await readFile(file(id,kind),'utf8');
      if(raw.length>64000)throw Error('MODEL_JOURNAL_INVALID');
      return JSON.parse(raw);
    }catch(error){if(error.code==='ENOENT')return null;throw error}
  }
  async function once(id,kind,value){
    const destination=file(id,kind),staged=destination+'.'+crypto.randomUUID()+'.tmp';
    try{
      const handle=await open(staged,'wx');
      try{await handle.writeFile(JSON.stringify(value)+'\n','utf8');await handle.sync()}
      finally{await handle.close()}
      await link(staged,destination);
      return true;
    }catch(error){if(error.code==='EEXIST')return false;throw error}
    finally{await unlink(staged).catch(()=>{})}
  }
  function native(phase,sessionId=null,turnId=null,partial=null){
    return canonicalNativeProgress({phase,sessionId,turnId,partial});
  }
  function outcome(intent,locator,value){
    const sessionId=locator.sessionId??null,turnId=value.turnId??locator.turnId??null;
    if(value.state==='returned'){
      const {text}=locator;
      const input={...intent.input,text};
      const {platform,channel,provider,model}=intent.input.execution;
      const reply=canonicalWorkbenchReply(input,intent.inputSha256,{
        requestId:input.requestId,target:input.target,sourceSha256:input.sourceSha256,promptSha256:input.promptSha256,
        inputSha256:intent.inputSha256,route:{platform,channel,provider,model},execution:input.execution,
        externalSessionId:sessionId,externalTurnId:turnId,startedUtc:intent.startedUtc,
        finishedUtc:new Date().toISOString(),finish:value.finish,finishReason:value.finishReason,usage:value.usage,answer:value.answer,
      });
      return {state:'returned',reply,native:native('returned',sessionId,turnId)};
    }
    const state=['failed','cancelled','refused','unknown'].includes(value.state)?value.state:'unknown';
    return {state,code:code(value.code),native:native(state==='refused'?'failed':state,sessionId,turnId,value.partial??null)};
  }
  function snapshot(task){
    return {state:'pending',native:native(task.turnId?'running':'accepted',task.sessionId,task.turnId)};
  }
  function definiteRefusal(intent,locator,proof){
    if(intent.input.execution.platform!=='codex'||!locator.dispatched||!locator.sessionId||locator.turnId
        ||proof?.sessionId!==locator.sessionId||proof?.method!=='turn/start')return null;
    return codexTurnStartRejection(proof.rpcCode,proof.kind);
  }
  async function processTask(task,body,adapter){
    const id=body.requestId;
    let blockWritten=Promise.resolve(),blocked=null;
    try{
      const value=await adapter.run(body,{
        signal:lifetime.signal,
        async session(sessionId){
          const binding=native('accepted',sessionId);
          if(!await once(id,'session',{sessionId:binding.sessionId}))throw Error('MODEL_JOURNAL_CONFLICT');
          task.sessionId=sessionId;
        },
        async dispatched(){
          if(!await once(id,'dispatch',{marked:true}))throw Error('MODEL_JOURNAL_CONFLICT');
          task.dispatched=true;
        },
        async refusedBeforeTurn({method,rpcCode,kind}){
          const proof={sessionId:task.sessionId,method,rpcCode,kind};
          if(!definiteRefusal(task.intent,task,proof)||!await once(id,'rejection',proof))throw Error('MODEL_JOURNAL_CONFLICT');
        },
        async turn(turnId,interrupt){
          native('running',task.sessionId,turnId);
          if(!await once(id,'turn',{turnId}))throw Error('MODEL_JOURNAL_CONFLICT');
          task.turnId=turnId;
          task.interrupt=interrupt;
        },
        block(reason){
          if(blocked)return;
          blocked=code(reason)??'CODEX_TOOL_REFUSED';
          blockWritten=once(id,'blocked',{code:blocked}).catch(()=>false);
        },
      });
      await blockWritten;
      const result=outcome(task.intent,task,blocked?{state:'failed',code:blocked,partial:value.partial}:value);
      await once(id,terminal.has(result.state)?'final':'uncertain',result);
    }catch{
      await once(id,'uncertain',outcome(task.intent,task,{state:'unknown',code:'MODEL_UNCONFIRMED'})).catch(()=>{});
    }finally{
      if(live===task)live=null;
    }
  }
  async function status(selector,signal){
    const {requestId:id,inputSha256}=canonicalWorkbenchReceiptSelector(selector);
    const intent=await get(id,'intent');
    if(!intent)return {state:'not-found'};
    if(intent.inputSha256!==inputSha256||intent.input?.requestId!==id)throw Error('MODEL_RECEIPT_MISMATCH');
    if(live?.id===id)return snapshot(live);
    const final=await get(id,'final');
    if(final)return final;
    const sessionId=(await get(id,'session'))?.sessionId??null, turnId=(await get(id,'turn'))?.turnId??null;
    const dispatched=Boolean(await get(id,'dispatch')),blocked=(await get(id,'blocked'))?.code??null;
    const previous=await get(id,'uncertain');
    const locator={sessionId,turnId,dispatched,blocked};
    if(blocked){
      const stopped=outcome(intent,locator,{state:'failed',code:blocked,partial:previous?.native?.partial});
      await once(id,'final',stopped);
      return await get(id,'final');
    }
    const refused=definiteRefusal(intent,locator,await get(id,'rejection'));
    if(refused){
      await once(id,'final',outcome(intent,locator,{state:'refused',code:refused}));
      return await get(id,'final');
    }
    if(!dispatched){
      // Another host may be between claiming this intent and recording dispatch.
      return outcome(intent,locator,{state:'unknown',code:'MODEL_UNCONFIRMED'});
    }
    // Only a read of the jointly bound native session is allowed after a lost process.
    if(!recovering.has(id)&&sessionId&&!signal?.aborted){
      recovering.add(id);
      try{
        const checked=await adapters[intent.input.execution.platform]?.recover?.(intent.input,locator,signal);
        if(checked&&checked.state!=='returned'){
          if(checked.turnId&&!locator.turnId){
            native('unknown',locator.sessionId,checked.turnId);
            await once(id,'turn',{turnId:checked.turnId});
          }
          const recovered=outcome(intent,locator,{...checked,partial:checked.partial??previous?.native?.partial});
          if(terminal.has(recovered.state)){await once(id,'final',recovered);return await get(id,'final')}
          return recovered;
        }
      }finally{recovering.delete(id)}
    }
    return outcome(intent,locator,{state:'unknown',code:previous?.code??'MODEL_UNCONFIRMED',partial:previous?.native?.partial});
  }
  async function submit(input){
    input=canonicalWorkbenchModelInput(input,namespace);
    if(input.execution?.channel!=='automatic'||!adapters[input.execution.platform]
        || await workbenchModelHash(input.text)!==input.promptSha256)throw Error('MODEL_INPUT_INVALID');
    const id=input.requestId,inputSha256=await workbenchModelHash(JSON.stringify(input));
    const adapter=adapters[input.execution.platform];
    const previous=await get(id,'intent');
    if(previous)return status({requestId:id,inputSha256});
    const capability=adapter.capability();
    if(!capability.ready)return {state:'refused',code:capability.code??'MODEL_UNAVAILABLE'};
    if(lifetime.signal.aborted||live)return {state:'refused',code:'MODEL_BUSY'};
    const {text,...binding}=input;
    const intent={input:binding,inputSha256,startedUtc:new Date().toISOString()};
    const task={id,intent,text,sessionId:null,turnId:null,interrupt:null,dispatched:false};
    live=task;
    try{
      await mkdir(journal,{recursive:true});
      if(!await once(id,'intent',intent)){
        live=null;
        return status({requestId:id,inputSha256});
      }
    }catch(error){if(live===task)live=null;throw error}
    task.done=processTask(task,input,adapter);
    return snapshot(task);
  }
  async function cancel(selector){
    const {requestId,inputSha256}=canonicalWorkbenchReceiptSelector(selector);
    const task=live;
    if(task?.id===requestId&&task.intent.inputSha256===inputSha256&&task.interrupt){
      const submitted=await task.interrupt();
      return {requested:submitted,...await status(selector)};
    }
    return {requested:false,...await status(selector)};
  }
  return {capabilities:()=>Promise.all(Object.values(adapters).map(adapter=>
    adapter.readCapability?.(lifetime.signal)??adapter.capability())),submit,status,cancel,
    close(){lifetime.abort();return live?.done}};
}

export function createAutomaticHttpHandler({automatic,admit}){
  const respond=(status,value)=>Response.json(value,{status,headers:{'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'}});
  return async request=>{
    const url=new URL(request.url);
    const statusRoute=url.pathname===AUTOMATIC_EXECUTION_STATUS_PATH;
    if(![AUTOMATIC_EXECUTION_PATH,AUTOMATIC_EXECUTION_STATUS_PATH].includes(url.pathname)||url.search)return respond(404,{code:'MODEL_UNAVAILABLE'});
    if(request.headers.get('x-prism-automatic')!=='1'||!admit(request))return respond(403,{code:'MODEL_OWNER_REQUIRED'});
    if(statusRoute&&request.method==='GET')return respond(200,{targets:await automatic?.capabilities()??[]});
    if(statusRoute||request.method==='GET')return respond(405,{code:'MODEL_METHOD'});
    if(request.method!=='POST'||request.headers.get('content-type')!=='application/json'||!request.body){
      return respond(403,{code:'MODEL_SAME_ORIGIN_REQUIRED'});
    }
    try{
      const chunks=[];
      let length=0;
      for await(const part of request.body){
        length+=part.byteLength;
        if(length>64000)return respond(413,{code:'MODEL_INPUT_INVALID'});
        chunks.push(part);
      }
      const {op,input}=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
      if(!Object.hasOwn({submit:1,status:1,cancel:1},op))return respond(400,{code:'MODEL_INPUT_INVALID'});
      if(!automatic)return respond(200,{state:op==='submit'?'refused':'unknown',code:'CODEX_UNCONFIGURED'});
      const result=await automatic[op](input,request.signal);
      return respond(op==='submit'&&result.state==='pending'?202:200,result);
    }catch(error){
      return respond(error instanceof SyntaxError||error.message==='MODEL_INPUT_INVALID'?400:409,
        {code:error.message==='MODEL_RECEIPT_MISMATCH'?'MODEL_RECEIPT_MISMATCH':'MODEL_UNAVAILABLE'});
    }
  };
}
