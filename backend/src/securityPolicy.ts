import {z} from 'zod';
export const bootstrapId='00000000-0000-4000-8000-000000000001';
export type Principal={id:string;name:string;role:'ADMIN'|'MEMBER'};
export const bootstrapPrincipal:Principal={id:bootstrapId,name:'Local administrator',role:'ADMIN'};
export class PolicyError extends Error {constructor(public status:number,public code:string){super(code);}}
export const endpointPolicySchema=z.object({
 enabled:z.boolean(),expiresAt:z.iso.datetime({offset:true}).nullable(),retentionDays:z.number().int().min(1).max(365).nullable(),
 rateLimitPerMinute:z.number().int().min(1).max(1200),maxRequests:z.number().int().min(1).max(100000),maxBodyStorageBytes:z.number().int().min(1).max(1073741824)
}).strict().refine(value=>value.expiresAt===null||Number.isFinite(Date.parse(value.expiresAt)),{message:'Invalid expiry'});
export const userNameSchema=z.object({name:z.string().trim().min(1).max(80)}).strict();
export const auditQuerySchema=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),endpointId:z.uuid().optional()}).strict();
