import {describe,it,expect,vi,afterEach} from 'vitest';
import {createServer,type Server} from 'node:http';
import {once} from 'node:events';
import request from 'supertest';
import {createApp} from '../src/app.js';
import type {Repository} from '../src/repository.js';
import type {ReplayService} from '../src/replayService.js';
import {internalOrigin,replayInputSchema,replayPayload,replaySignature,signatureMatches,replayVerdict,ReplayError} from '../src/replayPolicy.js';
import {deliverReplay} from '../src/replayTransport.js';
import type {requests,replayAttempts} from '../src/schema.js';
const id='9aa82a1c-4dd8-4568-8021-cd71f55080bb';const key='a'.repeat(40);
const source={method:'POST',rawBody:Buffer.from([0,255,128]).toString('base64'),query:{tag:['a','b']},contentType:'application/octet-stream',headers:[['Authorization','[REDACTED]'],['Cookie','[REDACTED]'],['Host','external.example'],['X-Test-A','safe'],['X-Test-Secret','[REDACTED]']]} as unknown as typeof requests.$inferSelect;
describe('internal replay policy',()=>{
 it.each(['https://example.com','http://169.254.169.254','http://192.168.0.1','http://backend.evil','http://backend/private','http://user:pass@backend','http://backend?target=other','http://backend#x'])('rejects destination %s',url=>expect(()=>internalOrigin(url)).toThrow());
 it('accepts only operator-configured internal destinations',()=>{expect(internalOrigin('http://backend:3000').hostname).toBe('backend');expect(internalOrigin('http://127.0.0.1:3000').port).toBe('3000');});
 it.each([{maxAttempts:0},{maxAttempts:4},{url:'http://example.com'},{idempotencyKey:'bad'}])('rejects invalid replay options %j',value=>expect(replayInputSchema.safeParse({idempotencyKey:id,...value}).success).toBe(false));
 it('retains raw bytes and duplicate query values, drops credentials/hop headers',()=>{const input=replayPayload(source);expect(Array.from(input.body)).toEqual([0,255,128]);expect(input.query).toBe('tag=a&tag=b');expect(input.headers).toEqual([['X-Test-A','safe']]);});
 it('rejects oversized or corrupt payloads',()=>{expect(()=>replayPayload({...source,rawBody:'bad base64'})).toThrow();expect(()=>replayPayload({...source,rawBody:Buffer.alloc(262145).toString('base64')})).toThrow();expect(()=>replayPayload({...source,method:'CONNECT'})).toThrow();});
 it('binds a proof to endpoint, reserved request ID, method, bytes and query',()=>{
  const proof=replaySignature(key,id,id,id,'POST',Buffer.from([0,255]),'tag=a&tag=b');
  expect(signatureMatches(proof,proof)).toBe(true);expect(signatureMatches('가'.repeat(proof.length),proof)).toBe(false);
  expect(signatureMatches(replaySignature(key,id,id,id,'PUT',Buffer.from([0,255]),'tag=a&tag=b'),proof)).toBe(false);
  expect(signatureMatches(replaySignature(key,id,id,id,'POST',Buffer.from([0,254]),'tag=a&tag=b'),proof)).toBe(false);
  expect(signatureMatches(replaySignature(key,id,id,id,'POST',Buffer.from([0,255]),'tag=b&tag=a'),proof)).toBe(false);
 });
 it.each([[200,'SUCCEEDED'],[204,'SUCCEEDED'],[302,'FAILED'],[400,'FAILED'],[429,'RETRYABLE'],[500,'RETRYABLE'],[503,'RETRYABLE']])('classifies observed HTTP %s as %s',(status,kind)=>expect(replayVerdict('RESPONSE',Number(status)).kind).toBe(kind));
 it('does not automatically retry an uncertain transport failure',()=>{expect(replayVerdict('TIMEOUT',null).kind).toBe('UNKNOWN');expect(replayVerdict('FAILED',null).kind).toBe('UNKNOWN');});
});
describe('management API boundary',()=>{
 it('authenticates replay routes, rejects public keys and propagates safe errors',async()=>{
  const replays={create:vi.fn(async()=>({id,status:'PENDING'})),list:vi.fn(async()=>({items:[]})),job:vi.fn(async()=>{throw new ReplayError(404,'REPLAY_NOT_FOUND');}),attempts:vi.fn(async()=>({items:[]})),cancel:vi.fn(async()=>({id,status:'CANCELLED'}))} as unknown as ReplayService;
  const app=createApp({} as Repository,key,undefined,undefined,undefined,replays);
  for(const path of [`/api/v1/replays/${id}`,`/api/v1/replays/${id}/attempts`,`/api/v1/endpoints/${id}/replays`])expect((await request(app).get(path)).status).toBe(401);
  expect((await request(app).post(`/api/v1/requests/${id}/replay`).auth('public-token',{type:'bearer'}).send({})).status).toBe(401);
  expect((await request(app).post(`/api/v1/requests/${id}/replay`).auth(key,{type:'bearer'}).send({idempotencyKey:id})).status).toBe(202);
  expect(replays.create).toHaveBeenCalledWith(id,{idempotencyKey:id});
  expect((await request(app).get(`/api/v1/replays/${id}`).auth(key,{type:'bearer'})).status).toBe(404);
  expect((await request(app).get('/api/v1/replays/not-uuid').auth(key,{type:'bearer'})).status).toBe(400);
 });
});
const servers:Server[]=[];afterEach(async()=>{for(const server of servers.splice(0)){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}});
async function listen(server:Server){servers.push(server);server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('Missing address');return `http://127.0.0.1:${address.port}`;}
describe('actual internal replay transport',()=>{
 const attempt={id,requestId:id} as typeof replayAttempts.$inferSelect;
 it('sends bytes without credentials or redirect following',async()=>{
  let redirects=0;const trap=await listen(createServer((_req,res)=>{redirects++;res.end();}));
  const received:Buffer[]=[];const origin=await listen(createServer((req,res)=>{
   expect(req.method).toBe('POST');expect(req.url).toBe('/h/public?tag=a&tag=b');expect(req.headers.authorization).toBeUndefined();expect(req.headers.cookie).toBeUndefined();expect(req.headers['x-test-a']).toBe('safe');expect(req.headers['x-hookscope-internal-replay']).toContain(id);
   req.on('data',chunk=>received.push(Buffer.from(chunk)));req.on('end',()=>{res.writeHead(302,{Location:trap});res.end('redirect');});
  }));
  const result=await deliverReplay(origin,key,{id,publicToken:'public'},source,attempt);expect(result.responseStatus).toBe(302);expect(redirects).toBe(0);expect(Buffer.concat(received)).toEqual(Buffer.from([0,255,128]));
 });
 it('bounds time and response body',async()=>{
  const origin=await listen(createServer((req,res)=>{if(req.url?.includes('large'))res.end('x'.repeat(16385));}));
  expect((await deliverReplay(origin,key,{id,publicToken:'large'},source,attempt,100)).outcome).toBe('FAILED');
  expect((await deliverReplay(origin,key,{id,publicToken:'slow'},source,attempt,30)).outcome).toBe('TIMEOUT');
 });
});
