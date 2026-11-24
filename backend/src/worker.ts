import {startReplayWorker} from './replayWorker.js';
import {makeReplayQueue,bounded} from './replayQueue.js';
import {pool} from './db.js';
import pino from 'pino';
const log=pino();const key=process.env.ADMIN_KEY??'';if(key.length<32)throw new Error('ADMIN_KEY must contain at least 32 characters');
const redisUrl=process.env.REDIS_URL??'redis://127.0.0.1:6379';
const worker=startReplayWorker({redisUrl,origin:process.env.INTERNAL_API_ORIGIN??'http://127.0.0.1:3000',key});
const health=makeReplayQueue(redisUrl);
worker.on('error',()=>log.error({event:'REPLAY_WORKER_ERROR'}));
worker.on('failed',job=>log.warn({event:'REPLAY_EXECUTION_FAILED',replayId:job?.id}));
await worker.waitUntilReady();
async function heartbeat(){try{await pool.query('SELECT 1 FROM webhook_replay_jobs LIMIT 0');const client=await health.client;await bounded(client.set('hookscope:replay:worker','ready',{EX:15}));}catch{log.warn({event:'REPLAY_WORKER_NOT_READY'});}}
await heartbeat();const timer=setInterval(()=>void heartbeat(),5000);
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{clearInterval(timer);void worker.close().then(()=>health.close()).then(()=>pool.end()).then(()=>process.exit(0));setTimeout(()=>process.exit(1),10000).unref();});
