import { redeemBusyId, stakeBusyId } from "../lib/busy";
export { redeemBusyId, stakeBusyId } from "../lib/busy";
import { tr } from "../lib/i18n";
import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import type { Holding, Lot, Pick, Ticker } from "../lib/board";
import { burnFrom, certLabel, fmtBurned, fmtCert, lotKey, pickN } from "../lib/board";
import { DIVIDEND_ALL_SHARE, DIVIDEND_WIN_SHARE, FRAGMENT_SHARE, KINDS, RAKE_SHARES, SNAPSHOT_SEC, countdown, fmtDay, fmtRate, fmtUsdt, fmtUsdt2, fmtWhen, isFree, nextSnapshot, phaseOf } from "../lib/arena";
import type { Entry, Funds, JackpotState, Pool, ResultsState, Stats } from "../lib/arena";
import type { Floor } from "../lib/market";
import type { MemePool } from "../lib/meme";
import { fmtTok, tick } from "../lib/meme";
import type { Quote, Quotes } from "../lib/quotes";
import { fmtUsd, quoteOf, unitValue } from "../lib/quotes";
import { chainNow } from "../lib/chain";
import { apiErrorText, apiGet, serverNow } from "../lib/api";
import { loadDividends, loadReferral, refLink } from "../lib/referral";
import type { ArenaSource, FundsMode } from "./Arena";
import { writeClip } from "./CopyAddr";
import type { Tab } from "./Topbar";
import { UpPoints } from "./UpPoints";
import { BalanceLedger } from "./BalanceLedger";

/// "My matches" lists only this many of the most recent matches by default; older ones fold away.
/// The list shows the latest 10 (in play and finished counted separately); the rest open on click (§58).
const RECENT = 10;
/// "Transactions" lists only this many of the most recent rows by default.
const LEDGER_RECENT = 10;

/// "1 cert" / "3 certs" — certificate counts are all over this page and English needs the
/// singular. Chinese has no plural and uses one measure word for both, which is why the whole
/// phrase goes through the catalogue instead of picking a suffix here.
function certs(n: bigint): string {
  return n === 1n ? tr("{0} cert", n.toString()) : tr("{0} certs", n.toString());
}

/// "1 batch" / "2 batches" — same story as certs() above.
function batches(n: number): string {
  return n === 1 ? tr("{0} batch", String(n)) : tr("{0} batches", String(n));
}

interface Props {
  account: Address | null;
  /// Read-only preview / demo: everything renders as usual, the write buttons are disabled.
  readOnly?: boolean;
  /// UP fixtures are only available in explicit demo mode, never in wallet previews.
  demo?: boolean;
  busy: number | null;
  holdings: Holding[];
  /// Unstaked certificates in the wallet, grouped by batch (§71.80 / the targeted §69.16 exception): staking and
  /// redeeming need a batch and a count, so we have to know which batches are on hand.
  lots: Lot[];
  /// Symbol → the live Binance quote (§71.26): used to work out "what is this one worth right now".
  quotes: Quotes;
  pools: Pool[];
  board: Ticker[];
  /// The arena balance (§26, the ledger). null = not signed in, or the arena endpoint is not configured.
  funds: Funds | null;
  /// Whether the arena endpoint (VITE_API_BASE) is configured.
  arenaConfigured: boolean;
  /// The Perfect-Score Jackpot (§71.38, `GET /jackpot`). Only `mine` (my shares) is used here; the amount lives
  /// on the arena's own plaque (§71.67).
  jackpot: JackpotState;
  source: ArenaSource;
  /// 🔴 Since §71.80 unstaking / redeeming / staking all work on "this many certificates out of that batch":
  /// tick a batch, type a count.
  /// Unstaking is possible at any time — the §37 "no unstaking during US market hours" gate was dropped by the
  /// user on 2026-09-15, and the front end no longer checks the clock at all.
  onUnstake: (id: number, picks: Pick[]) => void;
  onRedeem: (id: number, picks: Pick[]) => void;
  /// Stake certificates held in the wallet (§55: a certificate bought on the market sits in the wallet and only
  /// joins the dividend once it is staked).
  onStake: (id: number, picks: Pick[]) => void;
  onGo: (t: Tab) => void;
  /// Open the wallet-backed arena balance dialog without changing the current page.
  onFunds?: (mode: FundsMode) => void;
  /// Secondary-market floor prices (§33). undefined = not configured, nothing is shown on the card.
  floors?: Map<number, Floor>;
  /// MEME burn certificates (§71.11 / §71.94): which batches I hold and how many of each. Dividends are paid out
  /// off chain by the platform, by certificate count, so there is no on-chain claim step.
  /// undefined = the on-chain contract address is not configured and the whole block is skipped.
  meme?: { pools: MemePool[] };
}

/// My Account (§54): seven blocks, top to bottom — my matches, the Perfect-Score Jackpot (§71.67), my staking,
/// certificate dividends (§71.144), MEME burn certificates (§71.11 / §71.94),
/// invite friends (§71.144), transactions.
/// Unstaking lives here (the user, 2026-09-10: "put unstaking in my positions"); the staking page only deposits.
/// This page does not explain the rules; unstaking is always possible (the §37 market-hours gate was dropped on
/// 2026-09-15) and the rules sit in the Q&A at the foot of the "Asset Staking" page.
export function Account(p: Props) {
  if (!p.account) {
    return (
      <div className="panel">
        <div className="empty">
          <b>{tr("Wallet not connected")}</b>
          {tr("Connect a wallet to see your matches, perfect-score shares, staking positions, certificate fee share, referral commission and transaction history")}
        </div>
      </div>
    );
  }
  /// 🔴 §71.144: both of these blocks hit private back-end endpoints (`GET /referral` / `GET /dividends`), so we
  /// only knock when the arena endpoint is configured AND this wallet has signed in. In demo / preview mode
  /// (`readOnly`) the shell still renders, but it says "sign in to see this" inside — we do not invent numbers (§29).
  const mine = p.arenaConfigured && !p.readOnly && p.funds !== null;
  return (
    <div className="acct">
      <UpPoints key={`${p.demo ? "demo" : "live"}:${p.account.toLowerCase()}`} account={p.account} demo={p.demo} busy={p.busy} />
      <Matches {...p} me={p.account} />
      <Stakes {...p} />
      {p.arenaConfigured && <CertDividends on={mine} />}
      {p.meme && <MemeCerts pools={p.meme.pools} lots={p.lots} onGo={p.onGo} />}
      {p.arenaConfigured && <Invite on={mine} />}
      {p.demo || !p.arenaConfigured ? <Ledger {...p} me={p.account} /> : <BalanceLedger key={p.account.toLowerCase()} account={p.account} enabled={mine} busy={p.busy} />}
    </div>
  );
}

// ---------------------------------------------------------------- UPLOOP record

interface CompetitionRecord { id: string; source: "summit" | "daily" | "activity"; at: number; amount: string; outcome: "won" | "lost" | "refunded" | "pending"; prize: string }

interface MatchRow { pool: Pool; entries: Entry[]; results?: ResultsState }

// Demo mode still renders the legacy transaction preview; the live account uses
// the server-owned compact record endpoint above.
function useMyMatches(me: Address, pools: Pool[], source: ArenaSource, busy: number | null, all: boolean) {
  const [entries, setEntries] = useState<Map<number, Entry[]> | null>(null);
  const [detail, setDetail] = useState<Record<number, { results?: ResultsState }>>({});
  useEffect(() => {
    let alive = true;
    setEntries(null);
    source.myEntries(me).then((value) => { if (alive) setEntries(value); }).catch(() => { if (alive) setEntries(new Map()); });
    return () => { alive = false; };
  }, [me, source]);
  const rows = useMemo<MatchRow[]>(() => !entries ? [] : pools.filter((pool) => (entries.get(pool.id)?.length ?? 0) > 0)
    .sort((a, b) => b.locksAt - a.locksAt).map((pool) => ({ pool, entries: entries.get(pool.id)!, ...detail[pool.id] })), [entries, pools, detail]);
  const shown = all ? rows : rows.slice(0, RECENT);
  useEffect(() => {
    if (busy !== null) return;
    let alive = true;
    (async () => { for (const row of shown) {
      if (!row.pool.settled) continue;
      const results = await source.results(row.pool.id).catch((): ResultsState => ({ kind: "none" }));
      if (alive) setDetail((current) => ({ ...current, [row.pool.id]: { results } }));
    } })();
    return () => { alive = false; };
  }, [shown.map((row) => row.pool.id).join(","), source, busy]);
  return { loaded: entries !== null, rows };
}

function Matches({ me, funds: _funds, arenaConfigured, source, busy, onGo: _onGo, onFunds: _onFunds }: Props & { me: Address }) {

  // The record (§71.38): matches entered / win rate / perfect scores. The numbers come from the ledger's
  // `GET /stats` and the front end only divides; re-read whenever busy goes from set to null.
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    if (!arenaConfigured || busy !== null) return;
    let alive = true;
    const refresh = () => source.stats(me).then((st) => { if (alive) setStats(st); }).catch(() => { if (alive) setStats(null); });
    void refresh();
    const timer = setInterval(refresh, 15000);
    return () => { alive = false; clearInterval(timer); };
  }, [me, source, busy, arenaConfigured]);

  return (
    <section className="acct-sec">
      <div className="acct-h">
        <h2>{tr("My UPLOOP record")}</h2>
      </div>

      {/* The four record cells (§71.38). Nothing read → "—", never 0 (§25); the denominator of the win rate and the
          perfect-score rate includes settled paid matches and race cycles */}
      {arenaConfigured && (
        <div className="st-stats record" aria-label={tr("Record")}>
          <div className="pool-stat">
            <span className="k">{tr("Matches entered")}</span>
            <span className={`v${stats && stats.entries === 0 ? " zero" : ""}`}>{stats ? stats.entries : "—"}<i>{stats && stats.entries === 1 ? tr("match") : tr("matches")}</i></span>
            <small>{tr("Regular entries and activated race seats; cancelled entries do not count")}</small>
          </div>
          <div className="pool-stat">
            <span className="k">{tr("Win rate")}</span>
            <span className={`v${stats && stats.settled === 0 ? " zero" : ""}`}>{stats ? fmtRate(stats.won, stats.settled) : "—"}</span>
            <small>{stats ? tr("{0} wins / {1} results · each 15-minute race cycle counts once", stats.won, stats.settled) : tr("Loading…")}</small>
          </div>
          <div className="pool-stat">
            <span className="k">{tr("Perfect scores")}</span>
            <span className={`v${stats && stats.allCorrect === 0 ? " zero" : ""}`}>{stats ? stats.allCorrect : "—"}<i>{stats && stats.allCorrect === 1 ? tr("time") : tr("times")}</i></span>
            <small>{tr("Every selected direction must be right and the total return must exceed 1%")}</small>
          </div>
          <div className="pool-stat">
            <span className="k">{tr("Perfect-score rate")}</span>
            <span className={`v${stats && stats.settled === 0 ? " zero" : ""}`}>{stats ? fmtRate(stats.allCorrect, stats.settled) : "—"}</span>
            <small>{stats ? tr("{0} perfect / {1} results · each 15-minute race cycle counts once", stats.allCorrect, stats.settled) : tr("Loading…")}</small>
          </div>
        </div>
      )}

      {arenaConfigured && <CompetitionRecords account={me} enabled={true} />}
    </section>
  );
}
function CompetitionRecords({ account, enabled }: { account: Address; enabled: boolean }) {
  const [records, setRecords] = useState<CompetitionRecord[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setExpanded(false);
    const refresh = () => apiGet<{ records: CompetitionRecord[] }>("/competition-records")
      .then((value) => { if (alive) setRecords(value.records); })
      .catch(() => { if (alive) setRecords([]); });
    void refresh();
    const timer = setInterval(refresh, 15000);
    return () => { alive = false; clearInterval(timer); };
  }, [account, enabled]);
  if (!enabled) return null;
  const visible = records && (expanded ? records : records.slice(0, RECENT));
  return <section className="acct-records" aria-label={tr("Competition records")}>
    <h3>{tr("Competition records")}</h3>
    {!records ? <div className="note">{tr("Loading your records…")}</div> : records.length === 0 ? <div className="panel"><div className="empty">{tr("No competition records yet")}</div></div> :
      <>
      <div className="competition-record-list">{visible!.map((row) => {
        const won = row.outcome === "won";
        return <div className={`competition-record-row${won ? "" : " record-muted"}`} key={row.id}>
          <span className="competition-record-kind">{tr(row.source === "summit" ? "Summit race" : row.source === "daily" ? "Daily arena" : "Activity match")}</span>
          <span className="competition-record-amount">{fmtUsdt2(BigInt(row.amount))} USDT</span>
          <span className="competition-record-result">{tr(won ? "Won" : row.outcome === "pending" ? "In progress" : row.outcome === "refunded" ? "Refunded" : "Lost")}</span>
          {won && <b className="competition-record-prize">+{fmtUsdt2(BigInt(row.prize))} USDT</b>}
        </div>;
      })}</div>
      {records.length > RECENT && <button className="act ghosted competition-record-more" onClick={() => setExpanded((value) => !value)}>
        {expanded ? tr("Collapse") : tr("Show all {0} records", records.length)}
      </button>}
      </>}
  </section>;
}

// ---------------------------------------------------------------- my staking

/// One row per batch with a checkbox in front: the batch number, how many you hold, how many to move (editable),
/// how many tokens back each certificate, and what that is worth at the live Binance price (§71.80).
/// 🔴 A batch number is unique inside one certificate contract but repeats across contracts, so it always appears
/// as "asset + #number" (`certLabel`) — a bare number on its own is never allowed.
/// Value = the live Binance price × the tokens behind each certificate in this batch × the number being moved
/// (§71.26: only Binance sets a price); with no quote we write nothing (§25).
/// 🔴 For `burn` (a burn-type uBNC) two things on this row have to change: the token name carries a `$` (every MEME
/// does site-wide), and the "≈ $x" on the right is **not written at all** — it means "how much you get back when
/// you redeem", and a burn-type certificate redeems for nothing, so putting a Binance-priced number beside it
/// implies the certificate is backed by tokens (§25 / §29 / §71.139).
function LotPick({ symbol, lots, pick, quote, burn }: {
  symbol: string; lots: Lot[]; pick: LotPickState; quote?: Quote; burn?: boolean;
}) {
  return (
    <div className="cert-list" role="group" aria-label={tr("Certificate batches")}>
      {lots.map((l) => {
        const k = lotKey(l);
        const on = pick.sel.includes(k);
        const n = on ? pickN(pick.qty[k] ?? "", l.n) : 0n;
        return (
          <label className={`cert-row lot${on ? " on" : ""}`} key={k}>
            <input type="checkbox" checked={on} onChange={() => pick.toggle(l)} />
            <span className="ct">
              <b>{certLabel(symbol, l.batchId)}</b>
              <small>{tr("you have {0}", certs(l.n))}</small>
            </span>
            <span className="qty">
              <input
                inputMode="numeric" aria-label={tr("{0} certificates to move", certLabel(symbol, l.batchId))}
                placeholder={l.n.toString()} disabled={!on}
                value={pick.qty[k] ?? ""} onChange={(e) => pick.setQty(l, e.target.value)}
              />
              <small>{tr("certs")}</small>
            </span>
            <span className="am">
              <span>{burn ? <>{fmtBurned(l, l.assetPerCert)} {tr("burned per cert")}</> : <>{fmtCert(l, l.assetPerCert)} {tr("per cert")}</>}</span>
              <small>{!burn && quote && n > 0n ? `≈ ${fmtUsd(unitValue({ ...l, unit: l.assetPerCert * n }, quote))}` : ""}</small>
            </span>
          </label>
        );
      })}
    </div>
  );
}

/// The line above the checkboxes: how many batches and certificates are selected, plus select all / clear.
function PickHead({ pick, lots }: { pick: LotPickState; lots: Lot[] }) {
  const total = lots.reduce((a, l) => a + l.n, 0n);
  return (
    <div className="cert-head">
      <span>{tr("Selected")} <b>{pick.shares.toString()}</b> / {total.toString()} {tr("certs")}{pick.picks.length > 1 && <> ({pick.picks.length} {tr("batches)")}</>}</span>
      {pick.sel.length < lots.length ? <button className="link" onClick={pick.all}>{tr("Select all")}</button> : <button className="link" onClick={pick.none}>{tr("Clear")}</button>}
    </div>
  );
}

interface LotPickState {
  /// The keys of the ticked batches (`lotKey`: contract address + batch number)
  sel: string[];
  /// Batch key → the raw text in that batch's count box
  qty: Record<string, string>;
  /// The ticked batches with a valid count, ready to hand to a write operation
  picks: Pick[];
  /// Σ picks.n
  shares: bigint;
  toggle: (l: Lot) => void;
  setQty: (l: Lot, raw: string) => void;
  all: () => void;
  none: () => void;
}

/// The "tick some batches, set a count on each" state, shared by staking, unstaking and redeeming.
/// Ticking a batch fills the count to the full batch (moving the whole thing is the usual intent); edit it down to
/// move only part of it.
function useLotPick(lots: Lot[]): LotPickState {
  const [sel, setSel] = useState<string[]>([]);
  const [qty, setQtyMap] = useState<Record<string, string>>({});

  const toggle = (l: Lot) => {
    const k = lotKey(l);
    setSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
    setQtyMap((m) => (m[k] ? m : { ...m, [k]: l.n.toString() }));
  };
  const setQty = (l: Lot, raw: string) => setQtyMap((m) => ({ ...m, [lotKey(l)]: raw }));
  const all = () => {
    setSel(lots.map(lotKey));
    setQtyMap((m) => ({ ...Object.fromEntries(lots.map((l) => [lotKey(l), l.n.toString()])), ...m }));
  };
  const none = () => setSel([]);

  const picks = lots
    .filter((l) => sel.includes(lotKey(l)))
    .map((l) => ({ cert: l.cert, batchId: l.batchId, n: pickN(qty[lotKey(l)] ?? "", l.n) }))
    .filter((p) => p.n > 0n);

  return { sel, qty, picks, shares: picks.reduce((a, p) => a + p.n, 0n), toggle, setQty, all, none };
}

function Stakes({ holdings, board, lots, quotes, readOnly, busy, floors, onUnstake, onRedeem, onStake, onGo }: Props) {
  const staked = holdings.reduce((a, h) => a + h.total, 0n);
  const locked = readOnly || busy !== null;

  return (
    <section className="acct-sec">
      <div className="acct-h">
        <h2>{tr("My staking")}</h2>
        {holdings.length > 0 && <span className="cnt">{holdings.length}</span>}
        <span className="bal">
          <b>{staked.toString()}</b> {tr("certs staked")}
          <button className="act ghosted" onClick={() => onGo("mint")}>{tr("Deposit")}</button>
        </span>
      </div>
      {holdings.length > 0 && <SnapshotLine />}
      {holdings.length === 0 ? (
        <div className="panel">
          <div className="empty">
            <b>{tr("Nothing staked")}</b>
            {tr("Go to “Asset Staking” and deposit a token for certificates — depositing stakes them straight away; you can also buy them on the Certificate Market")}
          </div>
        </div>
      ) : (
        <div className="pool-grid">
          {holdings.map((h) => (
            <StakeCard
              key={h.id} h={h} locked={locked} busy={busy}
              /* Only the `Ticker` on `board` knows whether this is a burn-type certificate (`Holding` carries no
                 `mode`). Not found → treat it as redeemable, which is how this page has always looked, so the
                 burn-type wording never leaks onto another card. */
              burn={board.find((t) => t.id === h.id)?.mode === "burn"}
              quote={quoteOf(quotes, h)} floors={floors} onUnstake={onUnstake} onGo={onGo}
            />
          ))}
        </div>
      )}
      <WalletLots board={board} lots={lots} quotes={quotes} busy={busy} locked={locked} onRedeem={onRedeem} onStake={onStake} onGo={onGo} />
      <p className="acct-foot">
        {tr("You can ask to unstake at any time; once the transaction confirms the certificates return to your wallet. Redeeming only touches the batches and counts you picked. The full rules are in the “Asset Staking” help section.")}
      </p>
    </section>
  );
}

/// The one line the whole site shares: dividends settle on a 15-minute clock, and here is the next settlement point
/// and how long until it (the user, 2026-09-15, replacing the 7-day warm-up).
/// This number is the same for everyone — how long you have been staked does not affect the weight, so we do not
/// need to know when you staked.
/// 🔴 The seconds come from `chainNow()`, never `Date.now()`; a re-render every second keeps the countdown moving.
function SnapshotLine() {
  const [, bump] = useState(0);
  useEffect(() => {
    const t = setInterval(() => bump((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const now = chainNow();
  const at = nextSnapshot(now);
  const hhmm = new Date(at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <p className="st-snap">
      {tr("The fee share settles every")} {SNAPSHOT_SEC / 60} {tr("minutes · next settlement point")} <b>{hhmm}</b> {tr("(in")} {countdown(at - now)})
      <small>{tr("Eligible staked certificates join the split from the next settlement point, weighted by certificate count.")}</small>
    </p>
  );
}

/// One card per asset: the staked batches are listed, and unstaking takes a batch plus a count. Dividends are
/// weighted by **certificate count**, so how much is inside makes no difference (the user, 2026-09-15) — which
/// means "N certs staked" is the weight itself; how much each certificate holds only decides how many tokens come
/// back when you unstake or redeem.
///
/// 🔴 `burn` (a staked uBNC): three sentences on this card are false for a burn-type certificate — "X inside"
/// (there is nothing inside; the tokens went to the burn address the moment they were minted), "shares bStock
/// dividends" (it shares the MEME pot instead), and the "≈ $x" on the right of each batch row (§25 / §29).
/// All three branch on `burn` (§71.139).
/// uBNC has only been stakeable since §71.138, so these three had to be fixed the moment that path opened —
/// otherwise the first person to stake a uBNC would be reading nothing but untruths.
function StakeCard({ h, burn, locked, busy, quote, floors, onUnstake, onGo }: {
  h: Holding; burn: boolean; locked: boolean; busy: number | null; quote?: Quote;
  floors?: Map<number, Floor>;
  onUnstake: (id: number, picks: Pick[]) => void; onGo: (t: Tab) => void;
}) {
  const pick = useLotPick(h.lots);
  const floor = floors?.get(h.id) ?? null;
  const inside = h.lots.reduce((a, l) => a + l.assetPerCert * l.n, 0n);

  return (
    <div className="pool st-live">
      <div className="pool-top">
        <span className="sym">{h.symbol}</span>
        <span className="chip live">{tr("Staked")}</span>
      </div>
      <div className="st-stats">
        <div className="pool-stat">
          <span className="k">{tr("Staked")}</span>
          <span className="v">{h.total.toString()}<i>{tr("certs")}</i></span>
          <small>{batches(h.lots.length)} · {burn ? <>{tr("{0} burned in total", fmtBurned(h, inside))}</> : <>{fmtCert(h, inside)} {tr("inside")}</>}</small>
        </div>
      </div>
      <div className="st-line">
        {burn ? tr("Receives the MEME burn-certificate fee share, by certificate count") : tr("Shares USDT distributions, by certificate count")}
        {floors && <> · {floor ? <>{tr("lowest ask")} <b>{fmtUsdt(floor.unitPrice)}</b> {tr("USDT / cert")}</> : tr("no listings")} · <button className="link" onClick={() => onGo("market")}>{tr("Certificate market")}</button></>}
      </div>
      <PickHead pick={pick} lots={h.lots} />
      <LotPick symbol={h.symbol} lots={h.lots} pick={pick} quote={quote} burn={burn} />
      <div className="sc-acts">
        <button className="act ghosted" disabled={locked || pick.shares === 0n}
          title={tr("Once the unstake transaction confirms the certificates return to your wallet and can be staked again")}
          onClick={() => { onUnstake(h.id, pick.picks); pick.none(); }}>
          {busy === h.id ? tr("Working") : pick.shares > 0n ? tr("Unstake the {0} selected", certs(pick.shares)) : tr("Unstake")}
        </button>
      </div>
    </div>
  );
}

/// The certificates in the wallet (bought on the market, or unstaked back): **one row per batch, with the count and
/// all three actions on that same row** — stake / redeem / list on the market (the user, 2026-09-18, §71.128).
/// On a narrow screen a row spreads out into a card.
/// Since §71.80 this is a list of batches — §69.16 was relaxed for exactly this (we only list the asset
/// certificates we issued ourselves; USDT, asset tokens and MEME token balances in the wallet are still never
/// read). Staked and listed positions have their own views.
///
/// 🔴 The cost is written down here: one row moves one batch, so the old "tick several batches and push them all in
/// with one transaction" is gone. Gas on BSC is a few cents, and what it buys is never having to look back at a
/// checkbox to work out which batch the button you just pressed actually moved. The "My staking" card still uses
/// the checkbox machinery (`LotPick` / `PickHead` / `useLotPick`), untouched — unstaking really does often clear
/// several batches at once.
function WalletLots({ board, lots, quotes, busy, locked, onRedeem, onStake, onGo }: {
  board: Ticker[]; lots: Lot[]; quotes: Quotes; busy: number | null; locked: boolean;
  onRedeem: (id: number, picks: Pick[]) => void; onStake: (id: number, picks: Pick[]) => void;
  onGo: (t: Tab) => void;
}) {
  // Which row is currently sending a transaction. The busy id is keyed by **asset** (`stakeBusyId(tickerId)`), so
  // when one asset has two batches both rows would match — hence remembering which row was pressed; it is cleared
  // as soon as the transaction lands (busy back to null).
  const [acting, setActing] = useState<string | null>(null);
  useEffect(() => { if (busy === null) setActing(null); }, [busy]);

  // A row now says "uTSLA #2" on its own, so the asset dropdown above it is no longer needed: every batch is laid
  // out flat, sorted by symbol and then by batch number.
  // Batches whose parent card cannot be found are skipped (`onStake` / `onRedeem` need a tickerId, and without a
  // parent card there is no way to send the transaction).
  const rows = useMemo(() => {
    const byId = new Map(board.map((t) => [t.id, t]));
    return lots
      .map((l) => ({ l, t: byId.get(l.tickerId) }))
      .filter((r): r is { l: Lot; t: Ticker } => !!r.t)
      .sort((a, b) =>
        a.l.symbol.localeCompare(b.l.symbol) ||
        (a.l.batchId < b.l.batchId ? -1 : a.l.batchId > b.l.batchId ? 1 : 0));
  }, [board, lots]);
  const total = rows.reduce((a, r) => a + r.l.n, 0n);

  return (
    <div className="panel wal-shares">
      {/* Keep this card focused on certificates currently available in the wallet. */}
      <div className="k">{tr("Certificates in my wallet")}</div>
      {rows.length === 0 ? (
        <div className="note">{tr("No unstaked certificates in your wallet.")}</div>
      ) : (
        <>
          <div className="wl-head">
            <span>{tr("||before the wallet cert total")}<b>{total.toString()}</b> {tr("certs in {0}", batches(rows.length))}</span>
            <small>{tr("Each batch is handled on its own: set the count, then press that row’s own button")}</small>
          </div>
          <div className="wl-list" role="list">
            {rows.map(({ l, t }) => (
              <WalletLotRow
                key={lotKey(l)} l={l} t={t} quote={quoteOf(quotes, t)}
                busy={busy} locked={locked} acting={acting === lotKey(l)} onAct={setActing}
                onRedeem={onRedeem} onStake={onStake} onGo={onGo}
              />
            ))}
          </div>
          <small className="mk-note">
            {tr("Redeeming returns")} <b>{tr("the token amount that was locked when the certificate was minted")}</b>{tr("; it does not move with the token price. Different batches can back a different amount per certificate, and only the row you press is touched.")}
            {/* 🔴 §71.138: both certificate families now live in this block (a burn-type one can be staked and can
                be listed for sale), so as soon as a burn-type one is present we have to spell out that it has no
                redeem step — nobody should be hunting a row of "Redeem" buttons for theirs (§29) */}
            {rows.some(({ t }) => t.mode === "burn") && <>
              {" "}{tr("Burn-type certificates (uBNC) have no \"redeem\" step: the tokens went to the burn address the moment they were minted and cannot be recovered. They can still be staked, and sold on the certificate market.")}
            </>}
          </small>
        </>
      )}
    </div>
  );
}

/// One batch, one row: number / count (editable) / what redeeming returns plus its current value / stake · redeem ·
/// list on the market.
/// 🔴 A batch number is unique inside one certificate contract but repeats across contracts, so it always appears
/// as "asset + #number" (`certLabel`) — a bare number on its own is never allowed.
/// 🔴 The current value is only written when there is a Binance quote; with no quote it stays blank, and we never
/// pass an on-chain conversion off as a price (§25 / §71.26).
///
/// 🔴 Since §71.138 burn-type certificates (uBNC) go through this row too (they can be staked and sold on the
/// certificate market), so the row has two faces:
///   · redeemable: the third cell reads "X tokens on redemption ≈ $Y" and there are three buttons,
///     stake / redeem / list on the market;
///   · burn-type: the third cell reads "Not redeemable" and there is **no redeem button** — the tokens went to the
///     burn address the moment they were minted (§71.136), and there is no "≈ $" either (that number means "how
///     much you get back on redemption", and nothing comes back here, so writing it implies backing, §25 / §29).
/// The name needs no choosing here: `Lot.symbol` was already written as uBNC by `certName()` inside `lotsOf()`.
function WalletLotRow({ l, t, quote, busy, locked, acting, onAct, onRedeem, onStake, onGo }: {
  l: Lot; t: Ticker; quote?: Quote; busy: number | null; locked: boolean;
  acting: boolean; onAct: (k: string | null) => void;
  onRedeem: (id: number, picks: Pick[]) => void; onStake: (id: number, picks: Pick[]) => void;
  onGo: (tab: Tab) => void;
}) {
  // Default to the whole batch — moving all of it is by far the most common intent; edit it down to move part.
  // After a partial stake the batch shrinks, and the box follows it back to the new full amount (otherwise the old
  // number would still be sitting there and people would think that many are about to move).
  const [raw, setRaw] = useState(l.n.toString());
  useEffect(() => { setRaw(l.n.toString()); }, [l.n]);

  const n = pickN(raw, l.n);           // not a number → 0; anything over this batch is capped at the batch
  const ok = n > 0n && !locked;
  const label = certLabel(l.symbol, l.batchId);
  const burn = t.mode === "burn";
  // What redeeming returns = the tokens behind each certificate in this batch × the number being moved. That is the
  // amount locked in at mint time and has nothing to do with today's price (the colleague's doc, §5).
  const back = l.assetPerCert * n;
  // 🔴 Never work this out for a burn-type certificate: it means "how much money redeeming gets you back", and a
  // burn-type one redeems for nothing, so writing it implies the certificate is backed by tokens (§25 / §29).
  const usd = !burn && quote && n > 0n ? fmtUsd(unitValue({ ...l, unit: back }, quote)) : "";
  const one: Pick[] = [{ cert: l.cert, batchId: l.batchId, n }];
  const fire = (run: () => void) => { onAct(lotKey(l)); run(); };

  return (
    <div className="wl-row" role="listitem">
      <span className="wl-id">
        <b>{label}</b>
        {/* Every burn-type certificate is called uBNC, so this line both tells them apart (which token was burned
            for it) and is the only honest statement of where the certificate came from: it does not "hold" X
            tokens, X tokens were "burned" for it (§71.138) */}
        <small>
          {certs(l.n)} · {burn ? <>{burnFrom(l)} · {tr("{0} burned per cert", fmtBurned(l, l.assetPerCert))}</> : <>{fmtCert(l, l.assetPerCert)} {tr("per cert")}</>}
        </small>
      </span>
      <span className="wl-qty">
        {/* In the card layout (≤560) the four cells stack, and an input box on its own says nothing about what goes
            in it, so this label is added; wide screens have the column positions of a table header, so it hides */}
        <small className="wl-qk">{tr("Move")}</small>
        <input
          inputMode="numeric" aria-label={tr("{0} certificates to move", label)}
          placeholder={l.n.toString()} value={raw} onChange={(e) => setRaw(e.target.value)}
        />
        <small>{tr("certs")}</small>
      </span>
      <span className="wl-val">
        {burn ? (
          /* 🔴 Writing "redeems for X tokens" here for a burn-type certificate would simply be false: those tokens
             went to the burn address the moment it was minted and nobody can get them back (§71.136 / §71.138) */
          <>
            <b>{tr("Not redeemable")}</b>
            <small>{tr("the tokens went to the burn address")}</small>
          </>
        ) : (
          <>
            {/* Count box empty / not a number → "—", never 0 (§25: if we do not know, we do not write it — nobody
                should think they really would get 0 tokens) */}
            <b>{n > 0n ? fmtCert(l, back) : "—"}</b>
            <small>{tr("on redemption")}{usd && ` · ≈ ${usd}`}</small>
          </>
        )}
      </span>
      <span className="wl-act">
        <button className="act" disabled={!ok}
          title={tr("Stake {0} of your {1} certificates; they count towards the fee share from the next 15-minute settlement point. The first time needs one extra approval.", n, label)}
          onClick={() => fire(() => onStake(t.id, one))}>
          {acting && busy === stakeBusyId(t.id) ? tr("Staking") : n > 0n ? tr("Stake {0}", certs(n)) : tr("Stake")}
        </button>
        {/* 🔴 For a burn-type certificate **no redeem button is rendered at all** (not even a disabled one): the
            contract's `redeem()` simply does not work, and a greyed-out button only makes people keep pressing it,
            convinced they have failed to meet some condition (§71.138) */}
        {!burn && (
          <button className="act ghosted" disabled={!ok}
            title={tr("Burn {0} of your {1} certificates and get {2} back", n, label, fmtCert(l, back))}
            onClick={() => fire(() => onRedeem(t.id, one))}>
            {acting && busy === redeemBusyId(t.id) ? tr("Redeeming") : n > 0n ? tr("Redeem {0}", certs(n)) : tr("Redeem")}
          </button>
        )}
        {/* This only changes page, it sends no transaction — so it stays enabled in read-only mode and while a
            transaction is in flight. The market page has no "open with a batch preselected" entry point; which
            batch to list is picked once you are over there */}
        <button className="act ghosted wl-go" title={tr("Go to the certificate market and list it for sale")}
          onClick={() => onGo("market")}>{tr("List on the market")}</button>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- MEME burn certificates (§71.11 / §71.94)

/// The MEME burn certificates I hold: one card per pool, listing how many of each batch.
///
/// 🔴 Since §71.94 there is **no claim button** here: the dividend is centralised (settled by the user on
/// 2026-09-15) and paid out off chain by the platform, by certificate count. The new `BurnCertificate` contract has
/// no dividend function at all, and the old "claimable / claimed / claim to wallet" read a `MemeBurn` that was
/// never deployed — it was fiction. This block only shows what really exists on chain: which batches I hold and
/// how many of each.
function MemeCerts({ pools, lots, onGo }: {
  pools: MemePool[]; lots: Lot[]; onGo: (t: Tab) => void;
}) {
  const rows = pools
    .map((p) => ({ p, ls: lots.filter((l) => l.tickerId === p.id) }))
    .filter(({ ls }) => ls.length > 0);
  const total = rows.reduce((a, { ls }) => a + ls.reduce((b, l) => b + l.n, 0n), 0n);
  return (
    <section className="acct-sec">
      <div className="acct-h">
        <h2>{tr("MEME burn certificates")}</h2>
        {rows.length > 0 && <span className="cnt">{rows.length}</span>}
        <span className="bal">{total > 0n ? <>{tr("||before the burn-cert total")}<b>{total.toLocaleString()}</b> {tr("certs")}</> : tr("The fee share is paid out by the platform, by certificate count")}</span>
      </div>
      {rows.length === 0 ? (
        <div className="panel">
          <div className="empty">
            <b>{tr("No MEME burn certificates yet")}</b>
            {tr("Burn tokens for certificates in the")} <button className="link" onClick={() => onGo("meme")}>{tr("MEME Lab")}</button> {tr("and what you hold shows up here")}
          </div>
        </div>
      ) : (
        <div className="drops">
          {rows.map(({ p, ls }) => (
            <div className="drop-card" key={p.id}>
              {/* 🔴 The card is named after the **certificate's own** symbol (uBNC), not the token that was burned
                  ($BNBCAT): whichever MEME you burn you get the same certificate, so writing $BNBCAT here would be
                  inventing a certificate that does not exist (§71.136 / §71.138). Which is which is told by the
                  "From burning $XXX" that follows */}
              <div className="drop-top">
                <b>{p.certSymbol}</b>
                <span className="mute"> · {burnFrom({ unitSymbol: p.symbol })} · {ls.reduce((a, l) => a + l.n, 0n).toLocaleString()} {tr("certs")}</span>
              </div>
              {ls.map((l) => (
                <div className="drop-row" key={`${l.cert}-${l.batchId}`}>
                  <span>{certLabel(p.certSymbol, l.batchId)} · <b>{l.n.toLocaleString()}</b> {tr("certs")}</span>
                  {/* The $XXX in this line is the **token that was burned**, so its own name is the right one */}
                  <span className="mute">{tr("{0} {1} burned per cert", fmtTok(l.assetPerCert, p.decimals, 0), tick(p.symbol))}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {rows.length > 0 && (
        /* 🔴 Deliberately repeats "Certificates in my wallet" above: the same uBNC batch appears in both blocks,
           and the stake / list buttons only grow in that one. Without this line people would look for the buttons
           here, fail to find them, and conclude the certificate cannot be sold (§29) */
        <small className="mk-note">
          {tr("These batches are also listed under")} <b>{tr("“Certificates in my wallet”")}</b> {tr("above — the")} <b>{tr("Stake")}</b> {tr("and")} <b>{tr("List on the market")}</b> {tr("buttons are there.")}
          {tr("Burn-type certificates have no “redeem” step: the tokens went to the burn address the moment they were minted and cannot be recovered.")}
        </small>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- certificate dividends (§71.144)

/// Read the endpoint once. `null` = still loading, `Error` = the read failed (say so plainly, never invent a 0).
function useOnce<T>(load: () => Promise<T>, on: boolean): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    load()
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => { if (alive) setError(apiErrorText(e)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);
  return { data, error };
}

/// My certificate dividends (§71.144). Paid in USDT and credited to the balance: one share site-wide by
/// staked count, six shares to the winning assets' certificates weighted by count.
///
/// 🔴 Since §71.166 those figures are shares of the fee, not percentages of the buy-ins: the stakers get
/// FRAGMENT_SHARE of RAKE_SHARES, split DIVIDEND_ALL_SHARE site-wide and DIVIDEND_WIN_SHARE to the winning
/// assets. The fee itself is capped by what the losers staked, so no fixed percentage of a match can be quoted.
///
/// 🔴 This money **is already in the arena balance** — there is no claim step, which makes it completely unlike the
/// bStock block above, so the two are separate sections with different headings ("My fee share" is the bStock
/// on-chain token; this section is USDT).
function CertDividends({ on }: { on: boolean }) {
  const { data, error } = useOnce(loadDividends, on);
  const rows = data?.recent ?? [];
  return (
    <section className="acct-sec">
      <div className="acct-h">
        <h2>{tr("Certificate fee share")}</h2>
        {data && data.times > 0 && <span className="cnt">{data.times}</span>}
        <span className="bal">
          {data ? <>{tr("Total")} <b>+{fmtUsdt2(data.earned)}</b> {tr("USDT · credited to balance")}</> : tr("Stake certificates to share {0} parts in {1} of every match's fee", FRAGMENT_SHARE, RAKE_SHARES)}
        </span>
      </div>
      {!on ? (
        <div className="panel"><div className="empty"><b>{tr("Sign in to see this")}</b>{tr("The fee share is credited to your arena balance by certificate count — there is nothing to claim")}</div></div>
      ) : error ? (
        <div className="note">{tr("Could not load your fee-share records:")} {error}</div>
      ) : !data ? (
        <div className="note">{tr("Loading your fee-share records…")}</div>
      ) : rows.length === 0 ? (
        <div className="panel">
          <div className="empty">
            <b>{tr("Nothing paid out yet")}</b>
            {tr("The stakers' {0} parts of each match's fee split in two:", FRAGMENT_SHARE)} <b>{DIVIDEND_ALL_SHARE}</b> {tr("is shared equally by certificate count across every staker site-wide, and")} <b>{DIVIDEND_WIN_SHARE}</b> {tr("go to stakers of the winning assets' certificates, weighted by certificate count. You have to be staked to get a share.")}
          </div>
        </div>
      ) : (
        <div className="ledger">
          {rows.map((r, i) => (
            <div className="lg-row" key={`${r.poolId}-${r.scope}-${i}`}>
              <span className="lg-kind">{r.scope === "win" ? tr("Winning assets") : tr("Site-wide")}</span>
              <span className="lg-what">{r.race ? tr("Summit {0}U #{1}", r.race.room, r.race.round) : r.daily ? tr("Daily Arena #{0}", r.daily) : <>{tr("Match #")}{r.poolId}</>} {tr("· on")} <b>{r.shares.toLocaleString()}</b> {tr("certs")}{r.paidAt ? ` · ${fmtWhen(r.paidAt)}` : ""}</span>
              <span className="lg-amt">+{fmtUsdt2(r.amount)} USDT</span>
              <span className="lg-st">{tr("Credited")}</span>
            </div>
          ))}
        </div>
      )}
      {/* The user trimmed the small print on 2026-09-19 and this footnote went with it:
          "Dividends are worked out from the number of certificates staked at the moment of settlement and land
            straight in the arena balance. When a match cannot be paid out for the time being (the staker list
            cannot be read) the money stays on the books, queued for a retry — none of it is lost."
          🔴 The sentence itself is still true (the behaviour recorded in §29 has not changed: an undeliverable
          payout is queued for a retry, not dropped); it is simply no longer said on this card. If it ever has to go
          back, it goes in the Help Center — do not put it back here. */}
    </section>
  );
}

// ---------------------------------------------------------------- the invite link (§71.144)

/// My invite link. The user, 2026-09-19:
/// "create an invite link in My Account, with an ID per user (the link must not show the wallet address); when
///  someone who came in through a link enters a match, pay the promoter a commission out of the fee."
///
/// 🔴 Since §71.166 the commission is its own slice of the fee — REFERRAL_SHARE of RAKE_SHARES, not a cut of what
/// the platform keeps — and what is not claimed by any promoter falls to the platform. The fee itself is capped by
/// what the losers staked, so `rebate_bps` is a **ceiling** that only a fully charged match reaches.
/// 🔴 The link carries nothing but a random code issued by the back end — **no wallet address** — and the address
/// cannot be worked back out from the code. The user asked for exactly this.
/// 🔴 The rate is not hard-coded in the front end: `rebate_bps` comes from the endpoint. Hard-coding it here would
/// turn this line into a lie the day the back end changes it.
function Invite({ on }: { on: boolean }) {
  const { data, error } = useOnce(loadReferral, on);
  const [copied, setCopied] = useState<"" | "ok" | "no">("");
  const link = data ? refLink(data.code) : "";
  const copy = async () => {
    const ok = await writeClip(link);
    setCopied(ok ? "ok" : "no");
    setTimeout(() => setCopied(""), 2000);
  };
  const pct = data ? (data.rebateBps / 100).toFixed(data.rebateBps % 100 === 0 ? 0 : 2) : null;
  return (
    <section className="acct-sec">
      <div className="acct-h">
        <h2>{tr("Invite friends")}</h2>
        {data && data.invited > 0 && <span className="cnt">{data.invited}</span>}
        <span className="bal">
          {data ? <>{tr("Commission")} <b>+{fmtUsdt2(data.earned)}</b> {tr("USDT · credited to balance")}</> : tr("Your friends play, you take a cut of the fee")}
        </span>
      </div>
      {!on ? (
        <div className="panel"><div className="empty"><b>{tr("Sign in to generate one")}</b>{tr("One link per account, and it does not contain your wallet address")}</div></div>
      ) : error ? (
        <div className="note">{tr("Could not load your invite link:")} {error}</div>
      ) : !data ? (
        <div className="note">{tr("Loading your invite link…")}</div>
      ) : (
        <div className="invite">
          <div className="inv-link">
            <code title={link}>{link}</code>
            <button type="button" className={`act${copied ? ` ${copied}` : ""}`} onClick={copy}
              title={copied === "no" ? tr("This page will not let us copy for you — press and hold, or select the link above and copy it by hand") : tr("Copy the full invite link")}>
              {copied === "ok" ? tr("Copied") : copied === "no" ? tr("Cannot copy") : tr("Copy link")}
            </button>
          </div>
          <div className="inv-stats">
            <div className="pool-stat"><span className="k">{tr("My invite code")}</span><span className="v"><span className="asis">{data.code}</span></span></div>
            <div className="pool-stat"><span className="k">{tr("Invited")}</span><span className={`v${data.invited === 0 ? " zero" : ""}`}>{data.invited}<i>{data.invited === 1 ? tr("person") : tr("people")}</i></span></div>
            {/* 🔴 §71.166: the fee is capped by what the losers staked, so this is a ceiling, not a flat rate. */}
            <div className="pool-stat"><span className="k">{tr("Commission rate, at most")}</span><span className="v">{pct}<i>%</i></span></div>
            <div className="pool-stat"><span className="k">{tr("Total commission")}</span><span className={`v${data.earned === 0n ? " zero" : ""}`}>{fmtUsdt2(data.earned)}<i>USDT</i></span></div>
          </div>
          {/* The user trimmed the small print on 2026-09-19, dropping the commission explanation and the four rules:
              "① an account can only be bound to one promoter, and cannot be changed afterwards; ② only entries
                placed after binding earn commission; ③ you cannot use your own link; ④ a match refunded for too few
                entrants charges no fee, so it pays no commission."
              🔴 The rules themselves have not changed and the back end still works this way (the referral_* tables
              in `core/uploop/ledger/book.py`). All four are now written nowhere on the site — if they go back, they
              go in the Help Center, not back onto this card. */}
          {data.bound && (
            <small className="mk-note">
              {tr("You joined through invite code")} <b><span className="asis">{data.bound.code}</span></b> {tr("(linked")} {fmtWhen(data.bound.at)}{tr(").")}
            </small>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- transactions

interface LedgerRow {
  day: number;
  order: number;
  /// Display label only -- "Entry" / "Prize" / "Refund" / "Fee share", already translated by the
  /// time it lands here. It used to be a union of those four literals, but nothing ever switches
  /// on it (it is rendered straight into .lg-kind below), and a translated string cannot be a
  /// literal type.
  kind: string;
  what: string;
  /// The signed display amount, e.g. "+12.5 USDT" / "−10 USDT" / "+0.42 bAAPL"
  amount: string;
  neg: boolean;
  status: string;
}

/// Transactions: flattens the data the blocks above have already read into one statement (entry fees paid,
/// prizes, refunds) without reading the chain again. Newest first. The USDT amount column and the totals are fixed to two decimals (`fmtUsdt2`, §71.24).
function Ledger({ me, pools, source, busy }: Props & { me: Address }) {
  const { loaded, rows } = useMyMatches(me, pools, source, busy, true);
  const [all, setAll] = useState(false);
  const now = serverNow();
  const list: LedgerRow[] = [];
  let paid = 0n, won = 0n, back = 0n;

  for (const r of rows) {
    const ph = phaseOf(r.pool, now);
    const label = tr("{0} Match #{1} · {2}", fmtDay(r.pool.day), r.pool.id, KINDS[r.pool.kind].code);
    if (!isFree(r.pool)) {
      for (const e of r.entries) {
        // §66 variable buy-in: record what this entry actually paid, not the pool's minimum
        paid += e.amount;
        list.push({ day: r.pool.day, order: r.pool.id * 10 + 1, kind: tr("Entry"), what: tr("{0} · strategy #{1}", label, e.entryId), amount: `−${fmtUsdt2(e.amount)} USDT`, neg: true,
          status: ph === "open" ? tr("Entry open") : ph === "closing" ? tr("Entry closed") : ph === "locked" ? tr("Awaiting settlement") : ph === "review" ? tr("Under review") : ph === "settled" ? tr("Settled") : tr("Too few entrants") });
      }
      if (ph === "short" || ph === "refunding") {
        const sum = r.entries.reduce((a, e) => a + e.amount, 0n);
        if (ph === "refunding") back += sum;
        list.push({ day: r.pool.day, order: r.pool.id * 10 + 2, kind: tr("Refund"), what: label, amount: `+${fmtUsdt2(sum)} USDT`, neg: false, status: ph === "refunding" ? tr("Back in your balance") : tr("Refund pending") });
      }
    }
    if (ph === "settled" && r.results?.kind === "ok") {
      // An all-down match (§66, decision 3): each claim is what that entry itself paid, so it is recorded as a
      // refund, not as a prize
      const refunded = r.results.results.refunded === true;
      for (const c of r.results.results.claims) {
        if (c.to.toLowerCase() !== me.toLowerCase()) continue;
        const amount = BigInt(c.amount);
        if (refunded) back += amount; else won += amount;
        list.push({ day: r.pool.day, order: r.pool.id * 10 + 3, kind: refunded ? tr("Refund") : tr("Prize"), what: refunded ? tr("{0} · every asset fell, refunded in full", label) : tr("{0} · rank {1}", label, c.rank), amount: `+${fmtUsdt2(amount)} USDT`, neg: false, status: tr("Credited to balance") });
      }
    }
  }
  list.sort((a, b) => b.day - a.day || b.order - a.order);

  return (
    <section className="acct-sec">
      <div className="acct-h">
        <h2>{tr("Transactions")}</h2>
        {list.length > 0 && <span className="cnt">{list.length}</span>}
        <span className="bal">
          {tr("Prizes")} <b>+{fmtUsdt2(won)}</b> {tr("· refunds")} <b>+{fmtUsdt2(back)}</b> {tr("· entries")} <b>−{fmtUsdt2(paid)}</b> USDT
        </span>
      </div>
      {!loaded ? (
        <div className="note">{tr("Loading your records…")}</div>
      ) : list.length === 0 ? (
        <div className="panel"><div className="empty"><b>{tr("No transactions yet")}</b>{tr("Entries, prizes and refunds all show up here")}</div></div>
      ) : (
        <div className="ledger">
          {(all ? list : list.slice(0, LEDGER_RECENT)).map((l, i) => (
            <div className="lg-row" key={i}>
              <span className="lg-kind">{l.kind}</span>
              <span className="lg-what">{l.what}</span>
              <span className={`lg-amt${l.neg ? " neg" : ""}`}>{l.amount}</span>
              <span className="lg-st">{l.status}</span>
            </div>
          ))}
          {list.length > LEDGER_RECENT && (
            <button className="act ghosted more" onClick={() => setAll((v) => !v)}>
              {all ? tr("Collapse") : tr("{0} older rows", list.length - LEDGER_RECENT)}
            </button>
          )}
        </div>
      )}
      <p className="acct-foot">
        {tr("Prize figures come from result files checked against the ledger records; matches that do not reconcile are left out.")}
      </p>
    </section>
  );
}
