import { useState } from 'react';
import { Search } from 'lucide-react';
import { emptyFilters, type Filters } from './types';

export function RequestFilters({apply}:{apply:(filters:Filters)=>void}) {
  const [draft,setDraft]=useState<Filters>({...emptyFilters});
  const [error,setError]=useState('');
  const set=(key:keyof Filters,value:string)=>setDraft(previous=>({...previous,[key]:value}));
  return <form className="filters" aria-label="요청 검색 및 필터" onSubmit={e=>{
    e.preventDefault();
    if(draft.from&&draft.to&&Date.parse(draft.from)>Date.parse(draft.to)){setError('시작 시각은 종료 시각보다 늦을 수 없습니다.');return;}
    setError('');apply({...draft,q:draft.q.trim(),contentType:draft.contentType.trim()});
  }}>
    <label className="keyword">키워드<input aria-label="요청 키워드" maxLength={200} placeholder="Request ID, 본문, 헤더, 쿼리 검색" value={draft.q} onChange={e=>set('q',e.target.value)}/></label>
    <label>Method<select aria-label="Method 필터" value={draft.method} onChange={e=>set('method',e.target.value)}><option value="">전체 Method</option>{['GET','POST','PUT','PATCH','DELETE'].map(method=><option key={method}>{method}</option>)}</select></label>
    <label>응답 상태<input aria-label="Status 필터" type="number" min={100} max={599} placeholder="전체" value={draft.status} onChange={e=>set('status',e.target.value)}/></label>
    <label>Content-Type<input aria-label="Content-Type 필터" placeholder="application/json" maxLength={120} value={draft.contentType} onChange={e=>set('contentType',e.target.value)}/></label>
    <label>수신 시작 (현지 시각)<input aria-label="수신 시작" type="datetime-local" step="1" value={draft.from} onChange={e=>set('from',e.target.value)}/></label>
    <label>수신 종료 (현지 시각)<input aria-label="수신 종료" type="datetime-local" step="1" value={draft.to} onChange={e=>set('to',e.target.value)}/></label>
    <label>정렬<select aria-label="요청 정렬" value={draft.sort} onChange={e=>set('sort',e.target.value)}><option value="newest">최신순</option><option value="oldest">오래된순</option></select></label>
    <div className="filter-actions"><button type="submit"><Search size={14}/>검색 적용</button><button type="button" onClick={()=>{setDraft({...emptyFilters});setError('');apply({...emptyFilters});}}>초기화</button></div>
    {error&&<div role="alert" className="error">{error}</div>}
  </form>;
}
