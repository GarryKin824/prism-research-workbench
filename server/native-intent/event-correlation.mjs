const issuedObservers=new WeakMap();
export function readBoundEventEvidence(observer){const read=issuedObservers.get(observer);if(!read)throw Error('EVENT_OBSERVER_REQUIRED');return read()}
import {validatePinnedContextEvent} from './context-event-validator.mjs';
/** Passive bounded synthetic observer of official SessionEventEntry envelopes.
 * Never submits, approves, completes an intent or mutates its journal.
 * Caller owns authenticated session + exact pre-send quiescent cursor provenance.
 */
const fail=x=>{throw Error(x)},clone=x=>JSON.parse(JSON.stringify(x));
const exact=(x,required,optional=[])=>x&&Object.getPrototypeOf(x)===Object.prototype&&required.every(k=>Object.hasOwn(x,k))&&Object.keys(x).every(k=>[...required,...optional].includes(k));
const str=x=>typeof x==='string'&&x.length>0&&x.length<=262144;
const nat=x=>Number.isSafeInteger(x)&&x>=0;
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x)}return x};
function context(x){if(!exact(x,['sessionId','requestId','intentSha256','text','afterSeq','provider','model','isSeeded'])||!str(x.sessionId)||!str(x.requestId)||!str(x.text)||!/^[a-f0-9]{64}$/.test(x.intentSha256)||!nat(x.afterSeq)||!str(x.provider)||!str(x.model)||x.isSeeded!==false)fail('CONTEXT_INVALID');return clone(x)}
function json(x){let nodes=0;const seen=new Set();function walk(v,depth){if(++nodes>100000||depth>32)fail('EVENT_LIMIT');if(v===null||typeof v==='boolean')return v;if(typeof v==='string'){if(v.length>2000000)fail('EVENT_LIMIT');return v}if(typeof v==='number'&&Number.isFinite(v))return v;if(!v||typeof v!=='object'||seen.has(v))fail('JSON_DATA_REQUIRED');seen.add(v);let out;if(Array.isArray(v)){if(v.length>100000||Reflect.ownKeys(v).length!==v.length+1)fail('JSON_DATA_REQUIRED');out=[];for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d||!Object.hasOwn(d,'value'))fail('JSON_DATA_REQUIRED');out.push(walk(d.value,depth+1))}}else{if(Object.getPrototypeOf(v)!==Object.prototype)fail('JSON_DATA_REQUIRED');out={};for(const k of Reflect.ownKeys(v)){const d=Object.getOwnPropertyDescriptor(v,k);if(typeof k!=='string'||['__proto__','constructor','prototype'].includes(k)||!d.enumerable||!Object.hasOwn(d,'value'))fail('JSON_DATA_REQUIRED');out[k]=walk(d.value,depth+1)}}seen.delete(v);return out}const result=walk(x,0);if(JSON.stringify(result).length>2000000)fail('EVENT_LIMIT');return result}
export function createEventCorrelation(expected,{checkpoint=null,contextValidator=null}={}){
 const c=context(json(expected));let events=new Map(),interruption=null,invalid=null,replayed=false;
 function add(records){for(const r of records){if(!exact(r,['type','event'])||r.type!=='event')fail('NOT_DURABLE_EVENT');const e=r.event;if(!exact(e,['type','seq','time','data'],['ignorable','sourceEventSeqs','surfaceOp'])||!str(e.type)||!nat(e.seq)||!Number.isFinite(e.time)||e.seq<=c.afterSeq)fail('EVENT_ENVELOPE_INVALID');if(events.has(e.seq)&&JSON.stringify(events.get(e.seq))!==JSON.stringify(e))fail('DUPLICATE_CONFLICT');events.set(e.seq,e);if(events.size>2000||JSON.stringify([...events]).length>2000000)fail('EVENT_LIMIT')}}
 function report(){let status='awaiting-events',turn=null,step=null,matched=false,users=0,outputs=[],reason=null,through=c.afterSeq,ended=false,lastStep=-1,stepMessage=false,contextStep=null,headerSeen=false,systemSeen=false;const messageIds=new Set();
 try{if(invalid)fail(invalid);for(const seq of [...events.keys()].sort((a,b)=>a-b)){if(seq!==through+1){status='gap';break}through=seq;const e=events.get(seq),d=e.data;if(ended)fail('EVENTS_AFTER_TARGET_TURN');if(e.sourceEventSeqs!==undefined||(e.surfaceOp!==undefined&&e.surfaceOp!=='append'))fail('SURFACE_REWRITE_UNSUPPORTED');
 switch(e.type){
 case 'turn/start':if(turn!==null||!exact(d,['turn'])||!nat(d.turn))fail('TURN_AMBIGUOUS');turn=d.turn;break;
 case 'step/start':if(turn===null||step!==null||lastStep!==-1||!exact(d,['turn','step'])||d.turn!==turn||!nat(d.step)||d.step<=lastStep)fail('STEP_INVALID');if(contextStep!==null&&d.step!==contextStep)fail('CONTEXT_STEP_MISMATCH');step=d.step;lastStep=step;stepMessage=false;break;
 case 'user/message':if(turn===null||e.surfaceOp!=='append'||d?.role!=='user'||!str(d.id)||messageIds.has(d.id)||d?.source?.kind!=='user'||d.source.rpcId!==c.requestId||JSON.stringify(d.content)!==JSON.stringify([{type:'text',text:c.text}])||++users!==1)fail('USER_CORRELATION_AMBIGUOUS');messageIds.add(d.id);matched=true;break;
 case 'assistant/message':if(!matched||step===null||stepMessage||messageIds.has(d?.message?.id)||d?.turn!==turn||d.step!==step||d.interrupted!==undefined||d?.message?.role!=='assistant'||d.message.source?.kind!=='model'||d.message.source.provider!==c.provider||d.message.source.model!==c.model||!str(d.message.id)||e.surfaceOp!=='append'||!Array.isArray(d.stream)||!Array.isArray(d.message.content)||!d.message.content.length||d.message.content.some(b=>!exact(b,['type','text'])||b.type!=='text'||!str(b.text)))fail('ASSISTANT_UNSUPPORTED');stepMessage=true;messageIds.add(d.message.id);outputs.push({seq:e.seq,id:d.message.id,text:d.message.content.map(b=>b.text).join('')});break;
 case 'step/end':if(!exact(d,['turn','step'])||d.turn!==turn||d.step!==step||step===null)fail('STEP_INVALID');step=null;break;
 case 'system/message':{
 if(contextValidator===null)fail('SYSTEM_EVENT_VALIDATION_NOT_IMPLEMENTED');validatePinnedContextEvent(contextValidator,e);
 if(turn===null||step===null||matched||systemSeen||outputs.length||d.turn!==turn||!nat(d.step)||(step!==null&&d.step!==step)||(contextStep!==null&&contextStep!==d.step)||e.surfaceOp!=='append'||!exact(d,['turn','step','message']))fail('SYSTEM_SCOPE_INVALID');
 const m=d.message;if(!exact(m,['id','role','source','content'])||!str(m.id)||messageIds.has(m.id)||m.role!=='system'||!exact(m.source,['kind'])||m.source.kind!=='system-prompt'||!Array.isArray(m.content)||m.content.some(b=>!exact(b,['type','text'])||b.type!=='text'||typeof b.text!=='string'))fail('SYSTEM_SCHEMA_UNSUPPORTED');
 systemSeen=true;contextStep=d.step;messageIds.add(m.id);break;}

 case 'request/header':{
 if(contextValidator===null)fail('HEADER_EVENT_VALIDATION_NOT_IMPLEMENTED');validatePinnedContextEvent(contextValidator,e);
 if(turn===null||step===null||!matched||headerSeen||outputs.length||!exact(d,['header','reason'],['startsSeries'])||!['initial','resume','change','series'].includes(d.reason)||(d.startsSeries!==undefined&&d.startsSeries!==true))fail('HEADER_SCOPE_INVALID');
 const h=d.header;if(!exact(h,['config'],['adapterDefaults','tools'])||(h.tools!==undefined&&(!Array.isArray(h.tools)||h.tools.length)))fail('HEADER_TOOLS_UNSUPPORTED');const f=h.config;
 if(!exact(f,['provider','model'],['reasoningEffort','temperature','maxTokens','stop'])||f.provider!==c.provider||f.model!==c.model||(f.reasoningEffort!==undefined&&!str(f.reasoningEffort))||(f.temperature!==undefined&&!Number.isFinite(f.temperature))||(f.maxTokens!==undefined&&(!Number.isSafeInteger(f.maxTokens)||f.maxTokens<=0))||(f.stop!==undefined&&(!Array.isArray(f.stop)||f.stop.some(x=>typeof x!=='string'))))fail('HEADER_CONFIG_INVALID');
 if(h.adapterDefaults!==undefined&&(!exact(h.adapterDefaults,[],['reasoningEffort','maxTokens'])||Object.values(h.adapterDefaults).some(x=>x!==true)||Object.keys(h.adapterDefaults).some(k=>!Object.hasOwn(f,k))))fail('HEADER_DEFAULTS_INVALID');headerSeen=true;break;}

 case 'turn/end':if(turn===null||d?.turn!==turn||!matched||step!==null||!str(d.reason?.kind))fail('TURN_END_UNCORRELATED');reason=clone(d.reason);ended=true;if(d.reason.kind==='completed'&&outputs.length){status='candidate-completed'}else if(['error','aborted','blocked','max-tokens','interrupted','forked'].includes(d.reason.kind)){status='candidate-incomplete'}else fail('TURN_END_UNSUPPORTED');break;
 // Even ignorable unknown events are not silently accepted in this narrow first version.
 default:fail('EVENT_TYPE_UNSUPPORTED');
 }}if(!ended&&status!=='gap')status=matched?'in-progress':'awaiting-events';}
 catch(e){status='unknown';reason={code:e.message};outputs=[]}
 if(interruption&&!(replayed&&status.startsWith('candidate-'))){status='unknown';outputs=[]}
 return freeze({status,sessionId:c.sessionId,requestId:c.requestId,intentSha256:c.intentSha256,throughSeq:through,interruption,reason,outputs:status==='candidate-completed'?outputs:[],fixtureOnly:true,authority:'none',intentMutationAllowed:false,realModelConnected:false})}
 function feed({sessionId,records}){try{if(sessionId!==c.sessionId||!Array.isArray(records))fail('SESSION_MISMATCH');add(json(records))}catch(e){invalid=e.message}return report()}
 function interrupt(kind){if(!['disconnect','timeout'].includes(kind))fail('INTERRUPTION_INVALID');interruption=kind;replayed=false;return freeze({...report(),status:'unknown',outputs:[]})}
 function readback(input){try{if(input.sessionId!==c.sessionId||!Array.isArray(input.records))fail('SESSION_MISMATCH');const incoming=json(input.records),map=new Map(incoming.map(r=>[r.event?.seq,r.event]));for(const [seq,e] of events)if(JSON.stringify(map.get(seq))!==JSON.stringify(e))fail('READBACK_PREFIX_CHANGED');add(incoming);replayed=true}catch(e){invalid=e.message}return report()}
 function snapshot(){return JSON.stringify({schema:'prism-event-correlation-fixture/v1',context:c,records:[...events.values()].map(event=>({type:'event',event})),interruption,invalid})}
 if(checkpoint!==null){if(typeof checkpoint!=='string'||checkpoint.length>2100000)fail('CHECKPOINT_INVALID');let p;try{p=JSON.parse(checkpoint)}catch{fail('CHECKPOINT_INVALID')}if(!exact(p,['schema','context','records','interruption','invalid'])||p.schema!=='prism-event-correlation-fixture/v1'||JSON.stringify(p.context)!==JSON.stringify(c)||!Array.isArray(p.records)||![null,'disconnect','timeout'].includes(p.interruption)||(p.invalid!==null&&!str(p.invalid)))fail('CHECKPOINT_INVALID');add(json(p.records));interruption=p.interruption;invalid=p.invalid}
 const observer=Object.freeze({feed,readback,interrupt,snapshot,inspect:report});issuedObservers.set(observer,()=>freeze({context:clone(c),snapshot:snapshot(),report:report()}));return observer
}
const syntheticSources=new WeakSet();
export function createSyntheticEventSource(sessionId){let records=[],fault=null;const source=Object.freeze({setRecords(next){records=json(next)},setFault(kind){if(![null,'disconnect','timeout'].includes(kind))fail('FAULT_INVALID');fault=kind},async read(){if(fault)throw Error(fault);return {sessionId,records:json(records)}}});syntheticSources.add(source);return source}
export async function readSyntheticEvents(observer,source,{readback=false}={}){if(!syntheticSources.has(source))fail('SYNTHETIC_SOURCE_REQUIRED');let input;try{input=await source.read()}catch(e){return observer.interrupt(e.message==='timeout'?'timeout':'disconnect')}return readback?observer.readback(input):observer.feed(input)}
