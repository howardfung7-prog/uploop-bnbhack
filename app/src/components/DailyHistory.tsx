import { useEffect, useState } from 'react';
import { tr } from '../lib/i18n';
import { loadDailyRooms, dailyError, dailyStatus } from '../lib/daily-arena';
import type { DailyList } from '../lib/daily-arena';
import { fmtUsdt2 } from '../lib/arena';
export function DailyHistory({account}:{account:string}) {
  const [data,setData]=useState<DailyList|null>(null),[error,setError]=useState('');
  useEffect(()=>{let live=true;const load=async()=>{try{const next=await loadDailyRooms(undefined,account);if(live){setData(current=>current&&current.rooms.length>30?{...next,rooms:[...next.rooms,...current.rooms.filter(r=>!next.rooms.some(n=>n.id===r.id))],next_before:current.next_before}:next);setError('');}}catch(e){if(live)setError(dailyError(e));}};void load();const t=setInterval(load,15000);return()=>{live=false;clearInterval(t);};},[account]);
  const more=async()=>{if(!data?.next_before)return;try{const next=await loadDailyRooms(data.next_before,account);setData({...next,rooms:[...data.rooms,...next.rooms]});}catch(e){setError(dailyError(e));}};
  return <section className="acct-sec"><div className="acct-h"><h2>{tr('My daily arenas')}</h2></div>{error?<p role="alert">{error}</p>:!data?<p>{tr('Loading…')}</p>:!data.rooms.length?<p>{tr('No daily arena entries yet.')}</p>:<div className="ledger">{data.rooms.map(r=><div className="lg-row" key={r.id}><a className="lg-kind" href={`#arena/daily/${r.id}`}>#{r.id} {r.name}</a><span className="lg-what">{new Date(r.starts_at*1000).toISOString().slice(0,10)} UTC · {fmtUsdt2(BigInt(r.amount))} USDT</span><span className="lg-amt">{tr('Ranking prize')}: {fmtUsdt2(BigInt(r.my_prize??'0'))}<br/>{tr('Creator reward')}: {fmtUsdt2(BigInt(r.my_creator_reward??'0'))}</span><span className="lg-st">{dailyStatus(r)}</span></div>)}{data.next_before&&<button className="act ghosted" onClick={()=>void more()}>{tr('Load more')}</button>}</div>}</section>;
}
