// Read-only projection of already admitted bibliography; never fetches or writes.
export function sourceTraceRows(paper){
 const m=paper?.metadata;if(!m)return [];
 if(m.zotero){
  const z=m.zotero;
  return [{label:'Zotero',mode:'zotero-local',recordId:z.libraryType+':'+z.libraryId+':'+z.itemKey,
   retrievedAt:m.retrievedAt,query:'',fileSha256:null,recordNumber:null}];
 }
 if(!m.discovery)return [{label:m.provider||'未知来源',mode:'public-metadata',recordId:m.doi||'',retrievedAt:m.retrievedAt||'',query:m.query||'',fileSha256:null,recordNumber:null}];
 return (m.discovery.provenance||[]).slice(0,10).map(p=>{const match=p.mode==='local-file'&&/^sha256:([a-f0-9]{64}):([1-9]\d*)$/.exec(p.recordId);return {label:p.sourceLabel,sourceId:p.sourceId,mode:p.mode,recordId:p.recordId,retrievedAt:p.retrievedAt,query:p.query,fileSha256:match?match[1]:null,recordNumber:match?match[2]:null}});
}
export async function matchSourceFile(file,expected,crypto=globalThis.crypto){
 if(!/^[a-f0-9]{64}$/.test(expected))throw Error('INVALID_EXPECTED_HASH');
 if(!file||!Number.isSafeInteger(file.size)||file.size<1||file.size>1048576||typeof file.arrayBuffer!=='function')throw Error('FILE_SIZE_OR_READER');
 const bytes=await file.arrayBuffer();if(!(bytes instanceof ArrayBuffer)||bytes.byteLength!==file.size||bytes.byteLength>1048576)throw Error('FILE_CHANGED');
 const digest=await crypto.subtle.digest('SHA-256',bytes),hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 if(!/^[a-f0-9]{64}$/.test(hash))throw Error('HASH_UNAVAILABLE');
 return Object.freeze({matched:hash===expected,sha256:hash,bytes:bytes.byteLength});
}
