import { z } from 'zod';

export const customHeaderName = /^x-(test|mock|custom)-[a-z0-9-]{1,48}$/i;
export const headerValue = z.string().max(512).regex(/^[\t\x20-\x7e]*$/);
const customHeaders = z.array(z.tuple([z.string().regex(customHeaderName), headerValue])).max(12)
  .refine(headers => new Set(headers.map(([name])=>name.toLowerCase())).size===headers.length, 'Duplicate header');
export const responseConfigSchema = z.object({
  mode: z.enum(['DEFAULT','CUSTOM']).default('DEFAULT'),
  status: z.number().int().min(200).max(599).default(200),
  contentType: z.enum(['application/json','text/plain']).default('application/json'),
  body: z.string().refine(value=>Buffer.byteLength(value,'utf8')<=8192, 'Response body exceeds 8 KiB').default(''),
  headers: customHeaders.default([]),
  delayMs: z.number().int().min(0).max(2000).default(0),
}).strict().refine(value=>value.mode!=='CUSTOM'||![204,205,304].includes(value.status)||value.body==='', {
  message:'This status requires an empty body', path:['body'],
});
export type ResponseConfig = z.infer<typeof responseConfigSchema>;
export const defaultResponseConfig: ResponseConfig = responseConfigSchema.parse({});
export function responsePlan(config: ResponseConfig, requestId: string) {
  if(config.mode==='DEFAULT') return {status:200,contentType:'application/json; charset=utf-8',body:JSON.stringify({requestId,message:'Request recorded'}),headers:[] as [string,string][],delayMs:0};
  return {status:config.status,contentType:`${config.contentType}; charset=utf-8`,body:config.body,headers:config.headers,delayMs:config.delayMs};
}
