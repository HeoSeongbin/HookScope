import {pool} from './db.js';
import type {AnalyticsRepository,AnalyticsCapture} from './analyticsPolicy.js';

// Read only metadata. No body/header/query/token enters the analytics response.
export const analyticsRepository:AnalyticsRepository={async read(range,endpointId){
 const client=await pool.connect();
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL statement_timeout = '5s'");
  const scope=endpointId??null;
  const params=[range.from,range.to,scope];
  const where='received_at >= $1 AND received_at < $2 AND ($3::uuid IS NULL OR endpoint_id = $3)';
  const {rows:[clock]}=await client.query<{asOf:Date}>('SELECT transaction_timestamp() AS "asOf"');
  const {rows:[overall]}=await client.query<{endpointCount:string;allTimeRequests:string}>(`SELECT
   (SELECT count(*) FROM webhook_endpoints WHERE ($1::uuid IS NULL OR id=$1)) AS "endpointCount",
   (SELECT count(*) FROM webhook_requests WHERE ($1::uuid IS NULL OR endpoint_id=$1)) AS "allTimeRequests"`,[scope]);
  const {rows:[totals]}=await client.query(`SELECT count(*)::float8 AS requests,
   count(*) FILTER (WHERE received_at >= $2::timestamptz - interval '1 hour')::float8 AS "recentHourRequests",
   count(*) FILTER (WHERE response_status >= 400)::float8 AS "plannedErrorResponses",
   count(*) FILTER (WHERE parse_error IS NOT NULL)::float8 AS "parseErrors",
   coalesce(sum(body_size),0)::float8 AS "bodyBytes",
   avg(duration_ms)::float8 AS "capturePreparationAvgMs",
   percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::float8 AS "capturePreparationP95Ms"
   FROM webhook_requests WHERE ${where}`,params);
  const methods=(await client.query<{method:string;count:number}>(`SELECT method,count(*)::float8 AS count FROM webhook_requests WHERE ${where} GROUP BY method ORDER BY count DESC,method`,params)).rows;
  const statuses=(await client.query<{status:number;count:number}>(`SELECT response_status AS status,count(*)::float8 AS count FROM webhook_requests WHERE ${where} GROUP BY response_status ORDER BY response_status`,params)).rows;
  const sources=(await client.query<{source:string;count:number}>(`SELECT source,count(*)::float8 AS count FROM webhook_requests WHERE ${where} GROUP BY source ORDER BY source`,params)).rows;
  const timeline=(await client.query<{hour:Date;count:number}>(`WITH hours AS (
   SELECT generate_series(date_trunc('hour',$1::timestamptz AT TIME ZONE 'UTC'), date_trunc('hour',($2::timestamptz - interval '1 microsecond') AT TIME ZONE 'UTC'),interval '1 hour') AS hour
  ), counts AS (SELECT date_trunc('hour',received_at AT TIME ZONE 'UTC') AS hour,count(*)::float8 AS count FROM webhook_requests WHERE ${where} GROUP BY 1)
  SELECT hours.hour AT TIME ZONE 'UTC' AS hour,coalesce(counts.count,0)::float8 AS count FROM hours LEFT JOIN counts USING(hour) ORDER BY hour`,params)).rows.map(row=>({hour:row.hour.toISOString(),count:row.count}));
  const endpointUsage=(await client.query<{id:string;name:string;count:number}>(`SELECT e.id,e.name,count(r.id)::float8 AS count FROM webhook_endpoints e LEFT JOIN webhook_requests r ON r.endpoint_id=e.id AND r.received_at >= $1 AND r.received_at < $2
   WHERE ($3::uuid IS NULL OR e.id=$3) GROUP BY e.id,e.name ORDER BY count DESC,e.id LIMIT 10`,params)).rows;
  const columns='id,endpoint_id AS "endpointId",method,received_at AS "receivedAt",response_status AS "responseStatus",source,(parse_error IS NOT NULL) AS "parseError"';
  async function recent(errors:boolean):Promise<AnalyticsCapture[]>{
   const rows=(await client.query<Omit<AnalyticsCapture,'receivedAt'>&{receivedAt:Date}>(`SELECT ${columns} FROM webhook_requests WHERE ${where} ${errors?'AND (response_status >= 400 OR parse_error IS NOT NULL)':''} ORDER BY received_at DESC,id DESC LIMIT 5`,params)).rows;
   return rows.map(row=>({...row,receivedAt:row.receivedAt.toISOString()}));
  }
  const recentRequests=await recent(false),recentErrors=await recent(true);
  const attemptWhere='a.started_at >= $1 AND a.started_at < $2 AND ($3::uuid IS NULL OR j.endpoint_id=$3)';
  const {rows:[replay]}=await client.query(`SELECT count(*)::float8 AS attempts,count(a.duration_ms)::float8 AS "timedAttempts",avg(a.duration_ms)::float8 AS "avgDurationMs",percentile_cont(0.95) WITHIN GROUP (ORDER BY a.duration_ms)::float8 AS "p95DurationMs"
   FROM webhook_replay_attempts a JOIN webhook_replay_jobs j ON j.id=a.job_id WHERE ${attemptWhere}`,params);
  const replayStatuses=(await client.query<{status:string;count:number}>(`SELECT a.status,count(*)::float8 AS count FROM webhook_replay_attempts a JOIN webhook_replay_jobs j ON j.id=a.job_id WHERE ${attemptWhere} GROUP BY a.status ORDER BY a.status`,params)).rows;
  await client.query('COMMIT');
  return {endpointId:scope,asOf:clock.asOf.toISOString(),range:{from:range.from.toISOString(),to:range.to.toISOString(),bucket:'hour',timezone:'UTC'},endpointCount:Number(overall.endpointCount),allTimeRequests:Number(overall.allTimeRequests),totals,methods,statuses,sources,timeline,endpointUsage,recentRequests,recentErrors,replay:{...replay,statuses:replayStatuses}};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}};
