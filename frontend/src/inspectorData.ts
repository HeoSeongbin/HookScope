export function pretty(value: unknown): string {
  try { return JSON.stringify(value, null, 2) ?? '본문 없음'; }
  catch { return '구조가 너무 깊습니다. Raw 탭에서 확인하세요.'; }
}
export function rawBytes(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), character => character.charCodeAt(0));
}
export function isTextual(contentType: string): boolean {
  const type=contentType.split(';')[0].trim().toLowerCase();
  return type.startsWith('text/') || type==='application/json' || type.endsWith('+json') || type==='application/xml' || type.endsWith('+xml') || type==='application/x-www-form-urlencoded';
}
export function headerPairs(input: unknown): [string,string][] {
  return Array.isArray(input) ? input.filter((pair): pair is [string,string] => Array.isArray(pair) && pair.length===2 && pair.every(value=>typeof value==='string')) : [];
}
export function queryPairs(input: unknown): [string,string][] {
  if (!input || typeof input!=='object' || Array.isArray(input)) return [];
  return Object.entries(input).flatMap(([key,values])=>Array.isArray(values)?values.filter((value):value is string=>typeof value==='string').map(value=>[key,value] as [string,string]):[]);
}
export function maskSensitive(value: unknown, depth=0): unknown {
  if(depth>=64)return '[최대 표시 깊이]';
  if(Array.isArray(value))return value.map(item=>maskSensitive(item,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,/password|authorization|cookie|token|secret|api[-_]?key/i.test(key)?'[REDACTED]':maskSensitive(item,depth+1)]));
  return value;
}
