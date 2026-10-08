import { apiGet, apiPost, apiErrorText, ApiError } from "./api";
import { tr } from "./i18n";
import type { Side } from "./strategy";
import type { PerformanceSample } from "./race-performance";

export type RaceActionKind = "enter" | "rebuy" | "topup" | "switch" | "exit";
export interface RaceAction {
  id: number; round_id: number; kind: RaceActionKind; state: string; effective_at: number; amount: string;
  protection_count?: number | null;
  result?: { reason?: string; refunded?: string; amount?: string; protection_refund?: string } | null;
}
export interface RaceCycleLeg {
  ticker: string; symbol?: string; side: Side; open: string; close: string; return_points: string;
}
export interface RaceCycle {
  consumed_protection?: "none" | "free" | "paid";
  cycle_start: number; cycle_end: number; return_points: string; contribution: string; status: string; legs: RaceCycleLeg[];
}
export interface RaceLive {
  cycle_start: number; cycle_end: number; at: number | null; stale: boolean;
  stale_after?: number;
  return_points: string | null; legs: RaceCycleLeg[];
  samples?: PerformanceSample[];
}
export interface RaceSeat {
  id: number; player: string; name?: string; status: string; strategy_name: string;
  legs: { ticker: string; side: Side }[];
  total_return: string; contribution: string; invested: string;
}
export interface RaceHistory {
  round_id: number; seat: RaceSeat; cycles: RaceCycle[];
}
export interface RaceSnapshot {
  room?: number; entry_amount?: string; protection_amount?: string;
  operations_paused?: boolean;
  round: {
    id: number; status: string; phase: string; progress: string; prize_pool: string; entry_total?: string;
    rules_version?: number; pool_balance?: string; platform_fee?: string;
    winner_budget?: string; exit_paid?: string; projected_carryover?: string;
    distributable: string; carryover: string; next_settlement_at: number;
    operation_closes_at: number; updated_at: number; market_ready: boolean; pause_reason?: string | null;
  };
  counts: { registered: number; entries: number; eliminated: number; eliminated_entries: number; alive: number; pending: number; exited: number };
  me: {
    live?: RaceLive | null;
    seat: RaceSeat | null; estimated_prize: string; exit_quote: string; protection_balance: string;
    protections_remaining: number; topups_used: number; switches_used: number; switches_available: number;
    balance?: string; cycles?: RaceCycle[]; history?: RaceHistory[];
    allowed_actions: Partial<Record<RaceActionKind | "cancel", boolean>>;
    pending_actions: RaceAction[]; recent_actions?: RaceAction[];
  } | null;
  leaderboard: RaceSeat[];
  eliminated_leaderboard?: RaceSeat[];
  last_result: { round_id: number; progress: string; paid: string; carryover: string; reason?: string;
    rules_version?: number; prize_pool?: string; platform_fee?: string; exit_paid?: string;
    /// The 14% fee (`platform_fee`) split 7:1:3:3: stakers, jackpot, referral rebates, platform
    stakers_fee?: string; jackpot_fee?: string; referral_fee?: string; platform_share?: string;
    payouts?: {player: string; amount: string}[] } | null;
}

export async function loadRace(address: string | null, room = 10): Promise<RaceSnapshot> {
  const data = await apiGet<RaceSnapshot>("/race", { address, room: String(room) });
  // Do not accidentally render an older API's empty response as a live, empty prize pool.
  if (!data.round || !data.counts || !Array.isArray(data.leaderboard) || !/^\d+$/.test(data.round.prize_pool)
      || !/^\d+(\.\d+)?$/.test(data.round.progress)) throw new Error(tr("Race data is unavailable. Please retry."));
  return data;
}
export function submitRace(body: Record<string, unknown>) { return apiPost("/race/actions", body); }
export function cancelRace(id: number, key: string, room = 10) { return apiPost(`/race/actions/${id}/cancel`, { idempotency_key: key, room }); }

export function raceActionLabel(kind: RaceActionKind): string {
  return { enter: tr("Enter race"), rebuy: tr("Rebuy"), topup: tr("Add protection"), switch: tr("Change strategy"), exit: tr("Exit entire position") }[kind];
}
export function raceError(error: unknown): string {
  const messages: Record<string, string> = {
    RACE_FROZEN: tr("The final minute is locked. Wait for settlement."),
    FROZEN_WINDOW: tr("The final minute is locked. Wait for settlement."),
    CLOSED: tr("The table has closed at 80 points."),
    TABLE_CLOSED: tr("The table has closed at 80 points."),
    BAD_STRATEGY: tr("Choose three different supported assets and a direction for each."),
    STALE_ROUND: tr("A new race has started. Review your request again."),
    UNAVAILABLE: tr("Race operations are unavailable. Please retry shortly."),
    PAUSED: tr("Race paused. Operations will resume with the market."),
    TOPUP_LIMIT: tr("All four protection top-ups have been used in this race."),
    SWITCH_LIMIT: tr("No strategy changes available in this race."),
    OPERATION_CLOSED: tr("The final minute is locked. Wait for settlement."),
    SEALED: tr("The table has closed at 80 points."),
    DISABLED: tr("Race operations are unavailable. Please retry shortly."),
    MARKET_UNAVAILABLE: tr("Race paused. Operations will resume with the market."),
    SWITCH_UNAVAILABLE: tr("No strategy changes available in this race."),
    STRATEGY_LOCKED: tr("Strategy changes close at 90 points."),
    ALREADY_IN: tr("You already have an active or queued position."),
    EXITED_ROUND: tr("You have exited this race and cannot re-enter it."),
    EXIT_MIN_PLAYERS: tr("Early exit requires at least 5 active players in this room, both when requesting and after settlement."),
    NO_SEAT: tr("An active position is required for this request."),
    ACTION_PENDING: tr("This request is already queued. Cancel it before submitting another."),
    IDEMPOTENCY_CONFLICT: tr("The request has changed. Review and submit it again."),
    NOT_FOUND: tr("This request is no longer available. Refresh the race."),
  };
  return error instanceof ApiError && messages[error.code] ? messages[error.code] : apiErrorText(error);
}
