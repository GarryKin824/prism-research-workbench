/** Serialized fixture-only seam. The injected exchange is trusted; this module opens no transport.
 * Cancellation stops local adoption, not remote execution. Unknown outcomes are never retried.
 */
import {canonicalPlanningRequest} from './planning-model-adapter.mjs';
const PROTOCOL = 'prism-planning-fixture-bridge/v1';
const EXECUTOR = 'official-deepseek-loopback-http-fixture';
const PREFIX = '[本地HTTP合成样例，非真实模型答复；未验证]\n';
const uuid = x => typeof x === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(x);
const exact = (x, ks) => x !== null && typeof x === 'object' && !Array.isArray(x) && Reflect.ownKeys(x).length === ks.length && ks.every(k => Object.hasOwn(Object.getOwnPropertyDescriptor(x,k) ?? {},'value'));
const bytes = s => new TextEncoder().encode(s);
const fail = code => { throw Error(code); };
const freeze = x => { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };
const equalBinding = (b,q) => { try { return JSON.stringify(canonicalPlanningRequest({purpose:q.purpose,binding:b,payload:q.payload}).binding) === JSON.stringify(q.binding); } catch { return false; } };
// Reject ambiguous duplicate JSON member names, including escaped spellings.
function parse(raw) {
  if (typeof raw !== 'string' || raw.length > 2097152 || bytes(raw).length > 2097152) fail('SESSION_RESPONSE_INVALID');
  const value = JSON.parse(raw), tokens = raw.match(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]|[^\s{}\[\]:,]+/g) ?? [];
  const stack=[];
  for(let i=0;i<tokens.length;i++) {
    const t=tokens[i];
    if(t==='{') stack.push(new Set()); else if(t==='[') stack.push(null); else if(t==='}' || t===']') stack.pop();
    else if(t.startsWith('"') && tokens[i+1]===':') { const keys=stack.at(-1), key=JSON.parse(t); if(!keys || keys.has(key)) fail('SESSION_RESPONSE_INVALID'); keys.add(key); }
  }
  return value;
}
export function createPlanningSessionClient({exchange,crypto=globalThis.crypto,timeoutMs=5000}={}) {
  if(typeof exchange!=='function' || typeof crypto?.randomUUID!=='function' || typeof crypto?.subtle?.digest!=='function' || !Number.isSafeInteger(timeoutMs) || timeoutMs<1 || timeoutMs>60000) fail('SESSION_CONFIGURATION_INVALID');
  const previews=new WeakMap(), results=new WeakMap(), entries=new Set(), ids=new Set(); let closed=false, count=0;
  const digest=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes(s))),b=>b.toString(16).padStart(2,'0')).join('');
  function current(e,check=()=>true) {
    try { if(closed || e.cancelled || typeof check!=='function') throw Error(); e.stable(); if(check()!==true) throw Error(); e.stable(); if(closed || e.cancelled) throw Error(); }
    catch { fail('SESSION_CONTEXT_EXPIRED'); }
  }
  async function call(method,payload,e,check=()=>true) {
    current(e,check);
    const id=crypto.randomUUID(); if(!uuid(id) || ids.has(id)) fail('SESSION_CONFIGURATION_INVALID'); ids.add(id);
    const abort=new AbortController(); let timer,stop;
    const halted=new Promise((_,reject)=>{stop=()=>{abort.abort();reject(Error('SESSION_OUTCOME_UNKNOWN'));};});
    e.stops.add(stop);
    timer=setTimeout(()=>{e.cancelled=true;stop();},timeoutMs);
    try {
      const raw=await Promise.race([Promise.resolve().then(()=>{current(e,check);return exchange(JSON.stringify({protocol:PROTOCOL,id,method,payload}),{signal:abort.signal});}),halted]);
      current(e,check); const response=parse(raw);
      if(!exact(response,response?.ok===true?['protocol','id','ok','value']:['protocol','id','ok','error']) || response.protocol!==PROTOCOL || response.id!==id) fail('SESSION_RESPONSE_INVALID');
      if(response.ok!==true) { if(response.ok!==false || !exact(response.error,['code']) || typeof response.error.code!=='string' || !/^[A-Z][A-Z0-9_]{0,79}$/.test(response.error.code)) fail('SESSION_RESPONSE_INVALID'); fail('SESSION_REMOTE_REJECTED'); }
      return response.value;
    } catch { e.cancelled=true; abort.abort(); fail('SESSION_OUTCOME_UNKNOWN'); }
    finally {clearTimeout(timer);e.stops.delete(stop);}
  }
  async function validatePreview(p,q) {
    if(!exact(p,['kind','purpose','binding','requestId','sessionId','endpoint','method','body','headers','bodySha256','headersSha256','model','actualExecutor','realModelConnected','fixtureOnly','authority','previewSha256']) || p.kind!=='planning-http-preview' || p.purpose!==q.purpose || !equalBinding(p.binding,q) || !uuid(p.requestId) || !uuid(p.sessionId) || typeof p.endpoint!=='string' || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/v1\/messages$/.test(p.endpoint) || Number(new URL(p.endpoint).port)>65535 || p.method!=='POST' || p.model!=='prism-synthetic' || p.actualExecutor!==EXECUTOR || p.realModelConnected!==false || p.fixtureOnly!==true || p.authority!=='none' || typeof p.body!=='string' || bytes(p.body).length>262144 || !Array.isArray(p.headers) || p.headers.length!==7) fail('SESSION_PREVIEW_INVALID');
    const headers={'accept':'text/event-stream','content-type':'application/json','anthropic-version':'2023-06-01','x-api-key':'fixture-not-a-user-credential','x-deepseek-harness-user-id':'prism-public-fixture','x-deepseek-harness-session-id':p.sessionId,'user-agent':'deepseek-harness/0.2.2-rc.1 (+https://github.com/deepseek-ai/deepseek-harness)'};
    const seen=new Set();
    for(const h of p.headers) { if(!exact(h,['name','value']) || seen.has(h.name) || !Object.hasOwn(headers,h.name) || h.value!==headers[h.name]) fail('SESSION_PREVIEW_INVALID'); seen.add(h.name); }
    const b=parse(p.body);
    if(!exact(b,['model','stream','messages','max_tokens','thinking']) || b.model!=='prism-synthetic' || b.stream!==true || b.max_tokens!==256 || !exact(b.thinking,['type']) || b.thinking.type!=='disabled' || !Array.isArray(b.messages) || b.messages.length!==1 || !exact(b.messages[0],['role','content']) || b.messages[0].role!=='user' || !Array.isArray(b.messages[0].content) || b.messages[0].content.length!==1 || !exact(b.messages[0].content[0],['type','text']) || b.messages[0].content[0].type!=='text' || b.messages[0].content[0].text!==q.payload) fail('SESSION_PREVIEW_INVALID');
    const {previewSha256,...fields}=p;
    if(p.bodySha256!==await digest(p.body) || p.headersSha256!==await digest(JSON.stringify(p.headers)) || previewSha256!==await digest(JSON.stringify(fields))) fail('SESSION_PREVIEW_INVALID');
  }
  async function prepare(input,assertStable=()=>{}) {
    let e;
    try {
      if(closed || typeof assertStable!=='function') fail('SESSION_CONTEXT_EXPIRED');
      if(count>=100) fail('SESSION_PREVIEW_LIMIT');
      assertStable(); const q=freeze(canonicalPlanningRequest(input)), canonical=JSON.stringify(q);
      e={q,cancelled:false,used:false,stops:new Set(),stable:()=>{assertStable();if(JSON.stringify(canonicalPlanningRequest(input))!==canonical) fail('SESSION_CONTEXT_EXPIRED');}};
      current(e); count++; entries.add(e);
      const v=await call('prepare',q,e); current(e);
      if(!exact(v,['leaseId','preview']) || !uuid(v.leaseId)) fail('SESSION_PREVIEW_INVALID');
      e.leaseId=v.leaseId; await validatePreview(v.preview,q); current(e);
      e.preview=freeze(v.preview); previews.set(e.preview,e); return e.preview;
    } catch {if(e)e.cancelled=true;fail('SESSION_PREVIEW_INVALID');}
  }
  async function confirm(preview,{explicit,previewSha256}={},isCurrent=()=>true) {
    const e=previews.get(preview);
    if(!e || e.used || explicit!==true || previewSha256!==preview.previewSha256) fail('SESSION_CONFIRMATION_REQUIRED');
    current(e,isCurrent); e.used=true;
    try {
      const v=await call('confirm',{leaseId:e.leaseId,previewSha256,explicit:true},e,isCurrent); current(e,isCurrent);
      if(!exact(v,['result'])) fail('SESSION_RESULT_INVALID'); const r=v.result;
      if(!exact(r,['kind','requestId','purpose','binding','text','fixtureOnly','actualExecutor','realModelConnected','authority','verified']) || r.kind!=='planning-http-result' || r.requestId!==preview.requestId || r.purpose!==e.q.purpose || !equalBinding(r.binding,e.q) || r.fixtureOnly!==true || r.actualExecutor!==EXECUTOR || r.realModelConnected!==false || r.authority!=='none' || r.verified!==false || typeof r.text!=='string' || !r.text.startsWith(PREFIX) || !r.text.slice(PREFIX.length).trim() || r.text.length>16000 || bytes(r.text).length>65536 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(r.text) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(r.text)) fail('SESSION_RESULT_INVALID');
      current(e,isCurrent);freeze(r);results.set(r,{e,consumed:false});return r;
    } catch {e.cancelled=true;fail('SESSION_OUTCOME_UNKNOWN');}
  }
  function consumeResult(result,isCurrent=()=>true) {
    const r=results.get(result);if(!r || r.consumed) fail('SESSION_RESULT_EXPIRED');current(r.e,isCurrent);r.consumed=true;return result.text;
  }
  function cancel(token) {
    const e=previews.get(token)??results.get(token)?.e;if(!e || e.cancelled)return;
    e.cancelled=true;for(const stop of e.stops)stop();
    // Best effort protocol notification; local revocation is immediate and unconditional.
    if(!closed && e.leaseId) {const notification={stable:()=>{},cancelled:false,stops:new Set()};entries.add(notification);void call('cancel',{leaseId:e.leaseId},notification).then(v=>{if(!exact(v,['cancelled']) || v.cancelled!==true)fail('SESSION_RESPONSE_INVALID');}).catch(()=>{}).finally(()=>entries.delete(notification));}
  }
  function close() {closed=true;for(const e of entries){e.cancelled=true;for(const stop of e.stops)stop();}entries.clear();}
  return Object.freeze({prepare,confirm,consumeResult,cancel,close});
}
