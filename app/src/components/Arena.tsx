import { createPortal } from "react-dom";
import { PERIOD, tr } from "../lib/i18n";
import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { serverNow } from "../lib/api";
import { bareSym, uSym } from "../lib/ticker";
import { ADDRESS_CAP_BPS, KINDS, participantCount, MIN_ENTRIES,PHASE_LABEL, STRATEGY_WARN_BPS, addressHeadroom, cadenceCode, cadenceOf, countdown, dayOfUtc, fmtDay, fmtReturn, fmtUsdt, fmtUsdt2, fmtUsdtExact, fmtPoolWhen, fmtSpan, fmtWhenParts, isFree, parseUsdt, phaseOf, pinLabel, scheduleWindow, settlesAtOf, strategyShareBps, PRICE_BASIS, calendarDays, windowStart, urgent, visible } from "../lib/arena";
import type { Deposit, DepositInfo, DepositList, Entry, Featured, Funds, Kind, Phase, Pool, PoolLive, ResultsState, Stats, Withdrawal } from "../lib/arena";
import { MAX_DRAFTS, loadDrafts } from "../lib/drafts";
import type { Draft } from "../lib/drafts";
import { useMobileEntryScroll } from "../lib/useMobileEntryScroll";
import { POOLS, legCountIssue, tierRange, validate } from "../lib/strategy";
import { Avatar } from "./Avatar";
import { displayName } from "../lib/profile";
import { QrCode } from "./QrCode";
import { CompetitionGames } from "./CompetitionGames";
import type { CompetitionAvailability, CompetitionMode } from "./CompetitionGames";
import { depositExplorer } from "../lib/deposit-model";
import type { DepositTransfer } from "../lib/deposit-model";
import { ratesOf } from "../lib/points";
import type { PointsState, Rates } from "../lib/points";
import { dailyDemo } from "../lib/daily-demo";
import { ActivityPerformance } from "./ActivityPerformance";

/// The data source. Two implementations — the endpoint and the demo — and the component does not
/// care which one it is handed.
export interface ArenaSource {
  entries(poolId: number): Promise<Entry[]>;
  results(poolId: number): Promise<ResultsState>;
  /// My entries across every match, poolId → strategy list ("My Account", §54). Public data, no
  /// sign-in needed.
  myEntries(account: Address): Promise<Map<number, Entry[]>>;
  /// An activity match in progress: lock-time opens + sampled prices (§71.179, 3T / 5T only).
  live(poolId: number): Promise<PoolLive>;
  /// The deposit address (one per player, sign-in required) and the deposits credited to an
  /// address (§71.111).
  depositAddress(): Promise<DepositInfo>;
  deposits(account: Address): Promise<DepositList>;
  /// The signed-in wallet's withdrawals (§69.6). Sign-in required.
  withdrawals(): Promise<Withdrawal[]>;
  /// An address's record: matches entered / settled / won / perfect scores (§71.38, "My Account").
  /// Public data.
  stats(account: Address): Promise<Stats>;
}

interface Props {
  pools: Pool[];
  account: Address | null;
  /// My entries per pool (App's `myEntries`), for "My matches" (§71.179).
  myEntries?: Map<number, Entry[]>;
  canWrite: boolean;
  /// Whether the endpoint (VITE_API_BASE) is configured. Unconfigured, the page still renders its
  /// headings and the prize rules, but says plainly that nothing can be read.
  configured: boolean;
  /// Signed in to the arena with this wallet (GET /me works). Entering and withdrawing both need
  /// it; in demo mode it is always true.
  loggedIn: boolean;
  busy: boolean;
  source: ArenaSource;
  featured: Featured;
  /// The arena balance (§26, the ledger). Null when signed out or unconfigured. The wallet's own
  /// USDT is neither read nor shown (§69.15).
  funds: Funds | null;
  points: PointsState;
  followDemo: boolean;
  /// Operations has paused entries (§71.40, `GET /status`'s paused.entries): the entry button goes
  /// grey and reads "Entries paused"; entries already placed are unaffected.
  entriesPaused: boolean;
  onEnter: (pool: Pool, draft: Draft, amount: bigint) => Promise<boolean> | void;
  /// Open the deposit / withdraw dialog. The dialog itself (FundsModal) is rendered by App; the
  /// ways in are the avatar menu at the top right (§69.15) and "Deposit" in the entry dialog —
  /// the arena page's own balance card was removed in §71.22.
  onFunds: (mode: FundsMode, amount?: bigint) => void;
  onLogin?: () => void;
  onConnect?: () => void;
  onRaceChanged?: () => void;
  competitionAvailability?: CompetitionAvailability;
}

export type FundsMode = "deposit" | "withdraw";

/// The schedule window: the next few days (since §42 there are matches at weekends too).
/// "1 withdrawal" / "2 withdrawals" — English agrees with the count, Chinese uses one measure
/// word either way, so the whole phrase goes through the catalogue instead of a suffix here.
function withdrawals(n: number): string {
  return n === 1 ? tr("{0} withdrawal", String(n)) : tr("{0} withdrawals", String(n));
}

const WINDOW_DAYS = 3;
/// Past results are collapsed by default; expanded, at most this many matches are listed.
const PAST_MAX = 12;

/// Follow ("copy this strategy") is switched off for now (§71.168). The dialog and its plumbing are
/// kept, not deleted, because the feature is still on the roadmap — but nothing may show it yet, for
/// two reasons: there is no endpoint behind it (the button could only ever fail), and the split it
/// quotes, 85/15 of the payout, contradicts §71.166, where the strategist takes 15% of the *profit*
/// only and waives even that if the follower would otherwise not get their buy-in back. Shipping the
/// old numbers would be promising something we do not do. Flip this to true only together with the
/// backend and the corrected copy.
const FOLLOW_ENABLED = false;

type KindFilter = "all" | Kind | "free";

interface Detail {
  entries?: Entry[];
  results?: ResultsState;
}

/// The arena: the schedule (one row per match, like a poker tournament lobby) + the selected
/// match's detail + the entry dialog.
///
/// Before settlement there is a list of entrants but no ranking — the frontend has no price feed,
/// so any "live ranking" would be invented (§23).
export function Arena({ pools, account, myEntries, canWrite, configured, loggedIn, busy, source, featured, funds, points, followDemo, entriesPaused, onEnter, onFunds, onLogin, onConnect, onRaceChanged, competitionAvailability }: Props) {
  // Redraw the countdown once a second. The time comes from serverNow() (the endpoint's
  // X-Server-Time, falling back to chain time), not Date.now().
  const [, setTick] = useState(0);
  const [dailyDemoStep, setDailyDemoStep] = useState(8);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!followDemo) return;
    const t = setInterval(() => setDailyDemoStep((value) => value >= 48 ? 0 : value + 1), 2000);
    return () => clearInterval(t);
  }, [followDemo]);
  const now = serverNow();
  const [competitionMode, setCompetitionMode] = useState<CompetitionMode>(() => location.hash.startsWith('#arena/daily') ? 'daily' : location.hash.startsWith('#arena/activity') ? 'activity' : 'summit');

  const [kindF, setKindF] = useState<KindFilter>("all");
  const fits = (p: Pool) => kindF === "all" || (kindF === "free" ? isFree(p) : p.kind === kindF);

  // Three groups of rows: pinned (weekly + featured, not bound by the window), the schedule inside
  // the window, and past results.
  const { pinned, scheduled, past } = useMemo(() => {
    const days = scheduleWindow(now, WINDOW_DAYS);
    const inWindow = new Set(days);
    const byLock = (a: Pool, b: Pool) => a.locksAt - b.locksAt;
    // Matches taking entries come first, soonest to close at the top; then entries-closed and
    // awaiting lock; then locked / under review; settled and refunded last. A match that has been
    // void for a full minute is no longer listed (visible, §71.37).
    const rank = (p: Pool) => { const ph = phaseOf(p, now); return ph === "open" ? 0 : ph === "closing" ? 1 : ph === "locked" || ph === "review" ? 2 : 3; };
    const order = (a: Pool, b: Pool) => rank(a) - rank(b) || byLock(a, b);
    const listed = pools.filter((p) => fits(p) && visible(p, now));

    const pinned = listed.filter((p) => pinLabel(p, featured) && !p.settled && !p.refunding).sort(order);
    const pinnedIds = new Set(pinned.map((p) => p.id));
    const scheduled = listed.filter((p) => !pinnedIds.has(p.id) && inWindow.has(dayOfUtc(p.locksAt))).sort(order);
    const shownIds = new Set([...pinnedIds, ...scheduled.map((p) => p.id)]);
    const past = listed
      .filter((p) => !shownIds.has(p.id) && p.locksAt <= now)
      .sort((a, b) => b.locksAt - a.locksAt)
      .slice(0, PAST_MAX);
    return { pinned, scheduled, past };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pools, kindF, featured, Math.floor(now / 30)]);

  const [showPast, setShowPast] = useState(false);

  // "My matches" (§71.179): the matches I entered that have not started yet, and the ones running now.
  const [mineOnly, setMineOnly] = useState(false);
  const mine = useMemo(() => {
    const list = pools.filter((p) => myEntries?.has(p.id) && fits(p) && visible(p, now));
    const entered = list.filter((p) => { const ph = phaseOf(p, now); return ph === "open" || ph === "closing"; })
      .sort((a, b) => a.locksAt - b.locksAt);
    const running = list.filter((p) => { const ph = phaseOf(p, now); return ph === "locked" || ph === "review"; })
      .sort((a, b) => a.settlesAt - b.settlesAt);
    return { entered, running };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pools, myEntries, kindF, Math.floor(now / 30)]);

  // The single-match page (§68): the hash `#arena/<poolId>` opens it, "Back to schedule" returns
  // to `#arena`. It goes through the hash rather than component state so it can be linked, survives
  // a refresh, and the browser's back button returns to the schedule.
  const [openId, setOpenId] = useState<number | null>(() => poolFromHash());
  useEffect(() => {
    const f = () => setOpenId(poolFromHash());
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
  const openPool = openId === null ? null : pools.find((p) => p.id === openId) ?? null;
  const goMatch = (id: number) => { location.hash = `arena/${id}`; setOpenId(id); };
  const goLobby = () => { location.hash = "arena"; setOpenId(null); setCompetitionMode("summit"); };

  // The detail is loaded on demand; switching match starts over.
  const [detail, setDetail] = useState<Record<number, Detail>>({});
  useEffect(() => {
    if (!openPool) return;
    const id = openPool.id;
    const settled = openPool.settled;
    let alive = true;
    (async () => {
      const entries = await source.entries(id).catch(() => [] as Entry[]);
      const results = settled ? await source.results(id).catch((): ResultsState => ({ kind: "none" })) : { kind: "none" as const };
      if (alive) setDetail((d) => ({ ...d, [id]: { entries, results } }));
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPool?.id, openPool?.settled, source]);


  // The entry dialog. Opening it re-reads the local strategies — the user may have just changed
  // them in the strategy builder.
  const [enrolling, setEnrolling] = useState<Pool | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [entrySuccess, setEntrySuccess] = useState(false);
  const enroll = (p: Pool) => { const list = loadDrafts(account); setDrafts(list); setEnrolling(p); };
  useEffect(() => { if (!entrySuccess) return; const timer = setTimeout(() => setEntrySuccess(false), 4500); return () => clearTimeout(timer); }, [entrySuccess]);
  // The follow dialog (§68, still to be decided; it only opens in demo mode).
  const [following, setFollowing] = useState<{ pool: Pool; target: Entry } | null>(null);

  // The deposit / withdraw dialog. "Deposit" in the entry dialog arrives here carrying the shortfall.

  const tDays = calendarDays(windowStart(now), WINDOW_DAYS);
  const rowProps = { now, featured, selected: openId, paused: entriesPaused, onPick: goMatch, onEnroll: enroll };

  return (
    <div className={`arena${openId !== null ? " in-match" : ""}${competitionMode === 'activity' ? " activity-active" : ""}`}>
      {entrySuccess && createPortal(<div className="arena-success-toast" role="status" aria-live="polite"><strong>{tr("Entry successful")}</strong><span>{tr("Your entry has been recorded for this match.")}</span></div>, document.body)}
      {openId !== null ? (
        /* ------------ The single-match page (§68): the whole page is this one match, the schedule collapses ------------ */
        <>
          <nav className="match-bar" aria-label={tr("Match detail")}>
            <button className="back" onClick={goLobby}>{tr("← Back to schedule")}</button>
            <span className="crumb">{tr("Arena / Schedule /")} <b>#{openId}</b></span>
            {openPool && <span className={`chip ph-${phaseOf(openPool, now)}`}>{PHASE_LABEL[phaseOf(openPool, now)]}</span>}
          </nav>
          {openPool ? (
            <PoolCard
              pool={openPool} now={now} account={account} canWrite={canWrite} loggedIn={loggedIn} busy={busy} paused={entriesPaused}
              detail={detail[openPool.id]} pin={pinLabel(openPool, featured)} points={points} live={source.live}
              follow={FOLLOW_ENABLED && followDemo ? (e) => setFollowing({ pool: openPool, target: e }) : undefined}
              onEnroll={enroll}
            />
          ) : (
            <div className="pc">
              <div className="ent-empty">
                {!configured ? tr("Match information is unavailable right now. Please try again later.") : pools.length === 0 ? tr("Loading match #{0}…", openId) : tr("There is no match #{0}.", openId)}
                {" "}<button className="link" onClick={goLobby}>{tr("Back to schedule")}</button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <CompetitionGames key={account ?? "guest"} account={account} configured={configured && !followDemo}
            loggedIn={loggedIn} canWrite={canWrite} busy={busy} entriesPaused={entriesPaused}
            onLogin={onLogin} onConnect={onConnect} onFunds={() => onFunds("deposit")}
            onChanged={onRaceChanged} availability={competitionAvailability} onModeChange={setCompetitionMode}
            dailyPreview={followDemo ? dailyDemo(serverNow(), dailyDemoStep) : undefined} />

          {!configured && (
            <div className="note">
              <b>{tr("The arena service is unavailable.")}</b> {tr("Matches, entries and match records cannot be loaded right now. Please try again later.")}
            </div>
          )}

          {/* ------------ The schedule ------------ */}
          <section className="lobby">
            <div className="lobby-head">
              <h2>{tr("Activity matches")}</h2>
              <span className="lobby-sub">
                {tr("Next")} <b>{WINDOW_DAYS}</b> {tr("days ·")} <b>{fmtDay(tDays[0])}</b> {tr("to")} <b>{fmtDay(tDays[tDays.length - 1])}</b> {tr("(dates on the UTC calendar)")}
              </span>
              <div className="lobby-tools">
                <button className={`lobby-mine${mineOnly ? " on" : ""}`} aria-pressed={mineOnly} onClick={() => setMineOnly((v) => !v)}>
                  {tr("My activity matches")}
                  {mine.entered.length + mine.running.length > 0 && <b>{mine.entered.length + mine.running.length}</b>}
                </button>
                <div className="segs">
                  {(["all", "free", 0, 1, 2] as const).map((k) => (
                    <button key={String(k)} className={`${kindF === k ? "on " : ""}${typeof k === "number" ? "has-tier-mark" : ""}`} onClick={() => setKindF(k)}>
                      {typeof k === "number" && <b className={`tcode ${KINDS[k].key}`} aria-hidden="true">{KINDS[k].code}</b>}
                      <span>{k === "all" ? tr("All") : k === "free" ? tr("Free") : KINDS[k].label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="sch" role="table" aria-label={tr(mineOnly ? "My activity matches" : "Activity matches")}>
              <div className="sch-h" role="row">
                <span>{tr("Format · Time · Match")}</span><span>{tr("Match")}</span><span>{tr("Countdown")}</span><span>{tr("Entrants")}</span><span>{tr("Buy-in")}</span><span>{tr("Total prize")}</span><span />
              </div>

              {mineOnly ? (
                <>
                  <div className="sch-sec">{tr("My entered matches")} <small>{tr("Entered and waiting to lock; open one to see your strategies")}</small></div>
                  {mine.entered.length === 0
                    ? <div className="sch-empty"><b>{account ? tr("No entered matches waiting to start.") : tr("Connect a wallet to see your matches.")}</b></div>
                    : mine.entered.map((p) => <Row key={p.id} pool={p} {...rowProps} />)}
                  <div className="sch-sec">{tr("My matches in progress")} <small>{tr("Locked and running; 3T / 5T show your live strategy chart, NT waits for the result")}</small></div>
                  {mine.running.length === 0
                    ? <div className="sch-empty"><b>{account ? tr("No matches in progress.") : tr("Connect a wallet to see your matches.")}</b></div>
                    : mine.running.map((p) => <Row key={p.id} pool={p} {...rowProps} />)}
                </>
              ) : <>
              {pinned.length > 0 && (
                <>
                  <div className="sch-sec">{tr("Pinned")} <small>{tr("Weekly and featured matches, not bound by the date window")}</small></div>
                  {pinned.map((p) => <Row key={p.id} pool={p} pin {...rowProps} />)}
                </>
              )}

              <div className="sch-sec">{tr("Upcoming matches")} <small>{tr("Matches taking entries come first, soonest to close at the top; the countdown runs to entry close (1 minute before lock)")}</small></div>
              {scheduled.length === 0 ? (
                <div className="sch-empty">
                  <b>{configured ? tr("No matches on the selected dates.") : tr("The schedule is unavailable.")}</b>
                  {configured && (pools.length
                    ? tr(" You can create a strategy, or look at past results.")
                    : tr(" You can create and save a strategy in the meantime."))}
                </div>
              ) : scheduled.map((p) => <Row key={p.id} pool={p} {...rowProps} />)}

              {past.length > 0 && (
                <>
                  <button className="sch-sec tg" onClick={() => setShowPast((v) => !v)} aria-expanded={showPast}>
                    {showPast ? "▾" : "▸"} {tr("Past results")} <small>{tr("The last")} {past.length} {tr("matches · rankings and prizes")}</small>
                  </button>
                  {showPast && past.map((p) => <Row key={p.id} pool={p} {...rowProps} />)}
                </>
              )}
              </>}
            </div>

            <div className="sch-foot">
              <span>{tr("3T / 5T = 3 / 5 assets, NT = OPEN (")}{KINDS[2].minLegs}–{KINDS[2].maxLegs} {tr("assets).")}</span>
              <span>{tr("Times are in your local timezone; daily and weekly matches also show the UTC clock time.")}</span>
            </div>
          </section>

        </>
      )}

      {enrolling && (
        <EnterModal
          pool={enrolling} now={now} drafts={drafts} account={account} canWrite={canWrite} loggedIn={loggedIn} busy={busy} funds={funds} source={source}
          title={(() => { const l = pinLabel(enrolling, featured); return l && l !== tr("Weekly") ? l : tr("{0} match", fmtDay(dayOfUtc(enrolling.locksAt))); })()}
          onClose={() => setEnrolling(null)}
          onConfirm={async (d, amount) => {
            const ok = await onEnter(enrolling, d, amount);
            setEnrolling(null);
            if (ok === true) setEntrySuccess(true);
          }}
          onTopUp={(short) => { setEnrolling(null); onFunds("deposit", short); }}
        />
      )}

      {following && (
        <FollowModal
          pool={following.pool} target={following.target} now={now} account={account} funds={funds}
          title={(() => { const l = pinLabel(following.pool, featured); return l && l !== tr("Weekly") ? l : tr("{0} match", fmtDay(dayOfUtc(following.pool.locksAt))); })()}
          onClose={() => setFollowing(null)}
        />
      )}
    </div>
  );
}

// ================================================================ a schedule row

function Row({ pool, now, featured, pin, selected, paused, onPick, onEnroll }: {
  pool: Pool; now: number; featured: Featured; pin?: boolean; selected: number | null; paused: boolean;
  onPick: (id: number) => void; onEnroll: (p: Pool) => void;
}) {
  const ph = phaseOf(pool, now);
  const k = KINDS[pool.kind];
  const closeAt = settlesAtOf(pool);
  const when = fmtWhenParts(pool.locksAt);
  const label = pinLabel(pool, featured);
  const free = isFree(pool);

  return (
    <div
      className={`sch-r ${ph}${pool.id === selected ? " on" : ""}${pin ? " pin" : ""}`}
      role="row" tabIndex={0}
      onClick={() => onPick(pool.id)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(pool.id); } }}
    >
      <div className="sc-k">
        <span className={`tier k${pool.kind}`} title={k.label}>{k.code}</span>
        <span className="sc-kt">
          <b className="sc-when-full">{when.local}</b>
          <b className="sc-when-date">{when.date}</b>
          {/* Keep the cadence badge visible, but keep lock/UTC timing in the
              entry dialog. The schedule card is for scanning; the full timing
              is shown after the user presses Enter. */}
          <span className="sc-format"><span className="sc-when-time">{when.time}</span><b className={`cadence-code cadence-${cadenceOf(pool)}`}>{cadenceCode(cadenceOf(pool))}</b>{cadenceOf(pool) === "custom" ? ` ${fmtSpan(closeAt - pool.locksAt)}` : ""}</span>
        </span>
      </div>
      <div className="sc-n">
        {/* The local date/time above is the only date shown on a compact card.
            Repeating the ISO date here made mobile cards look duplicated. */}
        <b>{label && label !== tr("Weekly") ? label : tr("Match")}</b>
        <small>
          {label && <i className={`sc-pin${label === "Weekly" ? " wk" : ""}`}>{label === tr("Weekly") ? tr("Weekly · Pinned") : tr("Featured · Pinned")}</i>}
          #{pool.id}
        </small>
      </div>
      <div className="sc-cd">
        {ph === "open" ? (
          <b className={urgent(pool.entryClosesAt - now).trim() || undefined}>{countdown(pool.entryClosesAt - now)}</b>
        ) : ph === "closing" ? (
          <b className="mute">{countdown(pool.locksAt - now)}</b>
        ) : ph === "locked" ? (
          <b className="mute">{closeAt > now ? countdown(closeAt - now) : tr("Settlement time reached")}</b>
        ) : (
          <span className={`chip ph-${ph}`}>{PHASE_LABEL[ph]}</span>
        )}
      </div>
      <div className="sc-e">
        <small className="lbl">{tr("Entrants")}</small>
        <b>{participantCount(pool)}</b>
        <small>{participantCount(pool) < MIN_ENTRIES && ph === "open" ? tr("{0} entrants minimum", MIN_ENTRIES) : tierRange(POOLS[k.key])}</small>
      </div>
      <div className="sc-b">
        <small className="lbl">{tr("Buy-in")}</small>
        {free ? <b className="free">{tr("Free")}</b> : <><b>{fmtUsdt(pool.buyIn)}</b><small>USDT</small></>}
      </div>
      <div className="sc-p">
        <small className="lbl">{tr("Total prize")}</small>
        <b>{fmtUsdt(pool.gross)}</b>
        <small>USDT</small>
      </div>
      <div className="sc-a">
        {ph === "open" ? (
          <button className="enter" disabled={paused} title={paused ? tr("Entries are paused. Please try again later.") : undefined} onClick={(e) => { e.stopPropagation(); onEnroll(pool); }}>
            {paused ? tr("Entries paused") : free ? tr("Enter free") : tr("Enter")}
          </button>
        ) : (
          <button className="ghost" onClick={(e) => { e.stopPropagation(); onPick(pool.id); }}>
            {ph === "settled" ? tr("View ranking") : ph === "locked" || ph === "closing" || ph === "review" ? tr("View entrants") : tr("Refund")}
          </button>
        )}
        {/* The whole row opens the detail page (§68); this small line just says so */}
        <small className="sc-more">{ph === "open" ? tr("Entrants · details ›") : tr("Details ›")}</small>
      </div>
    </div>
  );
}

// ================================================================ the entry dialog: pick a strategy → pay

function EnterModal({ pool, now, drafts, account, canWrite, loggedIn, busy, funds, source, title, onClose, onConfirm, onTopUp }: {
  pool: Pool; now: number; drafts: Draft[]; account: Address | null; canWrite: boolean; loggedIn: boolean; busy: boolean;
  funds: Funds | null; source: ArenaSource; title: string; onClose: () => void; onConfirm: (d: Draft, amount: bigint) => Promise<void> | void;
  onTopUp: (shortfall: bigint) => void;
}) {
  const rules = POOLS[KINDS[pool.kind].key];
  const free = isFree(pool);
  const strategyTarget = useMobileEntryScroll<HTMLDivElement>(String(pool.id));

  // §71.168, the concentration caps. Both need the entrant list, and the dialog can be opened from
  // the schedule without ever having opened the match, so it reads the list itself. null = not read
  // back yet; the checks below stay quiet until it is, because the ledger enforces the hard cap in
  // the same transaction that takes the money and a guess here could only be wrong in one of two
  // ways -- blocking an entry that is allowed, or promising one that is not.
  const [entries, setEntries] = useState<Entry[] | null>(null);
  useEffect(() => {
    let alive = true;
    source.entries(pool.id).then((list) => { if (alive) setEntries(list); }).catch(() => { if (alive) setEntries([]); });
    return () => { alive = false; };
  }, [source, pool.id]);

  // §66, variable buy-ins: you fill in what you pay, the floor being the pool's buyIn. The field is
  // prefilled with the minimum — raising the stake is a deliberate act, and prefilling a larger
  // number would be committing more of the user's money on their behalf.
  //
  // 🔴 §71.171: the amount must be a whole multiple of this match's minimum ("no odd amounts"), so
  // a 25 USDT match takes 25 / 50 / 75 and never 37.5. The ledger refuses anything else, and it
  // refuses it before touching the balance, so catching it here is a courtesy, not the enforcement.
  const [amtText, setAmtText] = useState(() => (free ? "0" : fmtUsdtExact(pool.buyIn)));
  const parsed = free ? 0n : parseUsdt(amtText);
  const badAmt = parsed === null;
  const amount = parsed ?? 0n;
  const tooSmall = !free && !badAmt && amount < pool.buyIn;
  const notMultiple = !free && !badAmt && !tooSmall && pool.buyIn > 0n && amount % pool.buyIn !== 0n;
  const amtOk = free || (!badAmt && !tooSmall && !notMultiple);

  // Whether the balance covers it is only judged when writing is possible and the balance has been
  // read; in demo / read-only mode the button is disabled anyway.
  const fromBalance = free ? 0n : amount;
  const shortfall = !free && amtOk && funds && funds.arena < fromBalance ? fromBalance - funds.arena : 0n;
  const lacking = canWrite && shortfall > 0n;
  // The multiple only exists to make "raising the stake enlarges the exposure" visible. It is not odds.

  // 🔒 §39, enforced: the asset count is checked against this match's tier (3T = 3, 5T = 5,
  // NT = 6–50) and the wrong count can never be selected, with the reason written on the row;
  // a right count stored under a different tier (which should not happen) or any other failed check
  // (duplicate assets) cannot be selected either. The button is disabled — not merely warned about.
  const judged = drafts.map((d) => {
    const issue = legCountIssue(d.legs.length, rules);
    if (issue) return { d, ok: false, why: tr("{0} assets — {1} matches need {2}", d.legs.length, rules.code, tierRange(rules)) };
    if (d.pool !== rules.key) return { d, ok: false, why: tr("This is a {0} strategy; this match is {1}", POOLS[d.pool].code, rules.code) };
    const bad = validate(d.legs, rules).find((c) => !c.ok);
    return bad ? { d, ok: false, why: bad.label } : { d, ok: true, why: tr("Eligible · {0}", rules.code) };
  });
  const [pick, setPick] = useState<string>(() => judged.find((j) => j.ok)?.d.id ?? "");
  const chosen = judged.find((j) => j.ok && j.d.id === pick)?.d ?? null;
  const ph = phaseOf(pool, now);
  const open = ph === "open";

  // 🔒 §71.168, the address cap: one address may hold at most 70% of a match, blocked here and
  // blocked again by the ledger. `headroom` is -1 on a free match (no amounts, nothing to cap) and
  // null until the entrant list has been read.
  const mine = entries && account ? entries.filter((e) => e.player.toLowerCase() === account.toLowerCase()).reduce((s, e) => s + e.amount, 0n) : 0n;
  const headroom = entries === null ? null : addressHeadroom(pool.gross, mine, pool.buyIn, pool.entries);
  // 🔴 Two different refusals. `overCap` is "this amount is too large"; `capShut` is "no amount
  // works". Since §71.171 headroom is floored to a whole multiple of the minimum, so it is either
  // 0 or something that can really be typed in — `capShut` is the 0 case. The floor guarantees
  // every address a first entry, not an endless series of them, so this is reachable and has to be
  // said rather than left as a greyed-out button.
  const freeEntered = free && !!entries?.some(e => e.player.toLowerCase() === account?.toLowerCase());
  const capShut = headroom !== null && headroom >= 0n && headroom < pool.buyIn;
  const overCap = headroom !== null && headroom >= 0n && !badAmt && amount > headroom;

  // §71.168, the identical-strategy warning: a warning only, nothing is blocked. It counts the
  // amount about to be entered as part of the group, which is the number that will be true a
  // second after confirming.
  const sameBps = entries && chosen && !free && amtOk
    ? strategyShareBps(entries, chosen.legs.map((l) => ({ ticker: bareSym(l.symbol), side: l.side })), amount)
    : 0;
  const crowded = sameBps > STRATEGY_WARN_BPS;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="ov" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={tr("Enter match")} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="pc-kind">{tr("Enter ·")} {KINDS[pool.kind].code} {KINDS[pool.kind].label} · <b className={`cadence-code cadence-${cadenceOf(pool)}`}>{cadenceCode(cadenceOf(pool))}</b></span>
          <h3>{title}</h3>
          <button className="mini x" onClick={onClose} aria-label={tr("Close")}>×</button>
        </div>
        <div className="modal-meta">
          {tr("Locks")} <b>{fmtPoolWhen(pool, pool.locksAt)}</b> {tr("· settles")} <b>{fmtPoolWhen(pool, pool.settlesAt)}</b> · <b>{participantCount(pool)}</b> {tr("entrants · match #")}{pool.id}
          {open && <> {tr("· entry closes in")} <b className={urgent(pool.entryClosesAt - now).trim() || undefined}>{countdown(pool.entryClosesAt - now)}</b></>}
        </div>

        <p className="lad-note">{tr("90/10 ranked prizes · equal returns share one tier · a positive return can still lose principal. Multiple paid strategies are allowed; each is settled separately.")}</p>
        <div className="modal-sec entry-strategy-target" ref={strategyTarget} tabIndex={-1}>
          <a className="entry-build" href="#build" onClick={onClose}>＋ {tr("Build a strategy")}</a>
          <span className="k">
            {tr("1 · Pick a strategy")}
            <small>{rules.code} {tr("matches take")} {tierRange(rules)} {tr("strategies only ·")} {drafts.length} / {MAX_DRAFTS} {tr("saved||after the draft count")}</small>
          </span>
          {drafts.length === 0 ? (
            <div className="ent-empty">
              <b>{tr("No saved strategies yet.")}</b> {tr("Go to")} <a href="#build" onClick={onClose}>{tr("Strategy Builder")}</a> {tr("and create one (up to")} {MAX_DRAFTS} {tr("saved); once saved you can pick it here and enter.")}
            </div>
          ) : (
            <div className="opts" role="radiogroup">
              {judged.map(({ d, ok, why }) => (
                <button
                  key={d.id} className={`opt${pick === d.id && ok ? " on" : ""}`} role="radio"
                  aria-checked={pick === d.id && ok} disabled={!ok}
                  onClick={() => setPick(d.id)} title={ok ? undefined : why}
                >
                  <span className="rd" />
                  <span className="nm"><b className={`tcode ${d.pool}`}>{POOLS[d.pool].code}</b>{d.name}</span>
                  <span className={`st ${ok ? "ok" : "no"}`}>{why}</span>
                  {/* The tier is already on the badge above (POOLS[].code), so it is not repeated
                      here as a word: POOLS[].name now reads "3 assets", which would have made this
                      line say "3 assets · 3 assets" (§71.163). */}
                  <span className="meta">
                    {d.legs.length} {tr("assets ·")}{" "}
                    <b className="l">{d.legs.filter((l) => l.side === "long").length} {tr("long")}</b>{" "}
                    <b className="s">{d.legs.filter((l) => l.side === "short").length} {tr("short")}</b>
                    {" · "}{d.legs.map((l) => l.symbol).join(" ")}
                  </span>
                </button>
              ))}
              {!judged.some((j) => j.ok) && (
                <div className="ent-empty">
                  {tr("No saved strategy fits this")} {rules.code} {tr("match:")} {rules.code} {tr("matches take")} {tierRange(rules)} {tr("strategies only. Go to")} <a href="#build" onClick={onClose}>{tr("Strategy Builder")}</a> {tr("and create one that follows the")} {rules.code} {tr("rules.")}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-sec">
          <span className="k">
            {tr("2 · Set your buy-in")}
            <small>{free ? tr("This match is free") : tr("Whole multiples of {0} USDT", fmtUsdt(pool.buyIn))}</small>
          </span>
          {free ? (
            <div className="pay">
              <span>{tr("Buy-in")}</span>
              <b className="free">{tr("Free")}</b>
            </div>
          ) : (
            <>
              <div className="amt-in">
                <input
                  type="text" inputMode="decimal" value={amtText} aria-label={tr("Buy-in amount")}
                  className={badAmt || tooSmall || notMultiple ? "bad" : undefined}
                  onChange={(e) => setAmtText(e.target.value)}
                />
                <span className="unit">USDT</span>
                <div className="amt-mults">
                  {[1, 2, 5, 10].map((m) => (
                    <button
                      key={m} className={`mini${amtOk && amount === pool.buyIn * BigInt(m) ? " on" : ""}`}
                      onClick={() => setAmtText(fmtUsdtExact(pool.buyIn * BigInt(m)))}
                    >{m}×</button>
                  ))}
                </div>
              </div>
              {(badAmt || tooSmall || notMultiple) && (
                <div className="pay sub lack">
                  {badAmt ? tr("That amount is not valid: up to 18 decimal places, no thousands separators.")
                    : tooSmall ? tr("Below this match's minimum buy-in of {0} USDT.", fmtUsdt(pool.buyIn))
                    : tr("This match takes whole multiples of its {0} USDT minimum — {1} or {2}, not an amount in between.", fmtUsdt(pool.buyIn), fmtUsdt(amount - (amount % pool.buyIn)), fmtUsdt(amount - (amount % pool.buyIn) + pool.buyIn))}
                </div>
              )}
              {capShut ? (
                <div className="pay sub lack" role="alert">
                  {tr("You already hold nearly {0}% of this match, which is the most one address may hold, so you cannot add another entry here. Wait for others to enter, or enter a different match.", ADDRESS_CAP_BPS / 100)}
                </div>
              ) : overCap && (
                <div className="pay sub lack" role="alert">
                  {tr("One address may hold at most {0}% of a match. You can put in {1} USDT more here at the moment; the figure rises as others enter.", ADDRESS_CAP_BPS / 100, fmtUsdt(headroom ?? 0n))}
                </div>
              )}
              {crowded && !overCap && !capShut && (
                <div className="pay sub" role="status">
                  {tr("Heads up: this would put {0}% of the match on this one strategy. Everyone on it wins or loses together, and the prize is shared among them, so a crowded strategy pays each of them less.", Math.floor(sameBps / 100))}
                </div>
              )}
            </>
          )}
          {!free && (
            <div className={`pay bal${lacking ? " lack" : ""}`}>
              <span>{tr("Arena balance")}</span>
              {funds ? <b>{fmtUsdt(funds.arena)} <small>USDT</small></b> : <b className="mute">—</b>}
            </div>
          )}
          {lacking && (
            <div className="pay-lack" role="alert">
              <span><b>{tr("Not enough balance —")} {fmtUsdt(shortfall)} {tr("USDT short.")}</b> {tr("Deposit first, or lower the amount.")}</span>
              <button className="act" disabled={busy} onClick={() => onTopUp(shortfall)}>{tr("Deposit")}</button>
            </div>
          )}
        </div>

        <div className="modal-foot">
          <span className="pc-hint">
            {!open ? (ph === "closing" ? tr("Entries for this match have closed (they close 1 minute before lock).") : tr("This match is locked; entries are closed."))
              : !account ? tr("Connect a wallet to pay.")
              : !canWrite ? tr("Read-only / demo mode — payment is disabled.")
              : notMultiple ? tr("Round the amount to a whole multiple of {0} USDT.", fmtUsdt(pool.buyIn))
              : !amtOk ? tr("Set a valid buy-in first.")
              : freeEntered ? tr("One entry per account in free matches.")
              : capShut ? tr("You have reached this match's per-address limit.")
              : overCap ? tr("Lower the amount to {0} USDT or less.", fmtUsdt(headroom ?? 0n))
              : lacking ? tr("Not enough balance — deposit first, or lower the amount.")
              : free ? tr("Confirming registers the strategy and costs nothing; your display name and avatar are recorded with it.")
              : tr("Confirming registers the strategy and deducts the buy-in from your arena balance — no USDT approval, no gas; your display name and avatar are recorded with it.")}
          </span>
          <button className="enter" disabled={!open || !canWrite || !loggedIn || !chosen || busy || lacking || !amtOk || overCap || capShut || freeEntered} onClick={() => chosen && onConfirm(chosen, amount)}>
            {busy ? tr("Submitting…") : free ? tr("Enter free") : tr("Enter · {0} USDT from balance", amtOk ? fmtUsdt(amount) : "—")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ================================================================ the follow dialog (§68, still to be decided; demo mode only)

/// "Follow" = entering the same match with this entrant's already-public strategy, at your own
/// buy-in; if that entry wins a prize, 15% goes to the strategy's creator.
/// There is no endpoint for this yet: the dialog only demonstrates the flow and the confirm button
/// is always disabled; the production site does not show the button at all (§29 — never promise a
/// feature that does not exist).
function FollowModal({ pool, target, now, account, funds, title, onClose }: {
  pool: Pool; target: Entry; now: number; account: Address | null; funds: Funds | null;
  title: string; onClose: () => void;
}) {
  const free = isFree(pool);
  const ph = phaseOf(pool, now);
  const open = ph === "open";
  const [amtText, setAmtText] = useState(() => (free ? "0" : fmtUsdtExact(pool.buyIn)));
  const parsed = free ? 0n : parseUsdt(amtText);
  const badAmt = parsed === null;
  const amount = parsed ?? 0n;
  const tooSmall = !free && !badAmt && amount < pool.buyIn;
  // §71.171 applies here too: whatever the follow flow ends up being, it is still an entry into
  // this match, so the amount has to be a whole multiple of the match's minimum.
  const notMultiple = !free && !badAmt && !tooSmall && pool.buyIn > 0n && amount % pool.buyIn !== 0n;
  const amtOk = free || (!badAmt && !tooSmall && !notMultiple);
  const who = displayName(target, target.player);

  return (
    <div className="ov" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={tr("Enter with this strategy")} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{tr("Enter with {0}'s strategy", who)}</h3>
          <button className="mini x" onClick={onClose} aria-label={tr("Close")}>×</button>
        </div>
        <div className="modal-meta">
          {title} · #{pool.id} {tr("· locks")} <b>{fmtPoolWhen(pool, pool.locksAt)}</b>
          {!free && <> {tr("· minimum buy-in")} <b>{fmtUsdt(pool.buyIn)}</b> USDT</>}
        </div>

        <div className="modal-sec">
          <span className="k">{tr("1 · The strategy")}<small>{tr("Public from the moment it was entered ·")} {target.legs.length} {tr("assets, equally weighted")}</small></span>
          <Legs legs={target.legs} cls="fm-legs" />
          <div className="pay sub">{tr("Enter again with the same assets and directions, using your own buy-in.")}</div>
        </div>

        <div className="modal-sec">
          <span className="k">{tr("2 · Set your buy-in")}<small>{free ? tr("This match is free") : tr("Whole multiples of {0} USDT", fmtUsdt(pool.buyIn))}</small></span>
          {free ? (
            <div className="pay"><span>{tr("Buy-in")}</span><b className="free">{tr("Free")}</b></div>
          ) : (
            <>
              <div className="amt-in">
                <input
                  type="text" inputMode="decimal" value={amtText} aria-label={tr("Buy-in amount")}
                  className={badAmt || tooSmall || notMultiple ? "bad" : undefined}
                  onChange={(e) => setAmtText(e.target.value)}
                />
                <span className="unit">USDT</span>
                <div className="amt-mults">
                  {[1, 2, 5, 10].map((m) => (
                    <button
                      key={m} className={`mini${amtOk && amount === pool.buyIn * BigInt(m) ? " on" : ""}`}
                      onClick={() => setAmtText(fmtUsdtExact(pool.buyIn * BigInt(m)))}
                    >{m}×</button>
                  ))}
                </div>
              </div>
              {(badAmt || tooSmall || notMultiple) && (
                <div className="pay sub lack">
                  {badAmt ? tr("That amount is not valid: up to 18 decimal places, no thousands separators.")
                    : tooSmall ? tr("Below this match's minimum buy-in of {0} USDT.", fmtUsdt(pool.buyIn))
                    : tr("Round the amount to a whole multiple of {0} USDT.", fmtUsdt(pool.buyIn))}
                </div>
              )}
              <div className="pay bal">
                <span>{tr("Arena balance")}</span>
                {funds ? <b>{fmtUsdt(funds.arena)} <small>USDT</small></b> : <b className="mute">—</b>}
              </div>
            </>
          )}
        </div>

        <div className="modal-sec">
          <span className="k">{tr("3 · Revenue share")}<small>{tr("Only if this entry wins a prize")}</small></span>
          <div className="fm-split">
            <span><b>85%</b><small>{tr("to you")}</small></span>
            <span><b>15%</b><small>{tr("to the strategy's creator,")} {who}</small></span>
          </div>
        </div>

        <div className="modal-foot">
          <span className="pc-hint">
            {!open ? (ph === "closing" ? tr("Entries for this match have closed (they close 1 minute before lock).") : tr("This match is locked; entries are closed."))
              : !account ? tr("Connect a wallet to pay.")
              : tr("Demo only: entering with another participant's strategy is not available on the live site. No payment can be made here.")}
          </span>
          <button className="enter" disabled title={tr("Demo — payment is disabled")}>
            {free ? tr("Enter for free") : tr("Enter with {0} USDT", amtOk ? fmtUsdt(amount) : "—")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ================================================================ the deposit / withdraw dialog (§69.2 / §69.6)

/// Depositing = transferring USDT to **your own deposit address**, which the custody back end
/// credits by callback once it has enough confirmations (ownership is by address, §71.111); you can
/// send it from your wallet yourself, or have the wallet send it from here.
/// The deposit dialog holds exactly three things (§69.18): your deposit address + Copy (with the
/// single piece of small print, "BEP20 USDT"), the amount + send from wallet, and the last 5
/// deposits ("All records" switches to the full list). No explanatory small print.
/// Since §71.111 that address belongs to **this player alone** (requested from the custody back end
/// on demand, one per person); it is no longer one address shared by the whole site.
/// When no address can be had the endpoint returns address: null and this whole block goes grey and
/// reads "Deposits are unavailable" — an empty address is never shown.
/// Withdrawing = requesting a payout back to the signed-in wallet: the server issues a challenge
/// text → the wallet signs → the custody back end pays out (§71.111), which the interface calls
/// "Under review" (the endpoint's state is queued, §69.17). There is **no payout-address field**
/// (§69.6).
/// Above the limit set in the ops console the endpoint returns review (the interface calls it
/// "Manual review", §71.126): the money is frozen just the same, but an operator has to approve it
/// before it enters the payout queue. Why it was held is written as one sentence by the server in
/// the `review` field and copied here as it stands — the frontend does not invent its own wording.
/// Rendered by App (both the avatar menu at the top right and "Deposit" in the entry dialog open
/// it, §69.15 / §71.22).
/// onDeposit = have the wallet send USDT to your own deposit address (optional — the user can also
/// send it from their wallet directly);
/// onWithdraw = request a withdrawal: the server issues a challenge text → the wallet signs → it
/// queues. It only ever pays back to the signed-in wallet and takes no payout-address parameter
/// (§69.6).
export function FundsModal({ mode, funds, account, busy, canWrite, preset, source, withdrawPaused, depositTransfer, depositActive = false, onClose, onDeposit, onWithdraw, onCancel }: {
  mode: FundsMode; funds: Funds; account: Address; busy: boolean; canWrite: boolean; preset?: bigint; source: ArenaSource;
  /// Operations has paused withdrawals (§71.40): the request button goes grey and reads
  /// "Withdrawals paused"; requests already under review stay where they are and are not cancelled.
  withdrawPaused: boolean;
  depositTransfer?: DepositTransfer | null;
  depositActive?: boolean;
  onClose: () => void; onDeposit: (info: DepositInfo, amount: bigint) => void; onWithdraw: (amount: bigint, onSubmitted: () => void) => void; onCancel: (id: number) => void;
}) {
  const dep = mode === "deposit";
  const [info, setInfo] = useState<DepositInfo | null>(null);
  const [deps, setDeps] = useState<DepositList | null>(null);
  const [wds, setWds] = useState<Withdrawal[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [pollErr, setPollErr] = useState<string | null>(null);
  /// The retry counter (§71.110). A failed read used to leave one line of red text at the top with
  /// the three blocks stuck on "Loading…" forever, and the user had no way out — on a funds page
  /// that looks like a freeze. Bumping this number re-runs the effect below.
  const [reload, setReload] = useState(0);
  const [copied, setCopied] = useState(false);
  const [full, setFull] = useState(false); // the full deposit-history page (§69.18)
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!depositActive) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [depositActive]);
  const token = info?.tokenSymbol ?? (info?.chainId === 56 ? "USDT" : tr("Token"));
  const network = info ? ({ 56: "BNB Chain", 97: "BNB Chain Testnet", 11155111: "Sepolia Testnet", 1: "Ethereum" } as Record<number, string>)[info.chainId] ?? tr("Chain {0}", info.chainId) : "…";
  const waitingWallet = depositTransfer?.phase === "network" || depositTransfer?.phase === "wallet";
  const slowWallet = waitingWallet && now - depositTransfer.startedAt >= 20_000;
  const delayedCredit = depositActive && !waitingWallet && !!depositTransfer && now - depositTransfer.startedAt >= 180_000;
  const transferLink = depositTransfer?.hash ? depositExplorer(depositTransfer.chainId, depositTransfer.hash) : null;
  const progressText = depositTransfer ? {
    network: tr("Checking deposit details and wallet network…"),
    wallet: tr("Waiting for wallet approval. Open your wallet to confirm or reject the transfer."),
    submitted: tr("Transaction submitted. Waiting for confirmation…"),
    confirmed: tr("Transfer confirmed on-chain. Waiting for the deposit service to credit your arena balance."),
    credited: tr("Deposit credited to your arena balance."),
    failed: tr(depositTransfer.error ?? "The deposit request failed."),
  }[depositTransfer.phase] : null;
  // Read once on open; read again when busy goes from true back to false (a transfer / request /
  // cancellation has finished); read again on "Retry".
  useEffect(() => {
    if (busy) return;
    let alive = true;
    // Clear the previous error before reading: without this the red line and all three blocks stay
    // in their failed state during the retry, so pressing the button looks exactly like not
    // pressing it and there is no way to tell whether anything was retried (§71.110).
    setLoadErr(null);
    (async () => {
      try {
        if (dep) {
          const [i, d] = await Promise.all([source.depositAddress(), source.deposits(account)]);
          if (alive) { setInfo(i); setDeps(d); setLoadErr(null); }
        } else {
          const [i, w] = await Promise.all([source.depositAddress(), source.withdrawals()]);
          if (alive) { setInfo(i); setWds(w); setLoadErr(null); }
        }
      } catch (e) {
        if (alive) setLoadErr((e as Error).message.split("\n")[0]);
      }
    })();
    return () => { alive = false; };
  }, [dep, account, source, busy, reload]);

  // Keep external transfers and late custody callbacks visible, even while the dialog stays open.
  useEffect(() => {
    if (!dep) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await source.deposits(account);
        if (alive) { setDeps(data); setPollErr(null); }
      } catch { if (alive) setPollErr(tr("Deposit status could not refresh. Retrying automatically; do not resend a pending transfer.")); }
      if (alive) timer = setTimeout(poll, 6_000);
    };
    timer = setTimeout(poll, 6_000);
    return () => { alive = false; clearTimeout(timer); };
  }, [dep, account, source]);

  // Withdrawal states can change in the custody queue while this dialog remains open.
  useEffect(() => {
    if (dep) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await source.withdrawals();
        if (alive) { setWds(data); setPollErr(null); }
      } catch { if (alive) setPollErr(tr("Withdrawal status could not refresh. Retrying automatically.")); }
      if (alive) timer = setTimeout(poll, 6_000);
    };
    timer = setTimeout(poll, 6_000);
    return () => { alive = false; clearTimeout(timer); };
  }, [dep, source]);

  // Deposits have no cap: the frontend does not read the wallet's USDT, and sending more than it
  // holds is rejected by the wallet at the signing step (§69.15). Withdrawals cannot exceed the
  // arena balance.
  const cap = dep ? null : funds.withdrawable;
  const min = info ? (dep ? info.minDeposit : info.minWithdrawal) : null;
  const [text, setText] = useState(() => (preset && preset > 0n ? fmtUsdtExact(preset) : ""));
  const amount = parseUsdt(text);
  // Zero is the idle withdrawal amount after a successful request; it cannot be submitted.
  const bad = text === "" || (!dep && amount === 0n) ? null
    : amount === null ? tr("That amount is not valid — up to 18 decimal places")
    : amount === 0n ? tr("The amount cannot be 0")
    : min !== null && amount < min ? tr("Minimum {0} {1}", fmtUsdt(min), dep ? token : "USDT")
    : cap !== null && amount > cap ? tr("More than your withdrawable balance")
    : null;
  const ok = amount !== null && amount > 0n && bad === null;
  // In deposit mode there also has to be a real address: without one the button must be grey, or
  // pressing it only asks the wallet to send to undefined.
  const can = ok && canWrite && info !== null && (!dep || (info.address !== null && !depositActive));
  const requestWithdrawal = () => {
    if (!can || busy || withdrawPaused || amount === null) return;
    // Reset only when the server accepts the request, before the balance refresh.
    onWithdraw(amount, () => setText("0"));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { if (dep && full) setFull(false); else onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, dep, full]);

  const copy = async () => {
    if (!info || !info.address) return;
    try { await navigator.clipboard.writeText(info.address); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* if the browser withholds the clipboard, the user copies it by hand */ }
  };
  // Requests not yet paid out and not yet cancelled: queued (waiting in the payout queue) and
  // review (over the limit, waiting for an operator to release it, §71.126). To the user both mean
  // "the money is frozen and still on its way", so they count together as "N under review".
  const inFlight = (w: Withdrawal) => w.state === "queued" || w.state === "review";
  // Whether it can be cancelled is a different question: once handed to the payout provider it
  // cannot be (§71.151) — the platform may be signing it right now, and refunding here would send
  // the same money out twice. The server refuses too (409); this only keeps a button that cannot
  // work from being shown.
  const canCancel = (w: Withdrawal) => w.cancelable === true;
  const queued = (wds ?? []).filter(inFlight);
  const held = (wds ?? []).filter((w) => w.state === "review");

  // Deposit history: newest first (the endpoint already sorts by block descending, this sorts again
  // rather than relying on it). The dialog shows only the last 5; the full page shows all of them.
  const rows = deps ? [...deps.deposits].sort((a, b) => b.block - a.block || b.logIndex - a.logIndex) : [];
  const depRow = (d: Deposit) => (
    <div className="fd-row" key={`${d.txhash}:${d.logIndex}`} role="row">
      <span className="amt">+{fmtUsdt(d.amount)}<small> {token}</small></span>
      <span className="st">
        {d.credited ? <span className="chip live">{tr("Credited")}</span>
          : d.confirmations === null || !deps ? <span className="chip dark">{tr("Seen · awaiting confirmations")}</span>
          : <span className="chip rallying">{Math.min(d.confirmations, deps.required)} / {deps.required} {tr("confirmations")}</span>}
      </span>
      <span className="tx"><code>{short(d.txhash)}</code> {tr("· block #")}{d.block.toLocaleString()}</span>
    </div>
  );

  if (dep && full) {
    return (
      <div className="ov funds-overlay" onClick={onClose}>
        <div className="modal" role="dialog" aria-modal="true" aria-label={tr("Deposit history")} onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <span className="pc-kind">{tr("Arena balance")}</span>
            <h3>{tr("Deposit history")}</h3>
            <button className="mini back" onClick={() => setFull(false)}>{tr("Back")}</button>
            <button className="mini x" onClick={onClose} aria-label={tr("Close")}>×</button>
          </div>
          <div className="modal-meta">{tr("Signed-in wallet")} <code>{short(account)}</code> · <b>{rows.length}</b> {tr("in total")}</div>
          <div className="modal-sec fd-full">
            {!deps ? <div className="ent-empty">{loadErr ? tr("Could not load the deposit history") : tr("Loading deposit history…")}</div>
              : rows.length === 0 ? <div className="ent-empty">{tr("No deposits yet.")}</div>
              : <div className="fd-list" role="table" aria-label={tr("Deposit history")}>{rows.map(depRow)}</div>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ov funds-overlay" onClick={onClose}>
      <div className="modal funds-modal" role="dialog" aria-modal="true" aria-label={dep ? tr("Deposit") : tr("Withdraw")} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="pc-kind">{tr("Arena balance")}</span>
          <h3>{dep ? tr("Deposit") : tr("Withdraw")}</h3>
          <button className="mini x" onClick={onClose} aria-label={tr("Close")}>×</button>
        </div>
        <div className="funds-modal-scroll">
        <div className="modal-meta">
          {tr("Arena balance")} <b>{fmtUsdt(funds.arena)}</b> {tr("USDT · signed-in wallet")} <code>{short(account)}</code>
        </div>
        {/* The failed-read banner carries a "Retry" (§71.110). It sits here rather than inside each
            block because one read fetches the deposit address and the history together — they fail
            together, so one button that re-runs it is enough; three would be noise. */}
        {loadErr && (
          <div className="note alert fd-err">
            <span>{tr("Could not load:")} {loadErr}</span>
            <button className="mini" onClick={() => setReload((n) => n + 1)}>{tr("Retry")}</button>
          </div>
        )}

        {dep ? (
          <>
            <div className="modal-sec">
              <span className="k">{tr("Your deposit address")}<small>{network} · {token}</small></span>
              {info && <div className="fd-note">{tr("Only send {0} on {1} (chain ID {2}).", token, network, info.chainId)}</div>}
              {info && [97, 11155111, 31337].includes(info.chainId) && <div className="note alert">{tr("Test network: this deposit uses test tokens, not mainnet USDT.")}</div>}
              {info && info.address ? (
                <>
                  <div className="dep-addr">
                    <code>{info.address}</code>
                    <button className="mini" onClick={copy}>{copied ? tr("Copied") : tr("Copy")}</button>
                  </div>
                  {/* Scan to pay (§71.157): **desktop only** — CSS hides the whole block on phones.
                      On a phone the wallet and this page are on the same device, so it cannot scan
                      itself; there, the thing to press is the "Copy" above.
                      The code carries the plain address, not an EIP-681 payment link with an amount:
                      wallets parse parameterised links differently, and a misparse means the wrong
                      amount or the wrong token, whereas a bare address is the one thing every wallet
                      and every exchange withdrawal page understands (§71.31, same principle: never
                      guess someone else's format). */}
                  <div className="dep-qr">
                    <QrCode text={info.address} size={132} label={tr("Deposit address QR code")} />
                    <div className="dep-qr-t">
                      <b>{tr("Scan with a phone wallet")}</b>
                      <span>{tr("It scans to exactly the address above. Enter the amount in your wallet, and be sure to pick the right chain.")}</span>
                    </div>
                  </div>
                </>
              ) : info ? (
                /* Not configured in the back end, or momentarily unavailable (§71.111). Say plainly
                   that it is temporary, so nobody thinks their account is broken. */
                <div className="ent-empty">{info.unavailable ?? tr("Deposits are unavailable right now. Please try again later.")}</div>
              ) : loadErr ? (
                <div className="ent-empty">{tr("Could not load the deposit address · use Retry above to try again")}</div>
              ) : <div className="ent-empty">{tr("Loading the deposit address…")}</div>}
            </div>
            <div className="modal-sec">
              <span className="k">{tr("Send from your wallet")}</span>
              <div className={`amt-in${bad ? " bad" : ""}`}>
                <input
                  inputMode="decimal" placeholder="0" value={text} aria-label={tr("Amount")}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && can && !busy && info && info.address) onDeposit(info, amount!); }}
                />
                <span className="unit">{token}</span>
                {/* No "Max": the frontend does not read the wallet's USDT, so it cannot know how much is there (§69.15) */}
              </div>
              {bad && <div className="pay sub lack">{bad}</div>}
              {depositTransfer && <div className={`fd-transfer note${depositTransfer.phase === "failed" ? " alert" : ""}`} role="status" aria-live="polite">
                <b>{progressText}</b>
                {slowWallet && <span>{tr("No wallet response yet. Open the wallet extension or app and check pending requests. This page cannot detect whether its window opened. Do not submit again.")}</span>}
                {delayedCredit && <span>{tr("Crediting is taking longer than expected. Checking automatically; keep the transaction hash and do not send again.")}</span>}
                {depositTransfer.hash && <div>{tr("Transaction hash")} {transferLink
                  ? <a href={transferLink} target="_blank" rel="noopener noreferrer"><code>{depositTransfer.hash}</code> ↗</a>
                  : <code>{depositTransfer.hash}</code>}</div>}
              </div>}
            </div>
            <div className="modal-sec">
              <span className="k k-row">{tr("Deposit history")}
                {rows.length > 0 && <button className="more" onClick={() => setFull(true)}>{tr("All records ›")}</button>}
              </span>
              {pollErr && <div className="note alert" role="status">{pollErr}</div>}
              {!deps ? <div className="ent-empty">{loadErr ? tr("Could not load the deposit history") : tr("Loading deposit history…")}</div>
                : rows.length === 0 ? <div className="ent-empty">{tr("No deposits yet.")}</div>
                : <div className="fd-list" role="table" aria-label={tr("Deposit history")}>{rows.slice(0, 5).map(depRow)}</div>}
            </div>
          </>
        ) : (
          <>
            <div className="modal-sec">
              <span className="k">{tr("Amount")}<small>{tr("USDT · 18 decimal places")}</small></span>
              <div className={`amt-in withdrawal-amount${bad ? " bad" : ""}`}>
                <input
                  inputMode="decimal" autoFocus placeholder="0" value={text} aria-label={tr("Amount")}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") requestWithdrawal(); }}
                />
                <span className="unit">USDT</span>
                <button className="mini" onClick={() => setText(fmtUsdtExact(funds.withdrawable))} disabled={funds.withdrawable === 0n}>
                  {tr("Max")} {fmtUsdt(funds.withdrawable)}
                </button>
              </div>
              <div className={`pay sub${bad ? " lack" : ""}`}>
                {bad ?? <>{tr("Withdrawable {0} USDT", fmtUsdt(funds.withdrawable))}{funds.locked > 0n && <> · {tr("Locked {0} USDT", fmtUsdt(funds.locked))} {funds.unlockAt ? tr("until {0}", fmtWhenParts(funds.unlockAt).local) : ""}</>} · {tr("Withdrawals only go back to")} <b>{tr("your signed-in wallet")} {short(account)}</b>{min !== null && tr(" Minimum {0} USDT.", fmtUsdt(min))}</>}
              </div>
            </div>
            <div className="modal-sec">
              <span className="k">{tr("Withdrawal history")}<small>{tr("Anything not yet handed to the payout provider can be cancelled, and the money returns to your balance at once")}</small></span>
              {!wds ? <div className="ent-empty">{loadErr ? tr("Could not load the withdrawal history") : tr("Loading withdrawal history…")}</div>
                : wds.length === 0 ? <div className="ent-empty">{tr("No withdrawals yet.")}</div>
                : (
                  <div className="fd-list" role="table" aria-label={tr("Withdrawal history")}>
                    {wds.map((w) => (
                      <div className="fd-item" key={w.id}>
                        <div className="fd-row" role="row">
                          <span className="amt">−{fmtUsdt(w.amount)}<small> USDT</small></span>
                          <span className="st">
                            {/* `queued` really covers two stages (§71.151): not yet handed to the platform = under
                                review; already handed over and being paid = submitted to the provider. Without the
                                split, this row looks frozen after automatic payout hands the request over, and the
                                user assumes it is stuck. */}
                            {w.state === "queued" ? (w.platformId ? <span className="chip live">{tr("Submitted to provider")}</span> : w.approvedAt ? <span className="chip live">{tr("Approved")}</span> : <span className="chip rallying">{tr("Under review")}</span>)
                              : w.state === "review" ? <span className="chip rallying">{tr("Manual review")}</span>
                              : w.state === "sent" ? <span className="chip live">{tr("Withdrawal successful")}</span>
                              : <span className="chip dark">{tr("Cancelled")}</span>}
                          </span>
                          <span className="tx">
                            {fmtWhenParts(w.requestedAt).local}
                            {w.txhash && <> · <code>{short(w.txhash)}</code></>}
                          </span>
                          <span className="act-cell">
                            {canCancel(w) && (
                              <button className="mini" disabled={!canWrite || busy} onClick={() => onCancel(w.id)}>{tr("Cancel")}</button>
                            )}
                          </span>
                        </div>
                        {/* The reason it went to manual review is one sentence written by the server (§71.126),
                            shown exactly as it came; the frontend does not invent its own wording. It is written
                            by an operator, so it stays in the operator's own language until they write it in
                            English (§71.163, same rule as the notices). */}
                        {w.review && w.state === "review" && <div className="fd-note">{w.review} {tr("Once an operator approves it the payout continues automatically and there is no need to reapply; if you would rather not wait you can cancel, and the money returns to your balance at once.")}</div>}
                        {/* The handed-over stage gets a sentence of its own, or the "Cancel" button vanishes into
                            thin air and the user assumes something went wrong (§71.151) */}
                        {w.state === "queued" && w.platformId && <div className="fd-note">{tr("Handed to the payout provider and being paid out; it can no longer be cancelled. The transaction hash will appear here once it lands.")}</div>}
                        {w.state === "queued" && w.approvedAt && !w.platformId && <div className="fd-note">{tr("Approved — cannot be cancelled. It will continue to payout automatically.")}</div>}
                      </div>
                    ))}
                  </div>
                )}
            </div>
          </>
        )}

        </div>
        <div className="modal-foot funds-modal-actions">
          <span className="pc-hint">
            {!canWrite ? tr("Read-only / demo mode — funds cannot be moved.")
              : dep ? ""
              : withdrawPaused ? tr("Withdrawals are paused. Please try again later; requests already submitted stay where they are and do not need to be resubmitted.")
              : held.length > 0 ? tr("{0} under review, {1} of them in manual review; withdrawing does not affect matches you have already entered.", withdrawals(queued.length), held.length)
              : queued.length > 0 ? tr("{0} under review; withdrawing does not affect matches you have already entered.", withdrawals(queued.length)) : tr("Withdrawing does not affect matches you have already entered.")}
          </span>
          {dep ? (
            <button className="enter" disabled={!can || busy} onClick={() => can && info && info.address && onDeposit(info, amount!)}>
              {depositActive ? waitingWallet ? tr("Confirm in your wallet…") : tr("Waiting for deposit credit…") : busy ? tr("Confirm in your wallet…") : ok ? tr("Send {0} {1}", fmtUsdt(amount!), token) : tr("Send from wallet")}
            </button>
          ) : (
            <button className="enter" disabled={!can || busy || withdrawPaused} onClick={requestWithdrawal}>
              {withdrawPaused ? tr("Withdrawals paused") : busy ? tr("Signing…") : ok ? tr("Request {0} USDT", fmtUsdt(amount!)) : tr("Request withdrawal")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ================================================================ the match detail

function PoolCard({ pool, now, account, canWrite, loggedIn, busy, paused, detail, pin, points, live, follow, onEnroll }: {
  pool: Pool; now: number; account: Address | null; canWrite: boolean; loggedIn: boolean; busy: boolean; paused: boolean;
  detail?: Detail; pin: string | null; points: PointsState;
  /// Reads an in-progress match's prices for "My strategy performance" (§71.179).
  live: (poolId: number) => Promise<PoolLive>;
  /// Given a value, every row of the entrant list gets a "Follow" (§68, still to be decided; only
  /// demo mode passes it)
  follow?: (e: Entry) => void;
  onEnroll: (p: Pool) => void;
}) {
  const ph = phaseOf(pool, now);
  const k = KINDS[pool.kind];
  const lockDay = dayOfUtc(pool.locksAt);
  const closeAt = settlesAtOf(pool);
  const me = account?.toLowerCase();
  const free = isFree(pool);
  const myRows = me ? (detail?.entries ?? []).filter((e) => e.player.toLowerCase() === me) : [];

  return (
    <div className={`pc ${ph}`}>
      <div className="pc-head">
        <div className="pc-title">
          <span className={`plate k${pool.kind}`} title={k.label}>{k.code}</span>
          <span className="pc-kind">{k.label} · <b className={`cadence-code cadence-${cadenceOf(pool)}`}>{cadenceCode(cadenceOf(pool))}</b></span>
          <h2>{pin && pin !== tr("Weekly") ? pin : tr("{0} match", fmtDay(lockDay))}</h2>
          <span className={`chip ph-${ph}`}>{PHASE_LABEL[ph]}</span>
          {pin && <span className="chip rallying">{pin === tr("Weekly") ? tr("Weekly · Pinned") : tr("Featured · Pinned")}</span>}
        </div>
        <span className="pc-sub">
          {tr("Entries close")} <b>{fmtPoolWhen(pool, pool.entryClosesAt)}</b> {tr("· locks")} <b>{fmtPoolWhen(pool, pool.locksAt)}</b> {tr("· settles")} <b>{fmtPoolWhen(pool, closeAt)}</b> {tr("· match #")}{pool.id}
        </span>
      </div>

      {/* The five-cell scoreboard (§68): tier · entrants · total prize pool · minimum buy-in · countdown.
          Every number comes from the ledger endpoint's reading of the pool. */}
      <div className="pc-stats five">
        <div className="ps">
          <span className="k">{tr("Format")}</span>
          <span className="v">{k.label}</span>
          <span className="d">{k.code} · {tierRange(POOLS[k.key])} · <b className={`cadence-code cadence-${cadenceOf(pool)}`}>{cadenceCode(cadenceOf(pool))}</b></span>
        </div>
        <div className="ps">
          <span className="k">{tr("Entrants")}</span>
          <span className="v">{participantCount(pool)}</span>
          <span className="d">{participantCount(pool) < MIN_ENTRIES ? tr("Fewer than {0} entrants at entry close voids the match and refunds every buy-in", MIN_ENTRIES) : tr("{0}-entrant minimum met", MIN_ENTRIES)}</span>
        </div>
        <div className="ps">
          <span className="k">{tr("Total prize")}</span>
          <span className="v live">{fmtUsdt(pool.gross)}<i> USDT</i></span>
          <span className="d">{tr("Total buy-ins paid by entrants")}</span>
        </div>
        <div className="ps">
          <span className="k">{tr("Minimum buy-in")}</span>
          {free ? <span className="v short">{tr("Free")}</span> : <span className="v">{fmtUsdt(pool.buyIn)}<i> USDT</i></span>}
          {/* §71.171 replaced "no cap" here: there is a cap now (70% of the match, per address) and
              the amount has to be a whole multiple of this figure. Kept to one short clause -- the
              entry dialog is where the exact headroom is spelled out. */}
          {!free && <span className="d">{tr("You can pay more, in whole multiples")}</span>}
        </div>
        <div className="ps">
          {ph === "open" ? (
            <><span className="k">{tr("Entry closes in")}</span><span className={`v rally${urgent(pool.entryClosesAt - now)}`}>{countdown(pool.entryClosesAt - now)}</span><span className="d">{tr("Entries close 1 minute before lock; after lock nothing can be changed or refunded")}</span></>
          ) : ph === "closing" ? (
            <><span className="k">{tr("Locks in")}</span><span className="v">{countdown(pool.locksAt - now)}</span><span className="d">{tr("Entries are closed and the list is final")}</span></>
          ) : ph === "locked" ? (
            <><span className="k">{tr("Settles in")}</span><span className="v">{closeAt > now ? countdown(closeAt - now) : tr("Settlement time reached")}</span><span className="d">{tr("The ranking appears here after settlement")}</span></>
          ) : ph === "review" ? (
            <><span className="k">{tr("Settlement")}</span><span className="v rally">{tr("Under review")}</span><span className="d">{tr("Buy-ins, returns and prize payouts are being checked by hand; the ranking appears once that is done")}</span></>
          ) : ph === "settled" ? (
            <><span className="k">{tr("Settlement")}</span><span className="v short">{tr("Complete")}</span><span className="d">{tr("Prizes have been credited to the winners' arena balances")}</span></>
          ) : (
            <><span className="k">{tr("Refund")}</span><span className="v rally">{tr("In full")}</span><span className="d">{tr("Buy-ins are returned in full to arena balances")}</span></>
          )}
        </div>
      </div>

      {(ph === "locked" || ph === "review") && myRows.length > 0 && <ActivityPerformance pool={pool} mine={myRows} now={now} load={live} />}

      <Actions pool={pool} ph={ph} account={account} canWrite={canWrite} loggedIn={loggedIn} busy={busy} paused={paused} onEnroll={onEnroll} />

      {/* A voided pool has no prize money, so there are no prize rules to speak of */}
      {ph !== "short" && ph !== "refunding" && <Prizes />}

      {ph === "settled" ? (
        <Leaderboard pool={pool} detail={detail} me={me} />
      ) : (
        <Entrants pool={pool} ph={ph} entries={detail?.entries} me={me} points={points} onFollow={ph === "open" ? follow : undefined} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the action area

function Actions({ pool, ph, account, canWrite, loggedIn, busy, paused, onEnroll }: {
  pool: Pool; ph: Phase; account: Address | null; canWrite: boolean; loggedIn: boolean; busy: boolean; paused: boolean;
  onEnroll: (p: Pool) => void;
}) {
  const free = isFree(pool);

  // Entry open: just the button and one line of status (§71.19 — the user did not want the two
  // paragraphs of "Enter · pick one of your saved strategies").
  if (ph === "open") {
    return (
      <div className="pc-act solo">
        <div className="pc-act-r">
          <button className="enter" disabled={busy || paused} onClick={() => onEnroll(pool)}>
            {paused ? tr("Entries paused") : busy ? tr("Submitting…") : free ? tr("Enter free") : tr("Enter · {0} USDT minimum", fmtUsdt(pool.buyIn))}
          </button>
          <span className="pc-hint">
            {paused ? tr("Entries are paused. Please try again later; matches you have already entered are unaffected.")
              : !account ? tr("Connect a wallet to enter; you can look through the flow first.")
              : !canWrite ? tr("Read-only / demo mode — entering is disabled.")
              : !loggedIn ? tr("Sign in to the arena from the avatar menu at the top right, then enter.")
              : free ? tr("Confirming registers your entry and costs nothing.") : tr("Confirming registers your entry and deducts the buy-in from your arena balance.")}
          </span>
        </div>
      </div>
    );
  }
  if (ph === "closing") {
    return (
      <div className="pc-act muted">
        <span className="k">{tr("Entries closed, awaiting lock")}</span>
        <span className="pc-hint">
          {tr("Entries stop 1 minute before lock. The opening price is the open of the Binance candle at the lock time; after lock you can see the list of entrants but no ranking.")}
        </span>
      </div>
    );
  }
  if (ph === "review") {
    return (
      <div className="pc-act muted">
        <span className="k">{tr("Under review")}</span>
        <span className="pc-hint">
          {tr("Automatic settlement did not finish within the deadline, so this match goes to a manual check of the buy-ins, the return calculations and the prize payouts. It settles — and the ranking appears — only once that check is done, and no prize is paid in the meantime.")}
        </span>
      </div>
    );
  }
  if (ph === "short" || ph === "refunding") {
    return (
      <div className="pc-act">
        <div className="pc-act-l">
          <span className="k">{ph === "short" ? tr("Too few entrants — this match is void") : tr("This match is void and the buy-ins have been refunded")}</span>
          <span className="pc-hint">
            {tr("There were fewer than")} {MIN_ENTRIES} {tr("entrants at entry close.")} {ph === "short"
              ? tr("Every buy-in goes back in full to its own arena balance; once that is done this reads \\\"Refunded\\\". There is no button to press.")
              : tr("Every buy-in has been credited back in full to its own arena balance. There is no button to press.")}
          </span>
        </div>
      </div>
    );
  }
  if (ph === "locked") {
    return (
      <div className="pc-act muted">
        <span className="k">{tr("Locked, awaiting the {0} at the settlement time", PRICE_BASIS)}</span>
        <span className="pc-hint">
          {tr("The ranking appears here after settlement, and prizes are credited to the winners' arena balances.")}
        </span>
      </div>
    );
  }
  return null;
}

// ---------------------------------------------------------------- the prize rules

/// The prize rules (§66; cut down to the formulas alone on 2026-09-13, §71.16). There is
/// deliberately **no table of numbers** here: prizes depend on the whole field's weights, which are
/// only known at settlement, so before then any "what does first place get" would be invented
/// (§23 / §25). The user asked for the heading, the two formulas and one line about refunds only —
/// the break-even line, odds, split entries, the arbitrage Q&A, the fee split, this match's minimum
/// buy-in and the current prize pool are all gone from here (the prize pool is in the match header).
function Prizes() {
  return (
    <div className="lad">
      <div className="lad-head"><h3>{tr("How prizes are split")}</h3><span className="lad-basis">90% + 10%</span></div>
      <div className="rule-f"><code>{tr("Base weight = shares × return tier^(-0.25)")}</code></div>
      <p className="lad-note">{tr("90% is split by shares and return tier. 10% goes to the top K tiers (K = accounts ÷ 10 rounded up, at least 3), weighted 1 / tier. Equal returns share a tier.")}</p>
      <p className="lad-note">{tr("A positive return does not guarantee your buy-in back. Zero return is refunded; a negative return gets nothing. No positive returns, all returns equal, or under 10 accounts: full refund, no fee.")}</p>
    </div>
  );
}

/// The return multiple = prize ÷ buy-in, to two decimal places, rounded half up.
function mult(each: bigint, stake: bigint): string {
  if (stake === 0n) return "—";
  const c = (each * 100n + stake / 2n) / stake;
  return `${c / 100n}.${String(c % 100n).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- the entrant list (before settlement)

function Entrants({ pool, ph, entries, me, points, onFollow }: {
  pool: Pool; ph: Phase; entries?: Entry[]; me?: string;
  points: PointsState; onFollow?: (e: Entry) => void;
}) {
  const free = isFree(pool);
  const withFollow = !!onFollow;
  return (
    <div className="ent">
      <div className="lad-head">
        <h3>{tr("Entrants")}</h3>
        <span className="lad-basis">
          {ph === "open" ? tr("Entry open — the list keeps growing")
            : ph === "closing" ? tr("Entries closed · the list is final")
            : ph === "locked" ? tr("Locked · this becomes the ranking after settlement")
            : ph === "review" ? tr("Under review · this becomes the ranking once the check is done")
            : tr("Match void · buy-ins refunded, no ranking")}
          {" · "}{tr("||before the entry count")}<b>{pool.entries}</b> {tr("strategies||after the entry count")}
          {!free && entries && entries.length > 0 &&
            <> · {tr("||before the amount collected")}<b>{fmtUsdt(entries.reduce((a, e) => a + e.amount, 0n))}</b> {tr("USDT collected")}</>}
        </span>
      </div>
      {!entries ? (
        <div className="ent-empty">{tr("Loading entrants…")}</div>
      ) : entries.length === 0 ? null : (
        <div className={`ent-list${withFollow ? " f" : ""}`} role="table" aria-label={tr("Entrants")}>
          {/* §68, one row: number · avatar · name · win rate · perfect rate · buy-in · entered at · strategy (public) · (follow) */}
          <div className="ent-h" role="row">
            <span>#</span><span /><span>{tr("Entrant")}</span><span>{tr("Win rate")}</span><span>{tr("Perfect rate")}</span><span>{tr("Buy-in")}</span><span>{tr("Entered")}</span><span>{tr("Strategy · public")}</span>{withFollow && <span />}
          </div>
          {entries.map((e, i) => {
            const mine = !!me && e.player.toLowerCase() === me;
            const r = ratesOf(points, e.player);
            return (
              <div key={e.entryId} className={`ent-row${mine ? " me" : ""}`} role="row">
                <span className="no">{i + 1}</span>
                <span className="av"><Avatar address={e.player} variant={e.avatar} size={26} /></span>
                <span className="nm" title={e.player}>{displayName(e, e.player)}{mine && <i>{tr("You")}</i>}</span>
                <Rate r={r} kind="win" />
                <Rate r={r} kind="perfect" />
                {/* §66: every entry pays a different amount, and it comes from this entry in the ledger
                    rather than being inferred from "entrants × buy-in". Only the amount is written; the
                    "5.00×" multiple against the minimum is gone (§71.14, the user on 2026-09-12) */}
                <span className="stk">
                  {free ? tr("Free") : <>{fmtUsdt(e.amount)}<i> USDT</i></>}
                </span>
                {/* The moment the ledger registered it; unreadable means "—" */}
                <span className="at">{e.at !== undefined ? fmtWhenParts(e.at).local : "—"}</span>
                <Legs legs={e.legs} />
                {withFollow && (
                  <span className="fl">
                    {mine ? <small>{tr("Your strategy")}</small> : <button className="ghost" onClick={() => onFollow?.(e)}>{tr("Enter with this strategy")}</button>}
                  </span>
                )}
              </div>
            );
          })}
          {entries.length < pool.entries && <div className="ent-empty">{tr("Showing the first")} {entries.length} {tr("only")}</div>}
        </div>
      )}
    </div>
  );
}

/// One win-rate / perfect-rate cell. No record writes "—", and an older table with no perfect-score
/// field writes "—" too; no number is invented (§25). 50% and above uses the primary gold.
function Rate({ r, kind }: { r: Rates | null; kind: "win" | "perfect" }) {
  const num = r ? (kind === "win" ? r.win : r.perfect) : null;
  if (!r || num === null) return <span className={`rt ${kind}`}><small className="none">—</small></span>;
  const pct = Math.round((num * 100) / r.n);
  return (
    <span className={`rt ${kind}${pct >= 50 ? " hi" : ""}`} title={tr("{0} / {1} paid matches (counted off-chain)", num, r.n)}>
      {pct}%<small>{num}/{r.n}</small>
    </span>
  );
}

/// An Open-tier strategy can hold 6–50 assets (`POOLS.open`, in step with the contract's
/// `_legBounds`). Laying all of them out can stretch a row to half a screen, so a wide cell shows
/// 10 by default and the rest open on request (the user on 2026-09-16).
const LEGS_SHOWN = 10;

/// Share `cap` slots between the long and short sides: each takes half first, and whichever side
/// does not use its half gives the remainder back to the other.
/// 25 long 25 short → 5 / 5; 45 long 2 short → 8 / 2; 2 long 45 short → 2 / 8.
/// It does not simply truncate the combined list, because that would cut the smaller side away
/// entirely — and direction is exactly what this is here to show.
function legShare(cap: number, longs: number, shorts: number): [number, number] {
  if (longs + shorts <= cap) return [longs, shorts];
  const half = Math.min(longs, Math.floor(cap / 2));
  const s = Math.min(shorts, cap - half);
  return [Math.min(longs, cap - s), s];
}

/// One strategy's assets and directions: ↑ = long (green), ↓ = short (red) (the user on 2026-09-16).
/// The entrant list, the follow dialog and the settled leaderboard all share this one rendering —
/// they each used to draw their own, and the arrows and wording did not agree.
/// `compact` is for narrow rows (the small line under a name on the leaderboard): arrows and codes
/// only, with the words "long / short" dropped.
///
/// How many are laid out follows one of two paths; do not mix them:
///  · without `sideMax` (wide cells such as the entrant list and the follow dialog) = `LEGS_SHOWN`
///    in total, with the rest behind an "N more" toggle. The button says how many are left rather
///    than "…" — an ellipsis cannot tell you whether 3 or 40 are folded away, which is exactly what
///    §71.13's "no hiding assets behind an ellipsis" was about.
///  · with `sideMax` (that small line on the leaderboard) = a hard truncation per side plus "…",
///    with no toggle: that line sits in a fixed-height ranking row and has nowhere to expand into.
/// Either way the full list is always in the `title`, so no asset is ever really lost.
///
/// Direction must not rely on colour alone: the arrow is a shape, and the direction word is in the
/// title for screen readers and for colour-vision deficiency.
/// The class names are `.lg-up` / `.lg-dn`, not `.up`: `.up` is a global grid class
/// (styles.css:681), and styles.css:1721 already fell into that same hole once.
function Legs({ legs, compact, sideMax, cls }: { legs: Entry["legs"]; compact?: boolean; sideMax?: number; cls?: string }) {
  const [open, setOpen] = useState(false);
  const longs = legs.filter((l) => l.side === "long").map((l) => uSym(l.ticker));
  const shorts = legs.filter((l) => l.side === "short").map((l) => uSym(l.ticker));
  const hard = sideMax !== undefined;
  const [nl, ns] = hard
    ? [Math.min(longs.length, sideMax), Math.min(shorts.length, sideMax)]
    : open ? [longs.length, shorts.length] : legShare(LEGS_SHOWN, longs.length, shorts.length);
  const hidden = legs.length - nl - ns;
  const join = (xs: string[], n: number) => xs.slice(0, n).join(" ") + (hard && n < xs.length ? " …" : "");
  return (
    <span
      className={`legs${compact ? " cmp" : ""}${open ? " open" : ""}${cls ? ` ${cls}` : ""}`}
      title={tr("{0} assets, equally weighted · long {1} / short {2}", legs.length, longs.join(" ") || "—", shorts.join(" ") || "—")}
    >
      {nl > 0 && <span className="lg-up"><i aria-hidden="true">↑</i>{compact ? " " : tr(" Long ")}{join(longs, nl)}</span>}
      {ns > 0 && <span className="lg-dn"><i aria-hidden="true">↓</i>{compact ? " " : tr(" Short ")}{join(shorts, ns)}</span>}
      {!hard && (hidden > 0 || open) && (
        // A list row may one day be clickable as a whole (to follow), so bubbling is cut here
        // already: expanding the assets should not also open something else
        <button
          type="button" className="lg-more" aria-expanded={open}
          onClick={(ev) => { ev.stopPropagation(); setOpen((v) => !v); }}
        >
          {open ? tr("Show less") : tr("{0} more", hidden)}
        </button>
      )}
    </span>
  );
}

// ---------------------------------------------------------------- the ranking (after settlement)

/// One leaderboard row. Where `standings` exists it is used (the whole field, negative returns
/// included); otherwise it falls back to `claims` (the prize winners only).
type LbRow = { entryId: number; player: string; rank: number; ret: bigint; stake: bigint; prize: bigint };

function Leaderboard({ pool, detail, me }: { pool: Pool; detail?: Detail; me?: string }) {
  const res = detail?.results;
  const byEntry = new Map((detail?.entries ?? []).map((e) => [e.entryId, e]));
  const ok = res?.kind === "ok" ? res.results : null;
  // §66: each entry's buy-in and weight are in the settlement file's standings; older files have
  // neither field.
  const stand = new Map((ok?.standings ?? []).map((r) => [r.entry_id, r]));
  const stakeOf = (entryId: number): bigint => {
    const raw = stand.get(entryId)?.amount;
    if (raw !== undefined) return BigInt(raw);
    return byEntry.get(entryId)?.amount ?? 0n;   // fall back to the amount on the ledger's entry; neither means 0
  };
  // The "return ranking" lists the whole field: a losing entry has to be on it too, or the bottom
  // half of the ranking is empty and someone who lost cannot even find themselves (the user on
  // 2026-09-16). standings is the full field written by core/uploop/runner.py,
  // already sorted by (rank, entry_id).
  const full = ok?.standings !== undefined;
  const rows: LbRow[] = ok
    ? (full
      ? ok.standings!.map((s) => ({
        entryId: s.entry_id, player: s.player, rank: s.rank,
        ret: BigInt(s.strategy_return), stake: stakeOf(s.entry_id), prize: BigInt(s.prize_amount),
      }))
      // An older results file has claims only: the entries whose prize was positive. If the list
      // cannot be complete, the footnote says so rather than pretending it is the whole field (§25).
      : ok.claims.map((c) => ({
        entryId: c.entry_id, player: c.to, rank: c.rank,
        ret: BigInt(c.strategy_return), stake: stakeOf(c.entry_id), prize: BigInt(c.amount),
      })))
    : [];
  rows.sort((a, b) => a.rank - b.rank || a.entryId - b.entryId);
  // After settlement "my" row is pulled to the top, win or lose (the user on 2026-09-16). The rank
  // cell still shows the real rank — what was pulled up is the position, not the ranking, and
  // writing 1 there would be inventing a number. The original row stays, so the ranking is unbroken.
  const isMine = (r: LbRow) => !!me && r.player.toLowerCase() === me;
  const mineRow = rows.find(isMine);
  const ordered: { row: LbRow; pinned: boolean; dup: boolean }[] = [
    ...(mineRow ? [{ row: mineRow, pinned: true, dup: false }] : []),
    ...rows.map((row) => ({ row, pinned: false, dup: mineRow !== undefined && row === mineRow })),
  ];
  // 🔒 The file's `refunded` is not taken on trust: an all-negative match is defined as "not one
  // entry had a positive return", which standings shows. If the two disagree it is shown as an
  // ordinary settlement — better to say one thing less than to claim, on the publisher's behalf,
  // something that cannot be checked (§25).
  const refunded = ok?.refunded === true
    && (ok.standings === undefined || ok.standings.every((r) => BigInt(r.strategy_return) <= 0n)
      || (new Set(ok.standings.map(r => r.strategy_return)).size === 1));

  return (
    <div className="lb">
      <div className="lad-head">
        <h3>{refunded ? tr("Match refunded in full") : tr("Ranking")}</h3>
        <span className="lad-basis">
          {pool.entries} {tr("strategies · ranked by the strategy return computed from the")} {PRICE_BASIS} {tr("at the lock time and at the settlement time")}

        </span>
      </div>
      {refunded && (
        <div className="ent-empty alert">
          <b>{tr("This match met its full-refund condition. Every buy-in was returned, sponsorship was refunded, and no fee was charged.")}</b>
        </div>
      )}
      {!res ? (
        <div className="ent-empty">{tr("Loading results…")}</div>
      ) : res.kind === "none" ? (
        <div className="ent-empty">{tr("Could not load this match's results: the endpoint says it has not settled yet, or it did not respond. Refresh later.")}</div>
      ) : res.kind === "pending" ? (
        <div className="ent-empty">
          <b>{tr("Results not published yet.")}</b> {tr("The settlement root")} <code>{res.root.slice(0, 10)}…{res.root.slice(-6)}</code> {tr("is recorded in the ledger, and the ranking appears here once the runner publishes the results file.")}
        </div>
      ) : res.kind === "mismatch" ? (
        <div className="ent-empty alert">
          <b>{tr("The results file does not match the root recorded in the ledger, so it is not shown.")}</b> {tr("The ledger root is")} <code>{res.root.slice(0, 10)}…</code>.
          This is not your problem, it is the publisher&apos;s; balances follow the ledger.
        </div>
      ) : (
        <>
          <div className="lb-list">
            {ordered.map(({ row, pinned, dup }) => {
              const e = byEntry.get(row.entryId);
              const mine = isMine(row);
              return (
                <div
                  key={pinned ? `pin-${row.entryId}` : row.entryId}
                  className={`lb-row${mine ? " me" : ""}${row.rank <= 3 ? " top" : ""}${pinned ? " pinned" : ""}${dup ? " dup" : ""}`}
                >
                  {/* The place comes from rank, not from the row number — if the pinned "me" is 7th, it is neither enlarged nor renumbered */}
                  <span className="rk">{row.rank}</span>
                  <Avatar address={row.player as Address} variant={e?.avatar ?? 0} size={22} />
                  <span className="nm" title={row.player}>
                    {displayName(e ?? {}, row.player)}{mine && <i>{tr("You")}</i>}
                    {e && <small><Legs legs={e.legs} compact sideMax={3} /></small>}
                  </span>
                  {/* Since §66 the same return can be backed by different stakes, so the prizes differ while the
                      multiple is identical; the multiple is folded into the prize cell as small print instead of
                      taking a column of its own */}
                  <span className="stk">{row.stake > 0n ? <>{fmtUsdt2(row.stake)}<i> USDT</i></> : <i className="mute">{tr("Free")}</i>}</span>
                  {/* The last two cells: return as a percentage (two decimal places) → prize. The top three have their return enlarged (.lb-row.top .ret) */}
                  <span className={`ret ${row.ret >= 0n ? "gain" : "loss"}`}>{fmtReturn(row.ret.toString())}</span>
                  <span className="amt">
                    {row.prize > 0n
                      ? <><b>{fmtUsdt2(row.prize)}<small> USDT</small></b>{row.stake > 0n && <i>{mult(row.prize, row.stake)}×</i>}</>
                      : <i className="mute">{tr("No prize")}</i>}
                  </span>
                  {/* "Credited" hangs on the pinned row only; the original row (.dup) does not repeat it */}
                  <span className="cl">{mine && !dup && row.prize > 0n ? <span className="chip live">{tr("Credited")}</span> : null}</span>
                </div>
              );
            })}
          </div>
          <p className="lad-note">
            {refunded
              ? <>{tr("Everyone in this match is listed, and each amount is that entrant's own buy-in.")}</>
              : full
                ? <><b>{tr("Prizes go only to strategies with a positive return")}</b> {tr("— a return of 0 or below shares in nothing.")} <b>{tr("Multiple = prize ÷ buy-in")}</b>.</>
                : <>{tr("This match's results file carries no full standings, so only the strategies that won a prize can be listed.")} <b>{tr("Multiple = prize ÷ buy-in")}</b>.</>}
            {" "}{tr("The results file's root")}
            <code>{res.results.root.slice(0, 10)}…{res.results.root.slice(-6)}</code> {tr("has been checked against the ledger and matches")}
            {res.results.resultlog_tx ? <>{tr(", on-chain record")} <code>{res.results.resultlog_tx.slice(0, 10)}…</code></> : tr(", the on-chain record is pending")}{tr(PERIOD)}
            {" "}{refunded ? tr("Refunds were credited to arena balances at settlement and can be withdrawn at any time, with no deadline.") : tr("Prizes were credited to arena balances at settlement and can be withdrawn at any time, with no deadline.")}
          </p>
        </>
      )}
    </div>
  );
}

/// `#arena/<poolId>` → poolId; every other hash is null (§68, the single-match page).
function poolFromHash(): number | null {
  const m = /^#arena\/(\d+)$/.exec(location.hash);
  return m ? Number(m[1]) : null;
}

function short(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
