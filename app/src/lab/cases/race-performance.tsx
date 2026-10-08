import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { RacePerformance } from "../../components/RacePerformance";
import type { PerformanceSample } from "../../lib/race-performance";
import type { RaceCycle, RaceCycleLeg, RaceSnapshot } from "../../lib/race";
import { tr } from "../../lib/i18n";
import { Stage } from "../Stage";

const modes = [
  ["auto", "Auto demo"], ["pending", "Awaiting entry"], ["live", "Live returns"],
  ["settled", "Positive settlement"], ["switched", "New strategy active"],
  ["protected", "Paid protection used"], ["eliminated", "Eliminated"],
  ["stale", "Waiting for live prices"], ["extreme", "Extreme moves"],
] as const;
const original = ["BTC", "ETH", "SOL"].map((ticker, i) => ({ ticker, side: i === 1 ? "short" as const : "long" as const }));
const replacement = ["BNB", "ETH", "SOL"].map(ticker => ({ ticker, side: "short" as const }));
const outcomes = [[0.593, -0.192, 0.151], [0.78, 0.55, -0.63], [-1.35, 0.82, -0.95], [-1.1, -0.85, 0.9]];
const openings = { BTC: 63500, ETH: 2650, SOL: 146, BNB: 580 };
function marketLegs(strategy: typeof original, values: number[]): RaceCycleLeg[] {
  return strategy.map((leg, index) => {
    const opening = openings[leg.ticker as keyof typeof openings] * 1e8;
    const close = Math.round(opening * (1 + values[index] / 100 * (leg.side === "short" ? -1 : 1)));
    return { ...leg, open: String(opening), close: String(close), return_points: values[index].toFixed(6) };
  });
}

// Local fixtures only. The accelerated clock never submits requests to race APIs.
export function RacePerformancePreview() {
  const [mode, setMode] = useState("auto");
  const [step, setStep] = useState(0);
  const [run, setRun] = useState(0);
  const [base] = useState(() => Math.floor(Date.now() / 900000) * 900);
  useEffect(() => {
    const timer = setInterval(() => setStep(value => mode === "auto" ? Math.min(60, value + 1) : value + 1), 1000);
    return () => clearInterval(timer);
  }, [mode]);
  const select = (next: string) => { setMode(next); setStep(0); setRun(value => value + 1); };
  const auto = mode === "auto";
  const completed = auto ? Math.floor(step / 15) : mode === "pending" || mode === "live" || mode === "stale" || mode === "extreme" ? 0
    : mode === "settled" ? 1 : mode === "switched" ? 2 : mode === "protected" ? 3 : 4;
  const eliminated = completed === 4;
  const switched = completed >= 2;
  const strategy = switched ? replacement : original;
  const start = base + completed * 900;
  const now = start + (auto ? step % 15 * 60 : 300 + step * 5 % 500) + 1;
  const finalValues = mode === "extreme" ? [4, -3.5, -.35] : outcomes[Math.min(completed, 3)];
  const fraction = (now - start) / 900;
  const values = finalValues.map((value, index) => value * fraction + Math.sin(Math.PI * fraction) * Math.sin(fraction * Math.PI * 8 + index * 1.7) * .32);
  const legs = marketLegs(strategy, values);
  const cycles: RaceCycle[] = Array.from({ length: completed }, (_, index): RaceCycle => ({
    cycle_start: base + index * 900, cycle_end: base + (index + 1) * 900,
    return_points: outcomes[index].reduce((sum, value) => sum + value, 0).toFixed(6),
    contribution: index === 0 ? "0.552" : "0.907", status: index === 3 ? "eliminated" : "active",
    consumed_protection: index === 2 ? "paid" : "none", legs: marketLegs(index >= 2 ? replacement : original, outcomes[index]),
  })).reverse();
  const samples: PerformanceSample[] = [];
  for (let cycleIndex = Math.max(0, completed - 1); cycleIndex <= completed; cycleIndex++) {
    if (cycleIndex >= outcomes.length || mode === "pending") continue;
    const cycleStart = base + cycleIndex * 900;
    const elapsed = cycleIndex < completed ? 900 : now - cycleStart;
    const cycleStrategy = cycleIndex >= 2 ? replacement : original;
    for (let second = 0; second <= elapsed; second += 1) {
      const t = second / 900;
      const points = (mode === "extreme" ? finalValues : outcomes[cycleIndex]).map((target, index) =>
        target * t + Math.sin(Math.PI * t) * Math.sin(t * Math.PI * 8 + index * 1.7) * .32);
      samples.push({ cycle_start: cycleStart, at: cycleStart + second, legs: marketLegs(cycleStrategy, points) });
    }
    if (cycleIndex === completed && mode !== "stale") samples.push({ cycle_start: cycleStart, at: now, legs });
  }
  const seat = { id: run + 1, player: "0x" + "a".repeat(40), name: "Demo Player", strategy_name: switched ? "BNB / ETH / SOL" : "BTC / ETH / SOL",
    status: mode === "pending" ? "pending" : eliminated ? "eliminated" : "active", legs: strategy,
    total_return: cycles.reduce((sum, cycle) => sum + Math.max(0, Number(cycle.return_points)), 0).toFixed(6), contribution: completed === 0 ? "0" : completed === 1 ? "0.552" : "0.907", invested: "20000000000000000000" };
  const progress = [38.25, 51.82, 73.46, 86.12, 94.38][completed];
  const alive = [22, 18, 12, 8, 5][completed];
  const prize = [300, 330, 360, 390, 410][completed];
  const data: RaceSnapshot = {
    round: { id: 1008, status: "active", phase: "open", progress: String(progress), prize_pool: (BigInt(prize) * 10n ** 18n).toString(), distributable: "245100000000000000000", carryover: "0", next_settlement_at: start + 900, operation_closes_at: start + 840, updated_at: now, market_ready: true },
    counts: { registered: 30, entries: 30, eliminated: 30 - alive, eliminated_entries: 30 - alive, alive, pending: mode === "pending" ? 1 : 0, exited: 0 },
    leaderboard: [], last_result: null,
    me: { seat, estimated_prize: "18000000000000000000", exit_quote: "9000000000000000000", protection_balance: completed < 3 ? "10000000000000000000" : "0", protections_remaining: completed < 3 ? 1 : 0, topups_used: 1, switches_used: switched ? 1 : 0, switches_available: 1, allowed_actions: {}, pending_actions: [], cycles,
      live: mode === "pending" || eliminated ? null : { cycle_start: start, cycle_end: start + 900, at: now, stale: mode === "stale", return_points: values.reduce((sum, value) => sum + value, 0).toFixed(6), legs } },
  };
  return <Stage><div className="lab-race-preview">
    <div className="lab-race-preview-tools"><b>{tr("Simulated data · no real funds")}</b><p>{tr("Updates every second; the demo advances one simulated minute every second and completes a 15-minute cycle in 15 seconds.")}</p>
      <div>{modes.map(([value, label]) => <button className={mode === value ? "on" : ""} aria-pressed={mode === value} key={value} onClick={() => select(value)}>{tr(label)}</button>)}
        <button onClick={() => { setMode("auto"); setStep(value => Math.min(60, (Math.floor(value / 15) + 1) * 15)); }}>{tr("Next demo cycle")}</button>
      </div>
      <p>{tr("Demo path: profit → same strategy next cycle → new strategy → paid protection consumed → eliminated.")}</p>
    </div>
    <div className="crazy-race" data-phase={progress >= 90 ? "finale" : progress >= 80 ? "closed" : "open"} data-animating="true">
      <div className="crazy-race-head"><div className="crazy-race-title"><span className="crazy-race-k">{tr("Simulated data · no real funds")}</span><h2>{tr("100-Point Returns · Perpetual Index Summit Race")}</h2></div>
        <div className="crazy-hero-metrics"><div className="crazy-jackpot-score"><span>{tr("Race progress")}</span><div><b>{progress.toFixed(2)}</b><i>/ 100</i></div></div>
          <div className="crazy-pot crazy-pot-compact"><span className="label">{tr("Total prize")}</span><div className="amount">{prize.toFixed(2)}<small> USDT</small></div></div></div>
      </div>
      <div className="crazy-game"><div className="crazy-progress"><div className="crazy-progress-top"><span>{tr("Race #{0}", 1008)}</span><b>{tr("3 assets · 15-minute settlement")}</b></div>
        <div className="crazy-progress-track" style={{ "--race-progress": `${progress}%` } as CSSProperties}><span className="crazy-progress-fill" />
          <div className="crazy-progress-counts"><span><b>30</b><small>{tr("Registered players")}</small></span><span><b>{30 - alive}</b><small>{tr("Players eliminated")}</small></span><span><b>{alive}</b><small>{tr("Players still in")}</small></span></div>
        </div></div>
        <RacePerformance data={data} now={now} interrupted={false} samples={samples} liveIntervalMs={1_000} />
      </div>
    </div>
  </div></Stage>;
}
