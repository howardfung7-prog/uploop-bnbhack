import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ComponentProps } from 'react';
import type { CrazyRace } from './CrazyRace';
import { tr } from '../lib/i18n';
import { newIdemKey, serverNow } from '../lib/api';
import { displayName } from '../lib/profile';
import { loadDrafts } from '../lib/drafts';
import type { Draft } from '../lib/drafts';
import { useMobileEntryScroll } from '../lib/useMobileEntryScroll';
import { bareSym, uSym } from '../lib/ticker';
import { fmtUsdt2, countdown } from '../lib/arena';
import { writeClip } from './CopyAddr';
import { loadDailyRooms, loadDailyRoom, dailyAction, dailyError, dailyStatus, dailyNameLimit, validDailyName } from '../lib/daily-arena';
import type { DailyDetail, DailyList, DailyEntry } from '../lib/daily-arena';
const COLORS = ['var(--series-0)','var(--series-1)','var(--series-2)','var(--series-3)','var(--series-4)'];
const money = (n: string) => fmtUsdt2(BigInt(n));
const DAILY_AMOUNTS = [5, 10, 50, 200] as const;
const DAILY_BONUS_MAX = 10000;
const usd2 = (n:number) => n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const pct = (n?: string) => n == null ? '—' : `${Number(n)>0?'+':''}${Number(n).toFixed(3)}%`;
const roomFromHash = () => { const m=location.hash.match(/^#arena\/daily\/(\d+)$/); return m ? Number(m[1]) : null; };
const when = (t:number) => new Date(t*1000).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'});
const utcDate = (t:number) => new Date(t*1000).toISOString().slice(0,10);

function Performance({data, entry}: {data:DailyDetail;entry:DailyEntry}) {
  const chart = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(760);
  useEffect(() => {
    if (!chart.current) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(240, entries[0].contentRect.width)));
    observer.observe(chart.current);
    return () => observer.disconnect();
  }, []);
  const left = 46, right = width - 12, mid = 116;
  const samples = data.samples.map(s=>({at:s.at,score:s.scores.find(x=>x.entry_id===entry.id)})).filter(s=>s.score);
  const max = Math.max(1,...samples.flatMap(s=>s.score!.legs.map(l=>Math.abs(Number(l.return_points)))));
  const y = (value:number) => mid-value/max*96;
  const x = (at:number) => left+(at-data.room.starts_at)/86400*(right-left);
  const previous = samples.at(-2)?.score?.rank;
  const current = entry.performance;
  const delta = current && previous ? previous-current.rank : 0;
  return <section className="daily-performance">
    <div className="daily-performance-head"><h3>{tr('My strategy performance')}</h3><b>{pct(current?.return_points)}</b><strong className="daily-rank" key={`${current?.rank}-${samples.length}`}>NO.{current?.rank ?? '—'} <small>{delta>0?`↑${delta}`:delta<0?`↓${-delta}`:'—'}</small></strong></div>
    <div className="daily-legs">{entry.strategy.legs.map((leg,i)=><div key={leg.symbol} style={{borderColor:COLORS[i]}}><b>{uSym(leg.ticker)} <small>{leg.side==='long'?tr('Long'):tr('Short')}</small></b><strong style={{color:COLORS[i]}}>{pct(current?.legs[i]?.return_points)}</strong></div>)}</div>
    <svg ref={chart} className="daily-chart" viewBox={`0 0 ${width} 266`} role="img" aria-label={tr('Five-asset daily return chart')}>
      <rect className="daily-chart-positive" x={left} y={20} width={right-left} height={96}/>
      <rect className="daily-chart-negative" x={left} y={mid} width={right-left} height={96}/>
      {[-1,-.5,0,.5,1].map(v=><g key={v}>
        <line className={v===0?'daily-chart-zero':'daily-chart-grid'} x1={left} x2={right} y1={y(v*max)} y2={y(v*max)}/>
        <text x={left-6} y={y(v*max)+3} textAnchor="end">{(v*max).toFixed(1)}%</text>
      </g>)}
      {[0,6,12,18,24].map(h=><g key={h}>
        <line className="daily-chart-grid" x1={left+h/24*(right-left)} x2={left+h/24*(right-left)} y1={20} y2={212}/>
        <text x={left+h/24*(right-left)} y={238} textAnchor={h===0?'start':h===24?'end':'middle'}>{h}h</text>
      </g>)}
      {entry.strategy.legs.map((leg,i)=>{
        const points = [{x:left,y:mid},...samples.map(s=>({x:x(s.at),y:y(Number(s.score!.legs[i].return_points))}))];
        const last=points.at(-1)!;
        return <g key={leg.symbol}><polyline className="daily-chart-trace" points={points.map(p=>`${p.x},${p.y}`).join(' ')} stroke={COLORS[i]} vectorEffect="non-scaling-stroke"/><circle cx={last.x} cy={last.y} r="2.5" fill={COLORS[i]}/></g>;
      })}
    </svg>
    <small>{tr('From the UTC daily open · rankings update every 15 minutes')}</small>
    <div className="daily-rank-history">{samples.map(s=><span key={s.at} title={pct(s.score!.return_points)}>{new Date(s.at*1000).toISOString().slice(11,16)} <b>NO.{s.score!.rank}</b></span>)}</div>
  </section>;
}

export function DailyArena({account,configured,loggedIn,canWrite,busy,entriesPaused,onLogin,onConnect,onFunds,onChanged,preview}: ComponentProps<typeof CrazyRace> & { preview?: { list: DailyList; detail: DailyDetail; now: number } }) {
  const [id,setId]=useState<number|null>(roomFromHash);
  const [list,setList]=useState<DailyList|null>(preview?.list ?? null),[data,setData]=useState<DailyDetail|null>(preview?.detail ?? null);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[readFailed,setReadFailed]=useState(false);
  const [revision,setRevision]=useState(0),[sending,setSending]=useState(false),[mineOnly,setMineOnly]=useState(false);
  const sendingRef=useRef(false),request=useRef<{payload:string;key:string}|null>(null);
  const [form,setForm]=useState<'create'|'join'|'switch'|'cancel'|null>(null);
  const strategyTarget = useMobileEntryScroll<HTMLLabelElement>(form === 'join' || form === 'switch' ? form : null);
  const [drafts,setDrafts]=useState<Draft[]>([]),[selected,setSelected]=useState(''),[amount,setAmount]=useState(10),[bonus,setBonus]=useState('');
  const nameRef=useRef<HTMLInputElement>(null);
  const [date,setDate]=useState(utcDate((Math.floor(serverNow()/86400)+1)*86400)),[clockNow,setNow]=useState(serverNow);
  const now=preview?.now ?? clockNow;
  useEffect(()=>{const change=()=>{const next=roomFromHash();setId(next);setData(next&&preview ? {...preview.detail,room:preview.list.rooms.find(item=>item.id===next) ?? preview.detail.room} : null);setForm(null);setError('');};addEventListener('hashchange',change);const t=setInterval(()=>setNow(serverNow()),1000);return()=>{removeEventListener('hashchange',change);clearInterval(t);};},[preview]);
  useEffect(()=>{
    if(preview||!configured)return;
    let live=true;let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{if(id){const next=await loadDailyRoom(id);if(live)setData(next);}else{const next=await loadDailyRooms(undefined,mineOnly&&account?account:undefined);if(live)setList(current=>current&&current.rooms.length>30?{...next,rooms:[...next.rooms,...current.rooms.filter(r=>!next.rooms.some(n=>n.id===r.id))],next_before:current.next_before}:next);}if(live)setReadFailed(false);}catch(e){if(live){setReadFailed(true);setError(dailyError(e));}}if(live)timer=setTimeout(poll,15000);};
    void poll();return()=>{live=false;clearTimeout(timer);};
  },[id,configured,account,loggedIn,revision,mineOnly,preview]);
  useEffect(()=>{if(!form)return;const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!sending){setForm(null);}};addEventListener('keydown',escape);return()=>removeEventListener('keydown',escape);},[form,sending]);
  const room=data?.room,entry=data?.me;
  const visibleRooms=(list?.rooms??[]).filter(r=>r.status==='open'||r.status==='active').sort((a,b)=>Number(!!b.featured)-Number(!!a.featured));
  const allowed=!preview&&configured&&canWrite&&loggedIn&&!busy&&!sending&&!entriesPaused&&!readFailed&&!data?.operations_paused;
  const open=(kind:typeof form)=>{
    if(!account){setError(tr('Connect wallet before creating an arena.'));onConnect?.();return;}
    if(!loggedIn){setError(tr('Sign in before creating an arena.'));onLogin?.();return;}
    if(!configured||readFailed){setError(tr('Daily arenas are currently unavailable.'));return;}
    if(entriesPaused||data?.operations_paused){setError(tr('Daily arena actions are temporarily paused.'));return;}
    if(!allowed)return;
    const saved=loadDrafts(account).filter(d=>d.legs.length===5&&new Set(d.legs.map(l=>bareSym(l.symbol))).size===5);
    setDrafts(saved);setSelected(saved[0]?.id??'');setBonus('');setForm(kind);setError('');request.current=null;
  };
  const bonusValue=Number(bonus)||0;
  const go=(roomId?:number)=>{location.hash=roomId?`arena/daily/${roomId}`:'arena/daily';};
  const submit=async()=>{
    if(sendingRef.current||!form||!allowed)return;
    const draft=drafts.find(d=>d.id===selected);
    if(form!=='cancel'&&!draft)return;
    const name=nameRef.current?.value ?? '';
    if(form==='create'&&!validDailyName(name)){setError(tr('Chinese arena names allow up to 32 characters; English names allow up to 64 characters.'));return;}
    const body:Record<string,unknown>={kind:form};
    if(form==='create'){Object.assign(body,{name,date,amount});if(bonusValue>0)body.bonus=bonusValue;}else body.room_id=id;
    if(draft&&form!=='cancel')body.strategy={name:draft.name,legs:draft.legs.map(l=>({ticker:bareSym(l.symbol),side:l.side}))};
    const payload=JSON.stringify(body);if(request.current?.payload!==payload)request.current={payload,key:newIdemKey()};
    sendingRef.current=true;setSending(true);setError('');
    try{const result=await dailyAction({...body,idempotency_key:request.current.key});const action=form;setForm(null);setNotice(action==='join'||action==='create'?tr('Entry successful'):action==='cancel'?tr('Cancelled · refunded'):tr('Strategy updated'));request.current=null;setRevision(x=>x+1);go(action==='cancel'?undefined:result.room_id);onChanged?.();}
    catch(e){setError(dailyError(e));}finally{sendingRef.current=false;setSending(false);}
  };
  const loadMore=async()=>{if(!list?.next_before)return;try{const extra=await loadDailyRooms(list.next_before,mineOnly&&account?account:undefined);setList({...extra,rooms:[...list.rooms,...extra.rooms]});}catch(e){setError(dailyError(e));}};
  const progress=room?Math.max(0,Math.min(100,(now-room.starts_at)/86400*100)):0;
  const url=room?`https://uploop.io/#arena/daily/${room.id}`:'';
  const invite=async()=>{
    if(!url)return;
    setNotice('');
    if(await writeClip(url))setNotice(tr('Link copied'));
    else setNotice(tr('Copy failed'));
  };
  return <section className="crazy-race daily-arena">
    <header className="crazy-race-head"><div className="crazy-race-title"><span className="crazy-race-k">UPLOOP · DAILY</span><h2>{room?.name??tr('Daily arenas')}</h2><p>{tr('Five assets. One day. Your arena.')}</p></div>
      {room?<div className="daily-total"><span>{tr('Total prize')}</span><b>{money(room.total_prize)} <small>USDT</small></b>{BigInt(room.bonus??'0')>0n&&<em>{tr('Includes {0} USDT bonus',money(room.bonus!))}</em>}</div>:<button className="act daily-create-button" disabled={!!preview||!configured||sending||entriesPaused||list?.enabled===false} onClick={()=>open('create')}><strong>{tr('Create arena')}</strong><small>{tr('Win up to 6% in prizes')}</small></button>}
    </header>
    <div className="daily-content">
      {!configured&&<p className="note">{tr('Daily arenas are currently unavailable.')}</p>}
      {notice&&<div className="daily-notice" role="status">{notice}<button onClick={()=>setNotice('')} aria-label={tr('Close')}>×</button></div>}
      {error&&!form&&<p role="alert" className="daily-error">{error}<button onClick={()=>setRevision(x=>x+1)}>{tr('Retry')}</button></p>}
      {!id?<>
        <div className="daily-toolbar"><span>{tr('Registration closes 15 minutes before the start.')}</span>{account&&<button className="act ghosted" aria-pressed={mineOnly} onClick={()=>{setMineOnly(x=>!x);setList(null);}}>{mineOnly?tr('All arenas'):tr('My arenas')}</button>}</div>
        {!list&&configured?<p>{tr('Loading…')}</p>:<div className="daily-cards">{visibleRooms.map(r=><button className={`daily-card${r.featured?' pinned':''}`} key={r.id} onClick={()=>go(r.id)}>{r.featured&&<i className="daily-pin">{r.featured}</i>}<span className="daily-card-top"><small>#{r.id} · {dailyStatus(r)}</small><b>{money(r.amount)} USDT</b></span><h3>{r.name}</h3><p>{tr('Created by {0}',displayName({name:r.creator_name},r.creator))}</p><p>{utcDate(r.starts_at)} · 00:00 UTC</p><div><span>{tr('{0} players',r.count)}</span><strong>{money(r.total_prize)} USDT</strong></div>{BigInt(r.bonus??'0')>0n&&<p className="daily-card-bonus">{tr('Includes {0} USDT bonus',money(r.bonus!))}</p>}</button>)}</div>}
        {list&&visibleRooms.length===0&&<div className="daily-empty">{tr('No arenas yet. Create one and invite your opponents.')}</div>}
        {list?.next_before&&<button className="act ghosted" onClick={()=>void loadMore()}>{tr('Load more')}</button>}
      </>:!data?<p>{tr('Loading…')}</p>:<>
        <div className="daily-toolbar"><button className="link" onClick={()=>go()}>{tr('← All arenas')}</button><span>#{room!.id} · {dailyStatus(room!)}</span><button className="act ghosted" onClick={()=>void invite()}>{tr('Invite opponents')}</button></div>
        <div className="daily-time"><b>{when(room!.starts_at)} → {when(room!.ends_at)}</b><small>{utcDate(room!.starts_at)} · 00:00–24:00 UTC</small></div>
        <div className="daily-progress" role="progressbar" aria-label={tr('Daily match progress')} aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}><div className="daily-progress-fill" style={{width:`${progress}%`}}/><div className="daily-progress-label"><span>{tr('{0} players',room!.count)}</span><b>{now<room!.starts_at?tr('Starts in {0}',countdown(room!.starts_at-now)):room!.status==='finished'||room!.status==='refunded'?dailyStatus(room!):countdown(Math.max(0,room!.ends_at-now))}</b><span>{progress.toFixed(1)}%</span></div></div>
        <div className="daily-actions">
          {!account?<button className="act" onClick={onConnect}>{tr('Connect wallet')}</button>:!loggedIn?<button className="act" onClick={onLogin}>{tr('Sign in')}</button>:!entry&&room!.status==='open'&&now<room!.cutoff_at?<button className="act" disabled={!allowed} onClick={()=>open('join')}>{tr('Enter arena')} · {money(room!.amount)} USDT</button>:entry&&room!.status==='open'&&now<room!.starts_at?<button className="act" disabled={!allowed||entry.changes>0} onClick={()=>open('switch')}>{tr('Change strategy')} · {1-entry.changes}/1</button>:<span>{dailyStatus(room!)}</span>}
          {account===room!.creator&&room!.status==='open'&&!room!.locked&&<button className="act ghosted" disabled={!allowed} onClick={()=>open('cancel')}>{tr('Cancel arena')}</button>}
          {entry&&<div className="daily-estimate"><small>{tr('My ranking prize')}</small><b>{money(room!.status==='finished'?entry.prize:room!.status==='refunded'?'0':entry.performance?.estimated_prize??'0')} USDT</b></div>}
          {entry&&entry.player===room!.creator&&<div className="daily-estimate"><small>{tr('Creator reward')}</small><b>{money(room!.status==='finished'?entry.creator_reward:room!.status==='refunded'?'0':((BigInt(room!.total_prize)-BigInt(room!.bonus??'0'))*6n/100n).toString())} USDT</b></div>}
        </div>
        {room!.pause_reason&&<p className="note">{tr('Waiting for complete Binance candles. Settlement is delayed.')}</p>}
        {entry&&<Performance data={data} entry={entry}/>}
        <h3>{tr('Public strategies & leaderboard')}</h3>
        <div className="daily-board">{data.entries.map(e=>{const inMoney=now>=room!.starts_at&&(room!.status==='active'||room!.status==='finished')&&!!e.performance&&BigInt(e.performance.estimated_prize)>0n;return <div className={`daily-board-row${e.id===entry?.id?' mine':''}`} key={e.id}><b className="daily-place">{e.performance?`NO.${e.performance.rank}`:'—'}</b><div className="daily-player"><strong className={inMoney?'daily-money-circle':''}>{displayName(e,e.player)}</strong><small>{e.strategy.name}</small><div>{e.strategy.legs.map(l=><span key={l.symbol}>{uSym(l.ticker)} {l.side==='long'?tr('Long'):tr('Short')}</span>)}</div></div><div className="daily-result"><b>{pct(e.performance?.return_points)}</b><small>{money(room!.status==='finished'?e.prize:room!.status==='refunded'?'0':e.performance?.estimated_prize??'0')} USDT</small></div></div>})}</div>
      </>}
      <details className="daily-rules"><summary>{tr('Rules & prize details')}</summary><p>{tr('Enter with a public 5-asset strategy, ranked on UTC daily candles. One strategy change before the start; no withdrawal after entry.')}</p><p>{tr('Starts with 3 or more wallets. Below 3, the creator can cancel.')}</p><p>{tr('80% prizes · 6% creator · 14% fee')}</p><p>{tr('Winners: 3–5 players top 1; 6–15 top 3; 16–30 top 8; 31–50 top 15; 51+ top 25. Place n gets weight 1/n; ties split evenly.')}</p><p>{tr('If every return is equal, everyone is refunded in full with no fee.')}</p></details>
    </div>
    {form&&createPortal(<div className="daily-overlay" onClick={e=>{if(e.target===e.currentTarget&&!sending){setForm(null);}}}><section className="daily-modal" role="dialog" aria-modal="true" aria-label={tr('Daily arena order')}><button className="daily-modal-close" disabled={sending} onClick={()=>{setForm(null);}} aria-label={tr('Close')}>×</button>
      <form onSubmit={e=>{e.preventDefault();void submit();}}>
        <h2>{form==='create'?tr('Create arena'):form==='cancel'?tr('Cancel arena'):form==='switch'?tr('Change strategy'):tr('Enter arena')}</h2>
        {form==='create'&&<><label htmlFor="daily-arena-name">{tr('Arena name')}<input id="daily-arena-name" ref={nameRef} autoFocus required maxLength={64} defaultValue="" onInput={e=>{const input=e.currentTarget;const limit=dailyNameLimit(input.value);if(Array.from(input.value).length>limit)input.value=Array.from(input.value).slice(0,limit).join('');}} /></label><label htmlFor="daily-arena-date">{tr('Match date (UTC)')}<input id="daily-arena-date" required type="date" min={utcDate((Math.floor(now/86400)+1)*86400)} max={utcDate((Math.floor(now/86400)+30)*86400)} value={date} onChange={e=>setDate(e.target.value)}/></label><label htmlFor="daily-arena-buy-in">{tr('Buy-in')}<select id="daily-arena-buy-in" name="buy_in" value={String(amount)} onChange={e=>setAmount(Number(e.target.value))}>{DAILY_AMOUNTS.map(n=><option key={n} value={n}>{n} USDT</option>)}</select></label><div className="daily-bonus-field"><label htmlFor="daily-arena-bonus">{tr('Arena bonus')}<input id="daily-arena-bonus" inputMode="numeric" placeholder={tr('(optional)')} value={bonus} pattern="[0-9]*" onKeyDown={e=>{if(['.',',','e','E','-','+'].includes(e.key))e.preventDefault();}} onChange={e=>{const raw=e.target.value;if(!/^\d*$/.test(raw))return;const v=raw.replace(/^0+/,'');setBonus(Number(v)>DAILY_BONUS_MAX?String(DAILY_BONUS_MAX):v);}}/></label></div></>}
        {form==='cancel'?<p>{tr('Cancel this arena and refund every entrant in full?')}</p>:<><label htmlFor="daily-arena-strategy" ref={strategyTarget} tabIndex={-1} className="entry-strategy-target">{tr('Choose a saved five-asset strategy.')}<select id="daily-arena-strategy" name="strategy" required value={selected} onChange={e=>setSelected(e.target.value)}><option value="" disabled>{tr('Select strategy')}</option>{drafts.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>{!drafts.length&&<p>{tr('Save a five-asset strategy in the builder first.')} <a href="#build" onClick={()=>setForm(null)}>{tr('Create index')}</a></p>}<div className="daily-draft">{drafts.find(d=>d.id===selected)?.legs.map(l=><span key={l.id}>{l.symbol} {l.side==='long'?tr('Long'):tr('Short')}</span>)}</div><p>{tr('Strategies are public. No individual withdrawal or refund after entry.')}</p></>}
        {error&&<p className="daily-error" role="alert">{error}</p>}
        {form==='create'?<p>{bonusValue>0?<>{tr('Buy-in')} {usd2(amount)} + {tr('Arena bonus')} {usd2(bonusValue)} = <b>{usd2(amount+bonusValue)} USDT</b></>:<>{tr('Buy-in')}: <b>{usd2(amount)} USDT</b></>} <button type="button" className="link" onClick={onFunds}>{tr('Deposit')}</button></p>:form==='join'?<p>{tr('Buy-in')}: <b>{room?money(room.amount):'—'} USDT</b> <button type="button" className="link" onClick={onFunds}>{tr('Deposit')}</button></p>:null}
        <button className="act" disabled={!allowed||(form!=='cancel'&&!selected)} type="submit">{sending?tr('Submitting…'):tr('Confirm')}</button>
      </form>
    </section></div>,document.body)}
  </section>;
}
