// Experimental storage primitive, NOT connected to existing controllers or UI.
export function createBundleStore({storage,namespace,crypto,withLock,validate}) {
 if(!/^lab-bundle-[a-z0-9-]{1,70}$/.test(namespace)||typeof validate!=='function')throw Error('LAB_CONFIGURATION');
 const key=namespace+':bundle-v1',lock=key+':write';
 const digest=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),x=>x.toString(16).padStart(2,'0')).join('');
 const clone=x=>JSON.parse(JSON.stringify(x));
 async function decode(raw){if(typeof raw!=='string'||new TextEncoder().encode(raw).length>4000000)throw Error('BUNDLE_SIZE');const x=JSON.parse(raw),{sha256,...b}=x;if(Object.keys(x).sort().join(',')!=='authority,entries,namespace,revision,schema,sha256'||b.schema!=='prism-lab-bundle/v1'||b.namespace!==namespace||b.authority!=='none'||!Number.isSafeInteger(b.revision)||b.revision<1||!b.entries||Array.isArray(b.entries)||typeof b.entries!=='object'||Object.keys(b.entries).length>50||Object.entries(b.entries).some(([k,v])=>!/^data\/[a-z0-9-]{1,100}$/.test(k)||typeof v!=='string')||sha256!==await digest(JSON.stringify(b)))throw Error('BUNDLE_INVALID');await validate(clone(b.entries));return b;}
 async function load(){const raw=storage.getItem(key);if(raw===null)return null;const body=await decode(raw);if(storage.getItem(key)!==raw)throw Error('BUNDLE_CONFLICT');return {raw,...clone(body)};}
 // Callback runs only on isolated staging Map. Published storage has one write.
 async function transact({expectedRaw=null,build,explicitConfirmation=false,signal}) {
  if(!explicitConfirmation)throw Error('CONFIRMATION_REQUIRED');if(typeof withLock!=='function')throw Error('WEB_LOCKS_REQUIRED');
  const checkAbort=()=>{if(signal?.aborted)throw Error('BUNDLE_ABORTED')};
  return withLock(lock,async()=>{checkAbort();const before=storage.getItem(key);if(before!==expectedRaw)throw Error('BUNDLE_CONFLICT');const old=before===null?null:await decode(before);const staged=new Map(Object.entries(old?.entries||{}));
   let active=true;const live=()=>{if(!active)throw Error('STAGING_REVOKED')};
   const adapter={getItem:k=>{live();return staged.get(k)??null},setItem(k,v){live();if(typeof k!=='string'||!/^data\/[a-z0-9-]{1,100}$/.test(k)||typeof v!=='string')throw Error('STAGING_KEY_INVALID');staged.set(k,v)},get length(){live();return staged.size},key:i=>{live();return [...staged.keys()][i]??null}};
   try{await build(adapter)}finally{active=false}checkAbort();const entries=Object.fromEntries(staged);const body={schema:'prism-lab-bundle/v1',namespace,revision:(old?.revision||0)+1,authority:'none',entries};const raw=JSON.stringify({...body,sha256:await digest(JSON.stringify(body))});await decode(raw);checkAbort();if(storage.getItem(key)!==before)throw Error('BUNDLE_CONFLICT');
   try{storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw Error('READBACK')}catch{throw Error('BUNDLE_WRITE_UNKNOWN_CHECK_KEY:'+key)}
   return {key,raw,revision:body.revision,active:false};
  });
 }
 return {key,load,transact};
}
