import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {removeCodexScratch} from './codex-app-server.mjs';

const unverified=Object.freeze({includesFreeExecution:null,dispatch:false});
const modelName=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,119}$/.test(value);

export function createCodexReadiness(executable, {spawnChild=spawn,timeoutMs=9000}={}) {
  if (executable && (!path.isAbsolute(executable)||!/^codex(?:\.exe)?$/i.test(path.basename(executable)))) {
    throw Error('CODEX_EXECUTABLE_CONFIG_INVALID');
  }
  let busy=false;
  return async function readReadiness(signal) {
    if (!executable) return {state:'unconfigured',...unverified};
    if (busy) return {state:'busy',...unverified};
    busy=true;
    let cwd;
    try {
      cwd=await mkdtemp(path.join(tmpdir(),'prism-codex-readiness-'));
      return await new Promise(resolve=>{
        const child=spawnChild(executable,['app-server','--stdio','-c','analytics.enabled=false'],
          {cwd,stdio:['pipe','pipe','ignore'],windowsHide:true,shell:false});
        const lines=createInterface({input:child.stdout,crlfDelay:Infinity});
        let done=false,received=0,phase=1,account=null,limits=null;
        const timer=setTimeout(()=>finish('unavailable'),timeoutMs);
        const stop=()=>finish('unavailable');
        function finish(state,models=[]){
          if(done)return;
          done=true;
          clearTimeout(timer);
          signal?.removeEventListener('abort',stop);
          lines.close();
          child.stdin.end();
          child.kill();
          resolve({state,...unverified,...(state==='available'?{account,limits,models}: {})});
        }
        function send(method,id,params) {
          if(!done)child.stdin.write(JSON.stringify({method,...(id?{id}:{}),...(params?{params}:{})})+'\n');
        }
        function readModels(){
          phase=4;
          send('model/list',4,{limit:40,includeHidden:false});
        }
        child.on('error',stop);
        child.on('exit',stop);
        child.stdin.on('error',stop);
        child.stdout.on('data',data=>{received+=data.length;if(received>256000)stop()});
        signal?.addEventListener('abort',stop,{once:true});
        if (signal?.aborted) {stop();return}
        lines.on('line',line=>{
          if(done)return;
          try {
            if(line.length>200000){stop();return}
            const {id,result,error}=JSON.parse(line);
            if(id!==phase)return;
            if(id===1){
              if(error||!result){stop();return}
              send('initialized');
              phase=2;
              send('account/read',2,{refreshToken:false});
            }else if(id===2){
              if(error||!result){stop();return}
              const type=result.account?.type;
              if(!type){finish(result.requiresOpenaiAuth?'signed-out':'unavailable');return}
              account=type==='chatgpt'?'chatgpt':'other';
              if(account==='chatgpt'){
                phase=3;
                send('account/rateLimits/read',3);
              }else readModels();
            }else if(id===3){
              const rate=result?.rateLimitsByLimitId?.codex??result?.rateLimits;
              if(rate){
                const window=value=>Number.isFinite(value?.usedPercent)&&value.usedPercent>=0&&value.usedPercent<=100
                  ?{usedPercent:value.usedPercent,windowMinutes:Number.isSafeInteger(value.windowDurationMins)&&value.windowDurationMins>0?value.windowDurationMins:null}:null;
                limits={windows:[window(rate.primary),window(rate.secondary)].filter(Boolean),
                  hasCredits:typeof rate.credits?.hasCredits==='boolean'?rate.credits.hasCredits:null};
              }
              readModels();
            }else{
              const models=Array.isArray(result?.data)?[...new Set(result.data.slice(0,40).filter(row=>!row?.hidden)
                .map(row=>row?.model).filter(modelName))]:[];
              finish('available',models);
            }
          }catch{stop()}
        });
        send('initialize',1,{clientInfo:{name:'prism-readiness',title:'PRISM',version:'0.1.0'}});
      });
    } catch {
      return {state:'unavailable',...unverified};
    } finally {
      if(cwd)await removeCodexScratch(cwd);
      busy=false;
    }
  };
}
