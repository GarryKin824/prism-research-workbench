import {spawn} from 'node:child_process';
import {mkdtemp,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createInterface} from 'node:readline';

export function validCodexExecutable(executable){
  return typeof executable==='string'&&path.isAbsolute(executable)&&/^codex(?:\.exe)?$/i.test(path.basename(executable));
}

export function codexTurnStartRejection(rpcCode,kind){
  if(kind==='method'&&rpcCode===-32601)return 'CODEX_TURN_METHOD_UNAVAILABLE';
  if(kind==='parameters'&&rpcCode===-32602)return 'CODEX_TURN_INPUT_REJECTED';
  if(kind==='obsolete-policy'&&rpcCode===-32600)return 'CODEX_TURN_POLICY_REJECTED';
  return null;
}

function rpcResponseError(method,error){
  const failure=Error('CODEX_RPC_REFUSED');
  failure.rpcCode=error.code;
  failure.rpcMethod=method;
  if(method==='turn/start'){
    if(error.code===-32601)failure.rejectionKind='method';
    if(error.code===-32602)failure.rejectionKind='parameters';
    if(error.code===-32600&&error.message==='Invalid request: readOnly.access is no longer supported; use permissionProfile for restricted reads'){
      failure.rejectionKind='obsolete-policy';
    }
  }
  return failure;
}

export async function removeCodexScratch(cwd){
  for(let tries=0;tries<4;tries++){
    try{await rmdir(cwd);return}
    catch(error){
      if(error.code==='ENOENT'||error.code==='ENOTEMPTY')return;
      if(!['EBUSY','EPERM','EACCES'].includes(error.code))return;
      await new Promise(resolve=>setTimeout(resolve,40));
    }
  }
}

const readOnlyFlags=['app-server','--stdio','-c','analytics.enabled=false'];
const executionFlags=[...readOnlyFlags,
  '-c','forced_login_method="chatgpt"','-c','model_provider="openai"',
  '-c','approval_policy="never"','-c','web_search="disabled"',
  '-c','mcp_servers={}','-c','plugins={}','-c','apps._default.enabled=false',
  '-c','features.multi_agent=false','-c','features.shell_tool=false',
  '-c','project_doc_max_bytes=0',
];

function nativeEnvironment(home){
  const env={CODEX_HOME:home};
  // Keep OS discovery and certificate defaults. Provider API keys and runtime
  // injection variables are deliberately absent from this new process.
  for(const [key,value] of Object.entries(process.env)){
    if(/^(path|pathext|systemroot|windir|systemdrive|comspec|userprofile|home|appdata|localappdata|programdata|programfiles|programfiles\(x86\)|temp|tmp|lang)$/i.test(key))env[key]=value;
  }
  return env;
}

export async function connectCodexAppServer(executable,{home,spawnChild=spawn,signal,timeoutMs=10000}={}){
  if(!validCodexExecutable(executable)||home&&!path.isAbsolute(home))throw Error('CODEX_RUNTIME_UNAVAILABLE');
  const cwd=await mkdtemp(path.join(tmpdir(),'prism-codex-request-'));
  let child;
  try{
    child=spawnChild(executable,home?executionFlags:readOnlyFlags,{cwd,windowsHide:true,shell:false,
      stdio:['pipe','pipe','ignore'],...(home?{env:nativeEnvironment(home)}:{})});
  }catch{await removeCodexScratch(cwd);throw Error('CODEX_RUNTIME_UNAVAILABLE')}
  const lines=createInterface({input:child.stdout,crlfDelay:Infinity});
  const pending=new Map(),events=new Set();
  let serial=0,closed=false,received=0;
  let markClosed;
  const exited=new Promise(resolve=>{markClosed=resolve});
  function shutdown(){
    if(closed)return;
    closed=true;
    signal?.removeEventListener('abort',shutdown);
    lines.close();
    for(const request of pending.values())request.reject(Error('CODEX_TRANSPORT_LOST'));
    pending.clear();events.clear();
    child.stdin.end();child.kill();
  }
  child.once('close',()=>{shutdown();markClosed()});
  child.once('error',()=>{shutdown();markClosed()});
  child.stdin.on('error',shutdown);
  child.stdout.on('data',chunk=>{received+=chunk.length;if(received>2*1024*1024)shutdown()});
  signal?.addEventListener('abort',shutdown,{once:true});
  const send=value=>{if(closed)throw Error('CODEX_TRANSPORT_LOST');child.stdin.write(JSON.stringify(value)+'\n')};
  function request(method,params={},deadlineMs=timeoutMs){
    if(closed)return Promise.reject(Error('CODEX_TRANSPORT_LOST'));
    if(pending.size>=16)return Promise.reject(Error('CODEX_RUNTIME_BUSY'));
    return new Promise((resolve,reject)=>{
      const id=++serial;
      const finish=fn=>value=>{clearTimeout(timer);pending.delete(id);fn(value)};
      const timer=setTimeout(()=>finish(reject)(Error('CODEX_RPC_TIMEOUT')),deadlineMs);
      pending.set(id,{method,resolve:finish(resolve),reject:finish(reject)});
      try{send({id,method,params})}catch(error){pending.get(id)?.reject(error)}
    });
  }
  lines.on('line',line=>{
    if(closed)return;
    try{
      if(line.length>1024*1024){shutdown();return}
      const msg=JSON.parse(line);
      if(typeof msg.method==='string'){
        if(Object.hasOwn(msg,'id'))send({id:msg.id,error:{code:-32601,message:'PRISM only accepts text responses'}});
        for(const listen of events)listen(msg);
      }else{
        const entry=pending.get(msg.id);
        if(!entry)return;
        if(Object.hasOwn(msg,'error')){
          if(!Object.hasOwn(msg,'result')&&Number.isInteger(msg.error?.code)&&typeof msg.error.message==='string'){
            entry.reject(rpcResponseError(entry.method,msg.error));
          }else entry.reject(Error('CODEX_RPC_MALFORMED'));
        }else entry.resolve(msg.result);
      }
    }catch{shutdown()}
  });
  async function close(){
    shutdown();
    let timer;
    await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(resolve,500)})]);
    clearTimeout(timer);
    await removeCodexScratch(cwd);
  }
  try{
    if(signal?.aborted)throw Error('CODEX_TRANSPORT_LOST');
    await request('initialize',{clientInfo:{name:'prism',title:'PRISM',version:'0.1.0'},
      capabilities:{experimentalApi:Boolean(home)}});
    send({method:'initialized'});
    return {request,cwd,exited,onEvent(listener){events.add(listener);return ()=>events.delete(listener)},close};
  }catch(error){await close();throw error}
}

export function codexQuota(value){
  const rate=value?.rateLimitsByLimitId?.codex??value?.rateLimits;
  if(!rate)return null;
  const window=value=>Number.isFinite(value?.usedPercent)&&value.usedPercent>=0&&value.usedPercent<=100
    ?{usedPercent:value.usedPercent,windowMinutes:Number.isSafeInteger(value.windowDurationMins)&&value.windowDurationMins>0?value.windowDurationMins:null}:null;
  return {windows:[window(rate.primary),window(rate.secondary)].filter(Boolean),limitReached:!!rate.rateLimitReachedType,
    hasCredits:typeof rate.credits?.hasCredits==='boolean'?rate.credits.hasCredits:null,
    unlimited:typeof rate.credits?.unlimited==='boolean'?rate.credits.unlimited:null};
}
