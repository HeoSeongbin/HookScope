import {describe,it,expect,vi} from 'vitest';
import request from 'supertest';
import {endpointPolicySchema,bootstrapPrincipal,PolicyError} from '../src/securityPolicy.js';
import {createApp} from '../src/app.js';
import type {SecurityService} from '../src/securityService.js';
import type {Repository} from '../src/repository.js';
import type {ReplayService} from '../src/replayService.js';
import type {AnalyticsRepository} from '../src/analyticsPolicy.js';
const id='9aa82a1c-4dd8-4568-8021-cd71f55080bb',member={id:'9aa82a1c-4dd8-4568-8021-cd71f55080bc',name:'Member',role:'MEMBER' as const},key='a'.repeat(40);
const policy={enabled:true,expiresAt:null,retentionDays:7,rateLimitPerMinute:120,maxRequests:10000,maxBodyStorageBytes:67108864};
describe('endpoint operations policy',()=>{
 it('allows explicit legacy manual retention and expiry',()=>expect(endpointPolicySchema.parse({...policy,expiresAt:'2026-12-01T00:00:00Z',retentionDays:null})).toMatchObject({retentionDays:null}));
 it.each([{maxRequests:0},{maxRequests:100001},{retentionDays:0},{retentionDays:366},{rateLimitPerMinute:0},{rateLimitPerMinute:1201},{maxBodyStorageBytes:0},{maxBodyStorageBytes:1073741825},{enabled:'true'},{expiresAt:'bad'},{expiresAt:'2026-12-01T00:00:00+24:00'},{ownerId:id},{publicToken:'forged'}])('rejects invalid or privilege-changing policy %j',change=>expect(endpointPolicySchema.safeParse({...policy,...change}).success).toBe(false));
});
describe('management ownership boundary (repository double)',()=>{
 function setup(){const repo={endpoint:vi.fn().mockResolvedValue(undefined),request:vi.fn().mockResolvedValue(undefined),listEndpoints:vi.fn().mockResolvedValue([])} as unknown as Repository;
  const security={authenticate:vi.fn(async(value:string)=>value==='member-key'?member:value===key?bootstrapPrincipal:undefined),scope:vi.fn(()=>repo),clear:vi.fn(),policy:vi.fn(),createUser:vi.fn(async()=>{throw new PolicyError(403,'ADMIN_REQUIRED');})} as unknown as SecurityService;
  const replays={job:vi.fn().mockResolvedValue({id,endpointId:id}),cancel:vi.fn(),create:vi.fn(),attempts:vi.fn()} as unknown as ReplayService;
  const analytics={read:vi.fn().mockResolvedValue({totals:{requests:0}})} as unknown as AnalyticsRepository;
  return {repo,security,replays,analytics,app:createApp(repo,key,undefined,undefined,undefined,replays,analytics,security)};
 }
 it.each([['get',`/api/v1/endpoints/${id}/requests`],['put',`/api/v1/endpoints/${id}/response`],['post',`/api/v1/endpoints/${id}/test`],['put',`/api/v1/endpoints/${id}/policy`],['delete',`/api/v1/endpoints/${id}/requests`],['get',`/api/v1/requests/${id}`],['post',`/api/v1/requests/${id}/replay`],['get',`/api/v1/REPLAYS/${id}`],['get',`/api/v1/RePlAyS/${id}/attempts`],['post',`/api/v1/REPLAYS/${id}/cancel`],['post',`/api/v1/REQUESTS/${id}/replay`],['put',`/api/v1/ENDPOINTS/${id}/policy`],['get',`/api/v1/replays/${id}`],['get',`/api/v1/replays/${id}/attempts`],['post',`/api/v1/replays/${id}/cancel`]])('hides unowned resource on %s %s',async(method,path)=>{
  const {app,security,replays}=setup();const agent=request(app);const result=await (method==='get'?agent.get(path):method==='put'?agent.put(path):method==='delete'?agent.delete(path):agent.post(path)).auth('member-key',{type:'bearer'}).send({});
  expect(result.status).toBe(404);expect(security.clear).not.toHaveBeenCalled();expect(security.policy).not.toHaveBeenCalled();expect(replays.create).not.toHaveBeenCalled();expect(replays.cancel).not.toHaveBeenCalled();expect(replays.attempts).not.toHaveBeenCalled();
 });
 it('scopes global analytics to authenticated member identity, never a query owner override',async()=>{const {app,analytics}=setup();expect((await request(app).get('/api/v1/dashboard/summary').auth('member-key',{type:'bearer'})).status).toBe(200);expect(vi.mocked(analytics.read).mock.calls[0][2]).toBe(member.id);expect((await request(app).get('/api/v1/dashboard/summary?ownerId=other').auth('member-key',{type:'bearer'})).status).toBe(400);});
 it('keeps admin provisioning separate and fails authentication for revoked/public keys',async()=>{const {app}=setup();expect((await request(app).post('/api/v1/users').auth('member-key',{type:'bearer'}).send({name:'x'})).status).toBe(403);expect((await request(app).get('/api/v1/endpoints').auth('public-token',{type:'bearer'})).status).toBe(401);expect((await request(app).get('/api/v1/auth/me').auth('member-key',{type:'bearer'})).body.id).toBe(member.id);});
});
