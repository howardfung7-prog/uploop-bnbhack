import { useEffect, useState } from "react";
import { isZh, tr } from "../lib/i18n";
import { fmtUsdt2 } from "../lib/arena";
import { demoUpPoints, entryUpTier, formatUp, loadUpPoints, UP_SOURCES } from "../lib/up-points";
import type { UpSource, UpState } from "../lib/up-points";

export function UpPoints({ account, demo = false, busy }: { account: string; demo?: boolean; busy: number | null }) {
  const [state, setState] = useState<UpState>(() => demo ? demoUpPoints(account) : { kind: "loading" });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (demo) { setState(demoUpPoints(account)); return; }
    let alive = true;
    let controller: AbortController | undefined;
    const refresh = async () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      const next = await loadUpPoints(account, current.signal);
      if (alive && !current.signal.aborted) setState(next);
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 15_000);
    return () => { alive = false; controller?.abort(); clearInterval(timer); };
  }, [account, demo, busy, retry]);
  return <UpPointsCard state={state} demo={demo} onRetry={() => setRetry((n) => n + 1)} />;
}

const LABELS: Record<UpSource, string> = {
  participation: tr("Match participation"), ranking: tr("Ranking rewards"), loss: tr("Loss rewards"),
  staking: tr("Certificate staking"), onboarding: tr("First deposit reward"),
};

export function UpPointsCard({ state, demo = false, onRetry }: { state: UpState; demo?: boolean; onRetry?: () => void }) {
  const record = state.kind === "ok" ? state.record : null;
  const tier = record ? entryUpTier(record.volume) : null;
  const status = state.kind === "loading" ? tr("Loading UP…")
    : state.kind === "missing" ? tr("No UP record has been published for this wallet yet.")
    : state.kind === "not-published" ? tr("UP records have not been published yet.")
    : tr("UP records are unavailable. Please try again later.");
  return (
    <section className="up-points" aria-labelledby="up-points-heading" aria-busy={state.kind === "loading"}>
      <div className="up-points-head">
        <h2 id="up-points-heading">{tr("My UP")}</h2>
        <div>{demo && <span className="chip">{tr("Demo data")}</span>}<a href="#help/points">{tr("How to earn UP")} ↗</a></div>
      </div>
      <div className="up-points-grid">
        <div className="up-points-main">
          <span className="up-points-label">{tr("Lifetime UP")}</span>
          <div className="up-points-amount"><strong>{record ? formatUp(record.lifetimeTotal) : "—"}</strong><b>UP</b></div>
          {!record && <p role="status">{status} {state.kind === "unavailable" && <button className="link" onClick={onRetry}>{tr("Retry")}</button>}</p>}
        </div>
        <div className="up-points-summary">
          <div><span>{tr("Match UP multiplier")}</span><strong>{tier ? `${tier.multiplier}×` : "—"}</strong></div>
          {record && <p>{tier?.next
            ? tr("{0} / {1} USDT toward the next multiplier", fmtUsdt2(record.volume), fmtUsdt2(tier.next))
            : tr("Highest match multiplier reached")}</p>}
        </div>
      </div>
      {record && <details className="up-points-detail">
        <summary>{tr("UP breakdown")}</summary>
        <dl>{UP_SOURCES.map((source) => <div key={source}><dt>{LABELS[source]}</dt><dd>{formatUp(record.breakdown[source])} <b>UP</b></dd></div>)}</dl>
        {!demo && <p>{tr("Your first successful deposit earns 10 UP once per account.")}</p>}
        {!demo && <p>{tr("Ranking and staking UP are not enabled yet.")}</p>}
        <p>{tr("Updated {0} · off-chain records", new Intl.DateTimeFormat(isZh() ? "zh-CN" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(record.publishedAt * 1000) + " UTC")}</p>
      </details>}
    </section>
  );
}
