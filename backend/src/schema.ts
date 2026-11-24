import { pgTable, uuid, text, boolean, timestamp, integer, jsonb, index,uniqueIndex,type AnyPgColumn } from 'drizzle-orm/pg-core';
export const endpoints = pgTable('webhook_endpoints', {
  id: uuid('id').primaryKey().defaultRandom(), name: text('name').notNull(),
  publicToken: text('public_token').notNull().unique(), enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', {withTimezone:true}).notNull().defaultNow()
});
export const requests = pgTable('webhook_requests', {
  id: uuid('id').primaryKey().defaultRandom(), endpointId: uuid('endpoint_id').notNull().references(()=>endpoints.id,{onDelete:'cascade'}),
  method:text('method').notNull(), path:text('path').notNull(), query:jsonb('query').notNull(),
  headers:jsonb('headers').notNull(), rawBody:text('raw_body').notNull(), parsedBody:jsonb('parsed_body'),
  parseError:text('parse_error'), contentType:text('content_type').notNull(), bodySize:integer('body_size').notNull(),
  receivedAt:timestamp('received_at',{withTimezone:true}).notNull().defaultNow(),
  responseStatus:integer('response_status').notNull(), durationMs:integer('duration_ms').notNull(),
  responseBody:text('response_body'),responseHeaders:jsonb('response_headers'),
  responseDelayMs:integer('response_delay_ms').notNull().default(0),source:text('source').notNull().default('EXTERNAL')
  ,replayAttemptId:uuid('replay_attempt_id').unique().references(():AnyPgColumn=>replayAttempts.id,{onDelete:'set null'})
},t=>[index('requests_endpoint_time_idx').on(t.endpointId,t.receivedAt)]);
export const responseConfigs=pgTable('webhook_response_configs',{
  endpointId:uuid('endpoint_id').primaryKey().references(()=>endpoints.id,{onDelete:'cascade'}),
  mode:text('mode').notNull().default('DEFAULT'),status:integer('status').notNull().default(200),
  contentType:text('content_type').notNull().default('application/json'),body:text('body').notNull().default(''),
  headers:jsonb('headers').notNull().default([]),delayMs:integer('delay_ms').notNull().default(0),
  updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
});
export const replayJobs=pgTable('webhook_replay_jobs',{
 id:uuid('id').primaryKey().defaultRandom(),endpointId:uuid('endpoint_id').notNull().references(()=>endpoints.id,{onDelete:'cascade'}),
 originalRequestId:uuid('original_request_id').notNull().references(()=>requests.id,{onDelete:'cascade'}),idempotencyKey:uuid('idempotency_key').notNull().unique(),
 maxAttempts:integer('max_attempts').notNull(),status:text('status').notNull().default('PENDING'),lastError:text('last_error'),
 queueName:text('queue_name').notNull().default('hookscope-internal-replay'),nextAttemptAt:timestamp('next_attempt_at',{withTimezone:true}),
 createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[index('replay_jobs_endpoint_time_idx').on(t.endpointId,t.createdAt),index('replay_jobs_status_idx').on(t.status)]);
export const replayAttempts=pgTable('webhook_replay_attempts',{
 id:uuid('id').primaryKey().defaultRandom(),jobId:uuid('job_id').notNull().references(()=>replayJobs.id,{onDelete:'cascade'}),number:integer('number').notNull(),requestId:uuid('request_id').notNull().unique(),
 status:text('status').notNull().default('RUNNING'),errorCode:text('error_code'),responseStatus:integer('response_status'),responseBody:text('response_body'),responseHeaders:jsonb('response_headers'),durationMs:integer('duration_ms'),
 startedAt:timestamp('started_at',{withTimezone:true}).notNull().defaultNow(),finishedAt:timestamp('finished_at',{withTimezone:true}),
},t=>[uniqueIndex('replay_attempts_job_number_idx').on(t.jobId,t.number)]);
