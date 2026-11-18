import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {eq} from 'drizzle-orm';
import {createApp} from './app.js';
import {repository} from './repository.js';
import {db,pool} from './db.js';
import {endpoints,requests} from './schema.js';
import {createServer} from 'node:http';
import {io as connect} from 'socket.io-client';
import {attachRealtime,type ReceivedEvent} from './realtime.js';
const key=randomBytes(32).toString('hex');
const debugRepository={...repository,save:async(data:Parameters<typeof repository.save>[0])=>{try{return await repository.save(data);}catch(e){const cause=(e as Error & {cause?:Error}).cause;console.error('Storage diagnostic:',cause?.message??(e as Error).message);throw e;}}};
const server=createServer(createApp(debugRepository,key,'http://localhost:8088',event=>realtime.publish(event)));
const realtime=attachRealtime(server,repository,key,'http://localhost:8088');
server.listen(0,'127.0.0.1');
await once(server,'listening');
const address=server.address();
if(!address||typeof address==='string')throw new Error('No listening address');
const base=`http://127.0.0.1:${address.port}`;
const socket=connect(base,{auth:{token:key},autoConnect:false});
function waitForSocket<T>(event:string):Promise<T>{
 return new Promise((resolve,reject)=>{
  const receive=(value:T)=>{clearTimeout(timer);resolve(value);};
  const timer=setTimeout(()=>{socket.off(event,receive);reject(new Error(`Socket timeout: ${event}`));},5000);
  socket.once(event,receive);
 });
}
let endpointId:string|undefined;
const headers={Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
try{
 const created=await fetch(base+'/api/v1/endpoints',{method:'POST',headers,body:JSON.stringify({name:'PostgreSQL smoke test'})});
 assert.equal(created.status,201);const ep=await created.json() as {id:string;publicToken:string};endpointId=ep.id;
 const connected=waitForSocket<void>('connect');socket.connect();await connected;
 assert.deepEqual(await socket.timeout(5000).emitWithAck('endpoint:subscribe',{endpointId:ep.id}),{ok:true});
 const notification=waitForSocket<ReceivedEvent>('webhook:received');
 const body='{ "message": "실제 PostgreSQL 검증", "number": 42 }';
 const incoming=await fetch(`${base}/h/${ep.publicToken}?tag=a&tag=b`,{method:'POST',headers:{'Content-Type':'application/json'},body});
 assert.equal(incoming.status,200);const result=await incoming.json() as {requestId:string};
 const [row]=await db.select().from(requests).where(eq(requests.id,result.requestId));
 const event=await notification;
 assert.equal(event.requestId,row.id);assert.equal(event.endpointId,ep.id);assert.equal(event.receivedAt,row.receivedAt.toISOString());
 assert.equal(Buffer.from(row.rawBody,'base64').toString('utf8'),body);assert.deepEqual(row.query,{tag:['a','b']});
 const list=await fetch(`${base}/api/v1/endpoints/${ep.id}/requests`,{headers}).then(r=>r.json()) as {total:number;items:{id:string}[]};
 assert.equal(list.total,1);assert.equal(list.items[0].id,row.id);
 const detail=await fetch(`${base}/api/v1/requests/${row.id}`,{headers}).then(r=>r.json()) as {rawEncoding:string};assert.equal(detail.rawEncoding,'base64');
 assert.equal((await fetch(base+'/api/v1/requests/'+row.id)).status,401);
 console.log('PASS: HTTP endpoint creation → ingestion → PostgreSQL byte verification → authenticated Socket room notification → list/detail → authorization');
}finally{
 if(endpointId)await db.delete(endpoints).where(eq(endpoints.id,endpointId));
 socket.disconnect();await new Promise<void>(resolve=>realtime.io.close(()=>resolve()));await pool.end();
}
