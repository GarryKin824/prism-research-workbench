import http from 'node:http';
const frame=e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
export async function startSyntheticMessagesServer({mode='success'}={}) {
  if(!['success','redirect','429','disconnect','malformed','tool','oversized','slow','truncated','trailing','nontext','badusage'].includes(mode))throw Error('UNKNOWN_FIXTURE_MODE');
  const requests=[],sockets=new Set(),timers=new Set();
  const server=http.createServer(async(req,res)=> {
    const parts=[];let size=0;
    for await(const part of req){size+=part.length;if(size>262144){res.writeHead(413).end();return;}parts.push(part);}
    requests.push({method:req.method,path:req.url,headers:{...req.headers},body:Buffer.concat(parts).toString('utf8')});
    if(mode==='disconnect'){req.socket.destroy();return;}
    if(mode==='redirect'){res.writeHead(302,{location:'/redirect-must-not-be-followed'}).end();return;}
    if(mode==='429'){res.writeHead(429,{'content-type':'application/json'}).end('{"error":{"message":"synthetic rate limit"}}');return;}
    const send=()=> {
      if(res.destroyed)return;
      res.writeHead(200,{'content-type':'text/event-stream','connection':'close'});
      if(mode==='malformed'){res.end('event: message_start\ndata: {broken}\n\n');return;}
      if(mode==='oversized'){res.end(':'+ 'x'.repeat(65536)+'\n\n');return;}
      const events=[
        {type:'message_start',message:{id:'msg_synthetic',type:'message',role:'assistant',model:'prism-synthetic',content:[],usage:{input_tokens:3,output_tokens:0}}},
        {type:'content_block_start',index:0,content_block:mode==='tool'?{type:'tool_use',id:'tool_synthetic',name:'never_execute',input:{}}:{type:'text',text:''}},
        {type:'content_block_delta',index:0,delta:mode==='nontext'?{type:'thinking_delta',thinking:'synthetic'}:{type:'text_delta',text:'Synthetic loopback fixture response. No real model connected.'}},
        {type:'content_block_stop',index:0},
        {type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:mode==='badusage'?257:12}},
        {type:'message_stop'}
      ];
      let body=events.map(frame).join('');
      if(mode==='truncated')body=events.slice(0,-1).map(frame).join('');
      if(mode==='trailing')body+='data: {"type":"message_stop"}\n\n';
      res.end(body);
    };
    if(mode==='slow'){const timer=setTimeout(()=>{timers.delete(timer);send();},7000);timers.add(timer);} else send();
  });
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return Object.freeze({endpoint:`http://127.0.0.1:${server.address().port}/v1/messages`,stats:()=>({requests:requests.map(r=>({...r,headers:{...r.headers}})),count:requests.length}),close:async()=>{for(const timer of timers)clearTimeout(timer);for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}});
}
