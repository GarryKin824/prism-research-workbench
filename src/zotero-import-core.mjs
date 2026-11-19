import { LIMITS } from './pdf-intake/policy.mjs';
import { EXECUTOR, hash } from './pdf-intake/protocol.mjs';

export const ZOTERO_ROUTE = '/api/prism-zotero';
export const ZOTERO_PAGE_SIZE = 25;
export const ZOTERO_BATCH_SIZE = 5;
export const zoteroKey = value => typeof value === 'string' && /^[A-Z0-9]{8}$/.test(value);
export const zoteroServerId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
export const zoteroLibraryId = value => Number.isSafeInteger(value) && value >= 0;
export const zoteroText = (value, max) => typeof value === 'string'
  ? value.replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,max).trimEnd().toWellFormed() : '';
export const zoteroFilename = value => typeof value === 'string' && value.length <= 255 && /\.pdf$/i.test(value)
  && !/[\\/\x00-\x1f\x7f]/.test(value);
const text = (value,max) => typeof value === 'string' && value === zoteroText(value,max);
const exact = (value,keys) => value && typeof value === 'object' && Object.keys(value).sort().join(',') === keys;

export function normalizeDoi(value) {
  if (typeof value !== 'string' || value.length > 1000) return null;
  let doi=value.trim();
  try {
    if (/^https?:\/\//i.test(doi)) {
      const url=new URL(doi);
      if (!['doi.org','dx.doi.org'].includes(url.hostname.toLowerCase()) || url.username || url.password || url.port) return null;
      doi=url.pathname.slice(1);
    } else doi=doi.replace(/^doi:\s*/i,'');
    doi=decodeURIComponent(doi).toLowerCase();
  } catch { return null; }
  return doi.length<=500 && /^10\.\d{4,9}\/[^\s<>?#\x00-\x1f\x7f]+$/.test(doi) ? doi : null;
}

export function safeZoteroUrl(value) {
  if (typeof value !== 'string' || value.length > 2000 || /[\x00-\x20\x7f]/.test(value)) return '';
  try {
    const url=new URL(value);
    return ['http:','https:'].includes(url.protocol) && !url.username && !url.password ? value : '';
  } catch { return ''; }
}

export function zoteroDuplicate(papers, metadata) {
  const source=metadata.zotero;
  const same=papers.find(paper => {
    const old=paper.metadata?.zotero;
    return old && old.serverId===source.serverId && old.libraryType===source.libraryType
      && old.libraryId===source.libraryId && old.itemKey===source.itemKey;
  });
  if (same) return {kind:'item',paper:same};
  const doi=metadata.doi && papers.find(paper => !paper.metadata?.discovery?.simulation
    && [paper.doi,paper.source,paper.metadata?.doi,paper.metadata?.crossref?.doi].some(value=>normalizeDoi(value)===metadata.doi));
  return doi ? {kind:'doi',paper:doi} : null;
}

export function zoteroSourceLabel(metadata) {
  const source=metadata.zotero;
  return metadata.doi ? 'https://doi.org/'+metadata.doi
    : 'Zotero · '+(source.libraryType==='user'?'个人库':'群组库 '+source.libraryId)+' · '+source.itemKey;
}

export function zoteroMetadata(item, attachments, original=null, extraction=null) {
  const {title,libraryType,libraryId,itemKey,itemVersion,serverId,...fields}=item;
  const {url,...bibliography}=fields;
  return {
    provider:'Zotero',...bibliography,links:url?[{url,type:'bibliographic'}]:[],retrievedAt:new Date().toISOString(),
    zotero:{libraryType,libraryId,itemKey,itemVersion,serverId,attachments,original,extraction},
  };
}

export function zoteroPdfExtraction(preview) {
  const m=preview.metadata;
  return {textSha256:m.textSha256,pages:m.pages,pagesRead:m.pagesRead,truncated:m.truncated,
    parser:'PDF.js 6.3.289 derived classic',executor:m.actualExecutor,ocrPerformed:false};
}

export function validateZoteroMetadata(metadata, document=null) {
  const fail=()=>{throw Error('INVALID_ZOTERO_SOURCE')};
  if (!exact(metadata,'abstract,authors,doi,issue,links,pages,provider,publication,retrievedAt,volume,year,zotero')
      || metadata.provider!=='Zotero' || metadata.doi!==null && normalizeDoi(metadata.doi)!==metadata.doi
      || !Array.isArray(metadata.authors) || metadata.authors.length>100 || !metadata.authors.every(name=>name && text(name,300))
      || metadata.year!==null && (!Number.isInteger(metadata.year) || metadata.year<1000 || metadata.year>9999)
      || !text(metadata.abstract,12000) || !['publication','volume','issue','pages'].every(key=>text(metadata[key],500))
      || !Array.isArray(metadata.links) || metadata.links.length>1 || !metadata.links.every(link=>exact(link,'type,url')
        && link.type==='bibliographic' && safeZoteroUrl(link.url))
      || typeof metadata.retrievedAt!=='string' || !Number.isFinite(Date.parse(metadata.retrievedAt))
      || new Date(metadata.retrievedAt).toISOString()!==metadata.retrievedAt) fail();
  const z=metadata.zotero;
  if (!exact(z,'attachments,extraction,itemKey,itemVersion,libraryId,libraryType,original,serverId')
      || !['user','group'].includes(z.libraryType) || !zoteroLibraryId(z.libraryId) || z.libraryType==='group' && !z.libraryId
      || !zoteroKey(z.itemKey) || !zoteroLibraryId(z.itemVersion) || z.serverId!==null && !zoteroServerId(z.serverId)
      || !Array.isArray(z.attachments) || z.attachments.length>100) fail();
  const keys=new Set();
  for (const entry of z.attachments) {
    if (!exact(entry,'key,label,mode,version') || !zoteroKey(entry.key) || keys.has(entry.key) || !text(entry.label,255)
        || !zoteroLibraryId(entry.version) || !['stored','unsupported'].includes(entry.mode)) fail();
    keys.add(entry.key);
  }
  const original=z.original;
  if (original!==null && (!exact(original,'attachmentKey,byteLength,filename,pdfSha256')
      || !z.attachments.some(a=>a.key===original.attachmentKey && a.mode==='stored')
      || !zoteroFilename(original.filename) || !hash(original.pdfSha256) || !Number.isInteger(original.byteLength)
      || original.byteLength<5 || original.byteLength>LIMITS.maxBytes)) fail();
  const extraction=z.extraction;
  if (extraction!==null && (!original || !exact(extraction,'executor,ocrPerformed,pages,pagesRead,parser,textSha256,truncated')
      || !hash(extraction.textSha256) || document?.sha256!==extraction.textSha256
      || !Number.isInteger(extraction.pages) || extraction.pages<1 || extraction.pages>LIMITS.maxPages
      || !Number.isInteger(extraction.pagesRead) || extraction.pagesRead<1 || extraction.pagesRead>extraction.pages
      || typeof extraction.truncated!=='boolean' || extraction.pagesRead<extraction.pages && !extraction.truncated
      || extraction.parser!=='PDF.js 6.3.289 derived classic' || extraction.executor!==EXECUTOR
      || extraction.ocrPerformed!==false)) fail();
}
