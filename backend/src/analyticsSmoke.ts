import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {createApp} from './app.js';
import {analyticsRepository} from './analyticsRepository.js';
import type {AnalyticsResult} from './analyticsPolicy.js';
import {repository} from './repository.js';
import {pool} from './db.js';

const key=randomBytes(32).toString('hex');
const server=createApp(repository,key,undefined,undefined,undefined,undefined,analyticsRepository).listen(0,'127.0.0.1');await once(server,'listening');
const address=server.address();if(!address||typeof address==='string')throw new Error('Missing address');const base=`http://127.0.0.1:${address.port}`;
const headers={Authorization:`Bearer ${key}`,'Content-Type':'application/json'},ids:string[]=[];
const range='from=2001-01-01T00:00:00Z&to=2001-01-01T02:00:00Z';
async function create(){const response=await fetch(base+'/api/v1/endpoints',{method:'POST',headers,body:JSON.stringify({name:'Phase 6 analytics smoke'})});assert.equal(response.status,201);const endpoint=await response.json() as {id:string;publicToken:string};ids.push(endpoint.id);return endpoint;}
async function stats(endpointId?:string,query=range){const response=await fetch(base+(endpointId?`/api/v1/endpoints/${endpointId}/statistics`:'/api/v1/dashboard/summary')+'?'+query,{headers});assert.equal(response.status,200);return await response.json() as AnalyticsResult;}
try{
 const a=await create(),b=await create(),empty=await create();
 const captures:string[]=[];
 // Actual ingestion followed by explicit metadata fixtures gives deterministic boundary tests.
 for(const [endpoint,method,body] of [[a,'POST','{"ok":true}'],[a,'GET',null],[a,'POST','{broken'],[a,'PATCH','end boundary'],[a,'POST','before boundary'],[b,'PUT','foreign']] as const){
  const response=await fetch(`${base}/h/${endpoint.publicToken}`,{method,headers:{'Content-Type':'application/json'},body});assert.equal(response.status,200);captures.push((await response.json() as {requestId:string}).requestId);
 }
 const times=['2001-01-01T00:00:00Z','2001-01-01T00:59:59.999Z','2001-01-01T01:00:00Z','2001-01-01T02:00:00Z','2000-12-31T23:59:59.999Z','2001-01-01T00:30:00Z'];
 for(let i=0;i<captures.length;i++)await pool.query('UPDATE webhook_requests SET received_at=$1,duration_ms=$2,response_status=$3,source=$4 WHERE id=$5',[times[i],(i+1)*10,[200,404,500,200,200,200][i],['EXTERNAL','TEST','REPLAY','EXTERNAL','EXTERNAL','EXTERNAL'][i],captures[i]]);
 const jobId=randomUUID();await pool.query("INSERT INTO webhook_replay_jobs(id,endpoint_id,original_request_id,idempotency_key,max_attempts,status) VALUES($1,$2,$3,$4,3,'UNKNOWN')",[jobId,a.id,captures[0],randomUUID()]);
 for(const [number,status,duration,started] of [[1,'SUCCEEDED',100,'2001-01-01T00:20:00Z'],[2,'UNKNOWN',null,'2001-01-01T01:20:00Z'],[3,'FAILED',300,'2001-01-01T02:00:00Z']] as const)await pool.query('INSERT INTO webhook_replay_attempts(job_id,number,request_id,status,duration_ms,started_at) VALUES($1,$2,$3,$4,$5,$6)',[jobId,number,randomUUID(),status,duration,started]);
 const result=await stats(a.id);
 assert.equal(result.endpointCount,1);assert.equal(result.allTimeRequests,5);assert.equal(result.totals.requests,3);assert.equal(result.totals.recentHourRequests,1);assert.equal(result.totals.plannedErrorResponses,2);assert.equal(result.totals.parseErrors,1);
 assert.equal(result.totals.capturePreparationAvgMs,20);assert.equal(result.totals.capturePreparationP95Ms,29);assert.equal(result.totals.bodyBytes,Buffer.byteLength('{"ok":true}')+Buffer.byteLength('{broken'));
 assert.deepEqual(result.methods,[{method:'POST',count:2},{method:'GET',count:1}]);assert.deepEqual(result.statuses,[{status:200,count:1},{status:404,count:1},{status:500,count:1}]);assert.equal(result.sources.length,3);
 assert.deepEqual(result.timeline,[{hour:'2001-01-01T00:00:00.000Z',count:2},{hour:'2001-01-01T01:00:00.000Z',count:1}]);assert.equal(result.timeline.reduce((sum,row)=>sum+row.count,0),result.totals.requests);
 assert.deepEqual(result.recentErrors.map(row=>row.id),[captures[2],captures[1]]);assert.equal(result.recentRequests.length,3);
 assert.equal(result.replay.attempts,2);assert.equal(result.replay.timedAttempts,1);assert.equal(result.replay.avgDurationMs,100);assert.equal(result.replay.p95DurationMs,100);assert.equal(result.replay.statuses.length,2);
 const global=await stats();assert.equal(global.totals.requests,4);assert(global.endpointUsage.some(row=>row.id===b.id&&row.count===1));
 const none=await stats(empty.id);assert.equal(none.totals.requests,0);assert.equal(none.totals.capturePreparationAvgMs,null);assert.equal(none.replay.avgDurationMs,null);assert.equal(none.timeline.length,2);assert(none.timeline.every(row=>row.count===0));assert.deepEqual(none.recentErrors,[]);
 const offset=await stats(a.id,'from=2001-01-01T09:00:00%2B09:00&to=2001-01-01T11:00:00%2B09:00');assert.deepEqual(offset.totals,result.totals);
 const partial=await stats(a.id,'from=2001-01-01T00:30:00Z&to=2001-01-01T01:00:00Z');assert.equal(partial.timeline.length,1);assert.equal(partial.totals.requests,1);
 const maximum=await stats(empty.id,'from=2001-01-01T00:30:00Z&to=2001-02-01T00:30:00Z');assert.equal(maximum.timeline.length,745);
 const serialized=JSON.stringify(result);for(const secret of ['rawBody','parsedBody','headers','query','publicToken','{broken'])assert(!serialized.includes(secret));
 assert.equal((await fetch(base+'/api/v1/dashboard/summary')).status,401);
 console.log('PASS: actual PostgreSQL analytics, UTC/offset and partial-hour boundaries, totals/distributions, endpoint isolation, zero fill, null timing, P95, replay time separation and metadata-only responses');
}finally{
 await pool.query('DELETE FROM webhook_endpoints WHERE id=ANY($1::uuid[])',[ids]);await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await pool.end();
}
