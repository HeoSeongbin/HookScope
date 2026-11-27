import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db, pool } from './db.js';
import { endpoints, requests,responseConfigs,users } from './schema.js';
import {defaultResponseConfig,responseConfigSchema,type ResponseConfig} from './responsePolicy.js';
import {enforceCapturePolicy} from './capturePolicy.js';
import { requestConditions, requestFiltersSchema, type RequestFilters } from './requestFilters.js';
export const repository = {
 ready:async()=>{await pool.query('SELECT source,response_body,response_headers,response_delay_ms,replay_attempt_id FROM webhook_requests LIMIT 0');await pool.query('SELECT 1 FROM webhook_response_configs LIMIT 0');await pool.query('SELECT 1 FROM webhook_replay_attempts LIMIT 0');await pool.query('SELECT owner_id,retention_days FROM webhook_endpoints LIMIT 0');await pool.query('SELECT 1 FROM management_users LIMIT 0');await pool.query('SELECT 1 FROM audit_logs LIMIT 0');},
 listEndpoints:async()=>db.select().from(endpoints).orderBy(desc(endpoints.createdAt)),
 createEndpoint:async(name:string,publicToken:string)=>(await db.insert(endpoints).values({name,publicToken}).returning())[0],
 endpoint:async(id:string)=>(await db.select().from(endpoints).where(eq(endpoints.id,id)))[0],
 resolve:async(token:string)=>(await db.select({endpoint:endpoints}).from(endpoints).innerJoin(users,eq(users.id,endpoints.ownerId)).where(and(eq(endpoints.publicToken,token),eq(endpoints.enabled,true),eq(users.enabled,true),sql`(${endpoints.expiresAt} IS NULL OR ${endpoints.expiresAt} > now())`)))[0]?.endpoint,
 save:async(data:typeof requests.$inferInsert)=>db.transaction(async tx=>{await enforceCapturePolicy(tx,data.endpointId,data.bodySize);return (await tx.insert(requests).values(data).returning())[0];}),
 response:async(endpointId:string):Promise<ResponseConfig>=>{const [row]=await db.select().from(responseConfigs).where(eq(responseConfigs.endpointId,endpointId));return row?responseConfigSchema.parse({mode:row.mode,status:row.status,body:row.body,contentType:row.contentType,headers:row.headers,delayMs:row.delayMs}):{...defaultResponseConfig};},
 setResponse:async(endpointId:string,config:ResponseConfig)=>{await db.insert(responseConfigs).values({endpointId,...config}).onConflictDoUpdate({target:responseConfigs.endpointId,set:{...config,updatedAt:new Date()}});return config;},
 list:async(endpointId:string,filters:RequestFilters=requestFiltersSchema.parse({}))=>db.transaction(async tx=>{
  const where=requestConditions(endpointId,filters);
  const order=filters.sort==='oldest'?asc:desc;
  const [{count}]=await tx.select({count:sql<number>`count(*)`}).from(requests).where(where);
  const items=await tx.select({id:requests.id,endpointId:requests.endpointId,method:requests.method,contentType:requests.contentType,bodySize:requests.bodySize,receivedAt:requests.receivedAt,responseStatus:requests.responseStatus,parseError:requests.parseError,source:requests.source}).from(requests).where(where).orderBy(order(requests.receivedAt),order(requests.id)).limit(30).offset((filters.page-1)*30);
  return {items,total:Number(count),page:filters.page,pageSize:30};
 },{isolationLevel:'repeatable read',accessMode:'read only'}),
 request:async(id:string)=>(await db.select().from(requests).where(eq(requests.id,id)))[0]
};
export type Repository = typeof repository;
