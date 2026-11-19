import {describe,it,expect,vi} from 'vitest';
import request from 'supertest';
import {requestFiltersSchema} from '../src/requestFilters.js';
import {createApp} from '../src/app.js';
import type {Repository} from '../src/repository.js';
import {filterParams,emptyFilters} from '../../frontend/src/types.js';
import {rawBytes,headerPairs,queryPairs,maskSensitive,isTextual} from '../../frontend/src/inspectorData.js';
const id='9aa82a1c-4dd8-4568-8021-cd71f55080bb';
const key='a'.repeat(40);
describe('request filter validation and authenticated API',()=>{
 it('normalizes valid filters and preserves literal keywords',()=>{
  expect(requestFiltersSchema.parse({page:'2',method:'POST',status:'200',contentType:' Application/JSON ',q:' %_ ',from:'2026-11-19T00:00:00+09:00'})).toEqual({page:2,method:'POST',status:200,contentType:'application/json',q:'%_',from:'2026-11-19T00:00:00+09:00',sort:'newest'});
 });
 it.each([{page:0},{page:1.5},{page:10001},{method:'TRACE'},{status:99},{contentType:'json'},{from:'yesterday'},{from:'2026-11-20T00:00:00Z',to:'2026-11-19T00:00:00Z'},{q:'x'.repeat(201)},{q:'\0'},{sort:'random'},{q:['a','b']},{unknown:'x'}])('rejects invalid query %j',query=>expect(requestFiltersSchema.safeParse(query).success).toBe(false));
 it('keeps endpoint scoping and passes parsed filters to the repository',async()=>{
  const repo={endpoint:vi.fn().mockResolvedValue({id}),list:vi.fn().mockResolvedValue({items:[],total:0,page:2,pageSize:30})} as unknown as Repository;
  const app=createApp(repo,key);
  expect((await request(app).get(`/api/v1/endpoints/${id}/requests?q=test`)).status).toBe(401);
  const response=await request(app).get(`/api/v1/endpoints/${id}/requests?page=2&method=GET&q=%25_`).auth(key,{type:'bearer'});
  expect(response.status).toBe(200);
  expect(repo.list).toHaveBeenCalledWith(id,{page:2,method:'GET',q:'%_',sort:'newest'});
  const invalid=await request(app).get(`/api/v1/endpoints/${id}/requests?from=bad`).auth(key,{type:'bearer'});
  expect(invalid.status).toBe(400);expect(repo.list).toHaveBeenCalledOnce();
 });
});
describe('inspector data and filter serialization',()=>{
 it('serializes local date filters to explicit UTC instants',()=>{
  const query=new URLSearchParams(filterParams({...emptyFilters,q:'한글 %_',from:'2026-11-19T12:00:00'},2));
  expect(query.get('from')).toBe(new Date('2026-11-19T12:00:00').toISOString());expect(query.get('q')).toBe('한글 %_');expect(query.get('page')).toBe('2');
 });
 it('preserves duplicate pairs and special keys',()=>{
  expect(headerPairs([['X-Test','a'],['X-Test','b'],['bad'],null])).toEqual([['X-Test','a'],['X-Test','b']]);
  expect(queryPairs(JSON.parse('{"__proto__":["a","b"]}'))).toEqual([['__proto__','a'],['__proto__','b']]);
 });
 it('decodes binary bytes without text normalization',()=>{
  expect(Array.from(rawBytes(Buffer.from([0,255,128,10]).toString('base64')))).toEqual([0,255,128,10]);expect(isTextual('application/problem+json; charset=utf-8')).toBe(true);expect(isTextual('multipart/form-data')).toBe(false);
 });
 it('masks sensitive JSON keys without changing stored data',()=>{
  const source={customer:{api_key:'private',name:'Heo'},tokens:['a'],items:[{password:'hidden'}]};
  expect(maskSensitive(source)).toEqual({customer:{api_key:'[REDACTED]',name:'Heo'},tokens:'[REDACTED]',items:[{password:'[REDACTED]'}]});expect(source.customer.api_key).toBe('private');
 });
});
