/** Default-off trusted Host seam. Factory dependencies must never come from wire JSON.
 * No permission is granted here. Host owns binding, policy checks and Peer signal.
 */
const fail=c=>{throw Error(c)};
const fields=['generation','namespace','projectId','paperId','sourceSha256','nodeId','promptVersion','projectVersion','workspaceId','sessionId','provider','model','principalId','policyVersion'];
const valid=x=>x&&Object.isFrozen(x)&&Object.getPrototypeOf(x)===Object.prototype&&Reflect.ownKeys(x).length===fields.length&&fields.every(k=>{const d=Object.getOwnPropertyDescriptor(x,k);return d&&Object.hasOwn(d,'value')&&typeof d.value==='string'&&d.value.length>0&&d.value.length<=300});
export function createTrustedReadGuard(options={}){
 if(options.enabled!==true)return Object.freeze({inspect:()=>Object.freeze({enabled:false,submitEnabled:false}),close(){}});
 const {binding,peer,decide,read}=options;
 if(!binding||typeof binding.getSnapshot!=='function'||typeof binding.subscribe!=='function'||!peer||typeof peer.signal?.addEventListener!=='function'||typeof decide!=='function'||typeof read!=='function')fail('READ_GUARD_CONFIG');
 const signal=peer.signal;
 let closed=false,busy=false,stop;const initial=binding.getSnapshot();if(!valid(initial))fail('READ_GUARD_BINDING');
 const close=()=>{closed=true;try{stop?.();}finally{signal.removeEventListener('abort',close)}};
 const check=()=>{if(closed||signal.aborted||peer.signal!==signal)fail('READ_GUARD_REVOKED');if(binding.getSnapshot()!==initial){close();fail('READ_GUARD_CHANGED')}};
 async function authorize(){check();let decision;try{decision=await decide(initial)}catch{close();fail('READ_GUARD_POLICY_FAILED')}check();if(decision!==true){close();fail('READ_GUARD_DENIED')}}
 try{signal.addEventListener('abort',close,{once:true});stop=binding.subscribe(close);if(typeof stop!=='function')fail('READ_GUARD_LIFECYCLE');check()}catch(e){close();throw e}
 return Object.freeze({close,inspect:()=>Object.freeze({enabled:true,closed,busy,submitEnabled:false,productionReady:false}),async read(){
  check();if(busy)fail('READ_GUARD_BUSY');busy=true;
  try{await authorize();check();const value=await read(initial);check();const output=safeCopy(value);check();await authorize();check();return output}finally{busy=false}
 }});
}

function safeCopy(value){
 let size=0,nodes=0;const seen=new Set();
 function copy(x,depth=0){
  if(++nodes>10000||depth>24)fail('READ_GUARD_RESULT_LIMIT');
  if(x===null||typeof x==='boolean')return x;
  if(typeof x==='number'&&Number.isFinite(x))return x;
  if(typeof x==='string'){size+=x.length;if(size>1000000)fail('READ_GUARD_RESULT_LIMIT');return x}
  if(!x||typeof x!=='object'||seen.has(x)||(!Array.isArray(x)&&Object.getPrototypeOf(x)!==Object.prototype))fail('READ_GUARD_RESULT_INVALID');
  seen.add(x);const array=Array.isArray(x),out=array?[]:{};
  if(array&&x.length>10000)fail('READ_GUARD_RESULT_LIMIT');
  for(const key of Reflect.ownKeys(x)){
   if(array&&key==='length')continue;
   if(typeof key!=='string'||['__proto__','constructor','prototype'].includes(key)||(array&&!/^(0|[1-9][0-9]*)$/.test(key)))fail('READ_GUARD_RESULT_INVALID');
   const d=Object.getOwnPropertyDescriptor(x,key);if(!d||!Object.hasOwn(d,'value')||!d.enumerable)fail('READ_GUARD_RESULT_INVALID');
   size+=key.length;if(size>1000000)fail('READ_GUARD_RESULT_LIMIT');out[key]=copy(d.value,depth+1);
  }
  if(array&&Object.keys(out).length!==x.length)fail('READ_GUARD_RESULT_INVALID');
  seen.delete(x);return Object.freeze(out);
 }
 return copy(value);
}
