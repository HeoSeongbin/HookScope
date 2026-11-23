import { useState } from 'react';
import { Terminal, Copy, Download } from 'lucide-react';
import type { Capture } from './types';
import { JsonTree } from './JsonTree';
import { pretty, rawBytes, isTextual, headerPairs, queryPairs, maskSensitive } from './inspectorData';

export function RequestInspector({detail,copy}:{detail:Capture|null;copy:(value:string)=>Promise<void>}) {
  const [tab,setTab]=useState('Body');
  const [mode,setMode]=useState('Pretty');
  const [search,setSearch]=useState('');
  const [mask,setMask]=useState(true);
  if(!detail)return <section className="inspector"><div className="panel-title"><h2><Terminal size={16}/> 요청 상세</h2></div><div className="empty"><Terminal size={32}/><h3>요청의 안쪽까지 확인하세요</h3><p>목록에서 요청을 선택하면<br/>헤더, 쿼리, 본문이 여기에 표시됩니다.</p></div></section>;
  const pairs=tab==='Headers'?headerPairs(detail.headers).filter(pair=>pair.some(value=>value.toLowerCase().includes(search.toLowerCase()))):queryPairs(detail.query);
  const raw=detail.rawBody??'';
  const textual=isTextual(detail.contentType);
  const type=detail.contentType.split(';')[0].trim().toLowerCase();
  const isJson=type==='application/json'||type.endsWith('+json');
  const form=type==='application/x-www-form-urlencoded';
  const visibleBody=mask&&isJson?maskSensitive(detail.parsedBody):detail.parsedBody;
  function download() {
    const url=URL.createObjectURL(new Blob([rawBytes(raw)],{type:'application/octet-stream'}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download=`hookscope-${detail!.id}.bin`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <section className="inspector">
    <div className="panel-title"><h2><Terminal size={16}/> 요청 상세</h2><small>{detail.id.slice(0,8)}</small></div>
    <div className="tabs">{['Overview','Headers','Query','Body','Raw','Response'].map(t=><button key={t} className={tab===t?'on':''} onClick={()=>setTab(t)}>{t}</button>)}</div>
    {detail.parseError&&<div className="error">JSON 파싱 실패 · Raw 탭에서 원본 확인 가능</div>}
    {(tab==='Headers'||tab==='Query')?<>
      <div className="inspector-tools">{tab==='Headers'&&<input aria-label="헤더 검색" placeholder="헤더 이름 또는 값 검색" value={search} onChange={e=>setSearch(e.target.value)}/>}<button onClick={()=>void copy(pairs.map(([key,value])=>`${key}: ${value}`).join('\n'))}><Copy size={13}/> {tab==='Headers'?'헤더':'쿼리'} 전체 복사</button></div>
      <div className="kv-list">{pairs.length?pairs.map(([key,value],index)=><div className="kv-row" key={index}><code>{key}</code><span>{value}</span><button aria-label={`${tab==='Headers'?'헤더':'쿼리'} 복사 ${key} ${index+1}`} onClick={()=>void copy(`${key}: ${value}`)}><Copy size={12}/></button></div>):<p>표시할 값이 없습니다.</p>}</div>
      {tab==='Query'&&<small className="raw-note">중복 키의 각 값을 별도 행으로 표시합니다.</small>}
    </>:tab==='Body'?<>
      <div className="inspector-tools">{isJson&&!detail.parseError&&<>{['Pretty','Tree'].map(value=><button className={mode===value?'on':''} key={value} onClick={()=>setMode(value)}>{value==='Tree'?'트리 보기':'JSON 보기'}</button>)}<label><input type="checkbox" checked={mask} onChange={e=>setMask(e.target.checked)}/> 민감 필드 숨기기</label></>}{textual&&<button onClick={()=>void copy(typeof visibleBody==='string'?visibleBody:pretty(visibleBody))}><Copy size={13}/> 본문 복사</button>}</div>
      {!textual?<div className="binary-note">{detail.contentType||'알 수 없는 형식'} · {detail.bodySize} bytes<p>Binary/Multipart는 파싱하지 않습니다. Raw 탭에서 원본 바이트를 확인하거나 다운로드하세요.</p></div>:isJson&&!detail.parseError&&mode==='Tree'?<div className="json-tree"><JsonTree value={visibleBody}/></div>:form?<div className="kv-list">{queryPairs(visibleBody).map(([key,value],index)=><div className="kv-row" key={index}><code>{key}</code><span>{value}</span></div>)}</div>:<pre>{typeof visibleBody==='string'?visibleBody:pretty(visibleBody)}</pre>}
    </>:tab==='Raw'?<>
      <div className="inspector-tools"><button onClick={download}><Download size={13}/> 원본 다운로드</button><button onClick={()=>void copy(raw)}><Copy size={13}/> Base64 복사</button></div>
      <pre>{textual?new TextDecoder().decode(rawBytes(raw))||'(빈 본문)':raw||'(빈 본문)'}</pre><small className="raw-note">{textual?'UTF-8 미리보기':'Base64 원본 바이트'} · 다운로드는 재인코딩하지 않은 원본 바이트입니다.</small>
    </>:<pre>{tab==='Response'?pretty({status:detail.responseStatus,body:detail.responseBody??null,headers:detail.responseHeaders??null,configuredDelayMs:detail.responseDelayMs??0,capturePreparationMs:detail.durationMs,note:detail.responseBody==null?'과거 기록에는 응답 본문 스냅샷이 없습니다.':'저장 시점의 응답 계획입니다. 클라이언트 수신 완료를 보증하지 않습니다.'}):pretty({id:detail.id,endpointId:detail.endpointId,source:detail.source??'EXTERNAL',method:detail.method,receivedAt:detail.receivedAt,contentType:detail.contentType,bodySize:detail.bodySize,parseError:detail.parseError})}</pre>}
  </section>;
}
