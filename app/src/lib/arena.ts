/// The arena: pools, match formats, prize allocation, entry lists and results.
///
/// Three lines that must not be crossed (DECISIONS.md §23):
///   1. There is no "live ranking" before settlement. The frontend has no price feed, so any
///      in-flight placing would be made up. Once a match locks, only the entry list is shown;
///      rankings appear only after settlement, and only when the result file agrees with the root
///      recorded in the ledger (`GET /results/{id}` has already checked, §69.7).
///   2. Prize allocation mirrors core/uploop/settlement/ranked.py with integer arithmetic.
///      Positive entries share the 90/10 pools by stake and dense return tiers.
///   3. The match format (15 minutes / 1 hour / 4 hours / daily / weekly) is not a field on the
///      pool. A pool in the ledger has only `locks_at` and `settles_at` (§42), and the format is
///      the gap between them (`cadenceOf`), off the same table as the runner's `cadence_of`.
///      Show the pools there are; invent no sample pools. Prices are always Binance USDT-margined
///      perpetual candles (§71.33): the open is the open of the candle starting at the lock, the
///      close is the close of the candle finishing at settlement, and the period matches the
///      match; equities and crypto are priced the same way and have a price 24 hours a day. The
///      live quotes on the arena side (the **perpetual leg** of `/quotes`) are the 24-hour figures
///      for that same set of perpetuals, from the same source as settlement. Since §71.94
///      `/quotes` also has a **spot leg**, which is what the staking page uses (each catalog
///      token's own spot price) and has nothing to do with matches.
///      The interface never says "futures" (§28): a pool card says only "Binance price", and the
///      detail of the rule lives in the Help Center (§71.44).
///      Daily matches lock at 00:00 UTC and read Binance daily candles; weekly matches lock at
///      00:00 UTC on Monday and read weekly candles (§71.35). The interface appends "UTC HH:MM"
///      for those two formats only, and the arena never mentions US Eastern time any more (the US
///      Eastern calendar day in `dayOfSec` is left only for the §37 market-holiday check).
import { tr } from "./i18n";
import type { Address } from "viem";
import { ApiError, apiGet } from "./api";
import { POOLS } from "./strategy";
import type { PoolKey, Side } from "./strategy";

// ---------------------------------------------------------------- constants

/// The allocation constants locked in by §1–§3 and revised by §71.166. These mirror
/// core/uploop/settlement/engine.py and the /ops/profit payload; none of them is read from the
/// chain. (The on-chain Competition.sol with its old flat PRIZE_BPS = 8600 was removed on 2026-10-05.)
import { BPS_TOTAL, MIN_ENTRIES, SHARE_TOTAL, RANKED_RULE } from "./prizes";
export { BPS_TOTAL, MIN_ENTRIES, SHARE_TOTAL };

/// rank90_v2 charges 14% of nonzero-return stakes. Full refunds carry no fee.
export const RAKE_BPS = 1_400;

/// The fee splits into 14 shares: 7 to certificate stakers, 1 to the perfect-score jackpot, 6 to
/// the platform. The platform pays referral rebates out of its own 6, so the public split shows 6
/// rather than 3 + 3 -- the total fee an entrant pays is identical either way (§71.166 three).
export const RAKE_SHARES = 14;
export const FRAGMENT_SHARE = 7;
export const JACKPOT_SHARE = 1;
export const PLATFORM_SHARE = 6;

/// How the certificate stakers' 7 shares split in two (§71.144, mirrors DIVIDEND_ALL_SHARE and
/// DIVIDEND_WIN_SHARE in core/uploop/ledger/book.py): 6 follow the assets the winning strategies
/// held, 1 is shared by every staker on the platform. Both are paid in USDT into the arena balance.
export const DIVIDEND_WIN_SHARE = 6;
export const DIVIDEND_ALL_SHARE = 1;

/// Basis points of chargeable (nonzero-return) stakes for the split bar.
export const FRAGMENT_BPS = (RAKE_BPS * FRAGMENT_SHARE) / RAKE_SHARES;
export const JACKPOT_BPS = (RAKE_BPS * JACKPOT_SHARE) / RAKE_SHARES;
export const PLATFORM_BPS = (RAKE_BPS * PLATFORM_SHARE) / RAKE_SHARES;
/// 🔴 A floor on what goes back to entrants, not a prize pool. Since §71.166 the prize pool cannot
/// be known before settlement -- it depends on who ends up losing. What is knowable is that the fee
/// never exceeds 14%, so entrants always get back at least this much of the buy-ins, plus all of
/// the sponsorship. See payoutFloorOf.
export const PRIZE_BPS = BPS_TOTAL - RAKE_BPS;

/// Concentration caps (the user, 2026-09-21, §71.168; mirrors ADDRESS_CAP_BPS and
/// STRATEGY_WARN_BPS in core/uploop/ledger/book.py -- both ends must read the same number).
///
/// Existing concentration policy remains in force.
/// One address may hold at most 70% of a match: a hard block, enforced by the ledger as well.
/// One identical strategy holding more than 40% only raises a warning; nothing is blocked.
export const ADDRESS_CAP_BPS = 7_000;
export const STRATEGY_WARN_BPS = 4_000;

/// Opening relaxation (the user, 2026-09-21, §71.171; mirrors OPENING_ENTRIES / OPENING_MULTIPLE
/// in core/uploop/ledger/book.py).
///
/// With only the 70% rule and a one-times floor, the first entrant into an empty paid match could
/// put in exactly the minimum and nothing more -- they hold 100% of the field, so the ratio has no
/// second answer. That punishes the one person taking the opening risk. So while the match still
/// has fewer than three entries, the floor is raised to five times the minimum.
export const OPENING_ENTRIES = 3;
export const OPENING_MULTIPLE = 5n;

/// How much more this address may still put into this match, mirroring `_headroom` in
/// core/uploop/ledger/book.py. `gross` is everything the match has taken so far, `mine` this
/// address's part of it, `buyIn` the minimum entry, `entries` how many entries the match already
/// has (entries, not entrants -- one address entering twice counts twice).
///
/// Returns -1 for a free match (no amounts, so no ratio to cap).
///
/// Why one number is a complete answer: the requirement is (mine + x) ≤ 70% × (gross + x), and
/// because gross ≥ mine always holds, (mine + x) / (gross + x) never falls as x grows. So "may I
/// enter x?" is monotone in x and a single ceiling describes it exactly -- there is no "a large
/// amount is fine but a small one is not".
///
/// The floor underneath the ratio is what keeps a match from being unopenable, and it has two
/// tiers: five times the minimum while the match has fewer than OPENING_ENTRIES entries, one times
/// after that. 🔴 The floor is a ceiling on this address's *total*, not on one entry -- it
/// subtracts `mine` -- so entering three times during the opening window still stops at 5x, not
/// 15x. From the fourth entry on there is real money in the field and the ratio is roomy by itself.
///
/// The result is floored to a whole multiple of `buyIn`, because that is all the ledger accepts
/// (§71.171, "no odd amounts"). Two things follow, and both are relied on by the caller: the number
/// shown can always actually be typed in, and headroom is either 0 or at least `buyIn` -- so an
/// address that is out of room reads as a plain 0 rather than an unspendable remainder.
///
/// Flooring never eats into the floor: `mine` is itself a sum of whole multiples, so
/// `OPENING_MULTIPLE * buyIn - mine` is already a multiple.
export function addressHeadroom(gross: bigint, mine: bigint, buyIn: bigint, entries: number): bigint {
  if (buyIn <= 0n) return -1n;
  const capRoom = (BigInt(ADDRESS_CAP_BPS) * gross - BigInt(BPS_TOTAL) * mine) / BigInt(BPS_TOTAL - ADDRESS_CAP_BPS);
  const floor = (entries < OPENING_ENTRIES ? OPENING_MULTIPLE : 1n) * buyIn - mine;
  const room = capRoom > floor ? capRoom : floor;
  return room > 0n ? room - (room % buyIn) : 0n;
}

/// The fingerprint of a strategy: same assets, same directions = same strategy. Sorted, so the
/// order the legs were built in does not matter.
///
/// Weights are deliberately not part of it. The endpoint assigns them itself -- `_legs` in
/// core/uploop/api/app.py calls `equal_weights(len(legs))` -- so two entries holding the same
/// assets the same way always carry the same weights, and including them would only introduce a
/// false difference when the same assets were entered in a different order.
export function strategyKey(legs: readonly StrategyLeg[]): string {
  return legs.map((l) => `${l.ticker.toUpperCase()}:${l.side}`).sort().join("|");
}

/// Enough of a leg to fingerprint it: the entry list and a locally saved draft describe their legs
/// differently, and this is the part they agree on.
export interface StrategyLeg {
  ticker: string;
  side: Side;
}

/// How much of this match (in basis points of the buy-ins) is already on this exact strategy.
/// A warning only -- nothing is blocked, and a free match always returns 0 because every amount
/// in it is zero.
export function strategyShareBps(entries: readonly Entry[], legs: readonly StrategyLeg[], adding: bigint): number {
  const key = strategyKey(legs);
  let same = adding;
  let total = adding;
  for (const e of entries) {
    total += e.amount;
    if (strategyKey(e.legs) === key) same += e.amount;
  }
  return total > 0n ? Number((same * BigInt(BPS_TOTAL)) / total) : 0;
}

/// Entry closes 1 minute before the lock (the ledger's ENTRY_CUTOFF, §71.37): a 15-minute match
/// takes entries for 14 minutes, a 1-hour match for 59 minutes, and so on.
export const ENTRY_CUTOFF = 60;
/// A voided-and-refunded match stays in the schedule this many more seconds before it disappears
/// (the user, 2026-09-13: "after the refund, have it disappear from the frontend a minute later",
/// §71.37).
export const REFUND_LINGER = 60;

/// Tiers (§30): matching Competition.KIND_THREE / KIND_FIVE / KIND_OPEN. Like weight classes in
/// boxing — 3 assets and 5 assets are fixed counts, Open is 6–50; every tier has a daily and a
/// weekly match. The rules themselves live in POOLS in strategy.ts.
export type Kind = 0 | 1 | 2;
/// `code` is the short code in the schedule's first column (set by the user, 2026-09-05): 3T / 5T
/// = 3 / 5 assets, NT = OPEN (6–50 assets).
/// Both the counts and the short codes are derived from `POOLS` (§39): change a tier's rules in
/// strategy.ts alone and the schedule, the builder and the entry dialog all follow.
function kindRow(key: PoolKey) {
  const r = POOLS[key];
  return { key, label: r.name, code: r.code, minLegs: r.minLegs, maxLegs: r.maxLegs };
}
export const KINDS: Record<Kind, { key: PoolKey; label: string; code: string; minLegs: number; maxLegs: number }> = {
  0: kindRow("three"),
  1: kindRow("five"),
  2: kindRow("open"),
};
export const KIND_LIST: Kind[] = [0, 1, 2];
export function kindOf(key: PoolKey): Kind {
  return KIND_LIST.find((k) => KINDS[k].key === key) ?? 2;
}

// ---------------------------------------------------------------- match format

export type Cadence = "15m" | "1h" | "4h" | "daily" | "weekly" | "custom";

export interface CadenceInfo {
  key: Cadence;
  label: string;
  /// The standard gap from lock to settlement, in seconds.
  span: number;
  /// The tolerance allowed, in seconds. Since §71.35 daily and weekly matches are scheduled in
  /// UTC, so there is no daylight-saving hour and every format is 0.
  slack: number;
  /// The time is pinned to 00:00 UTC (daily every day, weekly on Monday, §71.35) and the interface
  /// appends "UTC HH:MM". Short matches run around the clock and carry no timezone wording.
  utc: boolean;
}

/// The same table as CADENCES in core/uploop/prices/spot.py (§42). The contract stores no format
/// field: the format is settlesAt − locksAt. The schedule shows the pools there are — the system
/// opens pools automatically from the schedule table (`core/data/schedule.json`) and states the
/// two times (§71.37), the frontend sorts them into formats, and no sample pools are invented.
/// Weekly matches go to the top of the schedule (§25).
export const CADENCES: CadenceInfo[] = [
  { key: "15m", label: tr("15-minute match"), span: 900, slack: 0, utc: false },
  { key: "1h", label: tr("1-hour match"), span: 3600, slack: 0, utc: false },
  { key: "4h", label: tr("4-hour match"), span: 4 * 3600, slack: 0, utc: false },
  { key: "daily", label: tr("Daily match"), span: 86_400, slack: 0, utc: true },
  { key: "weekly", label: tr("Weekly match"), span: 7 * 86_400, slack: 0, utc: true },
];

export function cadenceLabel(c: Cadence): string {
  return CADENCES.find((x) => x.key === c)?.label ?? tr("Custom window");
}

/// The short code, for recognising a format at a glance on desktop; the full name stays alongside
/// it as the explanatory text.
export function cadenceCode(c: Cadence): string {
  return c === "15m" ? "15M" : c === "1h" ? "1H" : c === "4h" ? "4H" : c === "daily" ? "1D" : c === "weekly" ? "1W" : "CUSTOM";
}

/// Whether this format's times are pinned to 00:00 UTC (which decides whether "UTC HH:MM" is
/// appended, §71.35).
export function cadenceUtc(c: Cadence): boolean {
  return CADENCES.find((x) => x.key === c)?.utc ?? false;
}

/// The one-line statement of what settlement is based on: every format uses Binance candle prices
/// (§71.33), only the period and the times differ. The interface never says "futures" (§28).
export const PRICE_BASIS = tr("Binance price");

// ---------------------------------------------------------------- pools

export function participantCount(pool: Pool): number {
  return pool.participants ?? 0;
}

export interface Pool {
  id: number;
  /// The settlement day, yyyymmdd
  day: number;
  kind: Kind;
  /// The minimum buy-in, in USDT's smallest unit (18 decimals, §69.13)
  buyIn: bigint;
  /// When entries lock (Unix seconds, the ledger's clock). The open price is the open of the
  /// Binance candle starting at this moment (§71.33).
  locksAt: number;
  /// When it settles (Unix seconds, §42). The close price is the close of the Binance candle
  /// finishing at this moment (§71.33); the runner does not settle before it.
  settlesAt: number;
  /// Entry closes 1 minute before the lock (the ledger's entry_closes_at, §71.37). No entries are
  /// taken after it; a match with fewer than 10 entrants at that point is voided and refunded.
  entryClosesAt: number;
  entries: number;
  participants?: number;
  settlementRule?: string;
  rankingSlots?: number;
  /// The ledger's state is settled / all_negative (a match where everyone lost and every buy-in
  /// was returned in full counts as settled too, §66)
  settled: boolean;
  /// The ledger's state is refunded: too few entrants, voided, and the buy-ins are already back in
  /// each person's arena balance
  refunding: boolean;
  /// When settlement / voiding was written to the ledger (the ledger's settled_at); null while it
  /// is still running. A voided match uses it to disappear from the schedule a minute later
  /// (`visible`).
  settledAt: number | null;
  /// Under review (§69.17 / §71.37): automatic settlement did not finish within the deadline, so
  /// the runner handed the match to a person to check; this is the reason in full. null = normal.
  review: string | null;
  /// The template name in the schedule table (15m / 1h / daily-3 …, §71.37); null for a pool
  /// opened by hand. Not shown in the interface.
  template: string | null;
  /// The pinned label (§71.40, the ops console's `POST /ops/pools/{id}/feature`, the ledger's
  /// `pool.featured`); null when not pinned.
  featured: string | null;
  /// Total buy-ins taken (the ledger's staked)
  gross: bigint;
  /// Total sponsorship; it all goes into the prize pool with nothing taken out (§26)
  sponsored: bigint;
}

/// The arena balance (the ledger, §69): entries are deducted from it, prizes and refunds go into
/// it, and it can be sent back to the signed-in wallet at any time.
/// It can only be read after signing with the wallet (GET /me). `pending` is the number of
/// withdrawals under review (the endpoint's queued state); the interface says "withdrawal under
/// review" and never says "in the queue" (§69.17).
/// 🔴 The frontend does not read the USDT in the user's wallet (it never calls USDT `balanceOf`),
/// and no screen shows a "wallet USDT" figure (the user, 2026-09-11, §69.15).
export interface Funds {
  arena: bigint;
  pending: number;
  withdrawable: bigint;
  locked: bigint;
  unlockAt: number | null;
}

export type Phase = "open" | "closing" | "locked" | "review" | "short" | "settled" | "refunding";

export const PHASE_LABEL: Record<Phase, string> = {
  open: tr("Entry open"),
  closing: tr("Entry closed · awaiting lock"),
  locked: tr("Locked · awaiting settlement"),
  review: tr("Under review"),
  short: tr("Too few entrants · voided and refunded"),
  settled: tr("Settled"),
  refunding: tr("Refunded"),
};

/// The phases (§71.37): entry closes 1 minute before the lock; fewer than 10 entrants at that
/// point → voided (the runner refunds immediately and the ledger state becomes refunded); between
/// the close and the lock it reads "entry closed · awaiting lock"; past the settlement deadline
/// with no settlement → "under review" (§69.17), and there are no rankings until the check is
/// done.
export function phaseOf(p: Pool, now: number): Phase {
  if (p.refunding) return "refunding";
  if (p.settled) return "settled";
  if (now < p.entryClosesAt) return "open";
  if (participantCount(p) < MIN_ENTRIES) return "short";
  if (p.review) return "review";
  return now < p.locksAt ? "closing" : "locked";
}

/// Whether the schedule / home page still lists this match: one voided and refunded more than a
/// minute ago is not listed (REFUND_LINGER). The history on "My Account" lists everything as
/// before.
export function visible(p: Pool, now: number): boolean {
  if (!p.refunding) return true;
  return p.settledAt === null || now - p.settledAt < REFUND_LINGER;
}

/// yyyymmdd split into [year, month (1-12), day]
export function splitDay(day: number): [number, number, number] {
  return [Math.floor(day / 10_000), Math.floor(day / 100) % 100, day % 100];
}

export function toDay(y: number, m: number, d: number): number {
  return y * 10_000 + m * 100 + d;
}

/// The standard time for a daily / weekly match: midnight of a given UTC calendar day (§71.35:
/// daily matches lock at 00:00 UTC and read Binance daily candles; weekly matches lock at 00:00
/// UTC on Monday and read weekly candles). Used for scheduling and for the demo data; a real
/// pool's times are always read from `locksAt` / `settlesAt` on chain, never inferred back from
/// this number.
export function utcMidnight(day: number): number {
  const [y, m, d] = splitDay(day);
  return Math.floor(Date.UTC(y, m - 1, d) / 1000);
}

/// This pool's settlement time — the on-chain field itself (§42). The name is kept because that is
/// what every call site uses.
export function settlesAtOf(p: Pool): number {
  return p.settlesAt;
}

/// On-chain seconds → the UTC calendar day, yyyymmdd. This is what the pool's `day` field means
/// (§42: the UTC day the settlement falls on), and what the schedule's calendar cells mean
/// (§71.35): a cell is placed by the lock day, because "what day entry closes" is the day an
/// entrant has to remember; the settlement day is written separately in the details.
export function dayOfUtc(sec: number): number {
  const d = new Date(sec * 1000);
  return toDay(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/// On-chain seconds → the US Eastern calendar day, yyyymmdd. Used only for the US market-holiday
/// check (the §37 unstaking gate: `Staking.holiday(day)`, `inSessionAt`); the schedule and the
/// demo timetable always use the UTC day (`dayOfUtc`, §71.35).
export function dayOfSec(sec: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(sec * 1000));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return toDay(g("year"), g("month"), g("day"));
}

/// Calendar arithmetic: day ± n days (on the UTC calendar, with no time of day involved, so
/// daylight saving cannot bite).
export function shiftDay(day: number, by: number): number {
  const [y, m, d] = splitDay(day);
  const t = new Date(Date.UTC(y, m - 1, d + by));
  return toDay(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/// 0 = Sunday … 6 = Saturday
export function weekdayOf(day: number): number {
  const [y, m, d] = splitDay(day);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/// A countdown inside its last 2 hours counts as "urgent" and the text turns orange-red (the user,
/// 2026-09-05). Only ever applied to the real seconds left on chain, with nothing brought forward
/// artificially — the urgency has to be real.
export const URGENT_SECS = 2 * 3600;
export function urgent(left: number): string {
  return left > 0 && left <= URGENT_SECS ? " urgent" : "";
}

/// The format = settlement time − lock time, looked up in `CADENCES` (the same table as the
/// runner's `cadence_of`). Matching nothing makes it a "custom window": the gap is shown as it is,
/// and it is not forced into one of the buckets.
export function cadenceOf(p: Pool): Cadence {
  const span = p.settlesAt - p.locksAt;
  for (const c of CADENCES) if (Math.abs(span - c.span) <= c.slack) return c.key;
  return "custom";
}

/// The gap from lock to settlement, for "custom window" pools and for the detail page.
export function fmtSpan(seconds: number): string {
  if (seconds % 86_400 === 0) {
    const d = seconds / 86_400;
    return `${d} ${d === 1 ? "day" : "days"}`;
  }
  if (seconds % 3600 === 0) {
    const h = seconds / 3600;
    return `${h} ${h === 1 ? "hour" : "hours"}`;
  }
  const m = Math.round(seconds / 60);
  return `${m} ${m === 1 ? "minute" : "minutes"}`;
}

/// The next match: the earliest pool still taking entries (its entry close has not passed). None
/// means null — the interface writes "nothing scheduled" rather than inventing a time.
export function nextPool(pools: Pool[], now: number): Pool | null {
  const open = pools.filter((p) => !p.refunding && !p.settled && p.entryClosesAt > now);
  if (!open.length) return null;
  return open.reduce((a, b) => (b.entryClosesAt < a.entryClosesAt ? b : a));
}

/// A free match: the buy-in is 0 and the whole prize pool comes from sponsorship (`fund`, §26).
/// A free match nobody has sponsored has a prize pool of 0, and the interface says so — "no
/// sponsorship yet" — rather than inventing a number.
export function isFree(p: Pool): boolean {
  return p.buyIn === 0n;
}

export function fmtBuyIn(v: bigint): string {
  return v === 0n ? tr("Free") : `${fmtUsdt(v)} USDT`;
}

// ---------------------------------------------------------------- pinned (featured)

/// Pinned matches: since §71.40 the ledger's `pool.featured` governs (the ops console's "pin"), and
/// the endpoint returns it along with the match. `VITE_FEATURED="poolId[:label],…"` is left only as
/// a fallback for demos and for when the ops console is not up. Weekly matches need no
/// configuration and are pinned automatically. The label is a display name only and affects
/// nothing in the ledger.
export type Featured = Map<number, string>;

export function parseFeatured(raw: string | undefined): Featured {
  const m: Featured = new Map();
  for (const part of (raw ?? "").split(",")) {
    const [idS, ...rest] = part.trim().split(":");
    if (!idS) continue;
    const id = Number(idS);
    if (!Number.isInteger(id) || id < 0) continue;
    m.set(id, rest.join(":").trim() || tr("Featured"));
  }
  return m;
}

export const FEATURED: Featured = parseFeatured(import.meta.env.VITE_FEATURED);

/// The pinned label: what the ops console set (the ledger's featured) comes first, then the
/// frontend configuration, then "Weekly"; not pinned returns null.
export function pinLabel(p: Pool, featured: Featured): string | null {
  return p.featured ?? featured.get(p.id) ?? (cadenceOf(p) === "weekly" ? tr("Weekly") : null);
}

// ---------------------------------------------------------------- the schedule window

/// The n calendar days (UTC) from `from` inclusive. Since §42 there is a price around the clock and
/// matches run at weekends too, so weekends are no longer skipped; a day with no pools reads "no
/// matches", and no fake pool is ever shown.
export function calendarDays(from: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => shiftDay(from, i));
}

/// Which day the "next three days" window starts counting from: daily matches lock at 00:00 UTC
/// (§71.35), so today's (UTC) has certainly locked already and counting starts tomorrow.
/// Short matches run around the clock and do not affect this starting point; matches that locked
/// today are listed by scheduleWindow all the same.
export function windowStart(now: number): number {
  const today = dayOfUtc(now);
  return utcMidnight(today) <= now ? shiftDay(today, 1) : today;
}

/// The schedule window: every calendar day from today (UTC) through day n. Matches that locked
/// today stay in the window (they sit below the ones still taking entries, so their lists can
/// still be read); no pool is hidden.
export function scheduleWindow(now: number, n: number): number[] {
  const today = dayOfUtc(now);
  const last = calendarDays(windowStart(now), n).at(-1) ?? today;
  const out: number[] = [];
  for (let d = today; d <= last; d = shiftDay(d, 1)) out.push(d);
  return out;
}

// ---------------------------------------------------------------- prize allocation

// The formula in prizes.ts is checked against ranked.py.
// All that is added here is how the split is defined.
export { allocateRanked, fmtShare, mulDiv, RETURN_SCALE } from "./prizes";
export type { Award, FieldRow } from "./prizes";

/// The least that can come back out of a given pile of buy-ins: gross × 86%.
export function payoutFloor(gross: bigint): bigint {
  return (gross * BigInt(PRIZE_BPS)) / BigInt(BPS_TOTAL);
}

/// 🔴 The least a match pays back to its entrants, NOT the prize pool. Since §71.166 the prize
/// pool excludes zero-return refunds in rank90_v2; total payouts include those refunds.
/// 86% of gross plus sponsorship is a lower bound on total payouts.
export function payoutFloorOf(p: Pool): bigint {
  return payoutFloor(p.gross) + p.sponsored;
}

// ---------------------------------------------------------------- the entry list

/// One strategy (the ledger's entry, §69.4). `legs[].ticker` is the bare code (NVDA, BTC), given
/// its prefix by `uSym()` when displayed; the legs are equally weighted and `weightBps` totals
/// 10000. `amount` is the buy-in this entry paid (it varies, §66). Public from the moment it is
/// entered.
export interface EntryLeg {
  ticker: string;
  side: Side;
  weightBps: number;
}

export interface Entry {
  entryId: number;
  player: Address;
  amount: bigint;
  legs: EntryLeg[];
  name: string;
  avatar: number;
  /// When the ledger recorded it (Unix seconds)
  at?: number;
}

/// One row of the settlement result file. The field names match
/// core/uploop/settlement/claims.py.
export interface ResultRow {
  entry_id: number;
  to: Address;
  amount: string;
  rank: number;
  strategy_return: string;
  proof: `0x${string}`[];
}

/// One row of the result file's `standings`: the placing and return of every strategy (including
/// those that won nothing). The field names match core/uploop/runner.py.
export interface Standing {
  entry_id: number;
  player: Address;
  rank: number;
  strategy_return: string;
  prize_amount: string;
  /// §66 variable buy-ins: what this entry actually paid. Older files do not have these two
  /// fields.
  amount?: string;
  /// Buy-in × return (a non-positive return counts as 0). Prize = pool × weight / Σweight.
  weight?: string;
  base_amount?: string;
  ranking_amount?: string;
}

export interface Results {
  pool_id: number;
  root: `0x${string}`;
  claims: ResultRow[];
  /// Metadata written by the runner; it may be missing (an old file, or one holding only claims).
  /// Missing means only the placings present in claims are shown.
  standings?: Standing[];
  /// §66 decision 3: nobody in the match was up → every buy-in is returned in full and the
  /// platform takes nothing. This match's "prize" is simply what each person paid.
  refunded?: boolean;
  settlement_rule?: string;
  participants?: number;
  ranking_slots?: number;
  /// Supplied by the endpoint (§69.7): the result file's sha256, the ResultLog transaction on
  /// chain (null until the contract colleague ships it), and the settlement time.
  file_sha256?: string;
  resultlog_tx?: string | null;
  settled_at?: number | null;
}

export type ResultsState =
  | { kind: "ok"; results: Results }
  | { kind: "pending"; root: `0x${string}` }   // the ledger has settled and recorded a root, but the result file is not published yet
  | { kind: "mismatch"; root: `0x${string}` }  // the result file disagrees with the ledger, the endpoint refuses to return it, nothing is shown
  | { kind: "none" };                          // not settled yet

// ---------------------------------------------------------------- reads from the API (DECISIONS §69)
//
// Pools, entry lists, results, deposits and withdrawals are all read from the ledger's endpoints;
// amounts are decimal strings, used as they are after `BigInt()` (18 decimals, §69.13).

interface PoolJson {
  participants?: number;
  settlement_rule?: string;
  ranking_slots?: number;
  id: number;
  kind: number;
  buy_in: string;
  locks_at: number;
  settles_at: number;
  /// Entry close = locks_at − 60 (§71.37). When an older endpoint does not send this field, the
  /// frontend fills it in by the same rule.
  entry_closes_at?: number;
  state: "open" | "refunded" | "settled" | "all_negative";
  settled_at?: number | null;
  review?: string | null;
  template?: string | null;
  /// Current status of the schedule template. null means a manual pool or a backend without
  /// the operations template table; false means the template was disabled after this pool was made.
  template_enabled?: boolean | null;
  featured?: string | null;
  entries: number;
  staked: string;
  sponsored: string;
}

function poolOf(p: PoolJson): Pool {
  return {
    id: p.id,
    day: dayOfUtc(p.settles_at),
    kind: p.kind as Kind,
    buyIn: BigInt(p.buy_in),
    locksAt: p.locks_at,
    settlesAt: p.settles_at,
    entryClosesAt: p.entry_closes_at ?? p.locks_at - ENTRY_CUTOFF,
    entries: p.entries,
    participants: p.participants,
    settlementRule: p.settlement_rule ?? RANKED_RULE,
    rankingSlots: p.ranking_slots,
    settled: p.state === "settled" || p.state === "all_negative",
    refunding: p.state === "refunded",
    settledAt: p.settled_at ?? null,
    review: p.review || null,
    template: p.template ?? null,
    featured: p.featured || null,
    gross: BigInt(p.staked),
    sponsored: BigInt(p.sponsored),
  };
}

export async function loadPools(): Promise<Pool[]> {
  const r = await apiGet<{ pools: PoolJson[] }>("/pools");
  return r.pools
    // Disabling a template stops future scheduling, but old open / locked pools are still in the
    // ledger. Do not show those stale active cards to players; keep settled/refunded history.
    .filter((p) => p.template_enabled !== false || p.state === "settled" || p.state === "all_negative" || p.state === "refunded")
    .map(poolOf)
    .sort((x, y) => x.id - y.id);
}

// ---------------------------------------------------------------- the perfect-score jackpot (§71.38) and personal record

interface JackpotPayoutJson { week: number; fund: string; shares: number; per_share: string; dust: string; players: number; paid_at: number }
interface JackpotJson {
  week: number; accumulated: string; shares: number; players: number; next_payout_at: number;
  last: JackpotPayoutJson | null; mine: { pending: number; total: number } | null;
}

/// One payout: `fund` is the amount shared out, `shares` the number of shares, `perShare` the
/// amount per share, and `dust` the remainder rolled into the following week.
export interface JackpotPayout { week: number; fund: bigint; shares: number; perShare: bigint; dust: bigint; players: number; paidAt: number }

/// `GET /jackpot`: one fourteenth of every paid match's fee accumulates here, a strategy that got
/// every asset's direction right and whose total return exceeds 1% scores 1 share, and at
/// 00:00 UTC every Monday half the total is split by share into each person's arena balance, the
/// rest rolling into the following week (§71.166). Every number comes from the ledger; the
/// frontend computes none of them.
///
/// 🔴 There is deliberately no "of which sponsorship" figure (§71.168): once a week has paid out,
/// what is left moves into the next week's account and a sponsorship can no longer be told apart
/// from the rest, so the number would under-report itself. The endpoint reports the total only.
export interface Jackpot {
  /// The current week, yyyyww (UTC ISO week)
  week: number;
  /// The accumulated amount not yet shared out
  accumulated: bigint;
  /// The perfect-score shares not yet paid, and how many people hold them
  shares: number;
  players: number;
  /// When the next payout happens (00:00 UTC next Monday, Unix seconds). The countdown uses
  /// serverNow (🔴 never Date.now).
  nextPayoutAt: number;
  last: JackpotPayout | null;
  /// With ?address=: this wallet's unpaid shares / lifetime shares
  mine: { pending: number; total: number } | null;
}

export type JackpotState = { kind: "none" } | { kind: "ok"; jackpot: Jackpot } | { kind: "error"; message: string };

export async function loadJackpot(address?: Address | null): Promise<Jackpot> {
  const r = await apiGet<JackpotJson>(address ? `/jackpot?address=${address}` : "/jackpot");
  const l = r.last;
  return {
    week: r.week, accumulated: BigInt(r.accumulated), shares: r.shares, players: r.players, nextPayoutAt: r.next_payout_at,
    last: l ? { week: l.week, fund: BigInt(l.fund), shares: l.shares, perShare: BigInt(l.per_share), dust: BigInt(l.dust), players: l.players, paidAt: l.paid_at } : null,
    mine: r.mine,
  };
}

/// yyyyww → "Week 37, 2026".
export function fmtWeek(week: number): string {
  return tr("Week {0}, {1}", week % 100, Math.floor(week / 100));
}

/// `GET /stats?address=` (§71.38): matches entered (entered and not voided), paid matches already
/// settled, how many of those won something, and how many got every direction right.
/// Race seats also count as entries; each settled 15-minute race cycle adds one
/// observation, positive total return adds a win, and three correct legs plus a total return over 1%
/// add a perfect score.
/// Win rate = won / settled, perfect-score rate = allCorrect / settled; with a denominator of 0 the
/// interface writes "—" (§25).
export interface Stats { entries: number; settled: number; won: number; allCorrect: number }

export async function loadStats(address: Address): Promise<Stats> {
  const r = await apiGet<{ entries: number; settled: number; won: number; all_correct: number }>(`/stats?address=${address}`);
  return { entries: r.entries, settled: r.settled, won: r.won, allCorrect: r.all_correct };
}

/// A percentage, whole numbers only; a denominator of 0 → "—".
export function fmtRate(num: number, den: number): string {
  if (den <= 0) return "—";
  return `${Math.round((num / den) * 100)}%`;
}

interface LegJson {
  ticker: string;
  weight_bps: number;
  side: Side;
}
interface EntryJson {
  entry_id: number;
  player: string;
  amount: string;
  legs: LegJson[];
  name: string;
  avatar: number;
  at?: number | null;
  pool_id?: number;
}

function entryOf(e: EntryJson): Entry {
  return {
    entryId: e.entry_id,
    player: e.player as Address,
    amount: BigInt(e.amount),
    legs: e.legs.map((l) => ({ ticker: l.ticker, side: l.side, weightBps: l.weight_bps })),
    name: e.name,
    avatar: e.avatar,
    at: e.at ?? undefined,
  };
}

/// Every strategy in one match, in the order they entered. Public from the moment of entry (§69.4).
export async function loadEntries(poolId: number): Promise<Entry[]> {
  const r = await apiGet<{ entries: EntryJson[] }>(`/pools/${poolId}/entries`);
  return r.entries.map(entryOf);
}

/// An activity match in progress (§71.179): the lock-time opens plus prices sampled since the lock.
/// Prices only (§23) — every return is computed here, from the viewer's own strategy. Prices are
/// integer strings scaled by 1e8, as everywhere else.
export interface PoolLive {
  available: boolean;
  sampleInterval: number;
  opens: Record<string, string>;
  samples: { at: number; prices: Record<string, string> }[];
  quotes: Record<string, { price: string; at: number }>;
  stale: boolean;
  staleAfter: number;
}

interface PoolLiveJson {
  available?: boolean; sample_interval?: number; opens?: Record<string, string>;
  samples?: { at: number; prices: Record<string, string> }[];
  quotes?: Record<string, { price: string; at: number }>; stale?: boolean; stale_after?: number;
}

export async function loadPoolLive(poolId: number): Promise<PoolLive> {
  const r = await apiGet<PoolLiveJson>(`/pools/${poolId}/live`);
  return {
    available: !!r.available, sampleInterval: r.sample_interval ?? 60, opens: r.opens ?? {},
    samples: r.samples ?? [], quotes: r.quotes ?? {}, stale: r.stale ?? true, staleAfter: r.stale_after ?? 15,
  };
}

/// Every strategy from one address, grouped by pool ("My Account"). Public data: no sign-in
/// needed, and the `?as=0x…` preview can see it too.
export async function loadMyEntries(account: Address): Promise<Map<number, Entry[]>> {
  const r = await apiGet<{ entries: EntryJson[] }>(`/entries?address=${account.toLowerCase()}`);
  const out = new Map<number, Entry[]>();
  for (const e of r.entries) {
    const pid = e.pool_id ?? -1;
    const list = out.get(pid) ?? [];
    list.push(entryOf(e));
    out.set(pid, list);
  }
  return out;
}

// ---------------------------------------------------------------- deposits / withdrawals (§69.2, §69.6)

/// The deposit address: send USDT here and it is credited to the arena balance after
/// `confirmations` confirmations.
/// Since §71.111 this address is **one per person** (asked for from the custody platform on the
/// spot), and crediting goes by **which address received it** — a transfer from someone else's
/// wallet still counts as theirs.
export interface DepositInfo {
  tokenSymbol?: string;
  /// This player's **own** deposit address (§71.111: one per person, asked for from the custody
  /// platform on the spot, no longer one address for the whole site).
  /// null = not configured / momentarily unobtainable; `unavailable` is then the plain sentence to
  /// show the user, and the whole block must be greyed out. An empty address must never be shown
  /// for someone to send money to.
  address: Address | null;
  unavailable: string | null;
  token: Address;
  chainId: number;
  confirmations: number;
  minDeposit: bigint;
  minWithdrawal: bigint;
}

export interface Deposit {
  txhash: string;
  logIndex: number;
  amount: bigint;
  block: number;
  /// The confirmation count the platform reports; null on rows already credited (once credited
  /// there is no need to show it any more)
  confirmations: number | null;
  credited: boolean;
}

export interface DepositList {
  /// How many confirmations are needed before crediting. Since §71.111 this number comes **from
  /// the platform** — we no longer read the chain head and subtract ourselves — so the list has no
  /// global "chain head block" either; the confirmation count sits on each row.
  required: number;
  deposits: Deposit[];
}

export interface Withdrawal {
  id: number;
  /// `review` = the amount is above the limit set in the ops console, so it went to a person
  /// (§71.126): the money is already frozen out of the arena balance, but it is **not** in the
  /// payout queue and only joins it once an admin approves. It can still be cancelled.
  state: "review" | "queued" | "sent" | "cancelled";
  amount: bigint;
  requestedAt: number;
  txhash: string | null;
  sentAt: number | null;
  /// Why it went to a person, as one sentence for the user to read (written by the server and shown
  /// directly; do not write a second version here). null when it was not held.
  review: string | null;
  /// The reference number on the custody platform. A value here = we have handed this one to the
  /// platform (since §71.151 that step is automatic); the state is still `queued`, but the meaning
  /// has moved from "waiting to be sent" to "submitted, waiting for the platform to release" — the
  /// two have to be shown apart, or the page looks frozen after the automatic payout goes out.
  /// null when it has not been handed over.
  platformId: string | null;
  /// When it was handed to the platform (seconds). Present exactly when `platformId` is.
  submittedAt: number | null;
  approvedAt?: number | null;
  cancelable?: boolean;
}

export interface WithdrawalJson {
  id: number;
  amount: string;
  state: Withdrawal["state"];
  requested_at: number;
  txhash?: string | null;
  sent_at?: number | null;
  review?: string | null;
  platform_id?: string | null;
  submitted_at?: number | null;
  approved_at?: number | null;
  cancelable?: boolean;
}

export function withdrawalOf(w: WithdrawalJson): Withdrawal {
  return { id: w.id, amount: BigInt(w.amount), state: w.state, requestedAt: w.requested_at, txhash: w.txhash ?? null,
           sentAt: w.sent_at ?? null, review: w.review ?? null,
           platformId: w.platform_id || null, submittedAt: w.submitted_at ?? null,
           approvedAt: w.approved_at ?? null, cancelable: w.cancelable ?? (w.state === "review" || (w.state === "queued" && !w.platform_id)) };
}

/// The signed-in wallet's own deposit address (§71.111, **sign-in required**: the address is one
/// per person).
/// When the custody platform is not configured, or the address cannot be obtained just now, the
/// endpoint returns `address: null` plus an `unavailable` sentence, which is not an error.
export async function loadDepositAddress(): Promise<DepositInfo> {
  const r = await apiGet<{ address: string | null; unavailable?: string | null; token_symbol?: string; token: string; chain_id: number; confirmations: number; min_deposit: string; min_withdrawal: string }>("/deposit-address");
  return {
    address: r.address ? (r.address as Address) : null,
    unavailable: r.unavailable ?? null,
    token: r.token as Address,
    tokenSymbol: r.token_symbol,
    chainId: r.chain_id,
    confirmations: r.confirmations,
    minDeposit: BigInt(r.min_deposit),
    minWithdrawal: BigInt(r.min_withdrawal),
  };
}

interface DepositJson {
  txhash: string;
  log_index: number;
  amount: string;
  block: number;
  confirmations: number | null;
  credited: boolean;
}

/// One address's deposit records (public, no sign-in needed), newest first.
/// Each row's `confirmations` is what the platform reports; rows already credited are null
/// (§71.111).
export async function loadDeposits(account: Address): Promise<DepositList> {
  const r = await apiGet<{ confirmations_required: number; deposits: DepositJson[] }>(`/deposits?address=${account.toLowerCase()}`);
  return {
    required: r.confirmations_required,
    deposits: r.deposits.map((d) => ({ txhash: d.txhash, logIndex: d.log_index, amount: BigInt(d.amount), block: d.block, confirmations: d.confirmations, credited: d.credited })),
  };
}

/// Every withdrawal by the signed-in wallet (sign-in required).
export async function loadWithdrawals(): Promise<Withdrawal[]> {
  const r = await apiGet<{ withdrawals: WithdrawalJson[] }>("/withdrawals");
  return r.withdrawals.map(withdrawalOf);
}

// ---------------------------------------------------------------- results

export const ZERO_ROOT = `0x${"0".repeat(64)}` as const;

/// The result file. Before returning it the endpoint has already checked the file's sha256 and its
/// root against the ledger's record (§69.7), and answers 409 when they disagree.
///   200 → ok; 404 NotSettled → none; 404 Pending (settled, file not published) → pending;
///   409 Mismatch → mismatch.
/// A network failure is thrown on for the caller to present — "could not read it" is never dressed
/// up as "awaiting publication".
export async function loadResults(poolId: number): Promise<ResultsState> {
  try {
    const json = await apiGet<Results>(`/results/${poolId}`);
    if (!Array.isArray(json.claims) || typeof json.root !== "string") return { kind: "mismatch", root: json.root ?? ZERO_ROOT };
    return { kind: "ok", results: json };
  } catch (e) {
    if (e instanceof ApiError) {
      const root = (typeof e.body.root === "string" ? e.body.root : ZERO_ROOT) as `0x${string}`;
      if (e.code === "NotSettled") return { kind: "none" };
      if (e.code === "Pending") return { kind: "pending", root };
      if (e.code === "Mismatch") return { kind: "mismatch", root };
    }
    throw e;
  }
}

// ---------------------------------------------------------------- formatting

/// USDT's smallest unit: USDT on BSC has 18 decimals and the ledger records it one for one
/// (§69.13).
export const USDT_DECIMALS = 18;
export const USDT_UNIT = 10n ** BigInt(USDT_DECIMALS);

/// A USDT amount typed by the user (up to 18 decimal places) → the smallest unit. Malformed input
/// returns null; nothing is rounded and nothing is guessed.
export function parseUsdt(text: string): bigint | null {
  const m = text.trim().replace(/,/g, "").match(/^(\d+)(?:\.(\d{0,18}))?$/);
  if (!m) return null;
  const whole = BigInt(m[1]);
  const frac = BigInt((m[2] ?? "").padEnd(USDT_DECIMALS, "0"));
  return whole * USDT_UNIT + frac;
}

/// USDT's smallest unit (18 decimals) → text for display: exactly two decimals, truncated, the
/// same as fmtUsdt2. Every account and amount on screen shows two decimal places, whole numbers
/// included (user request 2026-10-05).
export function fmtUsdt(v: bigint): string {
  return fmtUsdt2(v);
}

/// USDT's smallest unit → every significant decimal, no thousands separators. Only for filling an
/// input, where a truncated figure would change the amount submitted; display uses fmtUsdt.
export function fmtUsdtExact(v: bigint): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const frac = a % USDT_UNIT;
  const w = `${neg ? "-" : ""}${a / USDT_UNIT}`;
  return frac === 0n ? w : `${w}.${frac.toString().padStart(USDT_DECIMALS, "0").replace(/0+$/, "")}`;
}

/// USDT's smallest unit → exactly two decimal places (the leaderboard §71.21; the account page's
/// profit and loss and the earnings detail §71.24). Extra digits are truncated towards zero, never
/// rounded: a number on the board is never larger than what was actually credited, the same
/// definition as fmtReturn and core's format_return. Thousands separators as in fmtUsdt.
export function fmtUsdt2(v: bigint): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const cents = a / (USDT_UNIT / 100n);
  const whole = cents / 100n;
  const frac = (cents % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${whole.toLocaleString()}.${frac}`;
}

/// USDT's smallest unit → a whole number with no decimals (the prize plaque on the perfect-score
/// jackpot, where the user asked on 2026-09-15 for the "$1888" style, §71.66).
/// Truncated towards zero here too: the number on the plaque is never larger than the money
/// actually in the pool. Thousands separators as in fmtUsdt.
/// For the plaque only; amounts everywhere else keep their two decimals (§71.21).
export function fmtUsdt0(v: bigint): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  return `${neg ? "-" : ""}${(a / USDT_UNIT).toLocaleString()}`;
}

/// A settled return is a signed fixed-point integer at 1e12 (core/uploop/fixed.py RETURN_SCALE).
/// Shown to 0.01%, truncated towards zero, matching format_return.
export function fmtReturn(raw: string): string {
  const r = BigInt(raw);
  const neg = r < 0n;
  const abs = neg ? -r : r;
  const hundredths = (abs * 10_000n) / 1_000_000_000_000n;
  const whole = hundredths / 100n;
  const frac = (hundredths % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : "+"}${whole}.${frac}%`;
}

export function fmtDay(day: number): string {
  const [y, m, d] = splitDay(day);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/// On-chain seconds → local date and time text (the user sees their own timezone). `utc` is the
/// same moment's UTC clock time, appended only for daily / weekly matches (§71.35: those two lock
/// at 00:00 UTC; short matches run around the clock and carry no timezone wording). hourCycle h23:
/// midnight is written 00:00, not 24:00.
///
/// 🔴 The locale is pinned to "en-US" with a **spelled-out month** ("Sep 20, 14:30"): the site is
/// English throughout (§71.163), and a purely numeric date would read as 09/20 to an American and
/// 20/09 to everyone else — with match times this is not a difference anyone can afford to guess
/// at.
export function fmtWhenParts(sec: number): { local: string; date: string; time: string; utc: string } {
  const d = new Date(sec * 1000);
  return {
    local: d.toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    date: d.toLocaleDateString("en-US", { month: "short", day: "2-digit" }),
    time: d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    utc: d.toLocaleString("en-US", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  };
}

/// The local time; when `withUtc` is true (daily / weekly matches) "(UTC HH:MM)" is appended.
export function fmtWhen(sec: number, withUtc = false): string {
  const { local, utc } = fmtWhenParts(sec);
  return withUtc ? tr("{0} (UTC {1})", local, utc) : local;
}

/// The copy for a pool's lock / settlement time, with the format deciding whether the UTC clock
/// time is appended.
export function fmtPoolWhen(p: Pool, sec: number): string {
  return fmtWhen(sec, cadenceUtc(cadenceOf(p)));
}

export function countdown(sec: number): string {
  const s = Math.max(0, sec);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (d > 0) return tr("{0}d {1}h {2}m", d, h, m);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/// The clock that dividend settlement runs on: 15 minutes (set by the user on 2026-09-15, replacing
/// the original 7-day warm-up, §71.80).
export const SNAPSHOT_SEC = 900;

/// The next settlement point (seconds). Once staked, a certificate counts towards dividends from
/// the next quarter hour (:00 / :15 / :30 / :45), and every 15 minutes after that. Staking exactly
/// on the mark counts from the following slot — nobody gets to camp on the mark to snatch a
/// snapshot.
///
/// It is the same number site-wide, so there is no need to know when anyone staked (the custody
/// contract could not tell us anyway: it only emits events and has no view recording the time).
/// 🔴 The seconds passed in must come from `chainNow()` / `serverNow()`, never `Date.now()`.
export function nextSnapshot(sec: number): number {
  return Math.floor(sec / SNAPSHOT_SEC) * SNAPSHOT_SEC + SNAPSHOT_SEC;
}

/// Whether the US market is open: 09:30 ≤ t < 16:00 US Eastern, Monday to Friday.
///
/// ⚠️ Since 2026-09-15 this is **no longer used for unstaking** (the user removed the §37
/// market-hours gate; unstaking is available at any time). It is kept because it is part of the
/// arena's vocabulary: match scheduling and settlement times still have to speak in terms of the US
/// market calendar.
export function inSessionAt(sec: number): boolean {
  const wd = weekdayOf(dayOfSec(sec));
  if (wd === 0 || wd === 6) return false;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "numeric", minute: "numeric", hourCycle: "h23",
  }).formatToParts(new Date(sec * 1000));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const minute = g("hour") * 60 + g("minute");
  return minute >= 9 * 60 + 30 && minute < 16 * 60;
}
