import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db, pool } from './db.js';
import { endpoints, requests,responseConfigs } from './schema.js';
import {defaultResponseConfig,responseConfigSchema,type ResponseConfig} from './responsePolicy.js';
import { requestConditions, requestFiltersSchema, type RequestFilters } from './requestFilters.js';
export const repository = {
 ready:async()=>{await pool.query('SELECT source,response_body,response_headers,response_delay_ms FROM webhook_requests LIMIT 0');await pool.query('SELECT 1 FROM webhook_response_configs LIMIT 0');},
 listEndpoints:()=>db.select().from(endpoints).orderBy(desc(endpoints.createdAt)),
 createEndpoint:async(name:string,publicToken:string)=>(await db.insert(endpoints).values({name,publicToken}).returning())[0],
 endpoint:async(id:string)=>(await db.select().from(endpoints).where(eq(endpoints.id,id)))[0],
 resolve:async(token:string)=>(await db.select().from(endpoints).where(and(eq(endpoints.publicToken,token),eq(endpoints.enabled,true))))[0],
 save:async(data:typeof requests.$inferInsert)=>(await db.insert(requests).values(data).returning())[0],
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
