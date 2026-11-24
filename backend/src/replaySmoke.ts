import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {randomBytes,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {eq,and,sql} from 'drizzle-orm';
import {createApp} from './app.js';
import {repository} from './repository.js';
import {db,pool} from './db.js';
import {endpoints,requests,replayJobs,replayAttempts} from './schema.js';
import {makeReplayQueue} from './replayQueue.js';
import {createReplayService} from './replayService.js';
import {startReplayWorker,processReplay} from './replayWorker.js';
import {replayPayload,replaySignature} from './replayPolicy.js';
import {replayRepository} from './replayRepository.js';

const key=randomBytes(32).toString('hex');const queueName=`replay-smoke-${randomUUID()}`;
const redisUrl=process.env.REDIS_URL??'redis://127.0.0.1:6379';const queue=makeReplayQueue(redisUrl,queueName);
const service=createReplayService(repository,key,queue);const server=createServer(createApp(repository,key,undefined,undefined,undefined,service));
server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('No port');
const base=`http://127.0.0.1:${address.port}`;const headers={Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
const worker=startReplayWorker({redisUrl,origin:base,key,queueName});await worker.waitUntilReady();
let endpointId:string|undefined;
async function until<T>(read:()=>Promise<T>,check:(value:T)=>boolean,ms=15000){const deadline=Date.now()+ms;while(Date.now()<deadline){const value=await read();if(check(value))return value;await delay(75);}throw new Error('Smoke timeout');}
async function getJob(id:string){return await service.job(id);}
try{
 const created=await fetch(base+'/api/v1/endpoints',{method:'POST',headers,body:'{"name":"Phase 5 replay smoke"}'}).then(r=>r.json()) as {id:string;publicToken:string};endpointId=created.id;
 const originalBytes=Buffer.from([0,255,128,10,13]);
 const received=await fetch(`${base}/h/${created.publicToken}?tag=a&tag=b`,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Test-Preserved':'yes',Authorization:'must-not-forward'},body:originalBytes}).then(r=>r.json()) as {requestId:string};
 const original=await repository.request(received.requestId);
 const options={idempotencyKey:randomUUID(),maxAttempts:3};
 const first=await service.create(original.id,options);const duplicate=await service.create(original.id,options);assert.equal(first.id,duplicate.id);
 await until(()=>getJob(first.id),job=>job.status==='SUCCEEDED');
 const history=await service.attempts(first.id);assert.equal(history.items.length,1);assert(history.items[0].captured);
 const clone=await repository.request(history.items[0].requestId);assert.equal(clone.source,'REPLAY');assert.deepEqual(Buffer.from(clone.rawBody,'base64'),originalBytes);assert.deepEqual(clone.query,{tag:['a','b']});
 assert(!JSON.stringify(clone.headers).includes('Authorization'));assert(!JSON.stringify(clone.headers).toLowerCase().includes('internal-replay'));
 await processReplay(first.id,base,key,queueName);assert.equal((await service.attempts(first.id)).items.length,1);
 const failedProof=await fetch(`${base}/h/${created.publicToken}`,{method:'POST',headers:{'X-HookScope-Internal-Replay':'forged'},body:'bad'});assert.equal(failedProof.status,403);

 // HTTP failures intentionally cause distinct bounded retries, not duplicate execution of one attempt.
 await repository.setResponse(created.id,{mode:'CUSTOM',status:503,body:'retryable',contentType:'text/plain',headers:[],delayMs:0});
 const failing=await service.create(original.id,{idempotencyKey:randomUUID(),maxAttempts:3});
 await until(()=>getJob(failing.id),job=>job.status==='RETRYING');
 await assert.rejects(replayRepository.start(failing.id,queueName),/REPLAY_BACKOFF_PENDING/);
 await until(()=>getJob(failing.id),job=>job.status==='FAILED');const retries=(await service.attempts(failing.id)).items;
 assert.equal(retries.length,3);assert(retries.every(attempt=>attempt.responseStatus===503&&attempt.status==='FAILED'&&attempt.captured));assert.equal(new Set(retries.map(attempt=>attempt.requestId)).size,3);
 assert(new Date(retries[1].startedAt).getTime()-new Date(retries[0].finishedAt!).getTime()>=850);
 assert(new Date(retries[2].startedAt).getTime()-new Date(retries[1].finishedAt!).getTime()>=1800);
 await repository.setResponse(created.id,{mode:'CUSTOM',status:400,body:'permanent',contentType:'text/plain',headers:[],delayMs:0});
 const bad=await service.create(original.id,{idempotencyKey:randomUUID(),maxAttempts:3});await until(()=>getJob(bad.id),job=>job.status==='FAILED');assert.equal((await service.attempts(bad.id)).items.length,1);

 // Database cancellation remains authoritative even though a BullMQ job exists.
 await queue.pause();const cancel=await service.create(original.id,{idempotencyKey:randomUUID(),maxAttempts:3});assert.equal((await fetch(`${base}/api/v1/replays/${cancel.id}/cancel`,{method:'POST',headers,body:'{}'})).status,200);await queue.resume();await delay(150);
 assert.equal((await getJob(cancel.id)).status,'CANCELLED');assert.equal((await service.attempts(cancel.id)).items.length,0);

 // Duplicate signed delivery while the first response is delayed creates only one capture per attempt.
 await repository.setResponse(created.id,{mode:'CUSTOM',status:200,body:'deduplicated',contentType:'text/plain',headers:[],delayMs:1200});
 const slow=await service.create(original.id,{idempotencyKey:randomUUID(),maxAttempts:1});
 const active=await until(()=>service.attempts(slow.id),value=>value.items[0]?.captured===true);
 const attempt=active.items[0];const payload=replayPayload(original);
 const signature=replaySignature(key,attempt.id,attempt.requestId,created.id,payload.method,payload.body,payload.query);
 const proofs=await Promise.all([1,2].map(()=>fetch(`${base}/h/${created.publicToken}?${payload.query}`,{method:payload.method,headers:{'Content-Type':payload.contentType,'X-HookScope-Internal-Replay':`${attempt.id}.${signature}`},body:payload.body})));
 assert(proofs.every(response=>response.status===200));
 await assert.rejects(service.cancel(slow.id),/REPLAY_NOT_CANCELLABLE/);
 await until(()=>getJob(slow.id),job=>job.status==='SUCCEEDED');
 const [{count}]=await db.select({count:sql<number>`count(*)`}).from(requests).where(eq(requests.replayAttemptId,attempt.id));assert.equal(Number(count),1);

 // Recover conservatively from interrupted processor state, without another HTTP side effect.
 const interruptedId=randomUUID();await db.insert(replayJobs).values({id:interruptedId,endpointId:created.id,originalRequestId:original.id,idempotencyKey:randomUUID(),maxAttempts:3,status:'RUNNING',queueName});
 await db.insert(replayAttempts).values({jobId:interruptedId,number:1,requestId:randomUUID()});await processReplay(interruptedId,base,key,queueName);
 assert.equal((await getJob(interruptedId)).status,'UNKNOWN');assert.equal((await service.attempts(interruptedId)).items.length,1);
 // A persisted outbox row can be re-enqueued without trusting Redis as history storage.
 const [pending]=await db.insert(replayJobs).values({endpointId:created.id,originalRequestId:original.id,idempotencyKey:randomUUID(),maxAttempts:1,queueName}).returning();await service.reconcile();
 await until(()=>getJob(pending.id),job=>job.status==='SUCCEEDED');
 const isolated=await service.list(created.id,{status:'FAILED'});assert(isolated.items.every(job=>job.endpointId===created.id&&job.status==='FAILED'));
 const [foreignQueue]=await db.insert(replayJobs).values({endpointId:created.id,originalRequestId:original.id,idempotencyKey:randomUUID(),maxAttempts:1,queueName:`isolated-${randomUUID()}`}).returning();await service.reconcile();assert.equal(await queue.getJob(foreignQueue.id),undefined);assert.equal((await getJob(foreignQueue.id)).status,'PENDING');
 const captures=await db.select().from(requests).where(and(eq(requests.endpointId,created.id),eq(requests.source,'REPLAY')));assert.equal(captures.length,7);
 console.log('PASS: actual PostgreSQL + Redis + BullMQ Worker, bytes, idempotency, 3 bounded retries/backoff, terminal 4xx, queued cancellation, signed ingress dedup, interrupted UNKNOWN and durable outbox reconciliation');
}finally{
 await worker.close();await queue.obliterate({force:true});await queue.close();
 if(endpointId)await db.delete(endpoints).where(eq(endpoints.id,endpointId));
 await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();
}
