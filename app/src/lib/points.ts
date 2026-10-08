/// Reputation comes from regular settlement files; race performance comes from
/// committed 15-minute receipts through /points. Neither count changes prize money.
///
/// 🔴 The real ladder and RP algorithm live in `core/uploop/settlement/points.py`. The live site
///    reads the `rank` already computed in points.json; the copy here exists only so demo mode can
///    make up data offline. Changing a number means changing it in both places.
import { tr } from "./i18n";
import { API_BASE } from "./api";
import type { Address } from "viem";

export interface PlayerPoints {
  points: number;
  lost: string;            // USDT, smallest unit
  paid_entries: number;
  in_money: number;
  break_even: number;
  /// Paid matches where every asset direction was right (§68, the perfect rate). Older tables do
  /// not have this field.
  all_correct?: number;
  recent_in_money: number;
  recent_break_even: number;
  recent: number;
  /// The four below exist only in v2 (§71.159). An older table (v1) does not have them, and then
  /// the UI shows no rank rather than inventing one.
  rank?: Rank;
  rp?: number;
  /// How many **matches** were played — several entries in one match still count as one.
  pools_played?: number;
  volume?: string;         // cumulative buy-in, USDT smallest unit
}

/// The table version that carries ranks. An older table (v1) has titles but no ranks, and reading
/// one means showing nothing at all.
export const POINTS_V2 = "uploop.points.v2";

export interface PointsTable {
  version: string;
  as_of_day: number | null;
  pools: number[];
  players: Record<string, PlayerPoints>;
  race_rates?: Record<string, { settled: number; won: number; all_correct: number }>;
  daily_rates?: Record<string, { settled: number; won: number; all_correct: number }>;
}

export type Rank = "Rookie" | "Apprentice" | "Analyst" | "Strategist" | "Veteran" | "Master" | "Oracle";

/// The ladder: [name, RP required, in-the-money matches required, perfect matches required].
/// Identical to RANKS in points.py, down to the last digit.
export const RANKS: [Rank, number, number, number][] = [
  ["Rookie", 0, 0, 0],
  ["Apprentice", 50, 0, 0],
  ["Analyst", 150, 0, 0],
  ["Strategist", 350, 5, 0],
  ["Veteran", 600, 15, 1],
  ["Master", 900, 30, 5],
  ["Oracle", 1200, 60, 15],
];
export const RANK_NAMES: Rank[] = RANKS.map((r) => r[0]);

/// How the four RP axes convert, and where each one stops. Only the first two can be bought with
/// money, and together they cap at 500 RP — short of what Strategist asks for.
export const RP = {
  volumePer: 50, volumeCap: 200,     // every 50 USDT of cumulative buy-in → 1 RP
  pool: 3, poolCap: 300,             // every match entered → 3 RP
  win: 8, winCap: 400,               // every time in the money → 8 RP
  perfect: 40, perfectCap: 400,      // every perfect match → 40 RP
};

/// The tooltip shown on hover.
export function rankHow(r: Rank): string {
  const row = RANKS.find((x) => x[0] === r);
  if (!row) return "";
  const [, rp, win, perfect] = row;
  const bits = [tr("{0} RP", rp)];
  if (win) bits.push(tr("{0} in the money", win));
  if (perfect) bits.push(tr("{0} perfect", perfect));
  return rp === 0 ? tr("Where everyone starts: play a paid match and reputation begins") : tr("Requires: {0}", bits.join(" · "));
}

export type PointsState =
  | { kind: "ok"; table: PointsTable }
  | { kind: "none" };   // never published, or could not be read

export async function loadPoints(): Promise<PointsState> {
  const url = import.meta.env.VITE_POINTS_BASE ?? (API_BASE ? `${API_BASE}/points` : "/results/points.json");
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { kind: "none" };
    const json = (await res.json()) as PointsTable;
    if (typeof json !== "object" || json === null || typeof json.players !== "object") return { kind: "none" };
    if (API_BASE && import.meta.env.VITE_POINTS_BASE && url !== `${API_BASE}/points`) {
      const live = await fetch(`${API_BASE}/points`, { cache: "no-store" });
      if (!live.ok) return { kind: "none" };
      const liveTable = (await live.json()) as PointsTable;
      json.race_rates = liveTable.race_rates;
      json.daily_rates = liveTable.daily_rates;
    }
    return { kind: "ok", table: json };
  } catch {
    return { kind: "none" };
  }
}

export function pointsOf(state: PointsState, account: Address | string | null): PlayerPoints | null {
  if (state.kind !== "ok" || !account) return null;
  return state.table.players[account.toLowerCase()] ?? null;
}

/// Regular paid entries and settled race cycles each contribute one observation.
/// A race win requires positive total return; perfect requires all three legs > 0.
export interface Rates { n: number; win: number; perfect: number | null }
export function ratesOf(state: PointsState, player: Address | string): Rates | null {
  const p = pointsOf(state, player);
  const race = state.kind === "ok" ? state.table.race_rates?.[player.toLowerCase()] : undefined;
  const daily = state.kind === "ok" ? state.table.daily_rates?.[player.toLowerCase()] : undefined;
  const n = (p?.paid_entries ?? 0) + (race?.settled ?? 0) + (daily?.settled ?? 0);
  if (n === 0) return null;
  return {
    n,
    win: (p?.in_money ?? 0) + (race?.won ?? 0) + (daily?.won ?? 0),
    perfect: p && p.paid_entries > 0 && p.all_correct === undefined ? null : (p?.all_correct ?? 0) + (race?.all_correct ?? 0) + (daily?.all_correct ?? 0),
  };
}

/// This player's rank (§71.159). Three cases, handled separately, because the UI treats them very
/// differently:
///
/// 1. The table could not be read at all (never published / 404 / offline) → null, show nothing.
///    🔴 Falling back to Rookie here would be **unacceptable**: a real Master would watch himself
///    drop to Rookie for the few seconds the network is down, and the promise that "a rank never
///    goes down" would be broken on the spot. Better to show nothing.
/// 2. The table was read, it is v2, and this player is not in it (no paid match yet) → Rookie.
///    That is not invented data (§25): all three thresholds on the bottom rung are 0, nobody can
///    be lower, and `rank()` in the backend's `points.py` returns the same answer from an empty
///    history.
/// 3. The table is the old v1 (no rank field) → null. Someone in an old table may already be a
///    Master, and a missing field must not push them back down to Rookie.
export function rankOf(state: PointsState, account: Address | string | null): Rank | null {
  if (state.kind !== "ok" || !account) return null;
  const row = state.table.players[String(account).toLowerCase()];
  if (row) {
    const r = row.rank;
    return r && RANK_NAMES.includes(r) ? r : null;
  }
  return state.table.version === POINTS_V2 ? RANKS[0][0] : null;
}

/// Compute RP and rank from the four axes. **Demo mode only** — the live site always trusts the
/// backend's `rank` field.
export function rankFor(x: { volumeUsdt: number; pools: number; wins: number; perfect: number }): { rp: number; rank: Rank } {
  const rp = Math.min(RP.volumeCap, Math.floor(x.volumeUsdt / RP.volumePer))
    + Math.min(RP.poolCap, x.pools * RP.pool)
    + Math.min(RP.winCap, x.wins * RP.win)
    + Math.min(RP.perfectCap, x.perfect * RP.perfect);
  // Climb from the bottom rung and stop at the first one out of reach — the ladder is monotonic,
  // so failing one rung means failing every rung above it.
  let rank: Rank = RANKS[0][0];
  for (const [name, needRp, needWin, needPerfect] of RANKS) {
    if (rp < needRp || x.wins < needWin || x.perfect < needPerfect) break;
    rank = name;
  }
  return { rp, rank };
}
