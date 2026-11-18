import { pgTable, uuid, text, boolean, timestamp, integer, jsonb, index } from 'drizzle-orm/pg-core';
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
  responseStatus:integer('response_status').notNull(), durationMs:integer('duration_ms').notNull()
},t=>[index('requests_endpoint_time_idx').on(t.endpointId,t.receivedAt)]);
