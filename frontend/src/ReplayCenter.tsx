import {useCallback,useEffect,useRef,useState} from 'react';
import type {Capture} from './types';
import {maskSensitive,pretty} from './inspectorData';
type Api=(path:string,options?:RequestInit)=>Promise<unknown>;
type Job={id:string;originalRequestId:string;status:string;maxAttempts:number;lastError:string|null;createdAt:string;enqueuePending?:boolean};
type Attempt={id:string;number:number;requestId:string;status:string;errorCode:string|null;responseStatus:number|null;responseBody:string|null;durationMs:number|null;captured:boolean};
const labels:Record<string,string>={PENDING:'큐 등록 대기',QUEUED:'대기',RUNNING:'전송 중',RETRYING:'재시도 대기',SUCCEEDED:'성공',FAILED:'실패',CANCELLED:'취소',UNKNOWN:'결과 불확실'};
export function ReplayCenter({endpointId,selected,api,inspect}:{endpointId:string;selected:Capture|null;api:Api;inspect:(id:string)=>Promise<void>}){
 const [items,setItems]=useState<Job[]>([]),[job,setJob]=useState<Job|null>(null),[attempts,setAttempts]=useState<Attempt[]>([]),[original,setOriginal]=useState<Capture|null>(null);
 const [page,setPage]=useState(1),[total,setTotal]=useState(0),[filter,setFilter]=useState(''),[chosen,setChosen]=useState(''),[max,setMax]=useState(3),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const generation=useRef(0),mounted=useRef(true),pending=useRef<{requestId:string;key:string}|null>(null);
 const refresh=useCallback(async()=>{
  const version=++generation.current;
  try{
   const [list,detail,history]=await Promise.all([api(`/endpoints/${endpointId}/replays?page=${page}${filter?'&status='+filter:''}`),chosen?api(`/replays/${chosen}`):Promise.resolve(null),chosen?api(`/replays/${chosen}/attempts`):Promise.resolve(null)]) as [{items:Job[];total:number},Job|null,{items:Attempt[]}|null];
   if(!mounted.current||version!==generation.current)return;
   const last=Math.max(1,Math.ceil(list.total/30));if(page>last){setPage(last);return;}
   setItems(list.items);setTotal(list.total);setJob(detail);setAttempts(history?.items??[]);setError('');
  }catch(e){if(mounted.current&&version===generation.current)setError((e as Error).message);}
 },[api,endpointId,page,filter,chosen]);
 useEffect(()=>{mounted.current=true;void refresh();const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},2000);return()=>{mounted.current=false;generation.current++;clearInterval(timer);};},[refresh]);
 useEffect(()=>{let current=true;setOriginal(null);if(job)void api(`/requests/${job.originalRequestId}`).then(value=>{if(current)setOriginal(value as Capture);}).catch(()=>{});return()=>{current=false;};},[api,job?.originalRequestId]);
 async function run(){
  if(!selected||busy)return;setBusy(true);setError('');
  if(pending.current?.requestId!==selected.id)pending.current={requestId:selected.id,key:crypto.randomUUID()};
  try{const result=await api(`/requests/${selected.id}/replay`,{method:'POST',body:JSON.stringify({idempotencyKey:pending.current.key,maxAttempts:max})}) as Job;
   if(mounted.current){pending.current=null;setChosen(result.id);setJob(result);void refresh();}
  }catch(e){if(mounted.current)setError((e as Error).message);}finally{if(mounted.current)setBusy(false);}
 }
 async function cancel(){if(!job)return;try{await api(`/replays/${job.id}/cancel`,{method:'POST',body:'{}'});await refresh();}catch(e){if(mounted.current)setError((e as Error).message);}}
 return <section className="replay-center" aria-label="Replay Center">
  <div className="panel-title"><h2>Replay Center <span>{total}</span></h2><small>자체 Endpoint · 2초마다 상태 조회</small></div>
  <div className="replay-controls"><div><p>{selected?`선택한 요청: ${selected.id}`:'요청 목록에서 원본을 선택하세요.'}</p><small>원본 바이트를 재전송합니다. 인증·Cookie·연결 Header는 제외합니다.</small></div><label>최대 시도<select aria-label="Replay 최대 시도" value={max} onChange={e=>{setMax(Number(e.target.value));pending.current=null;}}>{[1,2,3].map(value=><option key={value} value={value}>{value}회</option>)}</select></label><button disabled={!selected||busy} onClick={()=>void run()}>{busy?'등록 중…':'Internal Replay 실행'}</button></div>
  {error&&<div className="error" role="alert">{error}</div>}
  <div className="replay-controls"><label>작업 상태<select aria-label="Replay 상태 필터" value={filter} onChange={e=>{setFilter(e.target.value);setPage(1);}}><option value="">전체</option>{Object.entries(labels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label><button onClick={()=>void refresh()}>작업 상태 다시 조회</button></div>
  <div className="replay-grid"><div className="replay-list">{items.length?items.map(item=><button className={'replay-job '+(chosen===item.id?'chosen':'')} key={item.id} onClick={()=>setChosen(item.id)}><span>{item.id.slice(0,8)} · {labels[item.status]}</span><small>{new Date(item.createdAt).toLocaleString('ko-KR')} · 원본 {item.originalRequestId.slice(0,8)}</small></button>):<p>표시할 Replay 작업이 없습니다.</p>}<div className="replay-pagination"><button disabled={page===1} onClick={()=>setPage(page-1)}>이전 작업</button><span>{page}/{Math.max(1,Math.ceil(total/30))} · {total}건</span><button disabled={page*30>=total} onClick={()=>setPage(page+1)}>다음 작업</button></div></div>
   <div className="replay-detail">{job?<><h3>작업 상태: {labels[job.status]}</h3><code>{job.id}</code>{job.lastError&&<p>{job.lastError}</p>}{['PENDING','QUEUED','RETRYING'].includes(job.status)&&<button onClick={()=>void cancel()}>Replay 취소</button>}{job.status==='UNKNOWN'&&<p>전송 결과를 확정할 수 없어 자동 재시도를 중단했습니다. 수신 이력을 확인하세요.</p>}
    {original&&<details className="original-comparison"><summary>원본 요청과 비교 · {original.method} · {original.bodySize} B</summary><button onClick={()=>void inspect(original.id)}>원본 상세 열기</button><pre>{pretty({id:original.id,method:original.method,contentType:original.contentType,bodySize:original.bodySize,originalPlannedStatus:original.responseStatus,parsedBody:maskSensitive(original.parsedBody)})}</pre></details>}
    {attempts.map(attempt=><article className="replay-attempt" key={attempt.id}><h4>시도 {attempt.number} · {labels[attempt.status]}</h4><p>관측 HTTP: {attempt.responseStatus??'없음'} · {attempt.durationMs??'—'} ms</p>{attempt.errorCode&&<p>{attempt.errorCode}</p>}{attempt.captured?<button onClick={()=>void inspect(attempt.requestId)}>이 시도의 수신 기록 확인</button>:<p>수신 기록 없음 또는 미확인</p>}{attempt.responseBody!==null&&<pre>{attempt.responseBody||'(빈 응답)'}</pre>}</article>)}{!attempts.length&&<p>아직 실행 시도가 없습니다.</p>}</>:<p>작업을 선택하면 시도 이력과 원본 비교를 확인할 수 있습니다.</p>}</div>
  </div><p className="tool-note">5xx·429만 최대 시도 내에서 1초·2초 백오프로 재시도합니다. 전송 결과가 불확실하면 UNKNOWN으로 중단하며, 실행 중 작업은 취소하지 않습니다.</p>
 </section>;
}
