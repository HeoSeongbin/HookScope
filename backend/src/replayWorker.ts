import {Worker,DelayedError} from 'bullmq';
import {z} from 'zod';
import {repository} from './repository.js';
import {replayRepository} from './replayRepository.js';
import {ReplayError,ReplayDeferred,internalOrigin} from './replayPolicy.js';
import {deliverReplay} from './replayTransport.js';
import {redisConnection,defaultReplayQueue} from './replayQueue.js';

export async function processReplay(id:string,origin:string,key:string,queueName=defaultReplayQueue){
 return replayRepository.locked(id,async()=>{
  const execution=await replayRepository.start(id,queueName);if(!execution)return;
  const {job,attempt}=execution;
  const endpoint=await repository.endpoint(job.endpointId);const original=await repository.request(job.originalRequestId);
  const failed={outcome:'RESPONSE' as const,responseStatus:null,responseBody:null,responseHeaders:null,durationMs:0};
  if(!endpoint?.enabled||!original){await replayRepository.finish(id,attempt.id,failed,!original?'ORIGINAL_NOT_FOUND':'ENDPOINT_DISABLED');return;}
  let delivery;
  try{delivery=await deliverReplay(origin,key,endpoint,original,attempt);}
  catch(error){if(error instanceof ReplayError){await replayRepository.finish(id,attempt.id,failed,error.code);return;}throw error;}
  const retry=await replayRepository.finish(id,attempt.id,delivery);if(retry)throw new Error('REPLAY_RETRYABLE');
 });
}
export function startReplayWorker(options:{redisUrl:string;origin:string;key:string;queueName?:string}){
 internalOrigin(options.origin);
 const worker=new Worker(options.queueName??defaultReplayQueue,async(job,token)=>{
  const id=z.uuid().parse(job.data?.replayId);if(job.name!=='internal-replay')throw new Error('INVALID_JOB');
  try{await processReplay(id,options.origin,options.key,options.queueName??defaultReplayQueue);}
  catch(error){
   if(error instanceof ReplayDeferred||error instanceof ReplayError&&error.code==='REPLAY_BUSY'){await job.moveToDelayed(error instanceof ReplayDeferred?error.retryAt:Date.now()+250,token);throw new DelayedError();}
   // BullMQ persists failedReason/stack in Redis. Never forward SQL errors with request/response parameters.
   // eslint-disable-next-line preserve-caught-error -- Retaining a SQL cause would expose payload parameters to Redis.
   throw new Error(error instanceof ReplayError?error.code:error instanceof Error&&error.message==='REPLAY_RETRYABLE'?'REPLAY_RETRYABLE':'REPLAY_PROCESSING_ERROR');
  }
 },{connection:redisConnection(options.redisUrl,true),concurrency:2,maxStalledCount:1});
 worker.on('error',()=>{});return worker;
}
