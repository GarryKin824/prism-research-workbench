// Only explicitly selected local TXT/Markdown. Never fetches or executes file content.
async function readLocalPaper(file){
 const fail=code=>{throw new Error(code)};
 if(!file||typeof file.name!=='string'||!(/\.(txt|md)$/i).test(file.name)||file.name.length>255||/[\x00-\x1f\x7f/\\]/.test(file.name))fail('UNSUPPORTED_FILE');
 if(!Number.isSafeInteger(file.size)||file.size<1||file.size>524288)fail('FILE_TOO_LARGE');
 const name=file.name,size=file.size;
 const bytes=await file.arrayBuffer();if(file.name!==name||file.size!==size)fail('FILE_CHANGED');if(bytes.byteLength!==size)fail('FILE_SIZE_CHANGED');
 let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)}catch{fail('INVALID_UTF8')}
 if(text.length>200000||!text.trim()||/^[\uFEFF\s]*%PDF-/.test(text)||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))fail('INVALID_TEXT_FILE');
 return {title:file.name.replace(/\.(txt|md)$/i,''),source:'用户选择的本地文本文件',document:{text,filename:file.name,mime:/\.md$/i.test(file.name)?'text/markdown':'text/plain',byteLength:bytes.byteLength}};
}
