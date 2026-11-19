export function makeSrcdoc({bundle,scriptHash}){
 if(typeof bundle!=='string'||typeof scriptHash!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(scriptHash))throw Error('INVALID_SRCDOC_CONFIG');
 // Bundle already has closing script tokens escaped before the build-time hash.
 if(/<\/script/i.test(bundle))throw Error('UNESCAPED_BUNDLE');
 const csp=`default-src 'none'; script-src 'sha256-${scriptHash}'; connect-src 'none'; worker-src blob:; child-src 'none'; img-src 'none'; style-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
 return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body><p>受限 PDF 文本提取；无账户或存储。</p><script type="module">${bundle}</script></body></html>`;
}
