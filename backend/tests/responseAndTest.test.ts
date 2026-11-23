import {afterEach,describe,it,expect,vi} from 'vitest';
import {createServer,type Server} from 'node:http';
import {once} from 'node:events';
import request from 'supertest';
import {createApp} from '../src/app.js';
import {responseConfigSchema,responsePlan,defaultResponseConfig,type ResponseConfig} from '../src/responsePolicy.js';
import {createTestTransport,testInputSchema,TestLimitError} from '../src/testSender.js';
import type {Repository} from '../src/repository.js';

const id='9aa82a1c-4dd8-4568-8021-cd71f55080bb';
const key='a'.repeat(40);
const servers:Server[]=[];
afterEach(async()=>{for(const server of servers.splice(0)){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}});
async function start(server:Server){servers.push(server);server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('Missing port');return address.port;}
function fixture(){
 let config:ResponseConfig={...defaultResponseConfig};
 const captures=new Map<string,unknown>();
 const repo={
  endpoint:vi.fn(async(endpointId:string)=>endpointId===id?{id,enabled:true,publicToken:'public-token'}:undefined),
  resolve:vi.fn(async(token:string)=>token==='public-token'?{id,enabled:true}:undefined),
  response:vi.fn(async()=>config),setResponse:vi.fn(async(_id:string,value:ResponseConfig)=>{config=value;return value;}),
  save:vi.fn(async(value:{id:string})=>{const stored={...value,receivedAt:new Date()};captures.set(value.id,stored);return stored;}),
  request:vi.fn(async(id:string)=>captures.get(id)),
 } as unknown as Repository;
 const server=createServer();const transport=createTestTransport(()=>{const address=server.address();return address&&typeof address!=='string'?address.port:0;});
 const app=createApp(repo,key,'http://localhost:8088',()=>{},transport);server.on('request',app);
 return {app,server,repo,transport,captures};
}

describe('safe custom response policy',()=>{
 it('keeps the default receipt format regardless of custom values',()=>expect(responsePlan({...defaultResponseConfig,status:500,body:'ignored',delayMs:2000},id)).toEqual(expect.objectContaining({status:200,delayMs:0,body:JSON.stringify({requestId:id,message:'Request recorded'})})));
 it.each([{status:199},{status:600},{status:200.5},{delayMs:-1},{delayMs:2001},{body:'가'.repeat(2731)},{contentType:'text/html'},{headers:[['X-Test-Result','ok\r\nSet-Cookie: private']]},{headers:[['X-Test-Result','가']]},{headers:[['X-Test-Result','a'],['x-test-result','b']]}])('rejects invalid config %j',value=>expect(responseConfigSchema.safeParse({mode:'CUSTOM',...value}).success).toBe(false));
 it.each(['Content-Length','Transfer-Encoding','Set-Cookie','Location','Content-Security-Policy','Connection','Cache-Control','X-Accel-Redirect','X-Request-Id','X-HookScope-Internal-Test-Token'])('blocks response header %s',name=>expect(responseConfigSchema.safeParse({headers:[[name,'value']]}).success).toBe(false));
 it.each([204,205,304])('requires an empty body for %i',status=>{expect(responseConfigSchema.safeParse({mode:'CUSTOM',status,body:'x'}).success).toBe(false);expect(responseConfigSchema.safeParse({mode:'CUSTOM',status,body:''}).success).toBe(true);});
 it('allows bounded UTF-8 body and safe headers, including intentionally malformed response JSON',()=>expect(responseConfigSchema.safeParse({mode:'CUSTOM',body:'{broken',headers:[['X-Test-Result','ok']]}).success).toBe(true));
});

describe('test sender validation',()=>{
 it.each([{url:'https://example.com'},{headers:[['Host','example.com']]},{headers:[['Authorization','secret']]},{headers:[['Cookie','secret']]},{headers:[['X-HookScope-Internal-Test-Token','forged']]},{headers:[['X-Test-A','a\nb']]},{method:'GET',body:'x'},{method:'TRACE'},{body:'x'.repeat(8193)},{query:[['q','x'.repeat(513)]]},{query:Array.from({length:20},()=>['q','x'.repeat(512)])}])('rejects forbidden input %j',value=>expect(testInputSchema.safeParse(value).success).toBe(false));
 it('preserves repeated query keys and safe header pairs',()=>expect(testInputSchema.parse({query:[['tag','a'],['tag','b']],headers:[['X-Test-Result','ok']]}).query).toEqual([['tag','a'],['tag','b']]));
});

describe('response settings and real local HTTP sender (repository double)',()=>{
 it('protects settings and sender with management authentication and endpoint checks',async()=>{
  const f=fixture();expect((await request(f.app).put(`/api/v1/endpoints/${id}/response`).send({})).status).toBe(401);
  expect((await request(f.app).post(`/api/v1/endpoints/${id}/test`).send({})).status).toBe(401);
  const missing='9aa82a1c-4dd8-4568-8021-cd71f55080bc';
  expect((await request(f.app).get(`/api/v1/endpoints/${missing}/response`).auth(key,{type:'bearer'})).status).toBe(404);
  expect((await request(f.app).post(`/api/v1/endpoints/${id}/test`).auth(key,{type:'bearer'}).send({url:'http://127.0.0.1'})).status).toBe(400);
  vi.mocked(f.repo.endpoint).mockResolvedValueOnce({id,enabled:false} as Awaited<ReturnType<Repository['endpoint']>>);
  expect((await request(f.app).post(`/api/v1/endpoints/${id}/test`).auth(key,{type:'bearer'}).send({})).status).toBe(409);
 });
 it('records response snapshots and returns configured error status through an actual HTTP test',async()=>{
  const f=fixture();await start(f.server);
  const config={mode:'CUSTOM',status:422,body:'{"error":"test rejection"}',headers:[['X-Test-Result','rejected']],delayMs:30};
  expect((await request(f.server).put(`/api/v1/endpoints/${id}/response`).auth(key,{type:'bearer'}).send(config)).status).toBe(200);
  const result=await request(f.server).post(`/api/v1/endpoints/${id}/test`).auth(key,{type:'bearer'}).send({body:'{"hello":"세계"}',query:[['tag','a'],['tag','b']]});
  expect(result.status).toBe(200);expect(result.body).toEqual(expect.objectContaining({recorded:true,outcome:'RESPONSE',requestId:expect.any(String),response:expect.objectContaining({status:422,body:config.body})}));
  const saved=f.captures.get(result.body.requestId) as {rawBody:string;headers:[string,string][];responseBody:string;source:string};
  expect(saved.source).toBe('TEST');expect(saved.responseBody).toBe(config.body);expect(Buffer.from(saved.rawBody,'base64').toString()).toBe('{"hello":"세계"}');expect(JSON.stringify(saved.headers).toLowerCase()).not.toContain('hookscope-internal-test-token');
  expect(result.body.response.headers).toContainEqual([expect.stringMatching(/^x-test-result$/i),'rejected']);
 });
 it('does not let external callers forge TEST source or bypass storage failure',async()=>{
  const f=fixture();const response=await request(f.app).post('/h/public-token').set('X-HookScope-Internal-Test-Token','forged').send('body');expect(response.status).toBe(200);expect(f.repo.save).toHaveBeenLastCalledWith(expect.objectContaining({source:'EXTERNAL'}));
  await f.repo.setResponse(id,responseConfigSchema.parse({mode:'CUSTOM',status:201,body:'a long custom body',headers:[['X-Test-Result','saved']]}));
  vi.mocked(f.repo.save).mockRejectedValueOnce(new Error('DB failure'));
  const failed=await request(f.app).post('/h/public-token').send('body');expect(failed.status).toBe(503);expect(failed.body.error.code).toBe('STORAGE_UNAVAILABLE');expect(failed.headers['x-test-result']).toBeUndefined();expect(failed.headers['content-type']).toContain('application/json');
 });
 it.each([204,205,304])('sends no bytes and still links saved requests for status %i',async status=>{
  const f=fixture();await start(f.server);await f.repo.setResponse(id,responseConfigSchema.parse({mode:'CUSTOM',status}));
  const response=await request(f.server).post(`/api/v1/endpoints/${id}/test`).auth(key,{type:'bearer'}).send({});
  expect(response.body.recorded).toBe(true);expect(response.body.response.status).toBe(status);expect(response.body.response.body).toBe('');
 });
 it('uses an asynchronous response delay while other routes remain responsive',async()=>{
  const f=fixture();await start(f.server);await f.repo.setResponse(id,responseConfigSchema.parse({mode:'CUSTOM',body:'delayed',contentType:'text/plain',delayMs:600}));
  let completed=false;const pending=request(f.server).post('/h/public-token').send('body').then(result=>{completed=true;return result;});
  await vi.waitFor(()=>expect(f.repo.save).toHaveBeenCalled());expect((await request(f.server).get('/health/live')).status).toBe(200);expect(completed).toBe(false);expect((await pending).text).toBe('delayed');
 });
});

describe('local transport limits and correlation',()=>{
 it('consumes one-time endpoint-bound claims and never follows redirects',async()=>{
  let trapCount=0;const trap=createServer((_req,res)=>{trapCount++;res.end('external');});const trapPort=await start(trap);
  const transport=createTestTransport(()=>port);let claimed:string|undefined;
  const server=createServer((req,res)=>{
   expect(req.headers.authorization).toBeUndefined();const token=String(req.headers['x-hookscope-internal-test-token']);expect(transport.claim(token,'other')).toBeUndefined();claimed=transport.claim(token,id);expect(transport.claim(token,id)).toBeUndefined();res.writeHead(302,{Location:`http://127.0.0.1:${trapPort}`});res.end();
  });const port=await start(server);
  const result=await transport.send({id,publicToken:'token'},testInputSchema.parse({}));expect(result.correlationId).toBe(claimed);expect(result.response?.status).toBe(302);expect(trapCount).toBe(0);
 });
 it('bounds response size and total time and cleans up after failures',async()=>{
  const server=createServer((req,res)=>{if(req.url?.includes('large'))res.end('x'.repeat(16385));});const port=await start(server);
  const transport=createTestTransport(()=>port,50);
  expect((await transport.send({id,publicToken:'large'},testInputSchema.parse({}))).outcome).toBe('FAILED');
  expect((await transport.send({id,publicToken:'slow'},testInputSchema.parse({}))).outcome).toBe('TIMEOUT');
 });
 it('limits concurrent sends instead of building an unbounded queue',async()=>{
  const server=createServer(()=>{});const port=await start(server);const transport=createTestTransport(()=>port,100);
  const pending=Array.from({length:8},()=>transport.send({id,publicToken:'slow'},testInputSchema.parse({})));
  await expect(transport.send({id,publicToken:'slow'},testInputSchema.parse({}))).rejects.toBeInstanceOf(TestLimitError);await Promise.all(pending);
 });
});
