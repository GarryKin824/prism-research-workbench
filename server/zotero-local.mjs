import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  ZOTERO_ROUTE, ZOTERO_PAGE_SIZE, zoteroKey, zoteroLibraryId, zoteroServerId, zoteroText, zoteroFilename, normalizeDoi, safeZoteroUrl,
} from '../src/zotero-import-core.mjs';
import { LIMITS } from '../src/pdf-intake/policy.mjs';

const here='http://127.0.0.1:23119';
const noCache={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'};
const json=(data,status=200)=>Response.json(data,{status,headers:noCache});
const fail=(code,status=502)=>{throw Object.assign(Error(code),{code,status})};
const execute=promisify(execFile);

async function smallBody(response, limit) {
  if (!response.body) return '';
  const reader=response.body.getReader(), decoder=new TextDecoder();
  let size=0, text='';
  try {
    while (true) {
      const part=await reader.read();
      if (part.done) return text+decoder.decode();
      size+=part.value.byteLength;
      if (size>limit) fail('ZOTERO_RESPONSE_TOO_LARGE');
      text+=decoder.decode(part.value,{stream:true});
    }
  } finally {
    await reader.cancel().catch(()=>{});
  }
}

const serverFrom=response=>{
  const id=response.headers.get('Zotero-Server-ID');
  if (id!==null && !zoteroServerId(id)) fail('ZOTERO_UNSUPPORTED');
  return id;
};

function itemFrom(row, library, serverId) {
  const d=row?.data;
  if (!d || d.deleted || ['note','attachment','annotation'].includes(d.itemType)
      || !zoteroKey(row.key) || !zoteroLibraryId(row.version)) return null;
  const title=zoteroText(d.title,500);
  if (!title || library.type==='group' && row.library?.id!==library.id) return null;
  const permittedId=library.type==='user' && zoteroLibraryId(row.library?.id)?row.library.id:library.id;
  const creatorTypes=['author','editor','bookAuthor','inventor','programmer','performer','director','presenter','artist','sponsor'];
  const creators=Array.isArray(d.creators)?d.creators:[];
  const authorLike=creators.filter(author=>creatorTypes.includes(author?.creatorType));
  const primary=authorLike.some(author=>author.creatorType==='author')
    ? authorLike.filter(author=>author.creatorType==='author') : authorLike;
  const authors=primary.slice(0,100).map(author=>zoteroText(author.name
    || [author.firstName,author.lastName].filter(Boolean).join(' '),300)).filter(Boolean);
  return {
    title,libraryType:library.type,libraryId:permittedId,itemKey:row.key,itemVersion:row.version,serverId,
    authors,year:Number(/\b[1-9]\d{3}\b/.exec(d.date??'')?.[0])||null,doi:normalizeDoi(d.DOI),
    abstract:zoteroText(d.abstractNote,12000),publication:zoteroText(d.publicationTitle||d.bookTitle||d.proceedingsTitle||d.publisher,500),
    volume:zoteroText(d.volume,500),issue:zoteroText(d.issue,500),pages:zoteroText(d.pages,500),url:safeZoteroUrl(d.url),
  };
}

function pdfAttachment(row, parentKey) {
  const d=row?.data;
  if (d?.itemType!=='attachment' || d.deleted || d.parentItem!==parentKey || !zoteroKey(row.key) || !zoteroLibraryId(row.version)) return null;
  const name=zoteroText(d.filename||d.title,255);
  const pdf=d.contentType==='application/pdf' || /\.pdf$/i.test(name);
  const stored=['imported_file','imported_url'].includes(d.linkMode) && d.contentType==='application/pdf';
  return {key:row.key,version:row.version,label:name||'未命名附件',mode:stored?'stored':'unsupported',pdf};
}

async function readStoredPdf(location, key, signal) {
  let filename;
  try {
    const fileUrl=new URL(location);
    if (fileUrl.protocol!=='file:' || fileUrl.hostname || fileUrl.search || fileUrl.hash) fail('ZOTERO_PDF_UNSUPPORTED',422);
    filename=fileURLToPath(fileUrl);
  } catch { fail('ZOTERO_PDF_UNSUPPORTED',422); }
  const root=path.parse(filename).root;
  const parts=filename.slice(root.length).split(path.sep);
  const name=parts.at(-1);
  if (parts.length<3 || parts.at(-3).toLowerCase()!=='storage' || parts.at(-2)!==key || !zoteroFilename(name)
      || parts.some(part=>!part || part==='.' || part==='..' || process.platform==='win32' && /[:.]$|:| $/.test(part))) {
    fail('ZOTERO_PDF_UNSUPPORTED',422);
  }
  if (process.platform==='win32') {
    if (!/^[a-z]:\\$/i.test(root)) fail('ZOTERO_PDF_UNSUPPORTED',422);
    // Reject network/mapped drives before asking the filesystem for any path on them.
    const inspect=`
$candidate=$env:PRISM_ZOTERO_PDF_PATH
$root=[IO.Path]::GetPathRoot($candidate)
if ([IO.DriveInfo]::new($root).DriveType -ne [IO.DriveType]::Fixed) { 'unsupported'; exit }
$cursor=$root
foreach ($component in $candidate.Substring($root.Length).Split([IO.Path]::DirectorySeparatorChar)) {
  $cursor=[IO.Path]::Combine($cursor,$component)
  try { $attributes=[int][IO.File]::GetAttributes($cursor) } catch {
    $errorType=$_.Exception.GetBaseException()
    if ($errorType -is [IO.FileNotFoundException] -or $errorType -is [IO.DirectoryNotFoundException]) { 'missing'; exit }
    'unavailable'; exit
  }
  if ($attributes -band 0x441400) { 'unsupported'; exit }
}
'local'
`;
    // Reject reparse points and offline/recall-on-access files before opening the PDF.
    const {stdout}=await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',inspect],
      {signal,windowsHide:true,maxBuffer:1024,env:{...process.env,PRISM_ZOTERO_PDF_PATH:filename}});
    const verdict=stdout.trim();
    if (verdict==='missing') fail('ZOTERO_PDF_MISSING',404);
    if (verdict==='unavailable') fail('ZOTERO_PDF_NOT_READABLE',422);
    if (verdict!=='local') fail('ZOTERO_PDF_UNSUPPORTED',422);
  }
  try {
    let cursor=root;
    for (const [index,part] of parts.entries()) {
      signal.throwIfAborted();
      cursor=path.join(cursor,part);
      const info=await lstat(cursor);
      if (info.isSymbolicLink() || (index===parts.length-1 ? !info.isFile() : !info.isDirectory())) {
        fail('ZOTERO_PDF_UNSUPPORTED',422);
      }
    }
    const file=await open(filename,constants.O_RDONLY | (constants.O_NOFOLLOW??0) | (constants.O_NONBLOCK??0));
    try {
      const before=await file.stat();
      if (!before.isFile() || before.size<5) fail('ZOTERO_PDF_INVALID',422);
      if (before.size>LIMITS.maxBytes) fail('ZOTERO_PDF_TOO_LARGE',413);
      const bytes=Buffer.alloc(before.size);
      let done=0;
      while (done<bytes.length) {
        signal.throwIfAborted();
        const {bytesRead}=await file.read(bytes,done,bytes.length-done,done);
        if (!bytesRead) fail('ZOTERO_PDF_CHANGED',409);
        done+=bytesRead;
      }
      const after=await file.stat(), current=await lstat(filename);
      if (!current.isFile() || before.ino!==current.ino || before.dev!==current.dev || before.size!==after.size
          || before.mtimeMs!==current.mtimeMs || before.mtimeMs!==after.mtimeMs) fail('ZOTERO_PDF_CHANGED',409);
      if (bytes.subarray(0,5).toString('ascii')!=='%PDF-') fail('ZOTERO_PDF_INVALID',422);
      return {name,bytes};
    } finally { await file.close(); }
  } catch (error) {
    if (error.code==='ENOENT') fail('ZOTERO_PDF_MISSING',404);
    if (error.code==='EACCES' || error.code==='EPERM') fail('ZOTERO_PDF_NOT_READABLE',422);
    throw error;
  }
}

export function createZoteroHandler({admit,fetchLocal=globalThis.fetch,timeoutMs=5000}) {
  async function local(endpoint,signal,expected,mode='json') {
    const headers={'Zotero-API-Version':'3'};
    if (expected) headers['Zotero-Server-ID']=expected;
    let response;
    try {
      response=await fetchLocal(new URL('/api/'+endpoint,here),{method:'GET',redirect:'manual',headers,signal});
    } catch {
      if (signal.aborted) throw signal.reason;
      fail('ZOTERO_UNREACHABLE',503);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(()=>{});
      const status=response.status;
      if (status===403) fail('ZOTERO_DISABLED',403);
      if (status===412) fail('ZOTERO_LIBRARY_CHANGED',409);
      if (status===404) fail(mode==='file'?'ZOTERO_PDF_UNSUPPORTED':'ZOTERO_NOT_FOUND',404);
      if (status===400 && mode==='file') fail('ZOTERO_PDF_MISSING',404);
      fail('ZOTERO_UNSUPPORTED');
    }
    if (response.headers.get('Zotero-API-Version')!=='3') {
      await response.body?.cancel().catch(()=>{});
      fail('ZOTERO_UNSUPPORTED');
    }
    const serverId=serverFrom(response);
    if (expected!==undefined && serverId!==expected) {
      await response.body?.cancel().catch(()=>{});
      fail('ZOTERO_LIBRARY_CHANGED',409);
    }
    const body=await smallBody(response,mode==='file'?8192:mode==='status'?1024:2*1024*1024);
    if (mode!=='json') return {serverId,body};
    try { return {body:JSON.parse(body),total:Number(response.headers.get('Total-Results')??-1)}; }
    catch { fail('ZOTERO_UNSUPPORTED'); }
  }
  const rows=async(endpoint,signal,serverId)=>{
    const result=await local(endpoint,signal,serverId);
    if (!Array.isArray(result.body)) fail('ZOTERO_UNSUPPORTED');
    return result;
  };
  const groupLibraries=async(signal,serverId)=>{
    const {body,total}=await rows('users/0/groups?limit=100',signal,serverId);
    return {groups:body.flatMap(group=>zoteroLibraryId(group?.id) && group.id && zoteroText(group.data?.name,255)
      ? [{id:group.id,name:zoteroText(group.data.name,255)}]:[]),moreGroups:total>body.length};
  };
  return async function zotero(request) {
    if (request.method!=='GET' || request.headers.get('X-PRISM-Zotero')!=='read' || !admit(request)) return json({code:'ZOTERO_FORBIDDEN'},403);
    const {pathname,searchParams:p}=new URL(request.url);
    if (pathname!==ZOTERO_ROUTE || p.size>8) return json({code:'ZOTERO_INVALID'},400);
    const signal=AbortSignal.any([request.signal,AbortSignal.timeout(timeoutMs)]);
    try {
      const op=p.get('op');
      if (op==='connect') {
        const {serverId}=await local('',signal,undefined,'status');
        // Check a real library endpoint because a greeting alone cannot establish read access.
        await rows('users/0/items/top?limit=1',signal,serverId);
        let groups={groups:[],moreGroups:false},groupsUnavailable=false;
        try { groups=await groupLibraries(signal,serverId); }
        catch (error) {
          if (!['ZOTERO_UNSUPPORTED','ZOTERO_NOT_FOUND'].includes(error.code)) throw error;
          groupsUnavailable=true;
        }
        return json({apiVersion:3,serverId,...groups,groupsUnavailable});
      }
      const serverId=p.get('server')||null, group=p.get('group');
      if (!p.has('server') || serverId!==null && !zoteroServerId(serverId)
          || group!==null && (!/^\d{1,15}$/.test(group) || !Number(group))) fail('ZOTERO_INVALID',400);
      const library=group?{type:'group',id:Number(group)}:{type:'user',id:0};
      const section=group?'groups/'+group:'users/0';
      const folder=p.get('folder')||'', item=p.get('item')||'', attachment=p.get('attachment')||'';
      const start=Number(p.get('start')||0), query=p.get('q')||'';
      if ([folder,item,attachment].some(key=>key && !zoteroKey(key)) || !zoteroLibraryId(start)
          || start>1000000 || query.length>300) fail('ZOTERO_INVALID',400);
      if (op==='folders') {
        const endpoint=section+(folder?'/collections/'+folder+'/collections':'/collections/top');
        const {body,total}=await rows(endpoint+'?limit=100&start='+start,signal,serverId);
        return json({folders:body.flatMap(row=>zoteroKey(row?.key) && zoteroText(row.data?.name,255)
          ? [{key:row.key,name:zoteroText(row.data.name,255)}]:[]),
          next:(total<0?body.length===100:total>start+body.length)?start+body.length:null});
      }
      if (op==='items') {
        const endpoint=section+(folder?'/collections/'+folder:'')+'/items/top';
        const params=new URLSearchParams({limit:ZOTERO_PAGE_SIZE,start,sort:'title',direction:'asc',itemType:'-attachment'});
        if (query) params.set('q',query);
        const {body,total}=await rows(endpoint+'?'+params,signal,serverId);
        return json({items:body.map(row=>itemFrom(row,library,serverId)).filter(Boolean),
          next:(total<0?body.length===ZOTERO_PAGE_SIZE:total>start+body.length)?start+body.length:null});
      }
      if (!item || !['preview','pdf'].includes(op)) fail('ZOTERO_INVALID',400);
      const endpoint=section+'/items/'+item;
      const {body:parent}=await local(endpoint,signal,serverId);
      const entry=itemFrom(parent,library,serverId);
      if (!entry || entry.itemKey!==item) fail('ZOTERO_NOT_FOUND',404);
      if (op==='preview') {
        const {body,total}=await rows(endpoint+'/children?limit=100&itemType=attachment',signal,serverId);
        const attachments=body.map(row=>pdfAttachment(row,item)).filter(Boolean);
        return json({item:entry,attachments:attachments.filter(row=>row.pdf).map(({pdf,...row})=>row),
          otherAttachments:attachments.some(row=>!row.pdf),moreAttachments:total<0?body.length===100:total>body.length});
      }
      if (!attachment || !/^\d+$/.test(p.get('version')??'')) fail('ZOTERO_INVALID',400);
      const version=Number(p.get('version'));
      const {body}=await local(section+'/items/'+attachment,signal,serverId);
      const selected=pdfAttachment(body,item);
      if (!selected || selected.key!==attachment || selected.mode!=='stored') fail('ZOTERO_PDF_UNSUPPORTED',422);
      if (version!==selected.version) fail('ZOTERO_PDF_CHANGED',409);
      const {body:location}=await local(section+'/items/'+attachment+'/file/view/url',signal,serverId,'file');
      const {name,bytes}=await readStoredPdf(location,attachment,signal);
      return new Response(bytes,{headers:{...noCache,'Content-Type':'application/pdf','X-PRISM-Filename':encodeURIComponent(name)}});
    } catch (error) {
      if (signal.aborted) return json({code:'ZOTERO_TIMEOUT'},504);
      return json({code:error.status?error.code:'ZOTERO_UNAVAILABLE'},error.status||502);
    }
  };
}

export function admitZoteroBrowser(request, origin) {
  return typeof origin==='string' && /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(origin)
    && new URL(request.url).origin===origin && request.headers.get('host')===new URL(origin).host
    && request.headers.get('sec-fetch-site')==='same-origin'
    && [null,origin].includes(request.headers.get('origin'));
}
