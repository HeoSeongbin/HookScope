import {eq,sql} from 'drizzle-orm';
import {db} from './db.js';
import {endpoints,requests,users} from './schema.js';
import {PolicyError} from './securityPolicy.js';
export type Transaction=Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function enforceCapturePolicy(tx:Transaction,endpointId:string,bodySize:number){
 const [endpoint]=await tx.select().from(endpoints).where(eq(endpoints.id,endpointId)).for('update');
 const [owner]=endpoint?await tx.select({enabled:users.enabled}).from(users).where(eq(users.id,endpoint.ownerId)):[];
 if(!endpoint?.enabled||!owner?.enabled||(endpoint.expiresAt&&endpoint.expiresAt<=new Date()))throw new PolicyError(404,'ENDPOINT_NOT_FOUND');
 const [usage]=await tx.select({count:sql<number>`count(*)::int`,bytes:sql<number>`coalesce(sum(${requests.bodySize}),0)::float8`,recent:sql<number>`count(*) FILTER (WHERE ${requests.receivedAt} > now() - interval '1 minute')::int`}).from(requests).where(eq(requests.endpointId,endpointId));
 if(usage.recent>=endpoint.rateLimitPerMinute)throw new PolicyError(429,'ENDPOINT_RATE_LIMIT');
 if(usage.count>=endpoint.maxRequests||usage.bytes+bodySize>endpoint.maxBodyStorageBytes)throw new PolicyError(429,'ENDPOINT_STORAGE_LIMIT');
}
