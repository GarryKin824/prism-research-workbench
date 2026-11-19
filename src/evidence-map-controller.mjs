import * as evidenceMapCore from './evidence-map-core.mjs';
import {sha256} from './custom-core.mjs';
export function createEvidenceMapController({store,storage,crypto=globalThis.crypto,withLock}){
 const namespace=store.getStorageKey(),key=namespace+':evidence-map-v1';let baseline=null,openingError=null,state=null,ready=false,unknown=null,confirming=false;const issued=new WeakMap();
 try{baseline=storage.getItem(key);}catch(cause){openingError=cause}
 const check=()=>{if(unknown)throw unknown;if(openingError)throw openingError;store.assertCurrentStorage();if(store.getStorageKey()!==namespace||storage.getItem(key)!==baseline)throw Error('EVIDENCE_MAP_STORAGE_CONFLICT')};
 async function initialize(){check();const expected=baseline,next=baseline===null?await evidenceMapCore.createEvidenceMap({namespace},crypto):await evidenceMapCore.loadEvidenceMap(baseline,{namespace},crypto);check();if(baseline!==expected)throw Error('EVIDENCE_MAP_STORAGE_CONFLICT');state=next;ready=true;return JSON.parse(JSON.stringify(state))}
 async function snapshot(){check();if(!ready)throw Error('EVIDENCE_MAP_NOT_READY');const savedBaseline=baseline,raw=JSON.stringify(store.getSnapshot().papers),papers=JSON.parse(raw),sources=[];for(const paper of papers)sources.push({namespace,paperId:paper.id,title:paper.title,documentSha256:paper.document?.sha256||null,snapshotSha256:await sha256(JSON.stringify(paper),crypto)});function stable(){check();if(baseline!==savedBaseline)throw Error('EVIDENCE_MAP_STORAGE_CONFLICT');if(JSON.stringify(store.getSnapshot().papers)!==raw)throw Error('EVIDENCE_MAP_SOURCE_CHANGED')}stable();return {state:JSON.parse(JSON.stringify(state)),sources,rows:evidenceMapCore.evidenceMapView(state,{sources}),stable}}
 async function prepare(paperId,fields,expectedSource){
  fields=JSON.parse(JSON.stringify(fields));expectedSource=JSON.parse(JSON.stringify(expectedSource));
  const s=await snapshot(),source=s.sources.find(x=>x.paperId===paperId);if(!source)throw Error('EVIDENCE_MAP_PAPER_MISSING');if(JSON.stringify(source)!==JSON.stringify(expectedSource))throw Error('EVIDENCE_MAP_EDIT_SOURCE_CHANGED');
  const preview=await evidenceMapCore.prepareRevision(state,{source,fields},crypto);s.stable();
  issued.set(preview,{display:JSON.stringify(preview),baseline,stable:s.stable});return preview;
 }
 async function confirm(preview,isCurrent=()=>true){
  check();if(confirming)throw Error('EVIDENCE_MAP_BUSY');if(!withLock)throw Error('WEB_LOCKS_REQUIRED');
  const t=issued.get(preview),stable=()=>{check();if(!t||issued.get(preview)!==t||t.baseline!==baseline||JSON.stringify(preview)!==t.display)throw Error('EVIDENCE_MAP_PREVIEW_EXPIRED');t.stable();if(isCurrent()!==true)throw Error('EVIDENCE_MAP_OPERATION_EXPIRED')};
  stable();confirming=true;
  try{return await withLock(namespace+':evidenceMap-write',async()=>{stable();const fixed=JSON.parse(t.display),next=await evidenceMapCore.confirmRevision(state,fixed,{source:fixed.source},crypto),raw=await evidenceMapCore.exportEvidenceMap(next,crypto);stable();
   try{storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw Error('EVIDENCE_MAP_READBACK_MISMATCH')}
   catch(cause){unknown=Error('EVIDENCE_MAP_SAVE_UNKNOWN_RELOAD_REQUIRED',{cause});throw unknown}
   baseline=raw;state=next;issued.delete(preview);return JSON.parse(JSON.stringify(state))
  })}finally{confirming=false}
 }

 async function exportData(format){const s=await snapshot(),raw=format==='csv'?await evidenceMapCore.exportCSV(state,{sources:s.sources},crypto):await evidenceMapCore.exportEvidenceMap(state,crypto);s.stable();return raw}
 async function inspectBackup(raw){return evidenceMapCore.importEvidenceMap(raw,crypto)}
 return {initialize,snapshot,prepare,confirm,exportData,inspectBackup};
}
