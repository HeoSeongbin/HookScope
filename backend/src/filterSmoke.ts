import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {inArray} from 'drizzle-orm';
import {createApp} from './app.js';
import {repository} from './repository.js';
import {db,pool} from './db.js';
import {endpoints} from './schema.js';

const key=randomBytes(32).toString('hex');
const server=createApp(repository,key).listen(0,'127.0.0.1');
await once(server,'listening');
const address=server.address();if(!address||typeof address==='string')throw new Error('Missing address');
const base=`http://127.0.0.1:${address.port}`;
const headers={Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
const ids:string[]=[];
async function create(name:string){
 const response=await fetch(base+'/api/v1/endpoints',{method:'POST',headers,body:JSON.stringify({name})});assert.equal(response.status,201);
 const endpoint=await response.json() as {id:string;publicToken:string};ids.push(endpoint.id);return endpoint;
}
try{
 const endpoint=await create('Phase 3 PostgreSQL filter smoke');
 const foreign=await create('Phase 3 isolated endpoint');
 const receive=`${base}/h/${endpoint.publicToken}?tag=one&tag=two`;
 for(let i=0;i<33;i++)assert.equal((await fetch(receive,{method:'POST',headers:{'Content-Type':'Application/JSON; charset=utf-8','X-Trace':'phase3'},body:JSON.stringify({sequence:i,event:i===0?'hello %_ 한국어':'ordinary',customer:{name:'Heo'}})})).status,200);
 assert.equal((await fetch(receive,{method:'PUT',headers:{'Content-Type':'text/plain'},body:'plain filter content'})).status,200);
 const binary=await fetch(receive,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:Buffer.from([0,255,128,10])});assert.equal(binary.status,200);
 const binaryId=(await binary.json() as {requestId:string}).requestId;
 assert.equal((await fetch(`${base}/h/${foreign.publicToken}`,{method:'POST',headers:{'Content-Type':'text/plain'},body:'foreign-only'})).status,200);
 async function list(filters:Record<string,string>={}){
  const response=await fetch(`${base}/api/v1/endpoints/${endpoint.id}/requests?${new URLSearchParams(filters)}`,{headers});assert.equal(response.status,200);
  return await response.json() as {items:{id:string;receivedAt:string;method:string;bodySize:number}[];total:number;page:number;pageSize:number};
 }
 const first=await list();const second=await list({page:'2'});
 assert.equal(first.total,35);assert.equal(first.items.length,30);assert.equal(second.items.length,5);
 assert.equal(new Set([...first.items,...second.items].map(item=>item.id)).size,35);
 assert(!('rawBody' in first.items[0]));
 assert.equal((await list({method:'POST',contentType:'APPLICATION/JSON',status:'200'})).total,33);
 assert.equal((await list({method:'PUT',contentType:'text/plain'})).total,1);
 assert.equal((await list({status:'500'})).total,0);
 assert.equal((await list({q:'%_'})).total,1);assert.equal((await list({q:'한국어'})).total,1);
 assert.equal((await list({q:"' OR 1=1 --"})).total,0);
 assert.equal((await list({q:'foreign-only'})).total,0);
 assert.equal((await list({q:'x-trace'})).total,33);
 assert.equal((await list({q:'two'})).total,35);
 const oldest=await list({sort:'oldest'});
 const allNewest=[...first.items,...second.items];
 assert.deepEqual(oldest.items.map(item=>item.id),[...allNewest].reverse().slice(0,30).map(item=>item.id));
 assert.equal((await list({from:'2000-01-01T00:00:00Z',to:'2100-01-01T09:00:00+09:00'})).total,35);
 assert.equal((await list({to:'2000-01-01T00:00:00Z'})).total,0);
 const latest=Date.parse(first.items[0].receivedAt);
 assert.equal((await list({from:new Date(latest+1000).toISOString()})).total,0);
 const detail=await fetch(`${base}/api/v1/requests/${binaryId}`,{headers}).then(r=>r.json()) as {rawBody:string;bodySize:number};
 assert.deepEqual(Buffer.from(detail.rawBody,'base64'),Buffer.from([0,255,128,10]));assert.equal(detail.bodySize,4);
 console.log('PASS: PostgreSQL filters, literal search, endpoint isolation, stable sort, 30/5 pagination, UTC ranges and binary bytes (36 real HTTP captures)');
}finally{
 if(ids.length)await db.delete(endpoints).where(inArray(endpoints.id,ids));
 await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await pool.end();
}
