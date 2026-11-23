import {describe,it,expect,vi} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/app.js';
import {parseBody,maskedHeaders} from '../src/body.js';
import type {Repository} from '../src/repository.js';
import {defaultResponseConfig} from '../src/responsePolicy.js';
const id='9aa82a1c-4dd8-4568-8021-cd71f55080bb';
const key='a'.repeat(40);
function fixture(){
 const repo={ready:vi.fn().mockResolvedValue(undefined),response:vi.fn().mockResolvedValue(defaultResponseConfig),listEndpoints:vi.fn().mockResolvedValue([]),createEndpoint:vi.fn().mockImplementation(async(name,publicToken)=>({id,name,publicToken})),endpoint:vi.fn().mockResolvedValue({id}),resolve:vi.fn().mockResolvedValue({id}),save:vi.fn().mockImplementation(async d=>({...d,id})),list:vi.fn().mockResolvedValue({items:[],page:1,pageSize:30,total:0}),request:vi.fn().mockResolvedValue(undefined)} as unknown as Repository;
 return {repo,app:createApp(repo,key)};
}
describe('HTTP ingestion and management boundary',()=>{
 it('rejects unauthenticated management access',async()=>{const {app}=fixture();expect((await request(app).get('/api/v1/endpoints')).status).toBe(401);});
 it('generates a separate random public token',async()=>{const {app}=fixture();const r=await request(app).post('/api/v1/endpoints').auth(key,{type:'bearer'}).send({name:'test'});expect(r.status).toBe(201);expect(r.body.publicToken).toMatch(/^[a-f0-9]{48}$/);expect(r.body.publicToken).not.toBe(key);});
 it('preserves raw bytes and duplicate queries, masks secrets',async()=>{const {app,repo}=fixture();const raw='{ "hello": "세계" }';const r=await request(app).post('/h/token?a=1&a=2').set('Content-Type','application/json').set('Authorization','secret').send(raw);expect(r.status).toBe(200);expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({rawBody:Buffer.from(raw).toString('base64'),query:{a:['1','2']},parsedBody:{hello:'세계'},headers:expect.arrayContaining([['Authorization','[REDACTED]']])}));});
 it('records malformed JSON with parse error',async()=>{const {app,repo}=fixture();expect((await request(app).post('/h/token').set('Content-Type','application/json').send('{oops')).status).toBe(200);expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({parseError:'INVALID_JSON'}));});
 it.each(['get','put','patch','delete'] as const)('accepts %s',async method=>{const {app}=fixture();expect((await request(app)[method]('/h/token')).status).toBe(200);});
 it('rejects oversize bodies before storage',async()=>{const {app,repo}=fixture();expect((await request(app).post('/h/token').set('Content-Type','text/plain').send('x'.repeat(262145))).status).toBe(413);expect(repo.save).not.toHaveBeenCalled();});
 it('does not acknowledge failed persistence',async()=>{const {app,repo}=fixture();vi.mocked(repo.save).mockRejectedValue(new Error('database password should never leak'));const r=await request(app).post('/h/token').send('text');expect(r.status).toBe(503);expect(JSON.stringify(r.body)).not.toContain('password');});
 it('rejects unknown tokens and unsupported methods',async()=>{const {app,repo}=fixture();vi.mocked(repo.resolve).mockResolvedValue(undefined as never);expect((await request(app).get('/h/unknown')).status).toBe(404);expect((await request(app).options('/h/token')).status).toBe(204);expect((await request(app).head('/h/token')).status).toBe(405);});
 it('validates IDs, names, and page limits',async()=>{const {app}=fixture();expect((await request(app).post('/api/v1/endpoints').auth(key,{type:'bearer'}).send({name:''})).status).toBe(400);expect((await request(app).get('/api/v1/requests/bad').auth(key,{type:'bearer'})).status).toBe(400);});
 it('reports DB readiness independently of liveness',async()=>{const {app,repo}=fixture();vi.mocked(repo.ready).mockRejectedValue(new Error());expect((await request(app).get('/health/ready')).status).toBe(503);expect((await request(app).get('/health/live')).status).toBe(200);});
});
describe('body parsing',()=>{
 it('keeps duplicate form keys',()=>expect(parseBody(Buffer.from('x=1&x=2'),'application/x-www-form-urlencoded').parsedBody).toEqual({x:['1','2']}));
 it('treats prototype-like keys as ordinary data',()=>{const body=parseBody(Buffer.from('__proto__=x&constructor=y'),'application/x-www-form-urlencoded').parsedBody as Record<string,string[]>;expect(Object.hasOwn(body,'__proto__')).toBe(true);expect(body.constructor).toEqual(['y']);});
 it('keeps text, treats binary as raw only',()=>{expect(parseBody(Buffer.from('hello'),'text/plain').parsedBody).toBe('hello');expect(parseBody(Buffer.from([255]),'application/octet-stream').parsedBody).toBeNull();});
 it('preserves duplicate non-secret headers',()=>expect(maskedHeaders(['X-Test','1','X-Test','2','Cookie','private'])).toEqual([['X-Test','1'],['X-Test','2'],['Cookie','[REDACTED]']]));
});
