import {createHash,randomBytes} from 'node:crypto';
import {and,desc,eq,sql} from 'drizzle-orm';
import {db} from './db.js';
import {users,endpoints,requests,responseConfigs,replayJobs,auditLogs} from './schema.js';
import {validAdminKey} from './auth.js';
import type {Repository} from './repository.js';
import {bootstrapId,bootstrapPrincipal,PolicyError,endpointPolicySchema,userNameSchema,auditQuerySchema,type Principal} from './securityPolicy.js';
import {cleanupExpired} from './retention.js';
import {recordAudit} from './audit.js';

const digest=(key:string)=>createHash('sha256').update(key).digest('hex');
const credential=()=>{const key='hsu_'+randomBytes(32).toString('base64url');return {key,keyHash:digest(key),keyExpiresAt:new Date(Date.now()+30*86400000)};};
export function createSecurityService(adminKey:string){
 let revoked:(id:string)=>void=()=>{};
 const admin=(p:Principal)=>{if(p.role!=='ADMIN')throw new PolicyError(403,'ADMIN_REQUIRED');};
 const metadata={id:users.id,name:users.name,role:users.role,enabled:users.enabled,keyExpiresAt:users.keyExpiresAt,createdAt:users.createdAt};
 function scope(repo:Repository,p:Principal):Repository{
  const owned=p.role==='ADMIN'?undefined:eq(endpoints.ownerId,p.id);
  const scoped={...repo,
   listEndpoints:async()=>db.select().from(endpoints).where(owned).orderBy(desc(endpoints.createdAt)),
   endpoint:async(id:string)=>(await db.select().from(endpoints).where(and(eq(endpoints.id,id),owned)))[0],
   request:async(id:string)=>(await db.select({capture:requests}).from(requests).innerJoin(endpoints,eq(endpoints.id,requests.endpointId)).where(and(eq(requests.id,id),owned)))[0]?.capture,
   createEndpoint:async(name:string,publicToken:string)=>db.transaction(async tx=>{
    const [user]=await tx.select().from(users).where(eq(users.id,p.id)).for('update');if(!user?.enabled)throw new PolicyError(401,'UNAUTHORIZED');
    const [{count}]=await tx.select({count:sql<number>`count(*)::int`}).from(endpoints).where(eq(endpoints.ownerId,p.id));if(count>=(p.role==='ADMIN'?1000:20))throw new PolicyError(429,'ENDPOINT_QUOTA');
    const [row]=await tx.insert(endpoints).values({name,publicToken,ownerId:p.id}).returning();await recordAudit(tx,p,p.id,'ENDPOINT_CREATED',row.id);return row;
   }),
   setResponse:async(endpointId:string,config:Parameters<Repository['setResponse']>[1])=>db.transaction(async tx=>{
    const [endpoint]=await tx.select().from(endpoints).where(and(eq(endpoints.id,endpointId),owned)).for('update');if(!endpoint)throw new PolicyError(404,'NOT_FOUND');
    await tx.insert(responseConfigs).values({endpointId,...config}).onConflictDoUpdate({target:responseConfigs.endpointId,set:{...config,updatedAt:new Date()}});
    await recordAudit(tx,p,endpoint.ownerId,'RESPONSE_CONFIG_UPDATED',endpointId,{mode:config.mode,status:config.status,delayMs:config.delayMs});return config;
   })
  };return scoped;
 }
 return {
  scope,
  onRevoke(fn:(id:string)=>void){revoked=fn;},
  async authenticate(candidate:unknown):Promise<Principal|undefined>{
   if(validAdminKey(candidate,adminKey))return bootstrapPrincipal;
   if(typeof candidate!=='string'||!/^hsu_[A-Za-z0-9_-]{43}$/.test(candidate))return;
   const [user]=await db.select().from(users).where(and(eq(users.keyHash,digest(candidate)),eq(users.enabled,true)));
   if(user?.role==='MEMBER'&&user.keyExpiresAt&&user.keyExpiresAt>new Date())return {id:user.id,name:user.name,role:'MEMBER'};
  },
  async listUsers(p:Principal){admin(p);return {items:await db.select(metadata).from(users).orderBy(desc(users.createdAt)).limit(100)};},
  async createUser(p:Principal,input:unknown){admin(p);const {name}=userNameSchema.parse(input);const {key,...stored}=credential();const user=await db.transaction(async tx=>{const [row]=await tx.insert(users).values({name,...stored}).returning(metadata);await recordAudit(tx,p,p.id,'USER_CREATED',row.id);return row;});return {...user,key};},
  async changeUser(p:Principal,id:string,enabled:boolean){admin(p);if(id===bootstrapId)throw new PolicyError(409,'BOOTSTRAP_ACCOUNT_PROTECTED');const user=await db.transaction(async tx=>{const [row]=await tx.update(users).set({enabled}).where(eq(users.id,id)).returning(metadata);if(!row)throw new PolicyError(404,'NOT_FOUND');await recordAudit(tx,p,p.id,enabled?'USER_ENABLED':'USER_DISABLED',id);return row;});if(!enabled)revoked(id);return user;},
  async rotateUser(p:Principal,id:string){admin(p);if(id===bootstrapId)throw new PolicyError(409,'BOOTSTRAP_ACCOUNT_PROTECTED');const {key,...stored}=credential();const user=await db.transaction(async tx=>{const [row]=await tx.update(users).set(stored).where(eq(users.id,id)).returning(metadata);if(!row)throw new PolicyError(404,'NOT_FOUND');await recordAudit(tx,p,p.id,'USER_KEY_ROTATED',id);return row;});revoked(id);return {...user,key};},
  async policy(repo:Repository,p:Principal,id:string,input:unknown){const value=endpointPolicySchema.parse(input);if(!await scope(repo,p).endpoint(id))throw new PolicyError(404,'NOT_FOUND');return db.transaction(async tx=>{const [row]=await tx.update(endpoints).set({...value,expiresAt:value.expiresAt?new Date(value.expiresAt):null}).where(eq(endpoints.id,id)).returning();if(!row)throw new PolicyError(404,'NOT_FOUND');await recordAudit(tx,p,row.ownerId,'ENDPOINT_POLICY_UPDATED',id,value);return row;});},
  async rotateEndpoint(repo:Repository,p:Principal,id:string){if(!await scope(repo,p).endpoint(id))throw new PolicyError(404,'NOT_FOUND');return db.transaction(async tx=>{const [row]=await tx.update(endpoints).set({publicToken:randomBytes(24).toString('hex')}).where(eq(endpoints.id,id)).returning();if(!row)throw new PolicyError(404,'NOT_FOUND');await recordAudit(tx,p,row.ownerId,'ENDPOINT_TOKEN_ROTATED',id);return row;});},
  async clear(repo:Repository,p:Principal,id:string,removeEndpoint=false){if(!await scope(repo,p).endpoint(id))throw new PolicyError(404,'NOT_FOUND');return db.transaction(async tx=>{
   const [endpoint]=await tx.select().from(endpoints).where(eq(endpoints.id,id)).for('update');if(!endpoint)throw new PolicyError(404,'NOT_FOUND');
   const active=await tx.select({id:replayJobs.id}).from(replayJobs).where(and(eq(replayJobs.endpointId,id),sql`${replayJobs.status} IN ('PENDING','QUEUED','RUNNING','RETRYING')`)).limit(1);if(active.length)throw new PolicyError(409,'REPLAY_IN_PROGRESS');
   const [{count}]=await tx.select({count:sql<number>`count(*)::int`}).from(requests).where(eq(requests.endpointId,id));
   await tx.delete(replayJobs).where(eq(replayJobs.endpointId,id));await tx.delete(requests).where(eq(requests.endpointId,id));if(removeEndpoint)await tx.delete(endpoints).where(eq(endpoints.id,id));
   await recordAudit(tx,p,endpoint.ownerId,removeEndpoint?'ENDPOINT_DELETED':'HISTORY_CLEARED',id,{requests:count});return {deletedRequests:count};
  });},
  async cleanup(repo:Repository,p:Principal,id:string){if(!await scope(repo,p).endpoint(id))throw new PolicyError(404,'NOT_FOUND');return cleanupExpired(id,p.id);},
  async audit(p:Principal,input:unknown){const {page,endpointId}=auditQuerySchema.parse(input);return db.transaction(async tx=>{const where=and(p.role==='ADMIN'?undefined:eq(auditLogs.ownerId,p.id),endpointId?eq(auditLogs.targetId,endpointId):undefined);const [{count}]=await tx.select({count:sql<number>`count(*)::int`}).from(auditLogs).where(where);const items=await tx.select().from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt),desc(auditLogs.id)).limit(30).offset((page-1)*30);return {items,total:count,page,pageSize:30};},{isolationLevel:'repeatable read',accessMode:'read only'});}
 };
}
export type SecurityService=ReturnType<typeof createSecurityService>;
