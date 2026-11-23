import { randomBytes, randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { customHeaderName, headerValue } from './responsePolicy.js';
import { maskedHeaders } from './body.js';

export const testInputSchema=z.object({
  method:z.enum(['GET','POST','PUT','PATCH','DELETE']).default('POST'),
  contentType:z.enum(['application/json','text/plain','application/x-www-form-urlencoded']).default('application/json'),
  body:z.string().refine(value=>Buffer.byteLength(value,'utf8')<=8192,'Test body exceeds 8 KiB').default(''),
  headers:z.array(z.tuple([z.string().refine(name=>customHeaderName.test(name)||/^(accept|user-agent)$/i.test(name)),headerValue])).max(12).default([]),
  query:z.array(z.tuple([z.string().min(1).max(80),z.string().max(512)])).max(20).default([]),
}).strict().refine(value=>value.method!=='GET'||!value.body,{message:'GET test requests require an empty body',path:['body']})
 .refine(value=>new URLSearchParams(value.query).toString().length<=4096,{message:'Query exceeds 4 KiB',path:['query']});
export type TestInput=z.infer<typeof testInputSchema>;
export interface TestDelivery {
  correlationId:string;
  outcome:'RESPONSE'|'TIMEOUT'|'FAILED';
  response:{status:number;headers:[string,string][];body:string}|null;
  durationMs:number;
}
export interface TestTransport {
  claim:(token:string|undefined,endpointId:string)=>string|undefined;
  send:(endpoint:{id:string;publicToken:string},input:TestInput)=>Promise<TestDelivery>;
}
export class TestLimitError extends Error {}

export function createTestTransport(getPort:()=>number,timeoutMs=5000):TestTransport {
  const pending=new Map<string,{endpointId:string;requestId:string}>();
  let active=0;
  return {
    claim(token,endpointId){
      if(!token)return;
      const entry=pending.get(token);
      if(!entry||entry.endpointId!==endpointId)return;
      pending.delete(token);return entry.requestId;
    },
    async send(endpoint,input){
      if(active>=8)throw new TestLimitError('TEST_CONCURRENCY_LIMIT');
      active++;
      const token=randomBytes(32).toString('hex');const correlationId=randomUUID();
      const started=performance.now();pending.set(token,{endpointId:endpoint.id,requestId:correlationId});
      try{
        return await new Promise<TestDelivery>(resolve=>{
          let finished=false;
          const finish=(outcome:TestDelivery['outcome'],response:TestDelivery['response']=null)=>{
            if(finished)return;finished=true;clearTimeout(timer);
            resolve({correlationId,outcome,response,durationMs:Math.round(performance.now()-started)});
          };
          // Numeric loopback, own listening port, fixed route; no DNS, Host-derived target or redirects.
          const port=getPort();
          const req=request({hostname:'127.0.0.1',family:4,port,method:input.method,
            path:`/h/${encodeURIComponent(endpoint.publicToken)}?${new URLSearchParams(input.query)}`,
            agent:false,maxHeaderSize:16384,
            headers:['Host',`127.0.0.1:${port}`,'Content-Type',input.contentType,'Content-Length',String(Buffer.byteLength(input.body)),
              'X-HookScope-Internal-Test-Token',token,...input.headers.flat()],
          },res=>{
            const chunks:Buffer[]=[];let size=0;
            res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>16384){finish('FAILED');req.destroy();res.destroy();return;}chunks.push(chunk);});
            res.on('error',()=>finish('FAILED'));
            res.on('aborted',()=>finish('FAILED'));
            res.on('end',()=>finish('RESPONSE',{status:res.statusCode??0,headers:maskedHeaders(res.rawHeaders),body:Buffer.concat(chunks).toString('utf8')}));
          });
          const timer=setTimeout(()=>{finish('TIMEOUT');req.destroy();},timeoutMs);
          req.on('error',()=>finish('FAILED'));req.end(input.body);
        });
      }catch{return {correlationId,outcome:'FAILED',response:null,durationMs:Math.round(performance.now()-started)};}
      finally{pending.delete(token);active--;}
    },
  };
}
