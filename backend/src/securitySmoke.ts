import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {randomBytes,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {io as connect,type Socket} from 'socket.io-client';
import {createApp} from './app.js';
import {repository} from './repository.js';
import {createSecurityService} from './securityService.js';
import {attachRealtime} from './realtime.js';
import {analyticsRepository} from './analyticsRepository.js';
import {makeReplayQueue} from './replayQueue.js';
import {createReplayService} from './replayService.js';
import {pool} from './db.js';

const admin=randomBytes(32).toString('hex'),security=createSecurityService(admin),queue=makeReplayQueue(undefined,'security-smoke-'+randomUUID());await queue.waitUntilReady();await queue.pause();
const replays=createReplayService(repository,admin,queue),server=createServer(createApp(repository,admin,undefined,event=>realtime.publish(event),undefined,replays,analyticsRepository,security));
const realtime=attachRealtime(server,repository,admin,'http://localhost:5173',security);security.onRevoke(id=>realtime.io.in('user:'+id).disconnectSockets(true));
server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('No address');const base=`http://127.0.0.1:${address.port}`;
const userIds:string[]=[],sockets:Socket[]=[];
type User={id:string;key:string};type Endpoint={id:string;publicToken:string};
async function api<T=Record<string,unknown>>(path:string,token=admin,method='GET',body?:unknown,expected=200):Promise<T>{const response=await fetch(base+'/api/v1'+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert.equal(response.status,expected,method+' '+path);return await response.json() as T;}
async function user(name:string){const value=await api<User>('/users',admin,'POST',{name},201);userIds.push(value.id);return value;}
async function endpoint(token:string){return api<Endpoint>('/endpoints',token,'POST',{name:'Phase 7 security smoke'},201);}
const defaults={enabled:true,expiresAt:null,retentionDays:1,rateLimitPerMinute:120,maxRequests:10000,maxBodyStorageBytes:67108864};
async function policy(id:string,key:string,changes:Record<string,unknown>={}){return api('/endpoints/'+id+'/policy',key,'PUT',{...defaults,...changes});}
async function receive(endpoint:Endpoint,body:Buffer|string='x'){return fetch(base+'/h/'+endpoint.publicToken,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:typeof body==='string'?body:new Uint8Array(body)});}
const socketEvent=(socket:Socket,event:'connect'|'disconnect')=>new Promise<void>(resolve=>socket.once(event,()=>resolve()));
async function socket(token:string){const socket=connect(base,{auth:{token},transports:['websocket'],reconnection:false});sockets.push(socket);await Promise.race([socketEvent(socket,'connect'),delay(3000).then(()=>{throw new Error('Socket connect timeout');})]);return socket;}
try{
 const a=await user('Security smoke A'),b=await user('Security smoke B'),ea=await endpoint(a.key),eb=await endpoint(b.key);
 assert(a.key!==b.key);const {rows:[stored]}=await pool.query('SELECT key_hash,key_expires_at FROM management_users WHERE id=$1',[a.id]);assert(stored.key_hash!==a.key&&stored.key_hash.length===64);assert(stored.key_expires_at>new Date());
 const first=await receive(ea,Buffer.from([0,255,128,10]));assert.equal(first.status,200);const original=(await first.json() as {requestId:string}).requestId;
 const own=await api<{items:Endpoint[]}>('/endpoints',a.key);assert.deepEqual(own.items.map(row=>row.id),[ea.id]);
 await api('/endpoints/'+ea.id,b.key,'GET',undefined,404);await api('/requests/'+original,b.key,'GET',undefined,404);await api('/endpoints/'+ea.id+'/statistics',b.key,'GET',undefined,404);await api('/endpoints/'+ea.id+'/response',b.key,'PUT',{},404);await api('/endpoints/'+ea.id+'/test',b.key,'POST',{},404);await api('/endpoints/'+ea.id,b.key,'DELETE',undefined,404);
 await api('/users',a.key,'POST',{name:'forbidden'},403);await api('/endpoints',ea.publicToken,'GET',undefined,401);
 const summary=await api<{allTimeRequests:number;endpointCount:number;endpointUsage:Endpoint[]}>('/dashboard/summary',a.key);assert.equal(summary.allTimeRequests,1);assert.equal(summary.endpointCount,1);assert(summary.endpointUsage.every(row=>row.id===ea.id));
 const sa=await socket(a.key),sb=await socket(b.key);assert((await sa.timeout(2000).emitWithAck('endpoint:subscribe',{endpointId:ea.id})).ok);assert.equal((await sb.timeout(2000).emitWithAck('endpoint:subscribe',{endpointId:ea.id})).ok,false);assert((await sb.timeout(2000).emitWithAck('endpoint:subscribe',{endpointId:eb.id})).ok);
 let foreignEvents=0;sb.on('webhook:received',()=>foreignEvents++);assert.equal((await receive(ea)).status,200);await delay(50);assert.equal(foreignEvents,0);
 const idempotencyKey=randomUUID();const job=await api<{id:string}>('/requests/'+original+'/replay',a.key,'POST',{idempotencyKey,maxAttempts:1},202);const repeated=await api<{id:string}>('/requests/'+original+'/replay',a.key,'POST',{idempotencyKey,maxAttempts:1},202);assert.equal(job.id,repeated.id);
 for(const path of ['/replays/'+job.id,'/replays/'+job.id+'/attempts','/REPLAYS/'+job.id,'/RePlAyS/'+job.id+'/attempts'])await api(path,b.key,'GET',undefined,404);await api('/replays/'+job.id+'/cancel',b.key,'POST',{},404);await api('/REPLAYS/'+job.id+'/cancel',b.key,'POST',{},404);await api('/REQUESTS/'+original+'/replay',b.key,'POST',{idempotencyKey:randomUUID()},404);await api('/ENDPOINTS/'+ea.id+'/policy',b.key,'PUT',defaults,404);await api('/requests/'+original+'/replay',b.key,'POST',{idempotencyKey:randomUUID()},404);
 const quotaNamespace='quota-'+randomUUID();await pool.query("INSERT INTO webhook_replay_jobs(endpoint_id,original_request_id,idempotency_key,max_attempts,status,queue_name) SELECT $1,$2,gen_random_uuid(),1,'CANCELLED',$3 FROM generate_series(1,999)",[ea.id,original,quotaNamespace]);
 await api('/requests/'+original+'/replay',a.key,'POST',{idempotencyKey:randomUUID()},429);assert.equal((await api<{id:string}>('/requests/'+original+'/replay',a.key,'POST',{idempotencyKey,maxAttempts:1},202)).id,job.id);await pool.query('DELETE FROM webhook_replay_jobs WHERE queue_name=$1',[quotaNamespace]);
 await api('/endpoints/'+ea.id+'/requests',a.key,'DELETE',undefined,409);
 await policy(ea.id,a.key);await pool.query("UPDATE webhook_requests SET received_at=now()-interval '2 days' WHERE endpoint_id=$1",[ea.id]);await api('/endpoints/'+ea.id+'/cleanup',a.key,'POST');
 const {rows:[pinned]}=await pool.query('SELECT count(*)::int AS count FROM webhook_requests WHERE endpoint_id=$1',[ea.id]);assert.equal(pinned.count,1);assert((await api<{id:string}>('/requests/'+original,a.key)).id===original);
 await api('/replays/'+job.id+'/cancel',a.key,'POST',{});await api('/endpoints/'+ea.id+'/cleanup',a.key,'POST');assert((await api<{id:string}>('/requests/'+original,a.key)).id===original);
 await api('/endpoints/'+ea.id+'/response',a.key,'PUT',{mode:'CUSTOM',status:200,contentType:'text/plain',body:'audit-body-sentinel',headers:[],delayMs:0});await api('/endpoints/'+ea.id+'/response',a.key,'PUT',{mode:'DEFAULT'});
 const audit=await api<{items:{action:string;details:unknown;ownerId:string}[]}>('/audit?endpointId='+ea.id,a.key);assert.equal(audit.items.filter(row=>row.action==='REPLAY_CREATED').length,1);assert(audit.items.every(row=>row.ownerId===a.id));const serialized=JSON.stringify(audit);assert(!serialized.includes(a.key)&&!serialized.includes(ea.publicToken)&&!serialized.includes('rawBody')&&!serialized.includes('audit-body-sentinel'));
 assert.equal((await api<{items:unknown[]}>('/audit?endpointId='+ea.id,b.key)).items.length,0);
 await api('/endpoints/'+ea.id+'/requests',a.key,'DELETE');await policy(ea.id,a.key,{maxRequests:2});
 const concurrent=await Promise.all(Array.from({length:10},()=>receive(ea)));assert.equal(concurrent.filter(row=>row.status===200).length,2);assert.equal(concurrent.filter(row=>row.status===429).length,8);
 await api('/endpoints/'+ea.id+'/requests',a.key,'DELETE');await policy(ea.id,a.key,{maxBodyStorageBytes:1});assert.equal((await receive(ea,'xx')).status,429);
 await policy(ea.id,a.key,{rateLimitPerMinute:1});assert.equal((await receive(ea)).status,200);assert.equal((await receive(ea)).status,429);
 await policy(ea.id,a.key,{expiresAt:'2000-01-01T00:00:00Z'});assert.equal((await receive(ea)).status,404);await policy(ea.id,a.key,{enabled:false});assert.equal((await receive(ea)).status,404);await policy(ea.id,a.key);
 await api('/endpoints/'+ea.id+'/requests',a.key,'DELETE');const rotated=await api<Endpoint>('/endpoints/'+ea.id+'/rotate-token',a.key,'POST');assert(rotated.publicToken!==ea.publicToken);assert.equal((await receive(ea)).status,404);assert.equal((await receive(rotated)).status,200);
 const disconnected=socketEvent(sa,'disconnect');await api('/users/'+a.id,admin,'PATCH',{enabled:false});await Promise.race([disconnected,delay(3000).then(()=>{throw new Error('Revocation timeout');})]);assert.equal((await receive(rotated)).status,404);await api('/endpoints',a.key,'GET',undefined,401);
 const replacement=await api<User>('/users/'+a.id+'/rotate-key',admin,'POST',{});await api('/users/'+a.id,admin,'PATCH',{enabled:true});await api('/endpoints',replacement.key);await api('/endpoints',a.key,'GET',undefined,401);
 await pool.query("UPDATE management_users SET key_expires_at=now()-interval '1 second' WHERE id=$1",[a.id]);await api('/endpoints',replacement.key,'GET',undefined,401);const renewed=await api<User>('/users/'+a.id+'/rotate-key',admin,'POST',{});await api('/endpoints/'+ea.id,renewed.key,'DELETE');await api('/endpoints/'+ea.id,renewed.key,'GET',undefined,404);
 for(let i=1;i<20;i++)await endpoint(b.key);await api('/endpoints',b.key,'POST',{name:'over account quota'},429);
 console.log('PASS: PostgreSQL user key hashing/expiry/revocation, REST/Socket/analytics/Replay ownership, transactional audit, concurrent quotas, expiry, token rotation, pinned retention, history deletion and account disable');
}finally{
 for(const socket of sockets)socket.disconnect();await queue.obliterate({force:true});await queue.close();
 if(userIds.length){await pool.query('DELETE FROM webhook_endpoints WHERE owner_id=ANY($1::uuid[])',[userIds]);await pool.query('DELETE FROM audit_logs WHERE owner_id=ANY($1::uuid[]) OR target_id=ANY($1::uuid[])',[userIds]);await pool.query('DELETE FROM management_users WHERE id=ANY($1::uuid[])',[userIds]);}
 await new Promise<void>(resolve=>realtime.io.close(()=>resolve()));await pool.end();
}
