import {useCallback,useEffect,useRef,useState} from 'react';
import type {AnalyticsResult} from './analyticsTypes';

type Props={endpointId:string;api:(path:string)=>Promise<unknown>;openCapture:(id:string,endpointId:string)=>void};
const formatMs=(value:number|null)=>value===null?'측정 없음':value.toLocaleString('ko-KR',{maximumFractionDigits:2})+' ms';
function Distribution({title,rows,denominator}:{title:string;rows:{label:string;count:number}[];denominator?:number}){
 const total=denominator??rows.reduce((sum,row)=>sum+row.count,0);
 return <article className="analytics-card"><h3>{title}</h3>{rows.length?<ul className="analytics-bars">{rows.map(row=><li key={row.label}><span>{row.label}</span><div><i style={{width:`${total?row.count/total*100:0}%`}}/></div><b>{row.count.toLocaleString()} <small>({total?(row.count/total*100).toFixed(1):'0'}%)</small></b></li>)}</ul>:<p>기간 내 데이터 없음</p>}</article>;
}
export function AnalyticsPanel({endpointId,api,openCapture}:Props){
 const [scope,setScope]=useState(endpointId?'endpoint':'all'),[period,setPeriod]=useState('24'),[from,setFrom]=useState(''),[to,setTo]=useState('');
 const [range,setRange]=useState(''),[data,setData]=useState<AnalyticsResult|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const generation=useRef(0);
 const refresh=useCallback(async()=>{
  if(scope==='endpoint'&&!endpointId)return;
  const version=++generation.current;setBusy(true);
  try{
   const params=range||new URLSearchParams({from:new Date(Date.now()-Number(period)*3600000).toISOString(),to:new Date().toISOString()}).toString();
   const path=scope==='all'?'/dashboard/summary':`/endpoints/${endpointId}/statistics`;
   const result=await api(path+'?'+params) as AnalyticsResult;
   if(version===generation.current){setData(result);setError('');}
  }catch(e){if(version===generation.current){setData(null);setError((e as Error).message);}}
  finally{if(version===generation.current)setBusy(false);}
 },[api,scope,endpointId,period,range]);
 useEffect(()=>{setData(null);void refresh();const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},15000);const visible=()=>{if(document.visibilityState==='visible')void refresh();};document.addEventListener('visibilitychange',visible);return()=>{generation.current++;clearInterval(timer);document.removeEventListener('visibilitychange',visible);};},[refresh]);
 function apply(e:React.FormEvent){e.preventDefault();const start=new Date(from),end=new Date(to);if(!from||!to||!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||start>=end||end.getTime()-start.getTime()>31*86400000){setError('시작·종료 시각을 입력하세요. 기간은 최대 31일입니다.');return;}setRange(new URLSearchParams({from:start.toISOString(),to:end.toISOString()}).toString());}
 return <section className="analytics" aria-label="Analytics 대시보드">
  <div className="panel-title"><h2>Analytics <span>실제 DB</span></h2><button onClick={()=>void refresh()} disabled={busy}>통계 갱신</button></div>
  <div className="analytics-controls"><label>분석 범위<select aria-label="통계 범위" value={scope} onChange={e=>setScope(e.target.value)}><option value="endpoint">선택 Endpoint</option><option value="all">전체 Dashboard</option></select></label><label>조회 기간<select aria-label="통계 기간" value={range?'custom':period} onChange={e=>{if(e.target.value==='custom'){setRange('');setPeriod('24');}else{setRange('');setPeriod(e.target.value);}}}><option value="24">최근 24시간</option><option value="168">최근 7일</option>{range&&<option value="custom">사용자 지정</option>}</select></label><span>15초마다 조회 · 요청 검색 조건과 독립</span></div>
  <form className="analytics-controls" onSubmit={apply}><label>시작 (현지 시각)<input aria-label="통계 시작 시각" type="datetime-local" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>종료 (미포함)<input aria-label="통계 종료 시각" type="datetime-local" value={to} onChange={e=>setTo(e.target.value)}/></label><button>통계 기간 적용</button></form>
  {error&&<div className="error" role="alert">{error}</div>}
  {!data&&!error&&<p className="analytics-note">통계 조회 중…</p>}
  {data&&<><p className="analytics-note">{scope==='all'?'전체 Dashboard':'선택 Endpoint 분석'} · {data.range.from} ≤ 수신 시각 &lt; {data.range.to}<br/>DB 스냅샷: {data.asOf} · UTC 시간 버킷</p>
   <div className="analytics-kpis"><div><span>보관된 전체 요청</span><strong data-testid="analytics-all-time">{data.allTimeRequests.toLocaleString()}</strong></div><div><span>기간 내 수신</span><strong data-testid="analytics-count">{data.totals.requests.toLocaleString()}</strong></div><div><span>기간 끝 최근 1시간 내 수신</span><strong>{data.totals.recentHourRequests.toLocaleString()}</strong></div><div><span>예정 응답 4xx·5xx / 파싱 오류</span><strong data-testid="analytics-errors">{data.totals.plannedErrorResponses} / {data.totals.parseErrors}</strong></div></div>
   <article className="analytics-card"><h3>시간별 요청량 (UTC)</h3>{data.totals.requests===0&&<p>기간 내 수신 기록이 없습니다. 빈 시간은 0건입니다.</p>}<div className="analytics-chart" role="img" aria-label={`시간별 요청량: ${data.totals.requests}건, ${data.timeline.length}개 UTC 시간 버킷`}><svg viewBox="0 0 800 160" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="150" x2="800" y2="150"/>{data.timeline.map((bucket,index)=>{const width=800/data.timeline.length;const height=bucket.count/Math.max(1,...data.timeline.map(row=>row.count))*140;return <rect key={bucket.hour} x={index*width} y={150-height} width={Math.max(.2,width*.8)} height={height}><title>{bucket.hour}: {bucket.count}건</title></rect>;})}</svg></div><div className="analytics-axis"><span>{data.timeline[0]?.hour}</span><span>{data.timeline.at(-1)?.hour}</span></div><details><summary>시간별 수치 표</summary><div className="analytics-table-scroll"><table><thead><tr><th>UTC 시간 시작</th><th>요청 수</th></tr></thead><tbody>{data.timeline.map(row=><tr key={row.hour}><td>{row.hour}</td><td>{row.count}</td></tr>)}</tbody></table></div></details></article>
   <div className="analytics-grid"><Distribution title="Method 비율" rows={data.methods.map(row=>({label:row.method,count:row.count}))}/><Distribution title="예정 응답 Status 분포" rows={data.statuses.map(row=>({label:String(row.status),count:row.count}))}/><Distribution title="수신 출처" rows={data.sources.map(row=>({label:row.source,count:row.count}))}/><Distribution title="Endpoint별 수신량 · 상위 10개" denominator={data.totals.requests} rows={data.endpointUsage.map(row=>({label:row.name+' · '+row.id.slice(0,8),count:row.count}))}/></div>
   <div className="analytics-grid"><article className="analytics-card"><h3>처리시간 분석</h3><p>캡처 준비 평균 / P95: <b>{formatMs(data.totals.capturePreparationAvgMs)} / {formatMs(data.totals.capturePreparationP95Ms)}</b></p><p>Replay 실제 HTTP 평균 / P95: <b>{formatMs(data.replay.avgDurationMs)} / {formatMs(data.replay.p95DurationMs)}</b></p><p>Replay 시도 {data.replay.attempts}회 · 시간 측정 {data.replay.timedAttempts}회</p><p>수신 준비 시간은 DB 저장 전까지이며 전체 응답 시간이 아닙니다. Replay 시간은 시도 시작 시각 기준으로 집계합니다. DB 저장된 모든 출처를 포함하며 예정 오류 응답은 대상 업무 실패율이 아닙니다.</p><p>관리 가능한 Endpoint {data.endpointCount}개 · 기간 내 본문 합계 {data.totals.bodyBytes.toLocaleString()} B</p></article><Distribution title="Replay 시도 상태" rows={data.replay.statuses.map(row=>({label:row.status,count:row.count}))}/></div>
   <div className="analytics-grid">{[{title:'최근 수신',rows:data.recentRequests},{title:'최근 오류 · 예정 4xx·5xx 또는 파싱 오류',rows:data.recentErrors}].map(group=><article className="analytics-card" key={group.title}><h3>{group.title}</h3>{group.rows.length?group.rows.map(row=><button className="analytics-recent" key={row.id} onClick={()=>openCapture(row.id,row.endpointId)}><span>{row.method} · {row.responseStatus} · {row.source}{row.parseError?' · 파싱 오류':''}</span><small>{new Date(row.receivedAt).toLocaleString('ko-KR')} · {row.id.slice(0,8)}</small></button>):<p>기간 내 기록 없음</p>}</article>)}</div>
  </>}
 </section>;
}
