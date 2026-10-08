import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { tr } from "../lib/i18n";
import { RaceReturnChart } from "./RaceReturnChart";
import type { PerformanceSample } from "../lib/race-performance";
import { uSym } from "../lib/ticker";
import type { RaceCycle, RaceSnapshot } from "../lib/race";
import { performancePercent, displayedSumMatches, samePerformanceStrategy } from "../lib/race-performance";
import { MARKET_MAX_AGE_SECONDS } from "../lib/quotes";

function outcome(cycle: RaceCycle): string {
  if (cycle.status === "eliminated") return tr("Eliminated");
  if (cycle.consumed_protection === "free") return tr("Free protection used");
  if (cycle.consumed_protection === "paid") return tr("Paid protection used");
  if (Number(cycle.return_points) < 0) return tr("Protection used");
  return tr("Survived this cycle");
}

export function RacePerformance({ data, now, interrupted, samples = [], onEliminated, onSettlementDismissed, liveIntervalMs = 1_000 }: {
  data: RaceSnapshot; now: number; interrupted: boolean; samples?: PerformanceSample[]; onEliminated?: () => void; onSettlementDismissed?: () => void; liveIntervalMs?: number;
}) {
  const me = data.me;
  const history = me?.history?.[0];
  const seat = me?.seat ?? history?.seat;
  const cycles = me?.seat ? me.cycles : history?.cycles;
  const latest = cycles?.[0];
  const resultKey = latest && seat ? `${seat.id}:${latest.cycle_end}` : "";
  const seen = useRef<string | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [settlementNotice, setSettlementNotice] = useState<"survived" | "protected" | "eliminated" | null>(null);
  useEffect(() => {
    const isNew = seen.current !== null && resultKey !== "" && seen.current !== resultKey;
    seen.current = resultKey;
    setReplaying(isNew);
    if (!isNew) return;
    setSettlementNotice(null);
    const timer = setTimeout(() => {
      setReplaying(false);
      setSettlementNotice(latest?.status === "eliminated" ? "eliminated"
        : latest?.consumed_protection === "free" || latest?.consumed_protection === "paid" || Number(latest?.return_points) < 0 ? "protected" : "survived");
    }, 6500);
    return () => clearTimeout(timer);
  }, [resultKey]);

  const pending = seat?.status === "pending";
  const active = seat?.status === "active";
  const live = me?.live;
  // A newly effective strategy must never inherit the previous strategy's chart.
  // Its predecessor remains visible only in the separately labelled settlement receipt.
  const sameSettledStrategy = !!latest && !!seat && samePerformanceStrategy(latest.legs, seat.legs);
  const settled = !!latest && (replaying && sameSettledStrategy || !active && !pending);
  const paused = data.operations_paused || data.round.status !== "active" || !data.round.market_ready;
  const fresh = active && !!live && !!seat && samePerformanceStrategy(live.legs, seat.legs)
    && live.cycle_end === data.round.next_settlement_at && !live.stale && live.at !== null
    && now - live.at >= 0 && now - live.at <= Math.min(MARKET_MAX_AGE_SECONDS, live.stale_after ?? MARKET_MAX_AGE_SECONDS)
    && now >= live.cycle_start && now < live.cycle_end && !interrupted && !paused;
  const legs = settled ? latest!.legs : fresh ? live!.legs : seat?.legs ?? [];
  const total = settled ? latest!.return_points : fresh ? live!.return_points : null;
  // The race total is the positive-only contribution score. A forming negative
  // cycle is still shown in the chart, but never reduces this aggregate.
  const raceTotal = seat ? Number(seat.contribution) + (fresh ? Math.max(0, Number(live.return_points)) : 0) : null;
  const pendingProtection = me?.pending_actions.some(action => action.kind === "topup") ?? false;
  const noProtectionAtRisk = fresh && live?.return_points !== null && Number(live?.return_points) < 0
    && me?.protections_remaining === 0 && !pendingProtection;
  const traces = useRef(new Map<string, PerformanceSample[]>());
  const keyFor = (start: number, items: { ticker: string; side: string }[]) =>
    `${seat?.id}:${start}:${items.map(leg => `${leg.ticker}:${leg.side}`).sort().join("|")}`;
  // Only backend-recorded samples form the chart, so refreshing or viewing it
  // on another device preserves the same history. Live card values stay separate.
  if (active && live && seat && live.cycle_end === data.round.next_settlement_at && live.samples?.length) {
    const key = keyFor(live.cycle_start, seat.legs);
    const observations = new Map((traces.current.get(key) ?? []).map(sample => [sample.at, sample]));
    for (const sample of live.samples) {
      if (sample.cycle_start === live.cycle_start && sample.at >= live.cycle_start && sample.at < live.cycle_end
          && samePerformanceStrategy(sample.legs, seat.legs)) observations.set(sample.at, sample);
    }
    traces.current.set(key, [...observations.values()].sort((a, b) => a.at - b.at).slice(-901));
  }
  while (traces.current.size > 3) traces.current.delete(traces.current.keys().next().value!);
  const values = legs.map(leg => (settled || fresh) && "return_points" in leg ? Number(leg.return_points) : null);
  if (!seat) return null;
  const periodStart = settled ? latest?.cycle_start : live?.cycle_start ?? data.round.next_settlement_at - 900;
  const periodEnd = settled ? latest?.cycle_end : data.round.next_settlement_at;
  const timeLabel = (at: number) => new Date(at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const state = settled ? tr("Cycle settled") : pending ? tr("Awaiting entry") : interrupted || paused ? tr("Live chart paused")
    : now >= data.round.next_settlement_at ? tr("Settling…") : fresh ? tr(liveIntervalMs <= 1_000 ? "Live · every second" : "Live · every 5 seconds") : tr("Waiting for live prices");
  const stateTone = settled ? "settled" : pending ? "pending" : interrupted || paused ? "paused"
    : now >= data.round.next_settlement_at ? "settling" : fresh ? "live" : "waiting";

  const noticeTitle = settlementNotice === "eliminated" ? tr("Sorry, you have been eliminated from this race")
    : settlementNotice === "protected" ? tr("One protection was consumed") : tr("Congratulations, you advanced to the next round");
  const dismissNotice = () => {
    const wasEliminated = settlementNotice === "eliminated";
    setSettlementNotice(null);
    onSettlementDismissed?.();
    if (wasEliminated) onEliminated?.();
  };

  return <section className="race-performance" data-replaying={replaying} aria-label={tr("My strategy performance")}>
    <header className="race-performance-head">
      <div><h3>{tr("My strategy performance")}</h3><span>{seat.strategy_name || tr("Strategy")}</span></div>
      <span className="race-performance-state" data-state={stateTone} role="status" aria-live="polite">{state}</span>
    </header>
    {!pending && periodStart !== undefined && periodEnd !== undefined && <p className="race-performance-note">{tr("Cycle {0}–{1}", timeLabel(periodStart), timeLabel(periodEnd))}</p>}
    <RaceReturnChart quotes={legs.map(leg => fresh ? live.legs.find(item => item.ticker === leg.ticker)
        : settled && !active ? latest!.legs.find(item => item.ticker === leg.ticker) : undefined)}
      legs={legs} start={periodStart!} end={periodEnd!} pending={pending} values={values}
      interrupted={active && !settled && !fresh && now >= periodStart! && now < periodEnd!}
      samples={[...(traces.current.get(keyFor(periodStart!, legs)) ?? []),
        ...samples.filter(sample => (sample.cycle_start === undefined || sample.cycle_start === periodStart)
          && sample.at >= periodStart! && sample.at <= periodEnd!),
        ...(settled ? [{ at: latest!.cycle_end, legs: latest!.legs }] : [])]} />
    {active && me?.protections_remaining === 0 && <div className="race-protection-warning-slot"><div className="race-protection-warning" style={{ visibility: noProtectionAtRisk ? "visible" : "hidden" }} role="alert" aria-live="polite">
      <b>{tr("No protection — add or be eliminated")}</b>
      <span>{tr("Add protection before the cutoff to continue into the next cycle.")}</span>
    </div></div>}
    <div className="race-performance-total">
      <div className="race-performance-metric"><span>{settled ? tr("Settled cycle return") : tr("Current cycle return")}</span><strong data-tone={Number(total) < 0 ? "loss" : "gain"}>{total === null ? "—" : performancePercent(total)}</strong></div>
      <div className="race-performance-metric"><span>{tr("Total race return")}</span><strong className="race-performance-race-total">{raceTotal === null || !Number.isFinite(raceTotal) ? "—" : performancePercent(String(raceTotal))}</strong></div>
      <small style={{ visibility: !settled && fresh && live?.at ? "visible" : "hidden" }}>{tr("Updated {0}", live?.at ? new Date(live.at * 1000).toLocaleTimeString() : "—")}</small>
    </div>
    {latest && <div className="race-performance-result" key={resultKey} data-animate={replaying} role="status">
      <div className="race-performance-result-head"><span>{tr("15-minute settlement")} · {new Date(latest.cycle_end * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span><b data-tone={Number(latest.return_points) < 0 ? "loss" : "gain"}>{outcome(latest)}</b></div>
      <div className="race-performance-equation">
        {latest.legs.map((leg, index) => <span className="race-performance-term" key={leg.ticker} style={{ "--term-index": index } as CSSProperties}>
          {index > 0 && <i>+</i>}<span><small>{uSym(leg.ticker)} {leg.side === "long" ? "↑" : "↓"}</small><b data-tone={Number(leg.return_points) < 0 ? "loss" : "gain"}>{Number(leg.return_points) < 0 ? `(${performancePercent(leg.return_points)})` : performancePercent(leg.return_points)}</b></span>
        </span>)}
        <span className="race-performance-answer"><i>{displayedSumMatches(latest) ? "=" : "≈"}</i><b data-tone={Number(latest.return_points) < 0 ? "loss" : "gain"}>{performancePercent(latest.return_points)}</b></span>
      </div>
    </div>}
    <p className="race-performance-note">{pending ? tr("Your three assets start tracking when entry takes effect.") : tr("Live returns are estimates. Settlement uses the full-precision 15-minute candle; displayed values are rounded to 3 decimals.")}</p>
    {settlementNotice && <div className="race-settlement-notice-backdrop" role="presentation">
      <div className="race-settlement-notice" role="dialog" aria-modal="true" aria-labelledby="race-settlement-notice-title">
        <div className={`race-settlement-notice-icon ${settlementNotice}`} aria-hidden="true">{settlementNotice === "eliminated" ? "×" : settlementNotice === "protected" ? "−" : "✓"}</div>
        <h3 id="race-settlement-notice-title">{noticeTitle}</h3>
        <button className="enter" type="button" onClick={dismissNotice}>{tr("Got it")}</button>
      </div>
    </div>}
  </section>;
}
