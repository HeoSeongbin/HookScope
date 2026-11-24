import {request} from 'node:http';
import {performance} from 'node:perf_hooks';
import {maskedHeaders} from './body.js';
import {internalOrigin,replayPayload,replaySignature,ReplayError} from './replayPolicy.js';
import type {requests,replayAttempts} from './schema.js';
export interface ReplayDelivery {outcome:'RESPONSE'|'TIMEOUT'|'FAILED';responseStatus:number|null;responseBody:string|null;responseHeaders:[string,string][]|null;durationMs:number}
export async function deliverReplay(origin:string,key:string,endpoint:{id:string;publicToken:string},source:typeof requests.$inferSelect,attempt:typeof replayAttempts.$inferSelect,timeoutMs=5000):Promise<ReplayDelivery>{
 const target=internalOrigin(origin);const input=replayPayload(source);
 const path=`/h/${encodeURIComponent(endpoint.publicToken)}?${input.query}`;if(path.length>8192)throw new ReplayError(400,'REPLAY_QUERY_TOO_LARGE');
 const signature=replaySignature(key,attempt.id,attempt.requestId,endpoint.id,input.method,input.body,input.query);
 const started=performance.now();
 return new Promise(resolve=>{
  let finished=false;
  const finish=(outcome:ReplayDelivery['outcome'],responseStatus:number|null=null,responseBody:string|null=null,responseHeaders:[string,string][]|null=null)=>{
   if(finished)return;finished=true;clearTimeout(timer);resolve({outcome,responseStatus,responseBody,responseHeaders,durationMs:Math.round(performance.now()-started)});
  };
  const headers=['Host',target.host,'Content-Length',String(input.body.length),'X-HookScope-Internal-Replay',`${attempt.id}.${signature}`,...input.headers.flat()];
  if(input.contentType)headers.push('Content-Type',input.contentType);
  const req=request({hostname:target.hostname==='localhost'?'127.0.0.1':target.hostname,port:Number(target.port||80),family:4,path,method:input.method,agent:false,maxHeaderSize:16384,headers},res=>{
   const chunks:Buffer[]=[];let size=0;
   res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>16384){finish('FAILED');req.destroy();res.destroy();return;}chunks.push(chunk);});
   res.on('end',()=>finish('RESPONSE',res.statusCode??0,Buffer.concat(chunks).toString('utf8'),maskedHeaders(res.rawHeaders)));
   res.on('error',()=>finish('FAILED'));res.on('aborted',()=>finish('FAILED'));
  });
  const timer=setTimeout(()=>{finish('TIMEOUT');req.destroy();},timeoutMs);
  req.on('error',()=>finish('FAILED'));req.end(input.body);
 });
}
