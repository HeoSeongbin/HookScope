import {createHmac,createHash,timingSafeEqual} from 'node:crypto';
import {validateHeaderValue} from 'node:http';
import {z} from 'zod';
import {customHeaderName} from './responsePolicy.js';
import type {requests} from './schema.js';
export const replayInputSchema=z.object({idempotencyKey:z.uuid(),maxAttempts:z.number().int().min(1).max(3).default(3)}).strict();
export const replayListSchema=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),status:z.enum(['PENDING','QUEUED','RUNNING','RETRYING','SUCCEEDED','FAILED','CANCELLED','UNKNOWN']).optional()}).strict();
export const terminalReplayStates=new Set(['SUCCEEDED','FAILED','CANCELLED','UNKNOWN']);
export class ReplayError extends Error {constructor(public status:number,public code:string){super(code);}}
export class ReplayDeferred extends Error {constructor(public retryAt:number){super('REPLAY_BACKOFF_PENDING');}}
export function internalOrigin(value:string){
 const url=new URL(value);
 if(url.protocol!=='http:'||!['backend','127.0.0.1','localhost'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Invalid INTERNAL_API_ORIGIN');
 return url;
}
export function replayPayload(source:typeof requests.$inferSelect){
 if(!['GET','POST','PUT','PATCH','DELETE'].includes(source.method))throw new ReplayError(400,'REPLAY_METHOD_UNSUPPORTED');
 const body=Buffer.from(source.rawBody,'base64');if(body.length>262144||body.toString('base64')!==source.rawBody)throw new ReplayError(400,'REPLAY_BODY_INVALID');
 const query=new URLSearchParams();
 if(source.query&&typeof source.query==='object')for(const [name,values] of Object.entries(source.query))if(Array.isArray(values))for(const value of values)if(typeof value==='string')query.append(name,value);
 if(query.toString().length>8000)throw new ReplayError(400,'REPLAY_QUERY_TOO_LARGE');
 const headers:[string,string][]=[];
 if(Array.isArray(source.headers))for(const pair of source.headers){
  if(!Array.isArray(pair)||pair.length!==2||!pair.every(value=>typeof value==='string'))continue;
  const [name,value]=pair as [string,string];
  if((!customHeaderName.test(name)&&!/^(accept|user-agent)$/i.test(name))||value==='[REDACTED]'||value.length>512||headers.length>=12)continue;
  try{validateHeaderValue(name,value);headers.push([name,value]);}catch{/* Exclude invalid/unsafe forwarding data. */}
 }
 try{validateHeaderValue('Content-Type',source.contentType);}catch{throw new ReplayError(400,'REPLAY_CONTENT_TYPE_INVALID');}
 if(source.contentType.length>512)throw new ReplayError(400,'REPLAY_CONTENT_TYPE_INVALID');
 return {method:source.method,body,query:query.toString(),headers,contentType:source.contentType};
}
export function replaySignature(key:string,attemptId:string,requestId:string,endpointId:string,method:string,body:Buffer,query:string){
 const digest=createHash('sha256').update(body).digest('hex');
 return createHmac('sha256',key).update(['hookscope:internal-replay:v1',attemptId,requestId,endpointId,method,digest,query].join('\n')).digest('base64url');
}
export function signatureMatches(actual:string,expected:string){const a=Buffer.from(actual),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);}
export function replayVerdict(outcome:string,status:number|null){
 if(outcome!=='RESPONSE')return {kind:'UNKNOWN' as const,code:outcome==='TIMEOUT'?'TRANSPORT_TIMEOUT':'TRANSPORT_UNCERTAIN'};
 if(status!==null&&status>=200&&status<300)return {kind:'SUCCEEDED' as const,code:null};
 const retry=status===429||(status!==null&&status>=500);
 return {kind:retry?'RETRYABLE' as const:'FAILED' as const,code:`HTTP_${status??'UNKNOWN'}`};
}
