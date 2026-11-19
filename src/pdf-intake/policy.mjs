// Pure shared boundary logic. Does not establish Worker or network isolation.
export const LEGACY_PDF_TEXT=Object.freeze({maxPages:50,maxChars:16000});
// Keep retained text within the document and archive contract; original bytes live in IndexedDB.
export const LIMITS=Object.freeze({maxBytes:32*1024*1024,maxPages:300,maxChars:200000,maxTextBytes:512*1024,timeoutMs:60000});
export const PAGE_IMAGE_LIMITS=Object.freeze({width:1200,height:1600,bytes:8*1024*1024});
export function checkBytes(bytes){if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>LIMITS.maxBytes)throw Error('PDF_SIZE_LIMIT');if(new TextDecoder('ascii').decode(bytes.subarray(0,5))!=='%PDF-')throw Error('NOT_PDF')}
export function validPdfText(text,{allowEmpty=false}={}){
 if(typeof text!=='string'||(!allowEmpty&&!text.trim())||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))return false;
 for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const n=text.charCodeAt(++i);if(!(n>=0xdc00&&n<=0xdfff))return false}else if(c>=0xdc00&&c<=0xdfff)return false}
 return true;
}
// The limit is UTF-16 units, but truncation must never split a Unicode code point.
function boundedText(text,limit){let end=Math.max(0,limit);if(end<text.length&&end>0&&text.charCodeAt(end-1)>=0xd800&&text.charCodeAt(end-1)<=0xdbff)end--;return text.slice(0,end)}
export async function extractText(document,{signal,onProgress=()=>{},race=p=>p,includePageSpans=false,legacy=false}={}){
 const check=()=>{if(signal?.aborted)throw Error('PDF_CANCELLED')};check();
 const {maxPages,maxChars}=legacy?LEGACY_PDF_TEXT:LIMITS;
 const encoder=new TextEncoder();let retainedBytes=0;
 if(!Number.isInteger(document.numPages)||document.numPages<1||document.numPages>maxPages)throw Error('PDF_PAGE_LIMIT');
 let text='',truncated=false,pagesRead=0;
 const pageSpans=[];
 for(let i=1;i<=document.numPages;i++){
  check();const page=await race(document.getPage(i));
  try{
   check();const content=await race(page.getTextContent());check();
   const prefix=`\n\n[PDF page ${i}]\n`;let pageText='',trailing='';
   for(const item of content.items){
    check();if(typeof item.str!=='string')continue;
    // Some PDF fonts map glyphs to control codes. Mark them visibly rather than joining words.
    const glyphs=legacy?item.str:item.str.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'\ufffd').toWellFormed();
    if(!validPdfText(glyphs,{allowEmpty:true}))throw Error('PDF_INVALID_TEXT');
    const part=(pageText?glyphs:glyphs.trimStart())+(item.hasEOL?'\n':' '),body=part.trimEnd(),cap=maxChars+1-pageText.length;
    // Retain only bounded pending whitespace. Trailing/empty-page whitespace is
    // discarded, and must not consume the retained-text budget or hide later pages.
    if(!body){if(pageText)trailing=(trailing+part.slice(0,cap)).slice(0,cap);continue}
    const addition=trailing+body;pageText+=addition.slice(0,cap);trailing=part.slice(body.length,body.length+maxChars+1-pageText.length);
    if(addition.length>cap||pageText.length>maxChars){truncated=true;break;}
   }
   if(pageText.trim()){
    const start=text.length+prefix.length;
    const room=maxChars-text.length,addition=prefix+pageText.trim();let retained=boundedText(addition,room);
    if(!legacy){
     const roomBytes=LIMITS.maxTextBytes-retainedBytes;
     if(encoder.encode(retained).length>roomBytes){
      let size=0,end=0;
      for(const cp of retained){size+=encoder.encode(cp).length;if(size>roomBytes)break;end+=cp.length}
      retained=retained.slice(0,end);truncated=true;
     }
     retainedBytes+=encoder.encode(retained).length;
    }
    if(legacy||retained.length>prefix.length)text+=retained;
    if(addition.length>room)truncated=true;
    // Only text read from the page enters its span. The display heading is generated.
    if(includePageSpans&&start<text.length)pageSpans.push({page:i,start,end:text.length});
   }
   pagesRead=i;onProgress({page:i,pages:document.numPages});
  }finally{page.cleanup()}
  if(text.length>=maxChars||truncated){truncated=truncated||i<document.numPages;break;}
 }
 check();if(!text.trim())throw Error('PDF_NO_TEXT_NO_OCR');if(!validPdfText(text))throw Error('PDF_INVALID_TEXT');
 const trimmed=text.trim(),result={text:trimmed,pages:document.numPages,pagesRead,truncated};
 if(!includePageSpans)return result;
 const leading=text.length-text.trimStart().length;
 result.pageSpans=pageSpans.map(({page,start,end})=>({
  page,start:start-leading,end:Math.min(end-leading,trimmed.length),
 })).filter(span=>span.start<span.end);
 return result;
}

export function pdfExcerptLocation(result,start,end){
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=end||end>result.text.length
    ||!Array.isArray(result.pageSpans)||result.pageSpans.length>result.pagesRead)throw Error('PDF_SOURCE_MISMATCH');
 let lastPage=0,lastEnd=0,covered=0;
 const pages=[];
 for(const span of result.pageSpans){
  if(!span||Object.keys(span).length!==3||!Number.isSafeInteger(span.page)||span.page<=lastPage||span.page>result.pagesRead
     ||!Number.isSafeInteger(span.start)||!Number.isSafeInteger(span.end)||span.start<lastEnd
     ||span.start>=span.end||span.end>result.text.length)throw Error('PDF_SOURCE_MISMATCH');
  const overlap=Math.min(end,span.end)-Math.max(start,span.start);
  if(overlap>0){pages.push(span.page);covered+=overlap}
  lastPage=span.page;lastEnd=span.end;
 }
 if(!pages.length)throw Error('PDF_SOURCE_PAGE_MISSING');
 return {pages,includesDisplayText:covered!==end-start};
}

// Bind offsets to exact saved text; original-page verification still reopens and hashes the PDF.
export function checkPdfTextIndex(text,index){
 if(!index||Object.keys(index).sort().join(',')!=='pageSpans,pages,pagesRead,truncated,version'||index.version!==2
  ||!Number.isInteger(index.pages)||index.pages<1||index.pages>LIMITS.maxPages||!Number.isInteger(index.pagesRead)||index.pagesRead<1||index.pagesRead>index.pages
  ||typeof index.truncated!=='boolean'||(!index.truncated&&index.pagesRead!==index.pages)
  ||!Array.isArray(index.pageSpans)||!index.pageSpans.length)throw Error('PDF_SOURCE_MISMATCH');
 pdfExcerptLocation({...index,text},0,text.length);
 let previous=0;
 for(const span of index.pageSpans){
  const prefix=(previous?'\n\n':'')+'[PDF page '+span.page+']\n';
  if(text.slice(previous,span.start)!==prefix)throw Error('PDF_SOURCE_MISMATCH');
  previous=span.end;
 }
 if(previous!==text.length)throw Error('PDF_SOURCE_MISMATCH');
 return index;
}
export function pdfPageRange(document,first,last=first){
 const index=checkPdfTextIndex(document.text,document.pdfText);
 if(!Number.isInteger(first)||!Number.isInteger(last)||first<1||last<first||last>index.pagesRead)throw Error('PDF_SOURCE_PAGE_MISSING');
 const spans=index.pageSpans.filter(span=>span.page>=first&&span.page<=last);
 if(!spans.length)throw Error('PDF_SOURCE_PAGE_MISSING');
 const left=spans[0];const start=left.start-('[PDF page '+left.page+']\n').length;
 return {start,end:spans.at(-1).end,pages:spans.map(span=>span.page)};
}
