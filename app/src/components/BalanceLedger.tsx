import { useEffect, useState } from "react";
import { apiGet } from "../lib/api";
import { fmtUsdt2, fmtWhen } from "../lib/arena";
import { tr } from "../lib/i18n";

interface Movement {
  id: number; ts: number; kind: string; ref: string; memo: string; amount: string;
  daily_room_id?: number; round_id: number | null; action_kind: string | null; room?: number | null;
}
interface Statement {
  address: string; items: Movement[]; next_before: number | null; income: string; expense: string;
}

export function movementLabel(row: Pick<Movement, "kind" | "action_kind">): string {
  if (row.kind === "race_reserve") return row.action_kind === "topup" ? tr("Race protection reserved") : tr("Race entry reserved");
  const labels: Record<string, string> = {
    daily_entry: tr("Daily arena entry"), daily_refund: tr("Daily arena refund"), daily_prize: tr("Daily arena prize"), daily_creator: tr("Daily arena creator reward"),
    daily_bonus: tr("Daily arena bonus"), daily_bonus_refund: tr("Daily arena bonus returned"),
    race_exit: tr("Race early exit"), race_prize: tr("Race prize"), race_refund: tr("Race request refunded"),
    race_protection_refund: tr("Unused protection returned"), deposit: tr("Deposit"),
    entry: tr("Entry"), enter: tr("Entry"), settle: tr("Prize"), settle_allneg: tr("Refund"), refund: tr("Refund"),
    withdraw_request: tr("Withdrawal reserved"), withdraw_cancel: tr("Withdrawal refunded"),
    dividend: tr("Fee share"), referral: tr("Referral commission"), jackpot: tr("Jackpot prize"), grant: tr("Account credit"),
  };
  return labels[row.kind] ?? tr("Account adjustment");
}

export function BalanceLedger({ account, enabled, busy }: { account: string; enabled: boolean; busy: number | null }) {
  const [data, setData] = useState<Statement | null>(null);
  const [error, setError] = useState(false);
  const [more, setMore] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const next = await apiGet<Statement>("/me/statement");
        if (alive && next.address.toLowerCase() === account.toLowerCase()) { setData(current => current && current.items.length > 100 ? {
          ...next, items: [...next.items, ...current.items.filter(row => row.id < (next.items.at(-1)?.id ?? 0))],
          next_before: current.next_before,
        } : next); setError(false); }
      } catch { if (alive) setError(true); }
      finally { loading = false; }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 15_000);
    return () => { alive = false; clearInterval(timer); };
  }, [account, enabled, busy, retry]);
  const loadMore = async () => {
    if (!data?.next_before || more) return;
    setMore(true);
    try {
      const next = await apiGet<Statement>("/me/statement", { before: data.next_before });
      if (next.address.toLowerCase() === account.toLowerCase()) setData(current => current ? {
        ...next, items: [...current.items, ...next.items.filter(row => !current.items.some(old => old.id === row.id))],
      } : next);
    } catch { setError(true); }
    finally { setMore(false); }
  };
  return <section className="acct-sec">
    <div className="acct-h"><h2>{tr("Transactions")}</h2>
      {enabled && data && <span className="bal">{tr("Income")} <b>+{fmtUsdt2(BigInt(data.income))}</b> · {tr("Expenses")} <b>−{fmtUsdt2(BigInt(data.expense))}</b> USDT</span>}
    </div>
    {!enabled ? <div className="note">{tr("Sign in to see this")}</div>
      : error ? <div className="note" role="status">{tr("Transaction records are unavailable.")} <button className="link" onClick={() => setRetry(n => n + 1)}>{tr("Retry")}</button></div> : null}
    {enabled && !data && !error && <div className="note">{tr("Loading your records…")}</div>}
    {enabled && data && (data.items.length === 0 ? <div className="panel"><div className="empty"><b>{tr("No transactions yet")}</b></div></div>
      : <div className="ledger">{data.items.slice(0, expanded ? data.items.length : 10).map(row => {
        const amount = BigInt(row.amount);
        return <div className="lg-row" key={row.id}>
          <span className="lg-kind">{movementLabel(row)}</span>
          <span className="lg-what">{row.room ? `${row.room} USDT · ` : ""}{row.daily_room_id ? tr("Daily arena #{0}", row.daily_room_id) : row.round_id !== null ? tr("100-point race #{0}", row.round_id) : tr("Record #{0}", row.id)} · {fmtWhen(row.ts)}</span>
          <span className={`lg-amt${amount < 0n ? " neg" : ""}`}>{amount < 0n ? "−" : "+"}{fmtUsdt2(amount < 0n ? -amount : amount)} USDT</span>
          <span className="lg-st">{amount < 0n ? tr("Deducted from balance") : tr("Credited to balance")}</span>
        </div>;
      })}{data.items.length > 10 && <button className="act ghosted more" onClick={() => setExpanded((value) => !value)}>{expanded ? tr("Collapse") : tr("{0} older rows", data.items.length - 10)}</button>}{expanded && data.next_before !== null && <button className="act ghosted more" disabled={more} onClick={() => void loadMore()}>{more ? tr("Loading…") : tr("Load older transactions")}</button>}</div>)}
    <p className="acct-foot">{tr("Actual arena balance movements. Reserved entry and protection funds appear once; using reserved protection does not deduct your balance again.")}</p>
  </section>;
}
