import {Queue, type ConnectionOptions} from 'bullmq';
export const defaultReplayQueue='hookscope-internal-replay';
export function redisConnection(url:string,worker=false):ConnectionOptions{
 const parsed=new URL(url);if(parsed.protocol!=='redis:')throw new Error('REDIS_URL must use redis:');
 const db=parsed.pathname.length>1?Number(parsed.pathname.slice(1)):0;if(!Number.isInteger(db)||db<0)throw new Error('Invalid Redis database');
 return {host:parsed.hostname,port:Number(parsed.port||6379),username:parsed.username?decodeURIComponent(parsed.username):undefined,password:parsed.password?decodeURIComponent(parsed.password):undefined,db,
   maxRetriesPerRequest:worker?null:1,enableOfflineQueue:worker,connectTimeout:1500,...(worker?{}:{commandTimeout:1500})};
}
export function makeReplayQueue(url=process.env.REDIS_URL??'redis://127.0.0.1:6379',name=defaultReplayQueue){
 const queue=new Queue(name,{connection:redisConnection(url)});
 queue.on('error',()=>{});return queue;
}
export async function bounded<T>(operation:Promise<T>,ms=2000):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([operation,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('QUEUE_TIMEOUT')),ms);})]);}
 finally{if(timer)clearTimeout(timer);}
}
