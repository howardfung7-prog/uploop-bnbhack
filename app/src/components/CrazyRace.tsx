import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RacePerformance } from "./RacePerformance";
import type { CSSProperties } from "react";
import type { Address } from "viem";
import { tr } from "../lib/i18n";
import { displayName } from "../lib/profile";
import { newIdemKey, serverNow, ApiError } from "../lib/api";
import { countdown, fmtUsdt2 } from "../lib/arena";
import { loadDrafts } from "../lib/drafts";
import type { Draft } from "../lib/drafts";
import { useMobileEntryScroll } from "../lib/useMobileEntryScroll";
import { bareSym, uSym } from "../lib/ticker";
import { cancelRace, loadRace, raceActionLabel, raceError, submitRace } from "../lib/race";
import type { RaceAction, RaceActionKind, RaceSnapshot } from "../lib/race";

const ROOMS = [5, 10, 50, 200] as const;
const RACE_POLL_MS = 1_000;
interface Props {
  account: Address | null; configured: boolean; loggedIn: boolean; canWrite: boolean;
  busy: boolean; entriesPaused: boolean; onLogin?: () => void; onConnect?: () => void;
  onFunds: () => void; onChanged?: () => void;
  roomAvailability?: Partial<Record<typeof ROOMS[number], boolean>>;
}
const money = (value?: string | null) => value == null ? "—" : fmtUsdt2(BigInt(value));
const percent = (value?: string) => value == null ? "—" : `${Number(value) > 0 ? "+" : ""}${Number(value).toFixed(4)}%`;
const points = (value?: string) => value == null ? "—" : Number(value).toFixed(4);
const price = (value?: string) => value == null ? "—" : (Number(value) / 1e8).toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
const roomLabel = (room: number) => `${room} USDT`;

// Decorative roll-up between two actual server amounts. Money calculations stay in the ledger.
function PrizeAmount({ value, round }: { value?: string; round?: number }) {
  const [shown, setShown] = useState<bigint | null>(null);
  const current = useRef<bigint | null>(null);
  const priorRound = useRef(round);
  useEffect(() => {
    const target = value == null ? null : BigInt(value);
    const start = current.current;
    if (target === null || start === null || priorRound.current !== round || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      priorRound.current = round; current.current = target; setShown(target); return;
    }
    let raf = 0; let beginning: number | null = null;
    const tick = (now: number) => {
      beginning ??= now;
      const fraction = Math.min(1000, Math.round((now - beginning) / 700 * 1000));
      const next = start + (target - start) * BigInt(fraction) / 1000n;
      current.current = next; setShown(next);
      if (fraction < 1000) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, round]);
  // --chars sizes the font so the full figure fits the tile on narrow screens.
  const text = shown === null ? "—" : fmtUsdt2(shown);
  const full = money(value);
  return <><span aria-hidden="true" style={{ "--chars": full.length } as CSSProperties}>{text}</span><span className="sr-only">{full}</span></>;
}

export function CrazyRace({ account, configured, loggedIn, canWrite, busy, entriesPaused, onLogin, onConnect, onFunds, onChanged, roomAvailability }: Props) {
  const [data, setData] = useState<RaceSnapshot | null>(null);
  const [room, setRoom] = useState(10);
  const roomEnabled = (value: number) => roomAvailability?.[value as typeof ROOMS[number]] !== false;
  const stepRoom = (direction: number) => {
    const start = ROOMS.indexOf(room as typeof ROOMS[number]);
    for (let i = 1; i <= ROOMS.length; i++) {
      const next = ROOMS[(start + direction * i + ROOMS.length * 2) % ROOMS.length];
      if (roomEnabled(next)) { setRoom(next); return; }
    }
  };
  useEffect(() => {
    if (!roomEnabled(room)) {
      const next = ROOMS.find(value => roomEnabled(value));
      if (next !== undefined) setRoom(next);
    }
  }, [room, roomAvailability]);
  const [readError, setReadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [success, setSuccess] = useState<"entry" | "rebuy" | false>(false);
  const [refresh, setRefresh] = useState(0);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [order, setOrder] = useState<{ kind: RaceActionKind; round: number; key: string } | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selected, setSelected] = useState("");
  const [protectionCount, setProtectionCount] = useState(4);
  const [delta, setDelta] = useState<bigint | null>(null);
  const [award, setAward] = useState<RaceSnapshot["last_result"]>(null);
  const [performanceDismissed, setPerformanceDismissed] = useState(false);
  const previousResult = useRef<number | null>(null);
  const previousPool = useRef<{ round: number; amount: bigint } | null>(null);
  const identity = useRef(account);
  identity.current = account;
  const [, setTick] = useState(0);
  useEffect(() => { const timer = setInterval(() => setTick(t => t + 1), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    setData(null); setReadError(null); setOrder(null); setActionError(null); setNotice(null); setDelta(null);
    setSuccess(false);
    setPerformanceDismissed(false);
    previousPool.current = null; previousResult.current = null; setAward(null);
  }, [account, configured, room]);
  useEffect(() => { setPerformanceDismissed(false); }, [data?.round.id, data?.me?.seat?.id]);
  useEffect(() => {
    if (!configured) return;
    let alive = true; let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await loadRace(account, room);
        if (!alive) return;
        const pool = BigInt(next.round.prize_pool);
        const previous = previousPool.current;
        if (!previous || previous.round !== next.round.id) setDelta(null);
        else if (previous.amount !== pool) setDelta(pool - previous.amount);
        previousPool.current = { round: next.round.id, amount: pool };
        if (previousResult.current !== null && next.last_result && previousResult.current !== next.last_result.round_id) setAward(next.last_result);
        previousResult.current = next.last_result?.round_id ?? 0;
        setData(next); setReadError(null);
      } catch (error) { if (alive) setReadError(raceError(error)); }
      if (alive) timer = setTimeout(poll, RACE_POLL_MS);
    }
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [account, configured, loggedIn, refresh, room]);
  useEffect(() => { if (delta === null) return; const timer = setTimeout(() => setDelta(null), 6000); return () => clearTimeout(timer); }, [delta]);
  useEffect(() => { if (!award) return; const timer = setTimeout(() => setAward(null), 8000); return () => clearTimeout(timer); }, [award]);
  useEffect(() => { if (!success) return; const timer = setTimeout(() => setSuccess(false), 4500); return () => clearTimeout(timer); }, [success]);

  const round = data?.round;
  const me = data?.me;
  const progress = round ? Number(round.progress) : null;
  const phase = progress === null ? "open" : progress >= 100 ? "payout" : progress >= 90 ? "finale" : progress >= 80 ? "closed" : "open";
  const now = serverNow();
  const paused = !!round && (round.status !== "active" || !round.market_ready || !!data?.operations_paused);
  const showPause = entriesPaused || paused;
  const [pauseDetailsOpen, setPauseDetailsOpen] = useState(false);
  useEffect(() => { setPauseDetailsOpen(false); }, [showPause, room, account]);
  const collapsed = showPause && !pauseDetailsOpen;
  const locked = !!round && now >= round.operation_closes_at;
  const stale = !!readError || !data;
  const writable = configured && loggedIn && canWrite && !busy && !sending && !entriesPaused && !stale && !paused && !locked && roomEnabled(room);
  const allowed = (kind: RaceActionKind) => writable && me?.allowed_actions[kind] === true;
  const available = me?.balance === undefined ? null : BigInt(me.balance);
  const cost = BigInt(room) * 10n ** 18n;
  const orderCost = order?.kind === "topup" ? cost * BigInt(protectionCount) : order && ["enter", "rebuy"].includes(order.kind) ? cost : 0n;
  const needsStrategy = order?.kind === "enter" || order?.kind === "rebuy" || order?.kind === "switch";
  const strategyTarget = useMobileEntryScroll<HTMLLabelElement>(needsStrategy ? order!.kind : null);
  const chosen = drafts.find(draft => draft.id === selected);
  const orderValid = !!order && order.round === round?.id && allowed(order.kind) && (!needsStrategy || !!chosen)
    && (orderCost === 0n || available !== null && available >= orderCost);

  // Phones have no hover title, so a silently disabled action reads as "tapping does nothing".
  // Unavailable actions stay tappable (aria-disabled) and explain why instead (§71.175).
  const blockedReason = (kind: RaceActionKind) => {
    if (!round || stale) return tr("Live updates are unavailable. Last received values are shown; operations are disabled.");
    if (entriesPaused || paused || !roomEnabled(room)) return tr("Race paused. Operations will resume with the market.");
    if (locked) return tr("The final minute is locked. Wait for settlement.");
    if (!me) return tr("This action is not available right now.");
    if ((kind === "enter" || kind === "rebuy") && me.seat?.status === "active") return tr("You are already in this race.");
    if (kind !== "enter" && kind !== "rebuy" && me.seat?.status !== "active") return tr("Only players still in the race can do this.");
    if (me.pending_actions.some(action => action.kind === kind)) return tr("This request is already queued for the next settlement.");
    if (kind === "switch") {
      if ((progress ?? 0) >= 90) return tr("Strategy changes close at 90 points.");
      if (me.switches_used >= 3) return tr("All 3 strategy changes for this race have been used.");
      if (me.switches_available <= 0) return tr("Survive one 15-minute settlement to earn a strategy change (up to 3 per race).");
    }
    if ((kind === "enter" || kind === "rebuy" || kind === "topup") && (progress ?? 0) >= 80) return tr("Entries and protection close at 80 points.");
    if (kind === "topup" && me.topups_used >= 4) return tr("All 4 protection top-ups for this race have been used.");
    if (kind === "exit" && (data?.counts.alive ?? 0) < 5) return tr("Early exit requires at least 5 active players in this room, both when requesting and after settlement.");
    return tr("This action is not available right now.");
  };
  const tryOrder = (kind: RaceActionKind) => {
    if (allowed(kind)) openOrder(kind);
    else if (!busy && !sending) { setOrder(null); setActionError(null); setNotice(blockedReason(kind)); }
  };
  const openOrder = (kind: RaceActionKind) => {
    if (!round || !allowed(kind)) return;
    const saved = loadDrafts(account).filter(draft => draft.legs.length === 3 && new Set(draft.legs.map(l => bareSym(l.symbol))).size === 3);
    setDrafts(saved); setSelected(saved[0]?.id ?? ""); setProtectionCount(Math.max(1, 4 - (me?.topups_used ?? 0))); setOrder({ kind, round: round.id, key: newIdemKey() }); setActionError(null); setNotice(null);
  };
  async function perform(cancelId?: number) {
    if (sendingRef.current || !account || !writable || (cancelId === undefined && !orderValid)) return;
    const who = account;
    sendingRef.current = true; setSending(true); setActionError(null);
    try {
      if (cancelId !== undefined) await cancelRace(cancelId, `cancel-${cancelId}`, room);
      else if (order) await submitRace({
        idempotency_key: order.key, round_id: order.round, kind: order.kind, room,
        ...(needsStrategy && chosen ? { strategy: { name: chosen.name, legs: chosen.legs.map(l => ({ ticker: bareSym(l.symbol), side: l.side })) } } : {}),
        ...(order.kind === "topup" ? { protection_count: protectionCount } : {}),
      });
      if (identity.current === who) {
        const entered = cancelId === undefined && (order?.kind === "enter" || order?.kind === "rebuy");
        setOrder(null); setNotice(cancelId === undefined ? tr("Request queued for the next settlement boundary.") : tr("Request cancelled. Reserved funds have been returned."));
        if (entered) setSuccess(order?.kind === "rebuy" ? "rebuy" : "entry");
        onChanged?.();
      }
    } catch (error) {
      if (identity.current === who) {
        setActionError(raceError(error));
        // Rejected requests may be reviewed again; ambiguous network results keep their key.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) setOrder(value => value ? { ...value, key: newIdemKey() } : value);
      }
    } finally { sendingRef.current = false; setSending(false); setRefresh(value => value + 1); }
  }
  const status = readError ? tr("Updates interrupted") : !configured ? tr("Race data unavailable") : !round ? tr("Connecting to race…") : paused ? tr("Race paused") : phase === "payout" ? tr("Payout is open") : phase === "finale" ? tr("Final stretch") : phase === "closed" ? tr("Table locked") : tr("Race is running");

  return <section className="crazy-race" data-phase={phase} data-animating={!showPause && !stale} aria-labelledby="crazy-race-title">
    {success && createPortal(<div className="crazy-success-toast" role="status" aria-live="polite"><strong>{tr(success === "rebuy" ? "Rebuy successful" : "Entry successful")}</strong><span>{tr("Your entry is queued for the next settlement boundary.")}</span></div>, document.body)}
    <div className="crazy-race-head">
      <div className="crazy-race-title">
        <span className="crazy-race-k">{tr("3 assets · 15-minute settlement")}{round && <span>{tr("Race #{0}", round.id)}</span>}</span>
        <h2 id="crazy-race-title">{tr("100-Point Returns · Perpetual Index Summit Race")}</h2>
        <div className="crazy-room-switcher" role="group" aria-label={tr("Race entry amount")}>
          <button type="button" className="crazy-room-arrow" aria-label={tr("Previous race room")} onClick={() => stepRoom(-1)}>‹</button>
          <strong>{roomLabel(room)}</strong>
          <button type="button" className="crazy-room-arrow" aria-label={tr("Next race room")} onClick={() => stepRoom(1)}>›</button>
        </div>
      </div>
      <div className="crazy-hero-metrics">
        <div className="crazy-jackpot-score"><span>{tr("Race progress")}</span><div><b>{progress === null ? "—" : progress.toFixed(2)}</b><i>/ 100</i></div></div>
        <div className="crazy-pot crazy-pot-compact"><span className="label">{tr("Total prize")} <small>USDT</small></span><div className="amount"><PrizeAmount value={data?.round.prize_pool} round={round?.id} /></div><span className={`delta${delta !== null && delta < 0n ? " loss" : ""}`} aria-live="polite">{delta !== null ? `${delta > 0n ? "+" : "−"}${fmtUsdt2(delta < 0n ? -delta : delta)} USDT` : ""}</span></div>
      </div>
    </div>
    {showPause && <div className="crazy-pause-summary">
      <div role="status"><strong>{entriesPaused || data?.operations_paused ? tr("Entries paused") : tr("Race paused")}</strong><p>{tr("The race view is collapsed while operations are paused. It will expand automatically when operations resume.")}</p></div>
      <button className="ghost" type="button" aria-expanded={!collapsed} aria-controls="crazy-race-content" onClick={() => setPauseDetailsOpen(value => !value)}>{pauseDetailsOpen ? tr("Hide race details") : tr("Show race details")}</button>
    </div>}
    <div className="crazy-game" id="crazy-race-content" hidden={collapsed}>
      {award && <div className="crazy-award" role="status"><strong>{award.reason === "summit" ? tr("Settlement complete") : tr("Race ended")}</strong><span>{tr("Last race #{0}: {1} points · paid {2} USDT · carried {3} USDT", award.round_id, award.progress, money(award.paid), money(award.carryover))}</span></div>}
      <div className="crazy-progress">
        <div className="crazy-progress-top"><span className="crazy-jackpot-k">{status}</span><b>{!round || paused ? "—" : now >= round.next_settlement_at ? tr("Settling…") : tr("Next settlement in {0}", countdown(round.next_settlement_at - now))}</b></div>
        <div className="crazy-progress-track" style={{ "--race-progress": `${Math.min(100, progress ?? 0)}%` } as CSSProperties}>
          <span className="crazy-progress-fill" role="progressbar" aria-label={tr("Race progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress === null ? undefined : Math.min(100, progress)} aria-valuetext={progress === null ? tr("Race data unavailable") : tr("{0} points settled", round!.progress)} />
          <div className="crazy-progress-counts"><span><b>{data?.counts.registered ?? "—"}</b><small>{tr("Registered players")}</small></span><span><b>{data?.counts.eliminated ?? "—"}</b><small>{tr("Players eliminated")}</small></span><span><b>{data?.counts.alive ?? "—"}</b><small>{tr("Players still in")}</small></span></div>
        </div>
        <div className="crazy-progress-bottom"><span>{tr("80 points close entries · 100 points pay survivors")}</span>{data && data.counts.pending > 0 && <small>{tr("{0} awaiting entry", data.counts.pending)}</small>}</div>
      </div>
      {data && account && loggedIn && !performanceDismissed && <RacePerformance key={`${account.toLowerCase()}:${room}`} data={data} now={now} interrupted={!!readError} onEliminated={() => setPerformanceDismissed(true)} onSettlementDismissed={() => setRefresh(value => value + 1)} />}
      {(!configured || readError || paused || locked || entriesPaused) && <div className="crazy-notice" role="status">{!configured ? tr("Race service is not configured.") : readError ? tr("Live updates are unavailable. Last received values are shown; operations are disabled.") : entriesPaused ? tr("Entries are paused. Please try again later.") : paused ? tr("Race paused. Operations will resume with the market.") : tr("The final minute is locked. Wait for settlement.")}</div>}
      {readError && <button className="mini" type="button" onClick={() => setRefresh(value => value + 1)}>{tr("Retry")}</button>}
      <div className="crazy-action-bar">
        <div className="crazy-controls">
        {!account ? <button className="enter" type="button" disabled={!onConnect || busy} onClick={onConnect}>{tr("Connect wallet")}</button> : !loggedIn ? <button className="enter" type="button" disabled={!onLogin || busy} onClick={onLogin}>{tr("Sign in to the arena")}</button> : <>
          <button className="enter" type="button" aria-disabled={!allowed("enter") && !allowed("rebuy")} onClick={() => tryOrder(me?.allowed_actions.rebuy ? "rebuy" : "enter")}>{me?.allowed_actions.rebuy ? `${tr("Rebuy")} · ${roomLabel(room)}` : `${tr("Enter")} · ${roomLabel(room)}`}</button>
          <button className="act" type="button" aria-disabled={!allowed("topup")} onClick={() => tryOrder("topup")}>{`${tr("Add protection")} · ${tr("up to 4")}`}</button>
          <button className="act" type="button" aria-disabled={!allowed("switch")} onClick={() => tryOrder("switch")}>{tr("Change strategy")}</button>
          <button className="act" type="button" title={tr("Early exit requires at least 5 active players in this room, both when requesting and after settlement.")} aria-disabled={!allowed("exit")} onClick={() => tryOrder("exit")}>{tr("Exit entire position · 50%")}</button>
        </>}
        <a className="ghost" href="#build">{tr("Build a strategy")}</a>
        </div>
        <div className="crazy-estimate"><span>{tr("My estimated prize")}</span><strong>{money(me?.estimated_prize)} <small>USDT</small></strong></div>
      </div>
      {me?.seat?.status === "active" && (data?.counts.alive ?? 0) < 5 && <p className="crazy-detail-note">{tr("Early exit requires at least 5 active players in this room, both when requesting and after settlement.")}</p>}
      {order && <form className="crazy-order" onSubmit={event => { event.preventDefault(); void perform(); }}>
        <h3>{raceActionLabel(order.kind)}</h3>
        {needsStrategy && <label ref={strategyTarget} tabIndex={-1} className="entry-strategy-target">{tr("Select a saved three-asset strategy")}<select value={selected} onChange={event => { setSelected(event.target.value); setOrder({ ...order, key: newIdemKey() }); }} disabled={!writable}>
          <option value="">{tr("Choose a strategy")}</option>{drafts.map(draft => <option key={draft.id} value={draft.id}>{draft.name}</option>)}
        </select></label>}
        {chosen && needsStrategy && <p>{chosen.legs.map(leg => `${uSym(bareSym(leg.symbol))} ${leg.side === "long" ? tr("Long") : tr("Short")}`).join(" · ")}</p>}
        {needsStrategy && drafts.length === 0 && <p>{tr("Save a three-asset strategy first.")} <a href="#build">{tr("Build a strategy")}</a></p>}
        {order.kind === "topup" && <label>{tr("Protection count")}<select value={protectionCount} onChange={event => setProtectionCount(Math.max(1, Math.min(4 - (me?.topups_used ?? 0), Number(event.target.value))))} disabled={!writable}>{Array.from({ length: Math.max(1, 4 - (me?.topups_used ?? 0)) }, (_, index) => index + 1).map(count => <option key={count} value={count}>{count} × {roomLabel(room)}</option>)}</select></label>}
        {order.kind === "exit" ? <p>{tr("Estimated exit payment: {0} USDT, plus {1} USDT unused protection. Final amount is recalculated after settlement. You lose final prize eligibility and cannot re-enter this race.", money(me?.exit_quote), money(me?.protection_balance))}</p> : <p>{orderCost > 0n ? tr("Reserve {0} USDT from your arena balance now. Unapplied or cancelled requests are refunded.", fmtUsdt2(orderCost)) : tr("The new strategy takes effect next cycle if you survive.")}</p>}
        {order.kind === "exit" && <p>{tr("Exit requests pay only if you survive settlement. A final negative return without protection eliminates you first, so the exit pays nothing.")}</p>}
        <p>{tr("A top-up submitted before the cutoff consumes one protection if needed to survive this cycle; unused protection is retained or refunded on exit. Settlement precedes exits and strategy changes.")}</p>
        {order.round !== round?.id && <p role="alert">{tr("A new race has started. Review your request again.")}</p>}
        {orderCost > 0n && available !== null && available < orderCost && <button className="act" type="button" onClick={onFunds}>{tr("Deposit")}</button>}
        <div><button className="enter" disabled={!orderValid} type="submit">{sending ? tr("Submitting…") : tr("Confirm request")}</button> <button className="ghost" type="button" disabled={sending} onClick={() => setOrder(null)}>{tr("Close")}</button></div>
      </form>}
      {actionError && <p className="crazy-notice" role="alert">{actionError}</p>}{notice && <p className="crazy-notice" role="status">{notice}</p>}
      {!!me?.pending_actions.length && <div className="crazy-pending"><h3>{tr("Queued requests")}</h3>{me.pending_actions.map(action => <div key={action.id}><span>{raceActionLabel(action.kind)} · {action.amount !== "0" ? money(action.amount) + " USDT · " : ""}{tr("Effective after {0}", new Date(action.effective_at * 1000).toLocaleTimeString())}</span><button className="mini" disabled={!writable || !me.allowed_actions.cancel} type="button" onClick={() => void perform(action.id)}>{tr("Cancel request")}</button></div>)}</div>}
      {!!me?.recent_actions?.some(action => action.state !== "pending") && <details className="crazy-receipts"><summary>{tr("Recent requests and refunds")}</summary>{me.recent_actions.filter(action => action.state !== "pending").map(action => <p key={action.id}>{tr("Race #{0}", action.round_id)} · {raceActionLabel(action.kind)} · {actionReceipt(action)}</p>)}</details>}
      <div className="crazy-details">
        {me && <details className="crazy-detail-panel"><summary>{tr("My position")}<span>{me.seat ? seatStatus(me.seat.status) : tr("Not entered")}</span></summary><div className="crazy-player">
          <div><small>{tr("Strategy")}</small><b>{me.seat?.strategy_name || "—"}</b></div>
          <div><small>{tr("Strategy legs")}</small><b>{me.seat?.legs.map(leg => `${uSym(leg.ticker)} ${leg.side === "long" ? tr("Long") : tr("Short")}`).join(" · ") || "—"}</b></div>
          <div><small>{tr("Settled strategy return")}</small><b>{percent(me.seat?.total_return)}</b></div>
          <div><small>{tr("Prize contribution")}</small><b>{points(me.seat?.contribution)} {tr("points")}</b></div>
          <div><small>{tr("Protection remaining")}</small><b>{me.protections_remaining}</b><span>{tr("Unused protection: {0} USDT", money(me.protection_balance))}</span></div>
          <div><small>{tr("Protection top-ups")}</small><b>{me.topups_used} / 4</b></div>
          <div><small>{tr("Strategy changes used")}</small><b>{me.switches_used} / 3</b><span>{tr("{0} available", me.switches_available)}</span></div>
        </div>
        {!!me.cycles?.length && <div className="crazy-cycles"><h4>{tr("15-minute strategy returns")}</h4>{me.cycles.map(cycle => <div className="crazy-cycle" key={`${cycle.cycle_start}-${me.seat?.id}`}><div><b>{new Date(cycle.cycle_start * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</b><strong className={Number(cycle.return_points) < 0 ? "loss" : Number(cycle.return_points) > 0 ? "gain" : undefined}>{percent(cycle.return_points)}</strong></div><span>{cycle.legs.map(leg => `${uSym(leg.ticker)} ${leg.side === "long" ? "↑" : "↓"} ${price(leg.open)}→${price(leg.close)} (${percent(leg.return_points)})`).join(" · ")}</span></div>)}</div>}
        <p className="crazy-detail-note">{tr("Your estimate is the remaining winner budget multiplied by your active contribution share. Early-exit payments are already deducted; unused protection is separate.")}</p></details>}
        <details className="crazy-detail-panel"><summary>{tr("Settled strategy leaderboard")}</summary><div className="crazy-standings">
          <p>{tr("Active positions only · positive cumulative contribution · updated after each complete cycle")}</p>
          <table><thead><tr><th>#</th><th>{tr("Player")}</th><th>{tr("Strategy")}</th><th>{tr("Invested")}</th><th>{tr("Return")}</th><th>{tr("Contribution")}</th></tr></thead><tbody>{data?.leaderboard.map((seat, index) => <tr key={seat.id} className={seat.player.toLowerCase() === account?.toLowerCase() ? "me" : undefined}><td>{index + 1}</td><td title={seat.player}>{displayName(seat, seat.player)}</td><td><b>{seat.strategy_name || "—"}</b>{seat.status === "exited" && <small>{tr("Exited")}</small>}<small>{seat.legs.map(leg => `${uSym(leg.ticker)} ${leg.side === "long" ? tr("Long") : tr("Short")}`).join(" · ")}</small></td><td>{money(seat.invested)}</td><td>{percent(seat.total_return)}</td><td>{points(seat.contribution)}</td></tr>)}</tbody></table>
          {!data?.leaderboard.length && <p>{data ? tr("No settled active positions yet.") : tr("Race data unavailable")}</p>}
          {!!data?.eliminated_leaderboard?.length && <><h4 className="crazy-eliminated-title">{tr("Eliminated positions · {0}", data.eliminated_leaderboard.length)}</h4><table className="crazy-eliminated"><thead><tr><th>{tr("Player")}</th><th>{tr("Strategy")}</th><th>{tr("Invested")}</th><th>{tr("Return")}</th><th>{tr("Contribution")}</th></tr></thead><tbody>{data.eliminated_leaderboard.map(seat => <tr key={seat.id}><td title={seat.player}>{displayName(seat, seat.player)}</td><td><b>{seat.strategy_name || "—"}</b>{seat.status === "exited" && <small>{tr("Exited")}</small>}<small>{seat.legs.map(leg => `${uSym(leg.ticker)} ${leg.side === "long" ? tr("Long") : tr("Short")}`).join(" · ")}</small></td><td>{money(seat.invested)}</td><td>{percent(seat.total_return)}</td><td>{points(seat.contribution)}</td></tr>)}</tbody></table></>}
          {data && <p className="crazy-detail-note">{tr("{0} total entries · {1} eliminated positions (including {2} early exits). Registered players count once; rebuys create new positions.", data.counts.entries, data.counts.eliminated_entries, data.counts.exited)}</p>}
        </div></details>
      </div>
    </div>
    <div className="crazy-race-foot" hidden={collapsed}><details><summary>{tr("Race rules and prize breakdown")}</summary>
      {round && <p>{tr("Total prize {0} USDT · available to survivors {1} USDT", money(round.prize_pool), money(round.distributable))}</p>}
      <p>{tr("Entry {0} USDT with 1 protection included. Buy up to 4 more at {0} USDT each; unused ones are refunded.", room)}</p>
      <p>{tr("Every 15 minutes the three asset returns are added up. A gain adds points; a loss uses 1 protection, and with none left you are out.")}</p>
      <p>{tr("At 100 points the race ends. Players still in split the prize by contribution (stakes are not returned first), and a new race starts.")}</p>
      {round && <p>{tr("At the finish a 14% fee is taken (7 stakers · 1 jackpot · 3 referrals · 3 platform). Of the rest, 95% is paid out and 5% rolls into the next race. If nobody is left, no fee is charged and everything rolls over.")}</p>}
      <p>{tr("Early exit: take 50% of your estimated prize and give up the final payout. At least 5 players must be in the room.")}</p>
      <details className="crazy-race-more"><summary>{tr("More rules and prize details")}</summary>
        <p>{tr("Entries, rebuys and protection stop at 80 points; strategy changes stop at 90.")}</p>
        <p>{tr("Each round you survive earns 1 strategy change, up to 3 per race. Rebuying does not reset it.")}</p>
        <p>{tr("Requests take effect after the round settles; the last minute is locked. New protection starts from the next round.")}</p>
        <p>{tr("Prices come from Binance USDⓈ-M 15-minute candles. If data is missing, the race pauses until it is back.")}</p>
        <p>{tr("Total prize = carryover + entry fees + used paid protection. Protection adds no prize weight.")}</p>
        <p>{tr("Early-exit payouts come out of the prize; estimates change as the race goes.")}</p>
        {round && <>
          <p>{tr("Carried in from the previous race: {0} USDT", money(round.carryover))}</p>
          <p>{tr("Estimated fee {0} USDT · early exits paid {1} USDT · projected summit carryover {2} USDT", money(round.platform_fee), money(round.exit_paid), money(round.projected_carryover))}</p>
        </>}
        {data?.last_result && <>
          <p>{tr("Last race #{0}: {1} points · paid {2} USDT · carried {3} USDT", data.last_result.round_id, data.last_result.progress, money(data.last_result.paid), money(data.last_result.carryover))}</p>
          {data.last_result.platform_fee !== undefined && <p>{tr("Last race: fee {0} USDT · early exits paid {1} USDT", money(data.last_result.platform_fee), money(data.last_result.exit_paid))}</p>}
        </>}
      </details>
    </details></div>
  </section>;
}
function seatStatus(status: string) {
  return ({ active: tr("Still in"), pending: tr("Awaiting entry"), eliminated: tr("Eliminated"), exited: tr("Exited"), settled: tr("Settled"), finished: tr("Settled") } as Record<string, string>)[status] ?? tr("Awaiting settlement");
}
function actionReceipt(action: RaceAction) {
  if (action.result?.refunded && BigInt(action.result.refunded) > 0n) return tr("Refunded {0} USDT", money(action.result.refunded));
  if (action.state === "cancelled") return tr("Cancelled");
  if (action.state === "rejected" && action.result?.reason === "eliminated_before_exit") return tr("Eliminated before exit; no exit payment.");
  if (action.state === "rejected" && action.result?.reason === "exit_min_players") return tr("Fewer than 5 active players after settlement; exit cancelled. Your position remains active.");
  if (action.state === "rejected") return tr("Not applied after settlement");
  if (action.kind === "exit" && action.result?.amount !== undefined) return tr("Paid {0} USDT · protection returned {1} USDT", money(action.result.amount), money(action.result.protection_refund ?? "0"));
  return tr("Applied");
}
