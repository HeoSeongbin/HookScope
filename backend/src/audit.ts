import {auditLogs} from './schema.js';
import type {Principal} from './securityPolicy.js';
import type {Transaction} from './capturePolicy.js';
export async function recordAudit(tx:Transaction,actor:Principal,ownerId:string,action:string,targetId:string,details:Record<string,unknown>={}){
 await tx.insert(auditLogs).values({actorId:actor.id,ownerId,action,targetId,details});
}
