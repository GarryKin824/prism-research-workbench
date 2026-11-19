import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { admitZoteroBrowser, createZoteroHandler } from '../server/zotero-local.mjs';
import { ZOTERO_ROUTE } from '../src/zotero-import-core.mjs';
import { AUTOMATIC_EXECUTION_PATH,AUTOMATIC_EXECUTION_STATUS_PATH,CODEX_READINESS_PATH } from '../src/execution-targets.mjs';
import { createCodexReadiness } from '../server/codex-readiness.mjs';
import { createCodexAutomaticAdapter } from '../server/codex-automatic.mjs';
import { createAutomaticExecutionGateway,createAutomaticHttpHandler } from '../server/automatic-execution.mjs';
import {Readable} from 'node:stream';
import path from 'node:path';

const root = new URL('../', import.meta.url);
const page = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="text-scale" content="scale">
<title>PRISM 本地开发预览</title>
<link rel="stylesheet" href="/preview.css">
<div id="app">正在打开工作台…</div>
<script src="/react.js"></script>
<script src="/react-dom.js"></script>
<script src="/bootstrap.js"></script>
<script src="/client.js"></script>
<script src="/mount.js"></script>
</html>`;
const bootstrap = `window.__PRISM_LOCAL_PROFILE__ = {
  storageNamespace: '44444444-4444-4444-8444-444444444404',
  required: true,
};
window.__PRISM_ZOTERO_LOCAL__ = true;
let pluginModule;
window.__ModuleLoader__ = { load(module) { pluginModule = module; } };`;
const mount = `const plugin = pluginModule.factory(name => {
  if (name !== 'react') throw Error('Unsupported preview dependency');
  return React;
});
const disposers = [];
plugin.apply({
  effect(operation) {
    for (const dispose of operation()) disposers.push(dispose);
  },
  slots: {
    inject(_name, operation) { return operation(); },
    register(meta, component) {
      if (meta.name === 'main') {
        const root = ReactDOM.createRoot(document.getElementById('app'));
        root.render(React.createElement(component));
      }
      return () => {};
    },
  },
});`;
const css = `html, body, #app { width:100%;height:100%;margin:0 }
body { background:#f4f5f3; font:0.9375rem/1.6 "Segoe UI","Microsoft YaHei UI",sans-serif }`;

export function createPreviewServer(zoteroOptions={}, {codexReadiness=createCodexReadiness(null),automatic=null}={}) {
  const scripts = new Map([
    ['/react.js', 'node_modules/react/umd/react.production.min.js'],
    ['/react-dom.js', 'node_modules/react-dom/umd/react-dom.production.min.js'],
    ['/client.js', 'lib/development-client.js'],
  ]);
  const text = new Map([
    ['/', ['text/html', page]],
    ['/preview.css', ['text/css', css]],
    ['/bootstrap.js', ['text/javascript', bootstrap]],
    ['/mount.js', ['text/javascript', mount]],
  ]);
  const zotero=createZoteroHandler({...zoteroOptions,admit:request=>admitZoteroBrowser(request,new URL(request.url).origin)});
  const automaticHttp=createAutomaticHttpHandler({automatic,admit:request=>{
    const origin=new URL(request.url).origin;
    return admitZoteroBrowser(request,origin)&&(request.method==='GET'||request.headers.get('origin')===origin);
  }});
  const server=createServer(async (request, response) => {
    const origin='http://127.0.0.1:'+server.address().port;
    if([AUTOMATIC_EXECUTION_PATH,AUTOMATIC_EXECUTION_STATUS_PATH].includes(request.url)){
      if(!['GET','POST'].includes(request.method)){response.writeHead(405).end();return}
      const abort=new AbortController();
      response.on('close',()=>abort.abort());
      const result=await automaticHttp(new Request(origin+request.url,{
        method:request.method,headers:request.headers,signal:abort.signal,
        ...(request.method==='POST'?{body:Readable.toWeb(request),duplex:'half'}:{}),
      }));
      if(!abort.signal.aborted)response.writeHead(result.status,Object.fromEntries(result.headers)).end(Buffer.from(await result.arrayBuffer()));
      return;
    }
    if(request.url===CODEX_READINESS_PATH){
      const abort=new AbortController();
      response.on('close',()=>abort.abort());
      const admitted=request.method==='GET'&&request.headers['x-prism-readiness']==='read'
        && admitZoteroBrowser(new Request(origin+CODEX_READINESS_PATH,{headers:request.headers}),origin);
      const result=admitted?await codexReadiness(abort.signal):{state:'unavailable'};
      if(!abort.signal.aborted)response.writeHead(admitted?200:403,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(result));
      return;
    }
    if (request.url===ZOTERO_ROUTE || request.url.startsWith(ZOTERO_ROUTE+'?')) {
      if (request.method!=='GET') {
        response.writeHead(403,{'Cache-Control':'no-store'}).end();
        return;
      }
      const abort=new AbortController();
      response.on('close',()=>abort.abort());
      const result=await zotero(new Request(origin+request.url,{headers:request.headers,method:request.method,signal:abort.signal}));
      const body=Buffer.from(await result.arrayBuffer());
      if (!abort.signal.aborted) response.writeHead(result.status,Object.fromEntries(result.headers)).end(body);
      return;
    }
    if (request.method !== 'GET' || !text.has(request.url) && !scripts.has(request.url)) {
      response.writeHead(404).end();
      return;
    }
    try {
      const [type, content] = text.get(request.url)
        ?? ['text/javascript', await readFile(new URL(scripts.get(request.url), root))];
      response.writeHead(200, {
        'Content-Type': type + '; charset=utf-8',
        'Cache-Control': 'no-store',
      }).end(content);
    } catch {
      response.writeHead(503).end('Build the local preview with npm run build:preview.');
    }
  });
  server.on('close',()=>automatic?.close());
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.argv[2] ?? '33824');
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw Error('Invalid preview port');
  const executable=process.env.PRISM_CODEX_APP_SERVER_EXE;
  const home=process.env.PRISM_CODEX_EXECUTION_HOME;
  const adapter=createCodexAutomaticAdapter({executable,home,includedOnly:process.env.PRISM_CODEX_INCLUDED_USAGE_ONLY==='confirmed'});
  const automatic=home&&path.isAbsolute(home)?createAutomaticExecutionGateway({namespace:'44444444-4444-4444-8444-444444444404',
    journal:path.join(home,'prism-automatic-journal'),adapters:{codex:adapter}}):null;
  const server = createPreviewServer({}, {codexReadiness:createCodexReadiness(executable),automatic});
  server.listen(port, '127.0.0.1', () => console.log('PRISM local preview: http://127.0.0.1:' + port + '/'));
}
