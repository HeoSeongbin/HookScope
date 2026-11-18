export function parseBody(raw:Buffer, contentType:string) {
 const text = raw.toString('utf8');
 const type = contentType.split(';')[0].trim().toLowerCase();
 if (!raw.length) return {parsedBody:null,parseError:null};
 if(type==='application/json' || type.endsWith('+json')) {
  try { return {parsedBody:JSON.parse(text) as unknown,parseError:null}; }
  catch { return {parsedBody:null,parseError:'INVALID_JSON'}; }
 }
 if(type==='application/x-www-form-urlencoded') return {parsedBody:pairs(new URLSearchParams(text)),parseError:null};
 if(type.startsWith('text/') || type==='application/xml') return {parsedBody:text,parseError:null};
 return {parsedBody:null,parseError:null};
}
export function pairs(params:URLSearchParams) {
 const result=new Map<string,string[]>();
 for(const [key,value] of params) {const values=result.get(key)??[];values.push(value);result.set(key,values);}
 return Object.fromEntries(result);
}
export function maskedHeaders(raw:string[]) {
 const result:[string,string][]=[];
 for(let i=0;i<raw.length;i+=2) result.push([raw[i],/authorization|cookie|token|secret|api[-_]key/i.test(raw[i])?'[REDACTED]':raw[i+1]]);
 return result;
}
