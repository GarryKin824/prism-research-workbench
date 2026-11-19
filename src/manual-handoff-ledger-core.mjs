// Metadata only. Hashes detect accidental modification, not identity or authenticity.
import {sha256} from './custom-core.mjs';
export const MANUAL_HANDOFF_LEDGER_SCHEMA='prism-manual-handoff-ledger-v1';
export const MANUAL_HANDOFF_LEDGER_LIMIT=200;
const exact=(x,names)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===names.split(',').sort().join(',');
const fail=code=>{throw Error(code)},clone=x=>JSON.parse(JSON.stringify(x));
const id=x=>typeof x==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(x),hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export function emptyManualHandoffLedger(namespace){return {schema:MANUAL_HANDOFF_LEDGER_SCHEMA,namespace,authority:'none',records:[]}}
export function validateManualHandoffLedger(s){
 if(!exact(s,'schema,namespace,authority,records')||s.schema!==MANUAL_HANDOFF_LEDGER_SCHEMA||typeof s.namespace!=='string'||!s.namespace||s.namespace.length>300||s.authority!=='none'||!Array.isArray(s.records)||s.records.length>MANUAL_HANDOFF_LEDGER_LIMIT)fail('HANDOFF_LEDGER_SCHEMA');
 const ids=new Set(),bindings=new Set();for(const r of s.records){if(!exact(r,'id,binding,paperId,projectId,kind,clipboard')||!id(r.id)||!hash(r.binding)||!id(r.paperId)||!(r.projectId===''||id(r.projectId))||!['initial','step_input'].includes(r.kind)||!['pending','copied','unknown'].includes(r.clipboard)||ids.has(r.id)||bindings.has(r.binding))fail('HANDOFF_LEDGER_RECORD');ids.add(r.id);bindings.add(r.binding)}return true;
}
export async function exportManualHandoffLedger(input,crypto=globalThis.crypto){const state=clone(input);validateManualHandoffLedger(state);return JSON.stringify({...state,integritySha256:await sha256(JSON.stringify(state),crypto)})}
export async function loadManualHandoffLedger(raw,namespace,crypto=globalThis.crypto){
 if(typeof raw!=='string'||new TextEncoder().encode(raw).length>200000)fail('HANDOFF_LEDGER_SIZE');let data;try{data=JSON.parse(raw)}catch{fail('HANDOFF_LEDGER_JSON')}
 if(!exact(data,'schema,namespace,authority,records,integritySha256')||!hash(data.integritySha256))fail('HANDOFF_LEDGER_SCHEMA');const {integritySha256,...state}=data;validateManualHandoffLedger(state);if(state.namespace!==namespace)fail('HANDOFF_LEDGER_NAMESPACE');if(await sha256(JSON.stringify(state),crypto)!==integritySha256)fail('HANDOFF_LEDGER_HASH');return state;
}
export function appendManualHandoffIntent(input,intent){const state=clone(input);validateManualHandoffLedger(state);if(state.records.some(r=>r.binding===intent?.binding||r.id===intent?.id))fail('HANDOFF_LEDGER_DUPLICATE');if(state.records.length>=MANUAL_HANDOFF_LEDGER_LIMIT)fail('HANDOFF_LEDGER_FULL');if(intent?.clipboard!=='pending')fail('HANDOFF_LEDGER_PENDING_REQUIRED');state.records.push(clone(intent));validateManualHandoffLedger(state);return state}
export function settleManualHandoffIntent(input,id,clipboard){const state=clone(input);validateManualHandoffLedger(state);const r=state.records.find(r=>r.id===id);if(!r||r.clipboard!=='pending'||!['copied','unknown'].includes(clipboard))fail('HANDOFF_LEDGER_SETTLE');r.clipboard=clipboard;return state}
export function manualHandoffLedgerView(state){validateManualHandoffLedger(state);return {namespace:state.namespace,authority:'none',originalsIncluded:false,restoresOriginals:false,records:state.records.map(r=>({...r,displayState:r.clipboard==='pending'?'unknown':r.clipboard,needsManualCheck:r.clipboard!=='copied'}))}}
