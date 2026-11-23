export type Endpoint = {id:string;name:string;publicToken:string;enabled:boolean};
export type Capture = {id:string;endpointId?:string;method:string;receivedAt:string;contentType:string;bodySize:number;responseStatus:number;parseError:string|null;headers?:unknown;query?:unknown;parsedBody?:unknown;rawBody?:string;durationMs?:number;source?:'EXTERNAL'|'TEST';responseBody?:string|null;responseHeaders?:unknown;responseDelayMs?:number};
export type Filters = {q:string;method:string;status:string;contentType:string;from:string;to:string;sort:string};
export const emptyFilters: Filters = {q:'',method:'',status:'',contentType:'',from:'',to:'',sort:'newest'};
export function filterParams(filters: Filters, page: number) {
  const params = new URLSearchParams({page:String(page)});
  for (const [key,value] of Object.entries(filters)) {
    if (!value) continue;
    params.set(key, key==='from'||key==='to' ? new Date(value).toISOString() : value);
  }
  return params.toString();
}
