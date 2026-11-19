import { z } from 'zod';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { requests } from './schema.js';

export const requestFiltersSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
  status: z.coerce.number().int().min(100).max(599).optional(),
  contentType: z.string().trim().max(120).regex(/^[a-z\d!#$&^_.+-]+\/[a-z\d!#$&^_.+-]+$/i).toLowerCase().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  q: z.string().trim().max(200).refine(value=>!value.includes('\0')).optional(),
  sort: z.enum(['newest', 'oldest']).default('newest'),
}).strict().refine(value => !value.from || !value.to || Date.parse(value.from) <= Date.parse(value.to), {
  message: 'from must not be later than to', path: ['to'],
});
export type RequestFilters = z.infer<typeof requestFiltersSchema>;

export function requestConditions(endpointId: string, filters: RequestFilters) {
  return and(
    eq(requests.endpointId, endpointId),
    filters.method ? eq(requests.method, filters.method) : undefined,
    filters.status ? eq(requests.responseStatus, filters.status) : undefined,
    filters.contentType ? sql`lower(trim(split_part(${requests.contentType}, ';', 1))) = ${filters.contentType}` : undefined,
    filters.from ? gte(requests.receivedAt, new Date(filters.from)) : undefined,
    filters.to ? lte(requests.receivedAt, new Date(filters.to)) : undefined,
    // Literal substring search: percent, underscores and SQL syntax have no special meaning.
    filters.q ? sql`strpos(lower(concat_ws(' ', ${requests.id}::text, ${requests.parsedBody}::text, ${requests.headers}::text, ${requests.query}::text, ${requests.contentType})), lower(${filters.q})) > 0` : undefined,
  );
}
