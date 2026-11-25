import React,{useState,useEffect,useCallback,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {Radio,Plus,Copy,RefreshCw,ArrowDownLeft,Shield,Terminal,Inbox,LogOut} from 'lucide-react';
import './style.css';
import {useRealtime,connectionLabels} from './useRealtime';
import {RequestInspector} from './RequestInspector';
import {EndpointTools} from './EndpointTools';
import {ReplayCenter} from './ReplayCenter';
import {AnalyticsPanel} from './AnalyticsPanel';
import {RequestFilters} from './RequestFilters';
import {emptyFilters,filterParams,type Filters,type Endpoint,type Capture} from './types';
function App(){
 const [key,setKey]=useState(''),[draft,setDraft]=useState(''),[endpoints,setEndpoints]=useState<Endpoint[]>([]),[active,setActive]=useState(''),[items,setItems]=useState<Capture[]>([]),[total,setTotal]=useState(0),[page,setPage]=useState(1),[detail,setDetail]=useState<Capture|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[name,setName]=useState(''),[notice,setNotice]=useState('');
 const api=useCallback(async(path:string,options:RequestInit={})=>{const r=await fetch('/api/v1'+path,{...options,headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`}});const data=await r.json();if(!r.ok)throw new Error(data.error?.code??'요청 실패');return data;},[key]);
 const [filters,setFilters]=useState<Filters>({...emptyFilters});
 const [analyticsCapture,setAnalyticsCapture]=useState<{id:string;endpointId:string}|null>(null);
 const generation=useRef(0);
 const selection=useRef(0);
 const load=useCallback(async()=>{
  if(!key)return;
  const version=++generation.current;setBusy(true);
  try{
   const [data,list]=await Promise.all([api('/endpoints'),active?api(`/endpoints/${active}/requests?${filterParams(filters,page)}`):Promise.resolve(null)]);
   if(version!==generation.current)return;
   setEndpoints(data.items);
   if(!active&&data.items[0])setActive(data.items[0].id);
   if(list){const last=Math.max(1,Math.ceil(list.total/list.pageSize));if(page>last){setPage(last);return;}setItems(list.items);setTotal(list.total);}
   setError('');
  }catch(e){if(version===generation.current)setError((e as Error).message);}
  finally{if(version===generation.current)setBusy(false);}
 },[api,key,active,page,filters]);
 useEffect(()=>{void load();return()=>{generation.current++;};},[load]);
 useEffect(()=>{selection.current++;setDetail(null);setItems([]);setTotal(0);},[active,key,filters,page]);
 useEffect(()=>{if(analyticsCapture&&analyticsCapture.endpointId===active){void inspect(analyticsCapture.id);setAnalyticsCapture(null);}},[analyticsCapture,active]);
 const connection=useRealtime(key,active,load);
 const endpoint=endpoints.find(e=>e.id===active);const url=endpoint?`${window.location.origin}/h/${endpoint.publicToken}`:'';
 async function create(e:React.FormEvent){e.preventDefault();generation.current++;try{const item=await api('/endpoints',{method:'POST',body:JSON.stringify({name})});generation.current++;setName('');setEndpoints(previous=>[item,...previous]);setActive(item.id);setPage(1);setDetail(null);}catch(e){setError((e as Error).message);}}
 async function inspect(id:string){const version=++selection.current;try{const item=await api('/requests/'+id);if(version===selection.current)setDetail(item);}catch(e){if(version===selection.current)setError((e as Error).message);}}
 async function copy(value:string){try{await navigator.clipboard.writeText(value);setNotice('클립보드에 복사했습니다.');}catch{setError('복사할 수 없습니다. URL을 직접 선택해 복사해 주세요.');}}
 if(!key)return <div className="login"><div className="brand"><Radio/> HookScope<span>LOCAL CONSOLE</span></div><h1>Webhook을 들여다보는<br/>가장 명확한 방법.</h1><p>요청을 수신하고, 원본 데이터를 확인하세요.</p><form onSubmit={e=>{e.preventDefault();setKey(draft);setDraft('');}}><label htmlFor="key">개발용 관리 키</label><input id="key" type="password" value={draft} onChange={e=>setDraft(e.target.value)} required minLength={32} placeholder=".env의 ADMIN_KEY"/><button>관리 콘솔 열기 →</button></form><small><Shield size={14}/> 키는 현재 화면의 메모리에만 보관됩니다.</small></div>;
 return <div className="shell"><aside><div className="brand"><Radio/> HookScope</div><div className="workspace">개발 워크스페이스 <span>LOCAL</span></div><div className="nav selected"><Inbox size={18}/> 요청 모니터</div><div className="section-label">ENDPOINTS <span>{endpoints.length}</span></div><div className="endpoint-list">{endpoints.map(e=><button className={'endpoint '+(active===e.id?'active':'')} key={e.id} onClick={()=>{setActive(e.id);setPage(1);setDetail(null);}}><span className="dot"/>{e.name}</button>)}</div><form onSubmit={create} className="create"><input aria-label="엔드포인트 이름" placeholder="새 엔드포인트 이름" value={name} onChange={e=>setName(e.target.value)} required maxLength={80}/><button title="엔드포인트 생성"><Plus size={17}/></button></form><div className="aside-bottom"><Shield size={15}/> 관리 API 인증 사용 중<button title="로그아웃" onClick={()=>{setKey('');setFilters({...emptyFilters});setPage(1);setItems([]);setDetail(null);setEndpoints([]);setActive('');}}><LogOut size={16}/></button></div></aside><main><header><span>워크스페이스 <b>/</b> 요청 모니터</span><span className={"phase connection-"+connection} role="status"><span className="dot"/> {connectionLabels[connection]}</span></header><section className="content"><div className="heading"><div><div className="eyebrow">WEBHOOK INSPECTOR</div><h1>요청 모니터<span>.</span></h1><p>들어오는 모든 요청을 한 곳에서 확인하세요.</p></div><button className="secondary" onClick={()=>void load()} disabled={busy}><RefreshCw size={15}/>{busy?'조회 중…':'새로고침'}</button></div>{error&&<div role="alert" className="error">{error}</div>}{notice&&<div role="status" className="notice" onClick={()=>setNotice('')}>{notice}</div>}<div className="url-card"><div className="url-icon"><ArrowDownLeft size={22}/></div><div><div className="section-label">WEBHOOK 수신 URL</div><code>{url||'왼쪽에서 엔드포인트를 생성하세요.'}</code></div><button className="secondary" disabled={!url} onClick={()=>void copy(url)}><Copy size={14}/> URL 복사</button></div><div className="metrics"><div><span>엔드포인트</span><strong>{endpoints.length}<small>개</small></strong></div><div><span>조건에 맞는 요청</span><strong>{total}<small>건</small></strong></div><div><span>본문 크기 제한</span><strong>256<small>KB / 요청</small></strong></div><div><span>저장소</span><strong className="storage">PostgreSQL<small>영속 저장</small></strong></div></div><AnalyticsPanel key={"analytics-"+active} endpointId={active} api={api} openCapture={(id,endpointId)=>{setActive(endpointId);setPage(1);setFilters({...emptyFilters});setAnalyticsCapture({id,endpointId});}}/><RequestFilters apply={next=>{generation.current++;setFilters(next);setPage(1);}}/><div className="monitor"><section className="request-panel"><div className="panel-title"><h2>수신 요청 <span>{total}</span></h2><small>{filters.sort==='oldest'?'오래된순':'최신순'}</small></div><div className="table-head"><span>METHOD / 수신 시각</span><span>STATUS</span></div>{items.length===0?<div className="empty"><Inbox size={32}/><h3>{Object.entries(filters).some(([k,v])=>k!=='sort'&&v)?'검색 조건에 맞는 요청이 없습니다':'아직 수신한 요청이 없습니다'}</h3><p>발급된 URL로 HTTP 요청을 보내세요.<br/>수신된 요청이 자동으로 표시됩니다.</p></div>:items.map(r=><button className={'request '+(detail?.id===r.id?'chosen':'')} onClick={()=>void inspect(r.id)} key={r.id}><div><span className={'method '+r.method}>{r.method}</span><time>{new Date(r.receivedAt).toLocaleString('ko-KR')}</time><p>{(r.source==='TEST'||r.source==='REPLAY')&&<span className="source-test">{r.source}</span>} {r.contentType||'Content-Type 없음'} · {r.bodySize} B</p></div><span className="status">{r.responseStatus}</span></button>)}<div className="pagination"><button disabled={page===1} onClick={()=>setPage(page-1)}>이전</button><span>{page} / {Math.max(1,Math.ceil(total/30))} 페이지 · {total}건</span><button disabled={page*30>=total} onClick={()=>setPage(page+1)}>다음</button></div></section><RequestInspector key={detail?.id??"empty"} detail={detail} copy={copy}/></div>{active&&<EndpointTools key={"tools-"+active} endpointId={active} url={url} api={api} inspect={inspect}/>}{active&&<ReplayCenter key={"replays-"+active} endpointId={active} selected={detail} api={api} inspect={inspect}/>}<div className="tip"><Terminal size={17}/><div><b>첫 번째 요청을 보내보세요</b><code>curl -X POST '{url||'YOUR_WEBHOOK_URL'}' -H 'Content-Type: application/json' -d '&#123;"hello":"HookScope"&#125;'</code></div></div><footer>HookScope · Webhook Testing & Monitoring<span>로컬 개발용 · PostgreSQL 기준 실시간 동기화</span></footer></section></main></div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
