import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import {randomBytes,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {z} from 'zod';
import pino from 'pino';
import {parseBody,pairs,maskedHeaders} from './body.js';
import type {Repository} from './repository.js';
import {validAdminKey} from './auth.js';
import type {PublishReceived} from './realtime.js';
import {requestFiltersSchema} from './requestFilters.js';
import {responseConfigSchema,responsePlan,customHeaderName} from './responsePolicy.js';
import {testInputSchema,TestLimitError,type TestTransport} from './testSender.js';
import {setTimeout as delay} from 'node:timers/promises';
import type {ReplayService} from './replayService.js';
import {ReplayError} from './replayPolicy.js';
import {analyticsRange,type AnalyticsRepository} from './analyticsPolicy.js';
import type {SecurityService} from './securityService.js';
import {PolicyError,bootstrapPrincipal} from './securityPolicy.js';
const log=pino();
export function createApp(repo:Repository,key:string,origin='http://localhost:5173',publish:PublishReceived=()=>{},tests?:TestTransport,replays?:ReplayService,analytics?:AnalyticsRepository,security?:SecurityService) {
 if(key.length<32) throw new Error('ADMIN_KEY must contain at least 32 characters');
 const app=express(); app.disable('x-powered-by');app.set('query parser','simple');
 app.use(helmet());app.use(cors({origin,methods:['GET','POST','PUT','PATCH','DELETE'],allowedHeaders:['Authorization','Content-Type']}));
 app.use((req,res,next)=>{res.setHeader('X-Request-Id',randomUUID());res.setHeader('Cache-Control','no-store');next();});
 app.get('/health/live',(_req,res)=>res.json({status:'live'}));
 app.get('/health/ready',async(_req,res)=>{try{await repo.ready();res.json({status:'ready'});}catch{res.status(503).json({error:{code:'NOT_READY'}});}});
 const intake=rateLimit({windowMs:60_000,limit:120,standardHeaders:'draft-8',legacyHeaders:false});
 app.all('/h/:token',intake,(req,res,next)=>{
  if(!['GET','POST','PUT','PATCH','DELETE'].includes(req.method)){res.setHeader('Allow','GET, POST, PUT, PATCH, DELETE');res.status(405).json({error:{code:'METHOD_NOT_ALLOWED'}});return;}
  if(req.originalUrl.length>8192){res.status(414).json({error:{code:'URL_TOO_LONG'}});return;}next();
 },express.raw({type:()=>true,limit:'256kb',inflate:false}),async(req,res)=>{
  const start=performance.now(); const endpoint=await repo.resolve(String(req.params.token));
  if(!endpoint){res.status(404).json({error:{code:'ENDPOINT_NOT_FOUND'}});return;}
  const raw=Buffer.isBuffer(req.body)?req.body:Buffer.alloc(0);const contentType=req.get('content-type')??'';
  const replayProof=req.get('x-hookscope-internal-replay');
  if(replayProof&&!replays)throw new ReplayError(503,'REPLAY_UNAVAILABLE');
  const replayAttempt=await replays?.verify(replayProof,endpoint.id,req.method,raw,new URL(req.originalUrl,'http://local').searchParams.toString());
  const testId=tests?.claim(req.get('x-hookscope-internal-test-token'),endpoint.id);
  const requestId=replayAttempt?.requestId??testId??String(res.getHeader('X-Request-Id'));
  const plan=responsePlan(await repo.response(endpoint.id),requestId);
  res.status(plan.status);res.setHeader('X-Request-Id',requestId);
  if(![204,205,304].includes(plan.status))res.setHeader('Content-Type',plan.contentType);
  if(plan.status!==204&&plan.status!==304)res.setHeader('Content-Length',Buffer.byteLength(plan.body));
  for(const [name,value] of plan.headers)res.setHeader(name,value);
  const responseHeaders=maskedHeaders(Object.entries(res.getHeaders()).flatMap(([name,value])=>[name,String(value)]));
  const rawHeaders:string[]=[];
  for(let i=0;i<req.rawHeaders.length;i+=2)if(!['x-hookscope-internal-test-token','x-hookscope-internal-replay'].includes(req.rawHeaders[i].toLowerCase()))rawHeaders.push(req.rawHeaders[i],req.rawHeaders[i+1]);
  const data={id:requestId,endpointId:endpoint.id,method:req.method,path:'/h/[REDACTED]',query:pairs(new URL(req.originalUrl,'http://local').searchParams),headers:maskedHeaders(rawHeaders),rawBody:raw.toString('base64'),...parseBody(raw,contentType),contentType,bodySize:raw.length,responseStatus:plan.status,responseBody:plan.body,responseHeaders,responseDelayMs:plan.delayMs,source:replayAttempt?'REPLAY':testId?'TEST':'EXTERNAL',durationMs:Math.round(performance.now()-start)};
  const result=replayAttempt&&replays?await replays.store(replayAttempt.id,data):{capture:await repo.save(data),created:true};
  const stored=result.capture;
  if(!result.created){
   for(const name of res.getHeaderNames())res.removeHeader(name);
   for(const pair of stored.responseHeaders as [string,string][])if(pair[1]!=='[REDACTED]')res.setHeader(pair[0],pair[1]);
   res.status(stored.responseStatus).end(stored.responseBody??'');return;
  }
  log.info({event:'REQUEST_STORED',requestId:stored.id,endpointId:endpoint.id,method:req.method});
  try {
   await publish({event:'webhook:received',endpointId:endpoint.id,requestId:stored.id,method:stored.method,receivedAt:new Date(stored.receivedAt??Date.now()).toISOString()});
  } catch {
   // Notifications are best effort. A committed capture remains successful.
   log.warn({event:'EVENT_PUBLISH_FAILED',requestId:stored.id,endpointId:endpoint.id});
  }
  res.on('finish',()=>log.info({event:'RESPONSE_SENT',requestId:stored.id,responseStatus:res.statusCode}));
  res.on('close',()=>{if(!res.writableFinished)log.warn({event:'RESPONSE_ABORTED',requestId:stored.id});});
  if(plan.delayMs)await delay(plan.delayMs);
  if(!res.destroyed)res.end(plan.body);
 });
 const api=express.Router();
 api.use(rateLimit({windowMs:60_000,limit:300,standardHeaders:'draft-8',legacyHeaders:false,handler:(_req,res)=>res.status(429).json({error:{code:'MANAGEMENT_RATE_LIMIT'}})}));
 api.use(async(req,res,next)=>{
  const value=req.get('authorization')??'';
  const principal=value.startsWith('Bearer ')?security?await security.authenticate(value.slice(7)):validAdminKey(value.slice(7),key)?bootstrapPrincipal:undefined:undefined;
  if(!principal){res.status(401).json({error:{code:'UNAUTHORIZED'}});return;}res.locals.principal=principal;res.locals.repo=security?security.scope(repo,principal):repo;next();
 });
 api.use(express.json({limit:'16kb'}));
 api.use(rateLimit({windowMs:60_000,limit:300,legacyHeaders:false,keyGenerator:(_req,res)=>String(res.locals.principal.id),handler:(_req,res)=>res.status(429).json({error:{code:'MANAGEMENT_RATE_LIMIT'}})}));
 api.use(async(req,res,next)=>{
  if(!security)return next();
  const scoped=res.locals.repo as Repository;
  // Express routes are case-insensitive; ownership guards must use the same matching rule.
  const endpoint=req.path.match(/^\/endpoints\/([^/]+)/i),capture=req.path.match(/^\/requests\/([^/]+)/i),job=req.path.match(/^\/replays\/([^/]+)/i);
  if(endpoint){const id=z.uuid().parse(endpoint[1]);if(!await scoped.endpoint(id))throw new PolicyError(404,'NOT_FOUND');}
  if(capture){const id=z.uuid().parse(capture[1]);if(!await scoped.request(id))throw new PolicyError(404,'NOT_FOUND');}
  if(job&&replays){let value;try{value=await replays.job(z.uuid().parse(job[1]));}catch(error){if(error instanceof ReplayError&&error.status===404)throw new PolicyError(404,'NOT_FOUND');throw error;}if(!await scoped.endpoint(value.endpointId))throw new PolicyError(404,'NOT_FOUND');}
  next();
 });
 api.get('/auth/me',(_req,res)=>res.json(res.locals.principal));
 if(security){
  api.get('/users',async(_req,res)=>res.json(await security.listUsers(res.locals.principal)));
  api.post('/users',async(req,res)=>res.status(201).json(await security.createUser(res.locals.principal,req.body)));
  api.patch('/users/:id',async(req,res)=>{const {enabled}=z.object({enabled:z.boolean()}).strict().parse(req.body);res.json(await security.changeUser(res.locals.principal,z.uuid().parse(req.params.id),enabled));});
  api.post('/users/:id/rotate-key',async(req,res)=>res.json(await security.rotateUser(res.locals.principal,z.uuid().parse(req.params.id))));
  api.get('/audit',async(req,res)=>res.json(await security.audit(res.locals.principal,req.query)));
  api.post('/endpoints/:id/cleanup',async(req,res)=>res.json(await security.cleanup(repo,res.locals.principal,z.uuid().parse(req.params.id))));
  api.put('/endpoints/:id/policy',async(req,res)=>res.json(await security.policy(repo,res.locals.principal,z.uuid().parse(req.params.id),req.body)));
  api.post('/endpoints/:id/rotate-token',async(req,res)=>res.json(await security.rotateEndpoint(repo,res.locals.principal,z.uuid().parse(req.params.id))));
  api.delete('/endpoints/:id/requests',async(req,res)=>res.json(await security.clear(repo,res.locals.principal,z.uuid().parse(req.params.id))));
  api.delete('/endpoints/:id',async(req,res)=>res.json(await security.clear(repo,res.locals.principal,z.uuid().parse(req.params.id),true)));
 }
 api.get('/endpoints',async(_req,res)=>res.json({items:await (res.locals.repo as Repository).listEndpoints()}));
 api.get('/dashboard/summary',async(req,res)=>{const range=analyticsRange(req.query);if(!analytics){res.status(503).json({error:{code:'ANALYTICS_UNAVAILABLE'}});return;}res.json(await (security&&res.locals.principal.role==='MEMBER'?analytics.read(range,undefined,res.locals.principal.id):analytics.read(range)));});
 api.get('/endpoints/:id/statistics',async(req,res)=>{const id=z.uuid().parse(req.params.id);const range=analyticsRange(req.query);if(!await (res.locals.repo as Repository).endpoint(id)){res.status(404).json({error:{code:'NOT_FOUND'}});return;}if(!analytics){res.status(503).json({error:{code:'ANALYTICS_UNAVAILABLE'}});return;}res.json(await (security&&res.locals.principal.role==='MEMBER'?analytics.read(range,id,res.locals.principal.id):analytics.read(range,id)));});
 api.post('/endpoints',async(req,res)=>{const {name}=z.object({name:z.string().trim().min(1).max(80)}).strict().parse(req.body);res.status(201).json(await (res.locals.repo as Repository).createEndpoint(name,randomBytes(24).toString('hex')));});
 api.get('/endpoints/:id',async(req,res)=>{const item=await (res.locals.repo as Repository).endpoint(z.uuid().parse(req.params.id));if(!item){res.status(404).json({error:{code:'NOT_FOUND'}});return;}res.json(item);});
 api.get('/endpoints/:id/requests',async(req,res)=>{const id=z.uuid().parse(req.params.id);const filters=requestFiltersSchema.parse(req.query);if(!await (res.locals.repo as Repository).endpoint(id)){res.status(404).json({error:{code:'NOT_FOUND'}});return;}res.json(await (res.locals.repo as Repository).list(id,filters));});
 api.get('/endpoints/:id/response',async(req,res)=>{const id=z.uuid().parse(req.params.id);if(!await (res.locals.repo as Repository).endpoint(id)){res.status(404).json({error:{code:'NOT_FOUND'}});return;}res.json(await (res.locals.repo as Repository).response(id));});
 api.put('/endpoints/:id/response',async(req,res)=>{const id=z.uuid().parse(req.params.id);const config=responseConfigSchema.parse(req.body);if(!await (res.locals.repo as Repository).endpoint(id)){res.status(404).json({error:{code:'NOT_FOUND'}});return;}res.json(await (res.locals.repo as Repository).setResponse(id,config));});
 api.post('/endpoints/:id/test',rateLimit({windowMs:60_000,limit:20,legacyHeaders:false}),async(req,res)=>{
  const id=z.uuid().parse(req.params.id);const input=testInputSchema.parse(req.body);
  const endpoint=await (res.locals.repo as Repository).endpoint(id);if(!endpoint){res.status(404).json({error:{code:'NOT_FOUND'}});return;}
  if(!endpoint.enabled){res.status(409).json({error:{code:'ENDPOINT_DISABLED'}});return;}
  if(!tests){res.status(503).json({error:{code:'TEST_UNAVAILABLE'}});return;}
  const delivery=await tests.send(endpoint,input);
  const capture=await (res.locals.repo as Repository).request(delivery.correlationId);
  const recorded=!!capture&&capture.endpointId===id&&capture.source==='TEST';
  res.json({outcome:delivery.outcome,response:delivery.response,durationMs:delivery.durationMs,recorded,requestId:recorded?capture.id:null});
 });
 api.get('/requests/:id',async(req,res)=>{const item=await (res.locals.repo as Repository).request(z.uuid().parse(req.params.id));if(!item){res.status(404).json({error:{code:'NOT_FOUND'}});return;}res.json({...item,rawEncoding:'base64'});});
 api.post('/requests/:id/replay',rateLimit({windowMs:60_000,limit:20,legacyHeaders:false}),async(req,res)=>{const id=z.uuid().parse(req.params.id);if(!replays)throw new ReplayError(503,'REPLAY_UNAVAILABLE');res.status(202).json(security?await replays.create(id,req.body,res.locals.principal):await replays.create(id,req.body));});
 api.get('/endpoints/:id/replays',async(req,res)=>{const id=z.uuid().parse(req.params.id);if(!replays)throw new ReplayError(503,'REPLAY_UNAVAILABLE');res.json(await replays.list(id,req.query));});
 api.get('/replays/:id',async(req,res)=>{const id=z.uuid().parse(req.params.id);if(!replays)throw new ReplayError(503,'REPLAY_UNAVAILABLE');res.json(await replays.job(id));});
 api.get('/replays/:id/attempts',async(req,res)=>{const id=z.uuid().parse(req.params.id);if(!replays)throw new ReplayError(503,'REPLAY_UNAVAILABLE');res.json(await replays.attempts(id));});
 api.post('/replays/:id/cancel',async(req,res)=>{const id=z.uuid().parse(req.params.id);if(!replays)throw new ReplayError(503,'REPLAY_UNAVAILABLE');res.json(await replays.cancel(id,security?res.locals.principal:undefined));});
 app.use('/api/v1',api);
 app.use((_req,res)=>res.status(404).json({error:{code:'NOT_FOUND'}}));
 app.use((err:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  const bodyError=err as {type?:string;status?:number};
  const status=err instanceof PolicyError?err.status:err instanceof ReplayError?err.status:err instanceof TestLimitError?429:err instanceof z.ZodError?400:bodyError.status===413?413:bodyError.status===415?415:bodyError.status===400?400:503;
  const code=err instanceof PolicyError?err.code:err instanceof ReplayError?err.code:status===429?'TEST_CONCURRENCY_LIMIT':status===413?'BODY_TOO_LARGE':status===415?'UNSUPPORTED_ENCODING':status===400?'INVALID_INPUT':'STORAGE_UNAVAILABLE';
  res.removeHeader('Content-Length');res.removeHeader('Content-Type');
  for(const name of res.getHeaderNames())if(customHeaderName.test(name))res.removeHeader(name);
  log.error({event:'REQUEST_FAILED',errorCode:code});res.status(status).json({error:{code}});
 });return app;
}
