import {pool} from './db.js';
import {bootstrapId} from './securityPolicy.js';
// Bounded sweep; active and terminal Replay references pin requests until explicit history removal.
export async function cleanupExpired(endpointId?:string,actorId=bootstrapId){
 const client=await pool.connect();try{
  await client.query('BEGIN');const {rows:[lock]}=await client.query('SELECT pg_try_advisory_xact_lock(720185) AS held');if(!lock.held){await client.query('ROLLBACK');return {deletedRequests:0,busy:true};}
  await client.query("SET LOCAL statement_timeout = '5s'");
  const {rows}=await client.query<{id:string;owner_id:string;retention_days:number}>(`SELECT e.id,e.owner_id,e.retention_days FROM webhook_endpoints e WHERE ($1::uuid IS NULL OR e.id=$1) AND e.retention_days IS NOT NULL AND EXISTS (SELECT 1 FROM webhook_requests r WHERE r.endpoint_id=e.id AND r.received_at < now()-(e.retention_days * interval '1 day') AND r.replay_attempt_id IS NULL AND NOT EXISTS (SELECT 1 FROM webhook_replay_jobs j WHERE j.original_request_id=r.id)) ORDER BY e.id LIMIT 20 FOR UPDATE SKIP LOCKED`,[endpointId??null]);
  let deletedRequests=0;
  for(const endpoint of rows){
   const result=await client.query(`DELETE FROM webhook_requests WHERE id IN (SELECT r.id FROM webhook_requests r WHERE r.endpoint_id=$1 AND r.received_at < now()-($2::int * interval '1 day') AND r.replay_attempt_id IS NULL AND NOT EXISTS (SELECT 1 FROM webhook_replay_jobs j WHERE j.original_request_id=r.id) ORDER BY r.received_at LIMIT 100) RETURNING id`,[endpoint.id,endpoint.retention_days]);
   if(result.rowCount){deletedRequests+=result.rowCount;await client.query("INSERT INTO audit_logs(actor_id,owner_id,action,target_id,details) VALUES($1,$2,'RETENTION_CLEANUP',$3,$4)",[actorId,endpoint.owner_id,endpoint.id,JSON.stringify({requests:result.rowCount})]);}
  }
  if(!endpointId)await client.query("DELETE FROM audit_logs WHERE id IN (SELECT id FROM audit_logs WHERE created_at < now()-interval '90 days' ORDER BY created_at LIMIT 500)");
  await client.query('COMMIT');return {deletedRequests,busy:false};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
