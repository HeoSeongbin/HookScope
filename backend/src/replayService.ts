import type {Queue} from 'bullmq';
import {z} from 'zod';
import type {Repository} from './repository.js';
import {replayRepository} from './replayRepository.js';
import {ReplayError,replayInputSchema,replayListSchema,replayPayload,replaySignature,signatureMatches,terminalReplayStates} from './replayPolicy.js';
import {bounded} from './replayQueue.js';
export function createReplayService(repo:Repository,key:string,queue:Queue){
 async function enqueue(job:Awaited<ReturnType<typeof replayRepository.job>>){
  if(terminalReplayStates.has(job.status))return true;
  try{await bounded(queue.add('internal-replay',{replayId:job.id},{jobId:job.id,attempts:job.maxAttempts,backoff:{type:'exponential',delay:1000},removeOnComplete:{count:1000},removeOnFail:{count:1000}}));await replayRepository.queued(job.id);return true;}catch{return false;}
 }
 let reconciling=false;
 return {
  async create(requestId:string,input:unknown){
   const value=replayInputSchema.parse(input);const original=await repo.request(requestId);if(!original)throw new ReplayError(404,'REQUEST_NOT_FOUND');
   const endpoint=await repo.endpoint(original.endpointId);if(!endpoint?.enabled)throw new ReplayError(409,'ENDPOINT_DISABLED');replayPayload(original);
   const job=await replayRepository.create(original,value.idempotencyKey,value.maxAttempts,queue.name);const enqueued=await enqueue(job);return {...await replayRepository.job(job.id),enqueuePending:!enqueued};
  },
  async list(endpointId:string,input:unknown){const filters=replayListSchema.parse(input);if(!await repo.endpoint(endpointId))throw new ReplayError(404,'ENDPOINT_NOT_FOUND');return replayRepository.list(endpointId,filters.page,filters.status);},
  async job(id:string){const job=await replayRepository.job(id);if(!job)throw new ReplayError(404,'REPLAY_NOT_FOUND');return job;},
  async attempts(id:string){if(!await replayRepository.job(id))throw new ReplayError(404,'REPLAY_NOT_FOUND');return {items:await replayRepository.attempts(id)};},
  async cancel(id:string){const job=await replayRepository.cancel(id);try{const queued=await bounded(queue.getJob(id));if(queued)await bounded(queued.remove());}catch{/* DB cancellation is authoritative even if Redis is unavailable or active. */}return job;},
  async verify(proof:string|undefined,endpointId:string,method:string,body:Buffer,query:string){
   if(!proof)return undefined;
   const [id,signature,...extra]=proof.split('.');if(extra.length||!z.uuid().safeParse(id).success||!signature)throw new ReplayError(403,'REPLAY_PROOF_INVALID');
   const attempt=await replayRepository.attempt(id);if(!attempt)throw new ReplayError(403,'REPLAY_PROOF_INVALID');
   const job=await replayRepository.job(attempt.jobId);
   if(job?.endpointId!==endpointId||job.status!=='RUNNING'||attempt.status!=='RUNNING'||!signatureMatches(signature,replaySignature(key,id,attempt.requestId,endpointId,method,body,query)))throw new ReplayError(403,'REPLAY_PROOF_INVALID');
   return attempt;
  },
  store:replayRepository.store,
  async reconcile(){
   if(reconciling)return;reconciling=true;
   try{for(const job of await replayRepository.outstanding(queue.name)){
    try{const queued=await bounded(queue.getJob(job.id));if(!queued){await enqueue(job);continue;}const state=await bounded(queued.getState());if(state==='failed'||state==='completed')await replayRepository.queueFailed(job.id);}catch{/* Retry the durable outbox on the next tick. */}
   }}finally{reconciling=false;}
  },
 };
}
export type ReplayService=ReturnType<typeof createReplayService>;
