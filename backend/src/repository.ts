import { and, desc, eq, sql } from 'drizzle-orm';
import { db, pool } from './db.js';
import { endpoints, requests } from './schema.js';
export const repository = {
 ready:async()=>{await pool.query('SELECT 1 FROM webhook_requests LIMIT 0');},
 listEndpoints:()=>db.select().from(endpoints).orderBy(desc(endpoints.createdAt)),
 createEndpoint:async(name:string,publicToken:string)=>(await db.insert(endpoints).values({name,publicToken}).returning())[0],
 endpoint:async(id:string)=>(await db.select().from(endpoints).where(eq(endpoints.id,id)))[0],
 resolve:async(token:string)=>(await db.select().from(endpoints).where(and(eq(endpoints.publicToken,token),eq(endpoints.enabled,true))))[0],
 save:async(data:typeof requests.$inferInsert)=>(await db.insert(requests).values(data).returning())[0],
 list:async(endpointId:string,page:number)=>({items:await db.select({id:requests.id,endpointId:requests.endpointId,method:requests.method,contentType:requests.contentType,bodySize:requests.bodySize,receivedAt:requests.receivedAt,responseStatus:requests.responseStatus,parseError:requests.parseError}).from(requests).where(eq(requests.endpointId,endpointId)).orderBy(desc(requests.receivedAt),desc(requests.id)).limit(30).offset((page-1)*30),total:Number((await db.select({count:sql<number>`count(*)`}).from(requests).where(eq(requests.endpointId,endpointId)))[0].count),page,pageSize:30}),
 request:async(id:string)=>(await db.select().from(requests).where(eq(requests.id,id)))[0]
};
export type Repository = typeof repository;
