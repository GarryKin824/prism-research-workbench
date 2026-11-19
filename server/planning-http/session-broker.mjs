/** JSON-only, transport-independent fixture broker. NOT an authentication layer.
 * A future admitted carrier must resolve scope on the server, never from a request.
 * This module registers no route and is unreachable from the delivered browser.
 */
import {randomUUID,createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {canonicalPlanningRequest} from '../../src/planning-model-adapter.mjs';
const PROTOCOL='prism-planning-fixture-bridge/v1', MAX_BYTES=1048576, LIMIT=100;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HEX=/^[a-f0-9]{64}$/;
const fail=code=>{throw Object.assign(Error(code),{code});};
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Reflect.ownKeys(o).length===keys.length&&keys.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(o,k)??{},'value'));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const hash=s=>createHash('sha256').update(s).digest('hex');
const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}return o;};

export function createPlanningSessionBroker({bridge,scope,leaseMs=60000,lifetimeMs=300000,requestTimeoutMs=10000}={}) {
  if(!bridge||!['prepare','confirm','consumeResult','cancel'].every(k=>typeof bridge[k]==='function')||
    !scope||typeof scope!=='object'||!scope.signal||typeof scope.signal.addEventListener!=='function'||typeof scope.assertCurrent!=='function'||
    !exact(scope.document,['namespace','projectId','revisionSha256','templateVersion','nodes'])||!Array.isArray(scope.document.nodes)||scope.document.nodes.length>30||
    ![leaseMs,lifetimeMs,requestTimeoutMs].every(n=>Number.isSafeInteger(n)&&n>=1)||leaseMs>60000||lifetimeMs>300000||requestTimeoutMs>60000)fail('SESSION_CONFIGURATION_INVALID');
  const d=scope.document;
  canonicalPlanningRequest({purpose:'project-planning',binding:{namespace:d.namespace,projectId:d.projectId,revisionSha256:d.revisionSha256,templateVersion:d.templateVersion,nodeId:null,promptVersion:null},payload:'synthetic validation'});
  const nodeIds=new Set();
  for(const n of d.nodes){
    if(!exact(n,['nodeId','promptVersion'])||nodeIds.has(n.nodeId))fail('SESSION_CONFIGURATION_INVALID');
    canonicalPlanningRequest({purpose:'node-prompt-discussion',binding:{namespace:d.namespace,projectId:d.projectId,revisionSha256:d.revisionSha256,templateVersion:d.templateVersion,...n},payload:'synthetic validation'});nodeIds.add(n.nodeId);
  }
  const document=freeze(JSON.parse(JSON.stringify(d))),documentRaw=JSON.stringify(d),leases=new Map(),seen=new Set(),pendingStops=new Set();
  let closed=false,prepared=0;const lifetimeDeadline=performance.now()+lifetimeMs;
  const assertScope=scope.assertCurrent.bind(scope),scopeSignal=scope.signal;
  function current() {
    try {
      if(closed||scopeSignal.aborted||performance.now()>=lifetimeDeadline||JSON.stringify(scope.document)!==documentRaw||assertScope()!==true)throw Error();
      if(closed||scopeSignal.aborted)throw Error();
    }catch{close();fail('SESSION_EXPIRED');}
  }
  function cancelLease(e){if(!e)return;e.cancelled=true;clearTimeout(e.timer);if(e.preview)bridge.cancel(e.preview);if(e.result)bridge.cancel(e.result);}
  function close(){if(closed)return;closed=true;clearTimeout(lifetime);scopeSignal.removeEventListener('abort',close);for(const stop of pendingStops)stop();pendingStops.clear();for(const e of leases.values())cancelLease(e);leases.clear();}
  const lifetime=setTimeout(close,lifetimeMs);lifetime.unref?.();scopeSignal.addEventListener('abort',close,{once:true});
  try{current();}catch(e){close();throw e;}
  function checkBinding(q){
    const b=q.binding;
    if(['namespace','projectId','revisionSha256','templateVersion'].some(k=>b[k]!==document[k])||
      (q.purpose==='node-prompt-discussion'&&!document.nodes.some(n=>n.nodeId===b.nodeId&&n.promptVersion===b.promptVersion)))fail('SESSION_SCOPE_REFUSED');
  }
  function publicPreview(p,q){
    const keys=['kind','purpose','binding','requestId','sessionId','endpoint','method','body','headers','bodySha256','headersSha256','model','actualExecutor','realModelConnected','fixtureOnly','authority','previewSha256'];
    if(!exact(p,keys)||p.kind!=='planning-http-preview'||p.purpose!==q.purpose||!same(p.binding,q.binding)||!UUID.test(p.requestId)||!UUID.test(p.sessionId)||p.fixtureOnly!==true||p.authority!=='none'||p.realModelConnected!==false||p.actualExecutor!=='official-deepseek-loopback-http-fixture'||!HEX.test(p.previewSha256))fail('SESSION_RESPONSE_INVALID');
    const {previewSha256,...fields}=p;if(hash(JSON.stringify(fields))!==previewSha256)fail('SESSION_RESPONSE_INVALID');
    return p;
  }
  function publicResult(r,p,text){
    if(!exact(r,['kind','requestId','purpose','binding','text','fixtureOnly','actualExecutor','realModelConnected','authority','verified'])||r.kind!=='planning-http-result'||r.requestId!==p.requestId||r.purpose!==p.purpose||!same(r.binding,p.binding)||r.fixtureOnly!==true||r.actualExecutor!==p.actualExecutor||r.realModelConnected!==false||r.authority!=='none'||r.verified!==false||typeof text!=='string'||r.text!==text||text.length>16000||!text.startsWith('[本地HTTP合成样例，非真实模型答复；未验证]\n'))fail('SESSION_RESPONSE_INVALID');
    return r;
  }
  async function dispatch(raw,{scope:callerScope,signal}={}) {
    let id=null,e,stopped=false,timer,onAbort;
    const reply=(ok,value)=>JSON.stringify(ok?{protocol:PROTOCOL,id,ok:true,value}:{protocol:PROTOCOL,id,ok:false,error:{code:value}});
    try {
      if(callerScope!==scope)fail('SESSION_SCOPE_REFUSED');current();
      if(typeof raw!=='string'||Buffer.byteLength(raw)>MAX_BYTES)fail('SESSION_BAD_REQUEST');
      let req;try{req=JSON.parse(raw);}catch{fail('SESSION_BAD_REQUEST');}
      if(!exact(req,['protocol','id','method','payload'])||req.protocol!==PROTOCOL||typeof req.id!=='string'||!UUID.test(req.id)||!['prepare','confirm','cancel'].includes(req.method))fail('SESSION_BAD_REQUEST');
      if(JSON.stringify(req)!==raw)fail('SESSION_BAD_REQUEST');
      id=req.id;if(seen.has(id))fail('SESSION_REPLAY_REFUSED');if(seen.size>=LIMIT*4)fail('SESSION_LIMIT');seen.add(id);
      const check=()=>{current();if(stopped||signal?.aborted||e?.cancelled||(e?.deadline!==undefined&&performance.now()>=e.deadline)){cancelLease(e);fail('SESSION_OUTCOME_UNKNOWN');}};
      let stopReject;const stop=new Promise((_,reject)=>{stopReject=reject;});
      onAbort=()=>{stopped=true;cancelLease(e);stopReject(Object.assign(Error('SESSION_OUTCOME_UNKNOWN'),{code:'SESSION_OUTCOME_UNKNOWN'}));};
      if(signal&&typeof signal.addEventListener!=='function')fail('SESSION_BAD_REQUEST');
      pendingStops.add(onAbort);signal?.addEventListener('abort',onAbort,{once:true});timer=setTimeout(onAbort,requestTimeoutMs);
      const operation=(async()=>{
        check();
        if(req.method==='prepare'){
          let q;try{q=freeze(canonicalPlanningRequest(req.payload));}catch{fail('SESSION_BAD_REQUEST');}checkBinding(q);
          if(prepared>=LIMIT)fail('SESSION_LIMIT');prepared++;
          e={preview:null,result:null,used:false,cancelled:false};
          const p=await bridge.prepare(q,check);e.preview=p;
          try{check();publicPreview(p,q);}catch(error){cancelLease(e);throw error;}
          const leaseId=randomUUID();e.deadline=performance.now()+leaseMs;e.timer=setTimeout(()=>cancelLease(e),leaseMs);e.timer.unref?.();leases.set(leaseId,e);
          return {leaseId,preview:p};
        }
        if(req.method==='cancel'){
          if(!exact(req.payload,['leaseId'])||!UUID.test(req.payload.leaseId))fail('SESSION_BAD_REQUEST');
          // Cancel is idempotent and discloses no handle existence.
          cancelLease(leases.get(req.payload.leaseId));return {cancelled:true};
        }
        if(!exact(req.payload,['leaseId','previewSha256','explicit'])||!UUID.test(req.payload.leaseId)||!HEX.test(req.payload.previewSha256)||req.payload.explicit!==true)fail('SESSION_CONFIRMATION_REQUIRED');
        e=leases.get(req.payload.leaseId);
        if(!e||e.used||e.cancelled||performance.now()>=e.deadline||e.preview.previewSha256!==req.payload.previewSha256){if(e&&performance.now()>=e.deadline)cancelLease(e);fail('SESSION_LEASE_EXPIRED');}
        check();e.used=true;
        try{
          const result=await bridge.confirm(e.preview,{explicit:true,previewSha256:e.preview.previewSha256},()=>{check();return true;});e.result=result;check();
          const text=bridge.consumeResult(result,()=>{check();return true;});check();
          return {result:publicResult(result,e.preview,text)};
        }catch{cancelLease(e);fail('SESSION_OUTCOME_UNKNOWN');}
      })();
      const value=await Promise.race([operation,stop]);check();
      const result=reply(true,value);if(Buffer.byteLength(result)>MAX_BYTES){cancelLease(e);fail('SESSION_RESPONSE_INVALID');}return result;
    }catch(error){
      const safe=new Set(['SESSION_EXPIRED','SESSION_SCOPE_REFUSED','SESSION_BAD_REQUEST','SESSION_REPLAY_REFUSED','SESSION_LIMIT','SESSION_CONFIRMATION_REQUIRED','SESSION_LEASE_EXPIRED','SESSION_RESPONSE_INVALID','SESSION_OUTCOME_UNKNOWN']);
      return reply(false,safe.has(error?.code)?error.code:'SESSION_OUTCOME_UNKNOWN');
    }finally{clearTimeout(timer);if(onAbort){pendingStops.delete(onAbort);signal?.removeEventListener?.('abort',onAbort);}}
  }
  return Object.freeze({dispatch,close,inspect:()=>Object.freeze({fixtureOnly:true,realModelConnected:false,closed,prepared,activeLeases:[...leases.values()].filter(e=>!e.cancelled&&!e.used).length,attemptedLeases:[...leases.values()].filter(e=>e.used).length})});
}
