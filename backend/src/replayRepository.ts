import {randomUUID} from 'node:crypto';
import {and,asc,desc,eq,inArray,sql,getTableColumns} from 'drizzle-orm';
import {db,pool} from './db.js';
import {replayJobs,replayAttempts,requests} from './schema.js';
import {ReplayError,ReplayDeferred,terminalReplayStates,replayVerdict} from './replayPolicy.js';
import type {ReplayDelivery} from './replayTransport.js';

export const replayRepository={
 async create(original:typeof requests.$inferSelect,key:string,maxAttempts:number,queueName:string){
  const [inserted]=await db.insert(replayJobs).values({originalRequestId:original.id,endpointId:original.endpointId,idempotencyKey:key,maxAttempts,queueName}).onConflictDoNothing().returning();
  const existing=inserted??(await db.select().from(replayJobs).where(eq(replayJobs.idempotencyKey,key)))[0];
  if(!existing||existing.originalRequestId!==original.id||existing.maxAttempts!==maxAttempts||existing.queueName!==queueName)throw new ReplayError(409,'IDEMPOTENCY_KEY_CONFLICT');
  return existing;
 },
 async job(id:string){return (await db.select().from(replayJobs).where(eq(replayJobs.id,id)))[0];},
 async attempts(id:string){return db.select({...getTableColumns(replayAttempts),captured:sql<boolean>`${requests.id} IS NOT NULL`}).from(replayAttempts).leftJoin(requests,eq(requests.id,replayAttempts.requestId)).where(eq(replayAttempts.jobId,id)).orderBy(asc(replayAttempts.number)).limit(3);},
 async attempt(id:string){return (await db.select().from(replayAttempts).where(eq(replayAttempts.id,id)))[0];},
 async list(endpointId:string,page:number,status?:string){return db.transaction(async tx=>{
  const where=and(eq(replayJobs.endpointId,endpointId),status?eq(replayJobs.status,status):undefined);
  const [{count}]=await tx.select({count:sql<number>`count(*)`}).from(replayJobs).where(where);
  const items=await tx.select().from(replayJobs).where(where).orderBy(desc(replayJobs.createdAt),desc(replayJobs.id)).limit(30).offset((page-1)*30);
  return {items,total:Number(count),page,pageSize:30};
 },{isolationLevel:'repeatable read',accessMode:'read only'});},
 async outstanding(queueName:string){return db.select().from(replayJobs).where(and(eq(replayJobs.queueName,queueName),inArray(replayJobs.status,['PENDING','QUEUED','RUNNING','RETRYING']))).orderBy(asc(replayJobs.updatedAt)).limit(50);},
 async queued(id:string){await db.update(replayJobs).set({status:'QUEUED',updatedAt:new Date()}).where(and(eq(replayJobs.id,id),eq(replayJobs.status,'PENDING')));},
 async queueFailed(id:string){await db.transaction(async tx=>{
  const [job]=await tx.select().from(replayJobs).where(eq(replayJobs.id,id)).for('update');
  if(!job||terminalReplayStates.has(job.status))return;
  const unknown=job.status==='RUNNING';
  await tx.update(replayAttempts).set({status:'UNKNOWN',errorCode:'QUEUE_PROCESSOR_INTERRUPTED',finishedAt:new Date()}).where(and(eq(replayAttempts.jobId,id),eq(replayAttempts.status,'RUNNING')));
  await tx.update(replayJobs).set({status:unknown?'UNKNOWN':'FAILED',lastError:'QUEUE_DELIVERY_EXHAUSTED',updatedAt:new Date()}).where(eq(replayJobs.id,id));
 });},
 async cancel(id:string){return db.transaction(async tx=>{
  const [job]=await tx.select().from(replayJobs).where(eq(replayJobs.id,id)).for('update');
  if(!job)throw new ReplayError(404,'REPLAY_NOT_FOUND');
  if(job.status==='CANCELLED')return job;
  if(!['PENDING','QUEUED','RETRYING'].includes(job.status))throw new ReplayError(409,'REPLAY_NOT_CANCELLABLE');
  return (await tx.update(replayJobs).set({status:'CANCELLED',updatedAt:new Date(),lastError:null}).where(eq(replayJobs.id,id)).returning())[0];
 });},
 async start(id:string,queueName:string){return db.transaction(async tx=>{
  const [job]=await tx.select().from(replayJobs).where(eq(replayJobs.id,id)).for('update');
  if(!job||job.queueName!==queueName||terminalReplayStates.has(job.status))return null;
  if(job.nextAttemptAt&&job.nextAttemptAt.getTime()>Date.now())throw new ReplayDeferred(job.nextAttemptAt.getTime());
  const [last]=await tx.select().from(replayAttempts).where(eq(replayAttempts.jobId,id)).orderBy(desc(replayAttempts.number)).limit(1);
  if(last?.status==='RUNNING'){
   await tx.update(replayAttempts).set({status:'UNKNOWN',errorCode:'INTERRUPTED_ATTEMPT',finishedAt:new Date()}).where(eq(replayAttempts.id,last.id));
   await tx.update(replayJobs).set({status:'UNKNOWN',lastError:'INTERRUPTED_ATTEMPT',updatedAt:new Date()}).where(eq(replayJobs.id,id));return null;
  }
  const number=(last?.number??0)+1;
  if(number>job.maxAttempts){await tx.update(replayJobs).set({status:'FAILED',lastError:'ATTEMPTS_EXHAUSTED',updatedAt:new Date()}).where(eq(replayJobs.id,id));return null;}
  const [attempt]=await tx.insert(replayAttempts).values({jobId:id,number,requestId:randomUUID()}).returning();
  await tx.update(replayJobs).set({status:'RUNNING',lastError:null,nextAttemptAt:null,updatedAt:new Date()}).where(eq(replayJobs.id,id));return {job,attempt};
 });},
 async finish(id:string,attemptId:string,delivery:ReplayDelivery,permanentError?:string){return db.transaction(async tx=>{
  const [job]=await tx.select().from(replayJobs).where(eq(replayJobs.id,id)).for('update');
  const [attempt]=await tx.select().from(replayAttempts).where(eq(replayAttempts.id,attemptId));
  if(!job||!attempt||attempt.status!=='RUNNING'||terminalReplayStates.has(job.status))return false;
  const verdict=permanentError?{kind:'FAILED' as const,code:permanentError}:replayVerdict(delivery.outcome,delivery.responseStatus);
  const retry=verdict.kind==='RETRYABLE'&&attempt.number<job.maxAttempts;
  const status=verdict.kind==='SUCCEEDED'?'SUCCEEDED':verdict.kind==='UNKNOWN'?'UNKNOWN':'FAILED';
  await tx.update(replayAttempts).set({status,errorCode:verdict.code,responseStatus:delivery.responseStatus,responseBody:delivery.responseBody,responseHeaders:delivery.responseHeaders,durationMs:delivery.durationMs,finishedAt:new Date()}).where(eq(replayAttempts.id,attemptId));
  await tx.update(replayJobs).set({status:retry?'RETRYING':status,lastError:verdict.code,nextAttemptAt:retry?new Date(Date.now()+1000*2**(attempt.number-1)):null,updatedAt:new Date()}).where(eq(replayJobs.id,id));return retry;
 });},
 async store(attemptId:string,data:typeof requests.$inferInsert){return db.transaction(async tx=>{
  const [attempt]=await tx.select().from(replayAttempts).where(eq(replayAttempts.id,attemptId)).for('update');
  if(!attempt||attempt.requestId!==data.id)throw new ReplayError(403,'REPLAY_PROOF_INVALID');
  const [existing]=await tx.select().from(requests).where(eq(requests.replayAttemptId,attemptId));
  if(existing)return {capture:existing,created:false};
  const [job]=await tx.select().from(replayJobs).where(eq(replayJobs.id,attempt.jobId));
  if(attempt.status!=='RUNNING'||job?.status!=='RUNNING'||job.endpointId!==data.endpointId)throw new ReplayError(409,'REPLAY_NOT_ACTIVE');
  const [capture]=await tx.insert(requests).values({...data,source:'REPLAY',replayAttemptId:attemptId}).returning();return {capture,created:true};
 });},
 async locked<T>(id:string,work:()=>Promise<T>){
  const client=await pool.connect();let held=false;
  try{const result=await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS held',[id]);held=!!result.rows[0].held;if(!held)throw new ReplayError(409,'REPLAY_BUSY');return await work();}
  finally{try{if(held)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[id]);}finally{client.release();}}
 },
};
