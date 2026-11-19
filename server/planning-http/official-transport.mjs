/** Node-only trusted-process fixture guard, NOT an OS security sandbox.
 * Run in a dedicated subprocess. runtimeRoot and endpoint are host configuration,
 * never request fields. No provider registration, auth plugins or model discovery.
 */
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash, randomUUID} from 'node:crypto';
import {isAbsolute, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {syncBuiltinESMExports} from 'node:module';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {verifyRuntime} from './verify-runtime.mjs';

const MODEL = 'prism-synthetic';
const EXECUTOR = 'official-deepseek-loopback-http-fixture';
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = code => Object.assign(new Error(code), {code});
let installed = false;

function messagesOf(payload) {
  if(typeof payload!=='string'||!payload.length)throw fail('FIXTURE_PAYLOAD_REFUSED');
  if(Buffer.byteLength(payload)>262144)throw fail('REQUEST_TOO_LARGE');
  return [{role:'user',content:[{type:'text',text:payload}]}];
}

// Check all raw frames, including trailing data the official terminal translator
// would otherwise stop reading. The official adapter still parses/translates SSE.
function checkSse(bytes) {
  let text;
  try { text = new TextDecoder('utf-8',{fatal:true}).decode(bytes).replaceAll('\r\n','\n'); } catch { throw fail('MALFORMED_SSE'); }
  if (!text.endsWith('\n\n') || text.includes('\r')) throw fail('TRUNCATED_SSE');
  let stage = 'start', terminal = false, inputTokens = 0;
  const exact = (o, keys) => o && typeof o==='object' && !Array.isArray(o) && Object.keys(o).length===keys.length && keys.every(k=>Object.hasOwn(o,k));
  const count = (v,max) => Number.isSafeInteger(v) && v>=0 && v<=max;
  for (const frame of text.split('\n\n').filter(Boolean)) {
    let name; const data=[];
    for (const line of frame.split('\n')) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) { if(name!==undefined) throw fail('MALFORMED_SSE'); name=line.slice(6).trim(); }
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /,''));
      else throw fail('MALFORMED_SSE');
    }
    if (!data.length) continue;
    if (terminal) throw fail('MALFORMED_SSE');
    let e; try { e=JSON.parse(data.join('\n')); } catch { throw fail('MALFORMED_SSE'); }
    if (!e || (name!==undefined && name!==e.type)) throw fail('NON_TEXT_OR_MALFORMED_SSE');
    if (e.type==='ping' && exact(e,['type'])) continue;
    if (stage==='start' && e.type==='message_start' && exact(e,['type','message'])) {
      const m=e.message;
      if(!exact(m,['id','type','role','model','content','usage']) || typeof m.id!=='string' || !/^msg_[a-zA-Z0-9_-]{1,128}$/.test(m.id) || m.type!=='message' || m.role!=='assistant' || m.model!==MODEL || !Array.isArray(m.content) || m.content.length || !exact(m.usage,['input_tokens','output_tokens']) || !count(m.usage.input_tokens,4096) || m.usage.output_tokens!==0) throw fail('NON_TEXT_OR_MALFORMED_SSE');
      inputTokens=m.usage.input_tokens; stage='block-start';
    } else if(stage==='block-start' && e.type==='content_block_start' && exact(e,['type','index','content_block']) && e.index===0 && exact(e.content_block,['type','text']) && e.content_block.type==='text' && e.content_block.text==='') stage='delta';
    else if(stage==='delta' && e.type==='content_block_delta' && exact(e,['type','index','delta']) && e.index===0 && exact(e.delta,['type','text']) && e.delta.type==='text_delta' && typeof e.delta.text==='string') { /* Complete text is validated after official translation. */ }
    else if(stage==='delta' && e.type==='content_block_stop' && exact(e,['type','index']) && e.index===0) stage='usage';
    else if(stage==='usage' && e.type==='message_delta' && exact(e,['type','delta','usage']) && exact(e.delta,['stop_reason','stop_sequence']) && e.delta.stop_reason==='end_turn' && e.delta.stop_sequence===null && exact(e.usage,['output_tokens']) && count(e.usage.output_tokens,256) && inputTokens+e.usage.output_tokens<=4352) stage='stop';
    else if(stage==='stop' && e.type==='message_stop' && exact(e,['type'])) terminal=true;
    else throw fail('NON_TEXT_OR_MALFORMED_SSE');
  }
  if (!terminal) throw fail('TRUNCATED_SSE');
}

export async function createOfficialLoopbackTransport({runtimeRoot, endpoint, fixtureDirectory}) {
  if (installed) throw fail('ONE_TRANSPORT_PER_PROCESS');
  let allowed; try { allowed=new URL(endpoint); } catch { throw fail('LOOPBACK_ENDPOINT_REQUIRED'); }
  if (allowed.protocol!=='http:' || allowed.hostname!=='127.0.0.1' || !allowed.port || allowed.username || allowed.password || allowed.search || allowed.hash || allowed.pathname!=='/v1/messages' || allowed.href!==endpoint) throw fail('LOOPBACK_ENDPOINT_REQUIRED');
  if (typeof fixtureDirectory!=='string' || !isAbsolute(fixtureDirectory)) throw fail('EXPLICIT_FIXTURE_DIRECTORY_REQUIRED');
  const runtime=await verifyRuntime(runtimeRoot);
  // Reserve globally after asynchronous verification, before patching/loading.
  if(installed) throw fail('ONE_TRANSPORT_PER_PROCESS');
  installed=true;
  const context=new AsyncLocalStorage(), wires=new WeakMap(), requestIds=new Set(), sessions=new Set(), controllers=new Set();
  const original={fetch:globalThis.fetch,connect:net.Socket.prototype.connect,httpRequest:http.request,httpGet:http.get,httpsRequest:https.request,httpsGet:https.get};
  const counters={dryRequests:0,wireCalls:0,blocked:0,invocations:0};
  let closed=false;
  const deny=()=>{counters.blocked++;throw fail('NETWORK_TARGET_REFUSED');};
  http.request=http.get=https.request=https.get=deny;
  net.Socket.prototype.connect=function(...args) {
    const state=context.getStore();
    let options=args[0]; if(Array.isArray(options)) options=options[0];
    if(closed || !state || state.mode!=='live' || !state.dispatchActive || state.socketClaimed || !options || typeof options!=='object' || String(options.port)!==allowed.port || (options.host??options.hostname)!=='127.0.0.1') return deny();
    state.socketClaimed=true;
    return original.connect.apply(this,args);
  };
  globalThis.fetch=async(input,init)=> {
    const state=context.getStore();
    if(closed || !state || state.controller.signal.aborted) return deny();
    const request=new Request(input,init);
    if(request.url!==endpoint || request.method!=='POST' || request.redirect!=='error') return deny();
    const body=await request.clone().text();
    if(Buffer.byteLength(body)>262144) throw fail('REQUEST_TOO_LARGE');
    const headers=[...request.headers].sort(([a],[b])=>a.localeCompare(b)).map(([name,value])=>({name,value}));
    const allowedHeaders=['accept','anthropic-version','content-type','user-agent','x-api-key','x-deepseek-harness-session-id','x-deepseek-harness-user-id'];
    if(headers.length!==allowedHeaders.length || headers.some(h=>!allowedHeaders.includes(h.name)) || request.headers.get('x-api-key')!=='fixture-not-a-user-credential' || request.headers.get('x-deepseek-harness-user-id')!=='prism-public-fixture' || request.headers.get('x-deepseek-harness-session-id')!==state.sessionId || request.headers.get('content-type')!=='application/json' || request.headers.get('accept')!=='text/event-stream' || request.headers.get('anthropic-version')!=='2023-06-01' || request.headers.get('user-agent')!=='deepseek-harness/0.2.2-rc.1 (+https://github.com/deepseek-ai/deepseek-harness)') throw fail('FIXTURE_HEADERS_REFUSED');
    const capture={endpoint,method:'POST',body,headers,bodySha256:sha(body),headersSha256:sha(JSON.stringify(headers)),model:MODEL,sessionId:state.sessionId,actualExecutor:EXECUTOR,realModelConnected:false};
    if(state.mode==='dry') {
      if(state.capture) throw fail('DUPLICATE_DRY_REQUEST');
      counters.dryRequests++;state.capture=capture;throw fail('DRY_ENCODING_NO_NETWORK');
    }
    if(state.dispatched || state.expected.body!==body || JSON.stringify(state.expected.headers)!==JSON.stringify(headers)) throw fail('EXACT_WIRE_MISMATCH');
    state.dispatched=true; counters.wireCalls++; state.dispatchActive=true;
    let response;
    try { response=await original.fetch(new Request(request,{signal:state.controller.signal,redirect:'error'})); }
    finally { state.dispatchActive=false; }
    if (!response.ok) { await response.body?.cancel(); throw fail(response.status===429?'FIXTURE_RATE_LIMITED':'FIXTURE_HTTP_REJECTED'); }
    if(!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream') || !response.body) { await response.body?.cancel(); throw fail('FIXTURE_RESPONSE_TYPE_REFUSED'); }
    const reader=response.body.getReader(),chunks=[];let size=0;
    try {
      for (;;) {
        const {done,value}=await reader.read(); if(done) break;
        size+=value.byteLength;if(size>65536) throw fail('RESPONSE_TOO_LARGE');
        chunks.push(value);state.controller.signal.throwIfAborted();
      }
    } catch(error) { await reader.cancel().catch(()=>{});throw error; }
    finally { reader.releaseLock(); }
    state.controller.signal.throwIfAborted();
    const bytes=Buffer.concat(chunks);checkSse(bytes);
    return new Response(bytes,{status:200,headers:{'content-type':'text/event-stream'}});
  };
  syncBuiltinESMExports();
  const close=()=> {
    if(closed)return;closed=true;
    for(const controller of controllers)controller.abort();
    globalThis.fetch=original.fetch;net.Socket.prototype.connect=original.connect;
    http.request=original.httpRequest;http.get=original.httpGet;https.request=original.httpsRequest;https.get=original.httpsGet;
    syncBuiltinESMExports(); installed=false;
  };
  let adapter;
  try {
    const {DeepSeekAdapter,resolveAdapterOptions,DeepSeekFileStore,DeepSeekUploadIndex}=await import(pathToFileURL(join(runtime.root,'node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js')).href);
    const options=resolveAdapterOptions({baseURL:allowed.origin,models:[{id:MODEL,inputModalities:['text'],maxTokens:256,contextWindow:4096}],thinking:'disabled',reasoningEffort:'off',maxTokens:256,streamIdleTimeoutMs:2000,retryPolicy:{mode:'normal',maxRetries:0}},{});
    adapter=new DeepSeekAdapter({options:()=>options,resolveAuth:async()=>({headers:{'x-api-key':'fixture-not-a-user-credential'}}),resolveUserId:()=> 'prism-public-fixture',prepareExtensions:async()=>({fields:{},accept:async()=>{}}),resolveFiles:()=>new DeepSeekFileStore({index:new DeepSeekUploadIndex(join(fixtureDirectory,'fixture-index.json'))}),admit:(_connection,model)=>{if(model!==MODEL)throw fail('FIXTURE_MODEL_REFUSED');}});
  } catch {close();throw fail('OFFICIAL_RUNTIME_INITIALIZATION_FAILED');}

  async function run(state,messages,signal) {
    const controller=state.controller;controllers.add(controller);
    const abort=()=>controller.abort();
    if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,4500);
    const aborted=new Promise((_,reject)=> {
      if(controller.signal.aborted)reject(fail('FIXTURE_ABORTED'));
      else controller.signal.addEventListener('abort',()=>reject(fail('FIXTURE_ABORTED')),{once:true});
    });
    try {
      return await Promise.race([aborted,context.run(state,async()=> {
        let text='',usage,finished=false;
        for await(const event of adapter.stream({provider:'deepseek',model:MODEL,sessionId:state.sessionId,messages,signal:controller.signal})) {
          controller.signal.throwIfAborted();
          if(event.type==='text-delta')text+=event.text;
          else if(event.type==='usage') {
            const u=event.usage; if(!u || !Number.isSafeInteger(u.inputTokens)||u.inputTokens<0||u.inputTokens>4096||!Number.isSafeInteger(u.outputTokens)||u.outputTokens<0||u.outputTokens>256||u.totalTokens!==u.inputTokens+u.outputTokens||u.cacheReadTokens||u.cacheWriteTokens)throw fail('MALFORMED_USAGE'); usage={inputTokens:u.inputTokens,outputTokens:u.outputTokens,totalTokens:u.totalTokens};
          } else if(event.type==='finish') {if(event.reason?.kind!=='stop'||finished)throw fail('INCOMPLETE_RESPONSE');finished=true;}
          else if(event.type==='block-start') {if(event.blockType!=='text')throw fail('NON_TEXT_RESPONSE');}
          else if(event.type==='block-end') {if(event.block?.type!=='text')throw fail('NON_TEXT_RESPONSE');}
          else throw fail('NON_TEXT_RESPONSE');
          if(Buffer.byteLength(text)>65536)throw fail('RESPONSE_TOO_LARGE');
        }
        if(!finished || !text || !usage || closed || controller.signal.aborted)throw fail('INCOMPLETE_RESPONSE');
        return Object.freeze({text,usage:Object.freeze(usage??{}),realModelConnected:false,actualExecutor:EXECUTOR});
      })]);
    } catch(error) {
      // SDK errors may contain remote/user content: never preserve cause/message.
      const safe=new Set(['FIXTURE_ABORTED','REQUEST_TOO_LARGE','RESPONSE_TOO_LARGE','EXACT_WIRE_MISMATCH','NETWORK_TARGET_REFUSED','FIXTURE_HEADERS_REFUSED','NON_TEXT_RESPONSE','MALFORMED_SSE','TRUNCATED_SSE','NON_TEXT_OR_MALFORMED_SSE','NON_TEXT_OR_INCOMPLETE_RESPONSE','FIXTURE_RATE_LIMITED','FIXTURE_HTTP_REJECTED','FIXTURE_RESPONSE_TYPE_REFUSED']);
      throw fail(safe.has(error?.code)?error.code:'OFFICIAL_FIXTURE_FAILED');
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();controllers.delete(controller);}
  }
  return Object.freeze({
    async prepare({payload,sessionId=randomUUID()}) {
      if(closed)throw fail('TRANSPORT_CLOSED');
      if(typeof sessionId!=='string'||!/^[-a-zA-Z0-9_]{1,128}$/.test(sessionId)||sessions.has(sessionId))throw fail('FIXTURE_SESSION_REFUSED');
      const messages=messagesOf(payload);sessions.add(sessionId);
      const state={mode:'dry',sessionId,controller:new AbortController()};
      try {await run(state,messages);} catch { /* Expected dry fetch interception. */ }
      if(!state.capture)throw fail('OFFICIAL_PREVIEW_FAILED');
      const wire=Object.freeze({...state.capture,headers:Object.freeze(state.capture.headers.map(Object.freeze))});
      wires.set(wire,{messages,used:false});return wire;
    },
    async invoke(wire,{requestId,signal}={}) {
      if(closed)throw fail('TRANSPORT_CLOSED');
      const lease=wires.get(wire);
      if(!lease||lease.used)throw fail('WIRE_LEASE_REFUSED');
      if(typeof requestId!=='string'||!requestId.length||requestId.length>256||requestIds.has(requestId))throw fail('REQUEST_ID_REFUSED');
      lease.used=true;requestIds.add(requestId);counters.invocations++;
      return run({mode:'live',sessionId:wire.sessionId,expected:wire,controller:new AbortController()},lease.messages,signal);
    },close,stats:()=>Object.freeze({...counters,closed,realModelConnected:false,actualExecutor:EXECUTOR})
  });
}
