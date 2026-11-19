import { useState } from 'react';
import { pretty } from './inspectorData';

export function JsonTree({value,label='root',depth=0}:{value:unknown;label?:string;depth?:number}) {
  const [open,setOpen]=useState(depth===0);
  const [limit,setLimit]=useState(100);
  if (value===null || typeof value!=='object') return <div className="json-leaf"><span>{label}</span>: <code>{pretty(value)}</code></div>;
  const entries=Object.entries(value);
  const array=Array.isArray(value);
  return <div className="json-node">
    <button className="tree-toggle" aria-expanded={open} aria-label={`${label} ${open?'접기':'펼치기'}`} onClick={()=>setOpen(!open)}>{open?'▾':'▸'} <b>{label}</b> <span>{array?'Array':'Object'} · {entries.length}</span></button>
    {open && (depth>=32 ? <p>최대 표시 깊이입니다. 원문 보기로 확인하세요.</p> : <div className="json-children">{entries.slice(0,limit).map(([key,item])=><JsonTree key={key} label={key} value={item} depth={depth+1}/>)}{entries.length>limit&&<button onClick={()=>setLimit(limit+100)}>다음 100개 보기 ({entries.length-limit}개 남음)</button>}</div>)}
  </div>;
}
