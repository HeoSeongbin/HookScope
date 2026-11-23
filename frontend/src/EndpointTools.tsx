import {useEffect,useRef,useState} from 'react';

type Config={mode:'DEFAULT'|'CUSTOM';status:number;contentType:string;body:string;headers:[string,string][];delayMs:number};
type Result={outcome:string;recorded:boolean;requestId:string|null;durationMs:number;response:{status:number;headers:[string,string][];body:string}|null};
type Api=(path:string,options?:RequestInit)=>Promise<unknown>;
const defaults:Config={mode:'DEFAULT',status:200,contentType:'application/json',body:'',headers:[],delayMs:0};
function pairs(input:string):[string,string][]{
  if(!input.trim())return [];
  const parsed:unknown=JSON.parse(input);
  if(!Array.isArray(parsed)||!parsed.every(row=>Array.isArray(row)&&row.length===2&&row.every(item=>typeof item==='string')))throw new Error('헤더와 Query는 [["이름","값"]] 형식으로 입력하세요.');
  return parsed as [string,string][];
}
export function EndpointTools({endpointId,url,api,inspect}:{endpointId:string;url:string;api:Api;inspect:(id:string)=>Promise<void>}){
  const [tab,setTab]=useState('response');
  const [config,setConfig]=useState<Config>(defaults);
  const [headers,setHeaders]=useState('[]');
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [sending,setSending]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [method,setMethod]=useState('POST');
  const [contentType,setContentType]=useState('application/json');
  const [body,setBody]=useState('{"event":"hookscope.test"}');
  const [requestHeaders,setRequestHeaders]=useState('[]');
  const [query,setQuery]=useState('[]');
  const [result,setResult]=useState<Result|null>(null);
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    let current=true;
    void api(`/endpoints/${endpointId}/response`).then(data=>{
      if(!current)return;const value=data as Config;setConfig(value);setHeaders(JSON.stringify(value.headers,null,2));setError('');
    }).catch(e=>{if(current)setError((e as Error).message);}).finally(()=>{if(current)setLoading(false);});
    return()=>{current=false;};
  },[api,endpointId]);
  async function save(e:React.FormEvent){
    e.preventDefault();if(saving)return;setSaving(true);setError('');setNotice('');
    try{
      const value={...config,headers:pairs(headers)};
      const saved=await api(`/endpoints/${endpointId}/response`,{method:'PUT',body:JSON.stringify(value)}) as Config;
      if(mounted.current){setConfig(saved);setHeaders(JSON.stringify(saved.headers,null,2));setNotice('응답 설정을 저장했습니다. 다음 수신 요청부터 적용됩니다.');}
    }catch(e){if(mounted.current)setError((e as Error).message);}finally{if(mounted.current)setSaving(false);}
  }
  async function send(e:React.FormEvent){
    e.preventDefault();if(sending)return;setSending(true);setError('');setResult(null);setNotice('');
    try{
      const data=await api(`/endpoints/${endpointId}/test`,{method:'POST',body:JSON.stringify({method,contentType,body,headers:pairs(requestHeaders),query:pairs(query)})}) as Result;
      if(mounted.current)setResult(data);
    }catch(e){if(mounted.current)setError((e as Error).message);}finally{if(mounted.current)setSending(false);}
  }
  return <section className="endpoint-tools" aria-label="응답 설정 및 테스트 전송">
    <div className="panel-title"><h2>Endpoint 도구</h2><small>현재 선택한 Endpoint에 적용</small></div>
    <div className="tabs"><button className={tab==='response'?'on':''} onClick={()=>setTab('response')}>응답 설정</button><button className={tab==='test'?'on':''} onClick={()=>setTab('test')}>테스트 전송</button></div>
    {error&&<div className="error" role="alert">{error}</div>}{notice&&<div className="notice" role="status">{notice}</div>}
    {tab==='response'?loading?<p className="tool-note">응답 설정 조회 중…</p>:<form className="tool-form" onSubmit={save}>
      <label>응답 모드<select aria-label="응답 모드" value={config.mode} onChange={e=>{if(e.target.value==='DEFAULT'){setConfig({...defaults});setHeaders('[]');}else setConfig({...config,mode:'CUSTOM'});}}><option value="DEFAULT">기본 · 200 접수 응답</option><option value="CUSTOM">사용자 정의</option></select></label>
      <label>HTTP Status<input aria-label="응답 Status" type="number" min={200} max={599} required disabled={config.mode==='DEFAULT'} value={config.status} onChange={e=>setConfig({...config,status:Number(e.target.value)})}/></label>
      <label>Content-Type<select aria-label="응답 Content-Type" disabled={config.mode==='DEFAULT'} value={config.contentType} onChange={e=>setConfig({...config,contentType:e.target.value})}><option>application/json</option><option>text/plain</option></select></label>
      <label>지연 (ms, 최대 2000)<input aria-label="응답 지연" type="number" min={0} max={2000} required disabled={config.mode==='DEFAULT'} value={config.delayMs} onChange={e=>setConfig({...config,delayMs:Number(e.target.value)})}/></label>
      <label className="tool-wide">응답 Body (UTF-8 최대 8 KiB)<textarea aria-label="응답 Body" rows={4} disabled={config.mode==='DEFAULT'} value={config.body} onChange={e=>setConfig({...config,body:e.target.value})}/></label>
      <label className="tool-wide">응답 Header 쌍 · X-Test- / X-Mock- / X-Custom-만 허용<textarea aria-label="응답 Headers" rows={2} disabled={config.mode==='DEFAULT'} value={headers} onChange={e=>setHeaders(e.target.value)}/></label>
      <p className="tool-note tool-wide">204·205·304는 빈 Body만 허용합니다. 기본 모드는 사용자 정의 값을 사용하지 않습니다.</p><button disabled={saving}>{saving?'저장 중…':'응답 설정 저장'}</button>
    </form>:<form className="tool-form" onSubmit={send}>
      <label className="tool-wide">자체 수신 URL<input aria-label="테스트 대상 URL" readOnly value={url}/></label>
      <label>Method<select aria-label="테스트 Method" value={method} onChange={e=>{setMethod(e.target.value);if(e.target.value==='GET')setBody('');}}>{['GET','POST','PUT','PATCH','DELETE'].map(value=><option key={value}>{value}</option>)}</select></label>
      <label>Content-Type<select aria-label="테스트 Content-Type" value={contentType} onChange={e=>setContentType(e.target.value)}>{['application/json','text/plain','application/x-www-form-urlencoded'].map(value=><option key={value}>{value}</option>)}</select></label>
      <label className="tool-wide">Header 쌍 · X-Test- / X-Mock- / X-Custom-, Accept, User-Agent<textarea aria-label="테스트 Headers" rows={2} value={requestHeaders} onChange={e=>setRequestHeaders(e.target.value)}/></label>
      <label className="tool-wide">Query 쌍 · 중복 키 지원<textarea aria-label="테스트 Query" rows={2} value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <label className="tool-wide">Body (UTF-8 최대 8 KiB)<textarea aria-label="테스트 Body" rows={4} disabled={method==='GET'} value={body} onChange={e=>setBody(e.target.value)}/></label>
      <button disabled={sending}>{sending?'전송 중…':'테스트 요청 보내기'}</button><p className="tool-note tool-wide">서버 자신의 Endpoint로 실제 HTTP 요청을 보냅니다. 외부 URL·인증 정보 전송은 지원하지 않습니다. 같은 요청을 반복 실행하면 새 기록이 생성됩니다.</p>
    </form>}
    {tab==='test'&&result&&<div className="test-result" role="status"><h3>전송 결과 · {result.outcome}</h3><p>수신 기록: {result.recorded?'저장됨':'확인되지 않음'} · HTTP {result.response?.status??'응답 없음'} · {result.durationMs} ms</p>{result.requestId&&<button onClick={()=>void inspect(result.requestId!)}>수신 요청 상세 열기</button>}<pre>{result.response?JSON.stringify(result.response,null,2):'전송 실패 또는 시간 초과입니다. 자동 재시도하지 않습니다.'}</pre></div>}
  </section>;
}
