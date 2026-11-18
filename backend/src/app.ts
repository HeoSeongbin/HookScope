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
const log=pino();
export function createApp(repo:Repository,key:string,origin='http://localhost:5173',publish:PublishReceived=()=>{}) {
 if(key.length<32) throw new Error('ADMIN_KEY must contain at least 32 characters');
 const app=express(); app.disable('x-powered-by');app.set('query parser','simple');
 app.use(helmet());app.use(cors({origin,methods:['GET','POST'],allowedHeaders:['Authorization','Content-Type']}));
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
  const stored=await repo.save({endpointId:endpoint.id,method:req.method,path:'/h/[REDACTED]',query:pairs(new URL(req.originalUrl,'http://local').searchParams),headers:maskedHeaders(req.rawHeaders),rawBody:raw.toString('base64'),...parseBody(raw,contentType),contentType,bodySize:raw.length,responseStatus:200,durationMs:Math.round(performance.now()-start)});
  log.info({event:'REQUEST_STORED',requestId:stored.id,endpointId:endpoint.id,method:req.method});
  try {
   publish({event:'webhook:received',endpointId:endpoint.id,requestId:stored.id,method:stored.method,receivedAt:new Date(stored.receivedAt??Date.now()).toISOString()});
  } catch {
   // Notifications are best effort. A committed capture remains successful.
   log.warn({event:'EVENT_PUBLISH_FAILED',requestId:stored.id,endpointId:endpoint.id});
  }
  res.on('finish',()=>log.info({event:'RESPONSE_SENT',requestId:stored.id,responseStatus:res.statusCode}));
  res.status(200).json({requestId:stored.id,message:'Request recorded'});
 });
 const api=express.Router();
 api.use((req,res,next)=>{
  const value=req.get('authorization')??'';
  if(!value.startsWith('Bearer ')||!validAdminKey(value.slice(7),key)){res.status(401).json({error:{code:'UNAUTHORIZED'}});return;} next();
 });
 api.use(rateLimit({windowMs:60_000,limit:300,legacyHeaders:false}));api.use(express.json({limit:'16kb'}));
 api.get('/endpoints',async(_req,res)=>res.json({items:await repo.listEndpoints()}));
 api.post('/endpoints',async(req,res)=>{const {name}=z.object({name:z.string().trim().min(1).max(80)}).parse(req.body);res.status(201).json(await repo.createEndpoint(name,randomBytes(24).toString('hex')));});
 api.get('/endpoints/:id',async(req,res)=>{const item=await repo.endpoint(z.uuid().parse(req.params.id));if(!item){res.status(404).json({error:{code:'NOT_FOUND'}});return;}res.json(item);});
 api.get('/endpoints/:id/requests',async(req,res)=>{const id=z.uuid().parse(req.params.id);const page=z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page);if(!await repo.endpoint(id)){res.status(404).json({error:{code:'NOT_FOUND'}});return;}res.json(await repo.list(id,page));});
 api.get('/requests/:id',async(req,res)=>{const item=await repo.request(z.uuid().parse(req.params.id));if(!item){res.status(404).json({error:{code:'NOT_FOUND'}});return;}res.json({...item,rawEncoding:'base64'});});
 app.use('/api/v1',api);
 app.use((_req,res)=>res.status(404).json({error:{code:'NOT_FOUND'}}));
 app.use((err:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  const bodyError=err as {type?:string;status?:number};
  const status=err instanceof z.ZodError?400:bodyError.status===413?413:bodyError.status===415?415:bodyError.status===400?400:503;
  const code=status===413?'BODY_TOO_LARGE':status===415?'UNSUPPORTED_ENCODING':status===400?'INVALID_INPUT':'STORAGE_UNAVAILABLE';
  log.error({event:'REQUEST_FAILED',errorCode:code});res.status(status).json({error:{code}});
 });return app;
}
