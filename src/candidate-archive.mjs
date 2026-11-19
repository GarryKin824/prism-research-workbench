/** Local, plaintext, unverified metadata snapshots. No network/library mutation. */
const CANDIDATE_ARCHIVE_LIMIT=1048576;
function candidateArchiveError(code){throw Object.assign(new Error(code),{code})}
function caObject(x,keys){return x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===keys.split(',').sort().join(',')}
function caText(x,max,nonempty=false){return typeof x==='string'&&x.length<=max&&(!nonempty||!!x.trim())&&!/[\x00-\x1f\x7f]/.test(x)&&!Array.from(x).some(c=>c.length===1&&/[\ud800-\udfff]/.test(c))}
function caDoi(x){return caText(x,500,true)&&x===x.trim().toLowerCase()&&/^10\.\d{4,9}\/[^\s<>?#]+$/.test(x)}
function caDate(x){if(typeof x!=='string'||x.length!==24)return false;try{return new Date(x).toISOString()===x}catch{return false}}
function caValidate(x){
 if(!caObject(x,'schema,provider,exportedAt,query,candidates,importedDois,memoryDois,stateScope,readOnly,fullTextRead,researchVerified,executionAllowed,dataAvailability,codeAvailability')||x.schema!=='prism-candidate-archive/v1'||x.provider!=='Crossref'||x.stateScope!=='export-time-unverified'||x.readOnly!==true||x.fullTextRead!==false||x.researchVerified!==false||x.executionAllowed!==false||x.dataAvailability!=='unknown'||x.codeAvailability!=='unknown'||!caDate(x.exportedAt)||!caText(x.query,300,true)||x.query!==x.query.trim())candidateArchiveError('CANDIDATE_ARCHIVE_SCHEMA');
 if(!Array.isArray(x.candidates)||x.candidates.length>10)candidateArchiveError('CANDIDATE_ARCHIVE_ITEMS');
 const dois=new Set();
 for(const c of x.candidates){
  if(!caObject(c,'doi,title,authors,year,abstract,links,retrievedAt,query')||!caDoi(c.doi)||dois.has(c.doi)||!caText(c.title,500,true)||!caText(c.abstract,12000)||!caDate(c.retrievedAt)||c.query!==x.query||!(c.year===null||Number.isInteger(c.year)&&c.year>=1000&&c.year<=3000)||!Array.isArray(c.authors)||c.authors.length>20||!c.authors.every(a=>caText(a,300,true))||!Array.isArray(c.links)||c.links.length>10)candidateArchiveError('CANDIDATE_ARCHIVE_ITEM');
  dois.add(c.doi);const urls=new Set();for(const l of c.links){if(!caObject(l,'url,type')||!caText(l.url,2000,true)||!caText(l.type,60,true)||urls.has(l.url))candidateArchiveError('CANDIDATE_ARCHIVE_LINK');try{const u=new URL(l.url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)candidateArchiveError('CANDIDATE_ARCHIVE_LINK')}catch{candidateArchiveError('CANDIDATE_ARCHIVE_LINK')}urls.add(l.url)}
 }
 for(const list of [x.importedDois,x.memoryDois])if(!Array.isArray(list)||list.length>10||new Set(list).size!==list.length||!list.every(d=>dois.has(d)))candidateArchiveError('CANDIDATE_ARCHIVE_STATE');
 if(!x.memoryDois.every(d=>x.importedDois.includes(d)))candidateArchiveError('CANDIDATE_ARCHIVE_STATE');
 return x;
}
export function parseCandidateArchive(raw){
 if(typeof raw!=='string'||new TextEncoder().encode(raw).length>CANDIDATE_ARCHIVE_LIMIT)candidateArchiveError('CANDIDATE_ARCHIVE_SIZE');
 let x;try{x=JSON.parse(raw)}catch{candidateArchiveError('CANDIDATE_ARCHIVE_JSON')}
 return caValidate(x);
}
export function createCandidateArchive({query,candidates,importedDois=[],memoryDois=[]}){
 // UI status arrays can include prior query items: only this batch is represented.
 for(const a of [importedDois,memoryDois])if(!Array.isArray(a)||a.length>1000||!a.every(caDoi))candidateArchiveError('CANDIDATE_ARCHIVE_STATE');
 if(!Array.isArray(candidates))candidateArchiveError('CANDIDATE_ARCHIVE_ITEMS');
 const ids=new Set(candidates.map(c=>c?.doi)),memory=[...new Set(memoryDois.filter(d=>ids.has(d)))],imported=[...new Set([...importedDois.filter(d=>ids.has(d)),...memory])];
 const packet=caValidate({schema:'prism-candidate-archive/v1',provider:'Crossref',exportedAt:new Date().toISOString(),query,candidates,importedDois:imported,memoryDois:memory,stateScope:'export-time-unverified',readOnly:true,fullTextRead:false,researchVerified:false,executionAllowed:false,dataAvailability:'unknown',codeAvailability:'unknown'});
 let raw;try{raw=JSON.stringify(packet)}catch{candidateArchiveError('CANDIDATE_ARCHIVE_JSON')}
 parseCandidateArchive(raw);return raw;
}
