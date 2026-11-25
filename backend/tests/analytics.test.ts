import {describe,it,expect,vi} from 'vitest';
import request from 'supertest';
import {analyticsRange,type AnalyticsRepository} from '../src/analyticsPolicy.js';
import {createApp} from '../src/app.js';
import type {Repository} from '../src/repository.js';
const id='9aa82a1c-4dd8-4568-8021-cd71f55080bb',key='a'.repeat(40);
describe('analytics range contract',()=>{
 it('uses a bounded last-24-hour default and explicit offsets',()=>{
  const now=new Date('2026-11-25T03:00:00Z');
  expect(analyticsRange({},now)).toEqual({from:new Date('2026-11-24T03:00:00Z'),to:now});
  expect(analyticsRange({from:'2026-11-25T09:00:00+09:00',to:'2026-11-25T12:00:00+09:00'}).from.toISOString()).toBe('2026-11-25T00:00:00.000Z');
 });
 it('allows exactly 31 days and defaults from relative to explicit to',()=>{
  expect(analyticsRange({from:'2026-01-01T00:00:00Z',to:'2026-02-01T00:00:00Z'}).from.getUTCDate()).toBe(1);
  expect(analyticsRange({to:'2026-01-02T00:00:00Z'}).from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
 });
 it.each([{from:'bad'},{to:'2026-02-30T00:00:00Z'},{to:'2026-01-01T00:00:00+24:00'},{from:'2026-11-25T00:00:00'}, {from:['2026-01-01T00:00:00Z']},{unknown:'x'},{bucket:'minute'},{from:'2026-01-02T00:00:00Z',to:'2026-01-01T00:00:00Z'},{from:'2026-01-01T00:00:00Z',to:'2026-01-01T00:00:00Z'},{from:'2026-01-01T00:00:00Z',to:'2026-02-01T00:00:00.001Z'}])('rejects invalid/unbounded query %j',query=>expect(()=>analyticsRange(query)).toThrow());
});
describe('authenticated analytics HTTP boundary (repository double)',()=>{
 function setup(){const repo={endpoint:vi.fn().mockResolvedValue({id})} as unknown as Repository;const read=vi.fn().mockResolvedValue({totals:{requests:0}});return {repo,read,app:createApp(repo,key,undefined,undefined,undefined,undefined,{read} as AnalyticsRepository)};}
 it.each(['/api/v1/dashboard/summary',`/api/v1/endpoints/${id}/statistics`])('rejects missing and public credentials for %s',async path=>{
  const {app,read}=setup();expect((await request(app).get(path)).status).toBe(401);expect((await request(app).get(path).auth('public-token',{type:'bearer'})).status).toBe(401);expect(read).not.toHaveBeenCalled();
 });
 it('passes the validated original endpoint and range and never accepts a caller scope override',async()=>{
  const {app,read}=setup();const response=await request(app).get(`/api/v1/endpoints/${id}/statistics?from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z`).auth(key,{type:'bearer'});
  expect(response.status).toBe(200);expect(response.headers['cache-control']).toBe('no-store');expect(read).toHaveBeenCalledWith({from:new Date('2026-01-01T00:00:00Z'),to:new Date('2026-01-02T00:00:00Z')},id);
  expect((await request(app).get(`/api/v1/endpoints/${id}/statistics?endpointId=other`).auth(key,{type:'bearer'})).status).toBe(400);expect(read).toHaveBeenCalledOnce();
 });
 it('uses global scope only on the separately authenticated summary route',async()=>{const {app,read}=setup();expect((await request(app).get('/api/v1/dashboard/summary').auth(key,{type:'bearer'})).status).toBe(200);expect(read.mock.calls[0]).toHaveLength(1);});
 it('rejects missing endpoints, invalid IDs and duplicate ranges before reading analytics',async()=>{
  const {app,repo,read}=setup();vi.mocked(repo.endpoint).mockResolvedValueOnce(undefined as never);
  expect((await request(app).get(`/api/v1/endpoints/${id}/statistics`).auth(key,{type:'bearer'})).status).toBe(404);
  expect((await request(app).get('/api/v1/endpoints/bad/statistics').auth(key,{type:'bearer'})).status).toBe(400);
  expect((await request(app).get('/api/v1/dashboard/summary?from=a&from=b').auth(key,{type:'bearer'})).status).toBe(400);expect(read).not.toHaveBeenCalled();
 });
 it('returns storage failure instead of plausible zero statistics',async()=>{
  const {app,read}=setup();read.mockRejectedValueOnce(new Error('DB offline'));
  const response=await request(app).get('/api/v1/dashboard/summary').auth(key,{type:'bearer'});expect(response.status).toBe(503);expect(response.body).toEqual({error:{code:'STORAGE_UNAVAILABLE'}});
 });
});
