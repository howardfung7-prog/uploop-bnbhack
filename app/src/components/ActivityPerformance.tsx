import { useEffect, useState } from "react";
import { tr } from "../lib/i18n";
import { countdown, KINDS } from "../lib/arena";
import type { Entry, Pool, PoolLive } from "../lib/arena";
import { RaceReturnChart } from "./RaceReturnChart";
import { performancePercent, returnScale } from "../lib/race-performance";
import type { PerformanceSample } from "../lib/race-performance";
import { MARKET_MAX_AGE_SECONDS } from "../lib/quotes";

const POLL_MS = 5_000;

/// One leg's return in percent from the lock-time open: the side comes first, so a short leg whose
/// price fell is a gain (§71.176).
function legReturn(open: string | undefined, price: string | undefined, side: string): number | null {
  const o = Number(open), p = Number(price);
  if (!o || !p || !Number.isFinite(o) || !Number.isFinite(p)) return null;
  const value = (p - o) / o * 100;
  return side === "short" ? -value : value;
}

/// X-axis ticks at the quarters of the match window, labelled in minutes, hours or days.
function windowTicks(start: number, end: number) {
  const span = end - start;
  return [0, 0.25, 0.5, 0.75, 1].map(f => {
    const offset = Math.round(span * f);
    const label = span <= 2 * 3600 ? tr("{0} min", Math.round(offset / 60))
      : span <= 3 * 86400 ? `${Math.round(offset / 3600 * 10) / 10}h` : `${Math.round(offset / 86400 * 10) / 10}d`;
    return { at: start + offset, label };
  });
}

const when = (at: number) => new Date(at * 1000).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

/// "My strategy performance" for an activity match in progress (§71.179). 3T / 5T reuse the race chart
/// as-is; NT has too many legs for a readable chart and only waits for the result.
export function ActivityPerformance({ pool, mine, now, load }: {
  pool: Pool; mine: Entry[]; now: number; load: (poolId: number) => Promise<PoolLive>;
}) {
  const [live, setLive] = useState<PoolLive | null>(null);
  const [failed, setFailed] = useState(false);
  const [pick, setPick] = useState(0);
  const charted = pool.kind !== 2;
  useEffect(() => {
    if (!charted) return;
    let alive = true;
    const pull = () => load(pool.id).then(
      value => { if (alive) { setLive(value); setFailed(false); } },
      () => { if (alive) setFailed(true); });
    pull();
    const timer = setInterval(pull, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [pool.id, charted, load]);

  const settling = now >= pool.settlesAt;
  const remaining = settling ? tr("Settlement time reached") : countdown(pool.settlesAt - now);
  const head = (state: string, tone: string, name?: string) => <header className="race-performance-head">
    <div><h3>{tr("My strategy performance")}</h3><span>{name ?? KINDS[pool.kind].code}</span></div>
    <span className="race-performance-state" data-state={tone} role="status" aria-live="polite">{state}</span>
  </header>;

  if (!charted) {
    return <section className="race-performance activity-performance" aria-label={tr("My strategy performance")}>
      {head(settling ? tr("Settling…") : tr("Awaiting the result"), settling ? "settling" : "waiting")}
      <p className="activity-waiting">{tr("NT matches have no live chart. Your ranking and prize appear here once the match settles.")}</p>
      <div className="race-performance-total">
        <div className="race-performance-metric"><span>{tr("Settles in")}</span><strong>{remaining}</strong></div>
        <small>{tr("{0} strategies entered", mine.length)}</small>
      </div>
    </section>;
  }

  const entry = mine[Math.min(pick, mine.length - 1)];
  const legs = entry.legs.map(leg => ({ ticker: leg.ticker, side: leg.side }));
  const opens = live?.opens ?? {};
  const maxAge = Math.min(MARKET_MAX_AGE_SECONDS, live?.staleAfter ?? MARKET_MAX_AGE_SECONDS);
  const fresh = (quote?: { price: string; at: number }) => !!quote && !live?.stale && quote.at <= pool.settlesAt && now - quote.at >= 0 && now - quote.at <= maxAge;
  const sampleOf = (at: number, price: (ticker: string) => string | undefined): PerformanceSample => ({
    at, legs: legs.flatMap(leg => {
      const value = legReturn(opens[leg.ticker], price(leg.ticker), leg.side);
      return value === null ? [] : [{ ticker: leg.ticker, side: leg.side, return_points: String(value) }];
    }),
  });
  const samples = (live?.samples ?? []).map(sample => sampleOf(sample.at, ticker => sample.prices[ticker]));
  const quoteAts = legs.map(leg => live?.quotes[leg.ticker]).filter(fresh).map(quote => quote!.at);
  // The newest quote extends the line between backend samples, so the tip moves every poll.
  if (quoteAts.length && Math.max(...quoteAts) > (samples.at(-1)?.at ?? 0))
    samples.push(sampleOf(Math.max(...quoteAts), ticker => fresh(live?.quotes[ticker]) ? live!.quotes[ticker].price : undefined));
  const latest = (ticker: string) => fresh(live?.quotes[ticker]) ? live!.quotes[ticker].price
    : [...(live?.samples ?? [])].reverse().find(sample => sample.prices[ticker])?.prices[ticker];
  const values = legs.map(leg => legReturn(opens[leg.ticker], latest(leg.ticker), leg.side));
  const total = values.every(value => value !== null)
    ? entry.legs.reduce((sum, leg, i) => sum + values[i]! * leg.weightBps / 10_000, 0) : null;
  const allFresh = legs.every(leg => fresh(live?.quotes[leg.ticker])) && legs.every(leg => opens[leg.ticker]);
  const scale = returnScale([...samples.flatMap(sample => sample.legs.map(leg => Number(leg.return_points))), ...values.map(value => value ?? 0)]);
  const [state, tone] = settling ? [tr("Settling…"), "settling"] : failed || live?.stale ? [tr("Live chart paused"), "paused"]
    : allFresh ? [tr("Live · every 5 seconds"), "live"] : [tr("Waiting for live prices"), "waiting"];

  return <section className="race-performance activity-performance" aria-label={tr("My strategy performance")}>
    {head(state, tone, tr("Entry #{0}", entry.entryId))}
    {mine.length > 1 && <div className="activity-picks" role="tablist" aria-label={tr("My strategies in this match")}>
      {mine.map((item, i) => <button key={item.entryId} role="tab" aria-selected={item === entry} className={item === entry ? "on" : ""} onClick={() => setPick(i)}>#{item.entryId}</button>)}
    </div>}
    <p className="race-performance-note">{tr("Lock {0} → settlement {1}", when(pool.locksAt), when(pool.settlesAt))}</p>
    <RaceReturnChart legs={legs} start={pool.locksAt} end={pool.settlesAt} samples={samples} values={values}
      pending={false} interrupted={!settling && (failed || !!live?.stale)} scale={scale}
      gap={3 * (live?.sampleInterval ?? 60)} ticks={windowTicks(pool.locksAt, pool.settlesAt)}
      finishLabel={tr("Settlement · {0}", when(pool.settlesAt))} openLabel={tr("Lock price")}
      ariaLabel={tr("My strategy's asset returns since the lock; the center line is zero return.")}
      caption={tr("The scale grows with the largest move; cards show actual returns. Dashed sections indicate missing data.")}
      quotes={legs.map(leg => ({ open: opens[leg.ticker], close: latest(leg.ticker) }))} />
    <div className="race-performance-total">
      <div className="race-performance-metric"><span>{tr("Current strategy return")}</span><strong data-tone={total !== null && total < 0 ? "loss" : "gain"}>{total === null ? "—" : performancePercent(String(total))}</strong></div>
      <div className="race-performance-metric"><span>{tr("Settles in")}</span><strong className="race-performance-race-total">{remaining}</strong></div>
    </div>
    <p className="race-performance-note">{tr("Live returns are estimates from futures quotes. The ranking uses the settlement candles and appears once the match settles.")}</p>
  </section>;
}
