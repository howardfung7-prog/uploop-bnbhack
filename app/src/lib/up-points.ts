import { API_BASE, arenaConfigured } from "./api";

/// UP is a separately published ledger. Legacy loss points and RP must never be relabelled UP.
export const UP_VERSION = "uploop.up.v2";
export const UP_RULES = "up_v1";
export const UP_SCALE = 1_000_000n;
const USDT = 10n ** 18n;

export const UP = {
  participation: 2, loss: 5, ranking: [2, 5, 8], rankingMatches: 3, rankingAccounts: 10,
  onboarding: 10,
} as const;

export type UpSource = "participation" | "ranking" | "loss" | "staking" | "onboarding";
export const UP_SOURCES: UpSource[] = ["participation", "ranking", "loss", "staking", "onboarding"];
export interface UpRecord {
  lifetimeTotal: bigint;
  volume: bigint;
  breakdown: Record<UpSource, bigint>;
  publishedAt: number;
}
export type UpState =
  | { kind: "loading" | "not-published" | "unavailable" | "missing" }
  | { kind: "ok"; record: UpRecord };

function object(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function integer(v: unknown): bigint | null {
  // Bounded canonical integers; no floats, exponents, signs or accidental JS precision loss.
  return typeof v === "string" && /^(0|[1-9]\d{0,59})$/.test(v) ? BigInt(v) : null;
}
function timestamp(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= 253402300799;
}

export function parseUpPoints(json: unknown, account: string): UpState {
  if (!/^0x[0-9a-fA-F]{40}$/.test(account) || !object(json)
    || json.version !== UP_VERSION || json.rules_version !== UP_RULES
    || !timestamp(json.published_at) || !object(json.players)) return { kind: "unavailable" };
  const key = account.toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(json.players, key)) return { kind: "missing" };
  const p = json.players[key];
  if (!object(p) || !object(p.breakdown)) return { kind: "unavailable" };
  const lifetimeTotal = integer(p.lifetime_up), volume = integer(p.eligible_volume);
  if (lifetimeTotal === null || volume === null) return { kind: "unavailable" };
  const breakdown = {} as Record<UpSource, bigint>;
  for (const source of UP_SOURCES) {
    const amount = integer(p.breakdown[source]);
    if (amount === null) return { kind: "unavailable" };
    breakdown[source] = amount;
  }
  if (UP_SOURCES.reduce((s, k) => s + breakdown[k], 0n) !== lifetimeTotal) return { kind: "unavailable" };
  return { kind: "ok", record: {
    lifetimeTotal, volume, breakdown,
    publishedAt: json.published_at,
  } };
}

export async function loadUpPoints(account: string, signal?: AbortSignal): Promise<UpState> {
  try {
    const res = await fetch(import.meta.env.VITE_UP_POINTS_URL ?? (arenaConfigured() ? `${API_BASE}/up-points?address=${encodeURIComponent(account.toLowerCase())}` : "/results/up-points.json"), { cache: "no-store", signal });
    if (res.status === 404) return { kind: "not-published" };
    if (!res.ok) return { kind: "unavailable" };
    return parseUpPoints(await res.json(), account);
  } catch {
    return { kind: "unavailable" };
  }
}

/// Truncate display only; no rounding up into the next reward threshold.
export function formatUp(value: bigint): string {
  const whole = (value / UP_SCALE).toLocaleString("en-US");
  return `${whole}.${((value % UP_SCALE) / 10_000n).toString().padStart(2, "0")}`;
}

export function entryUpTier(volume: bigint): { multiplier: string; next: bigint | null } {
  if (volume >= 5000n * USDT) return { multiplier: "3", next: null };
  if (volume >= 2000n * USDT) return { multiplier: "2", next: 5000n * USDT };
  if (volume >= 500n * USDT) return { multiplier: "1.5", next: 2000n * USDT };
  return { multiplier: "1", next: 500n * USDT };
}

/// Only called by the explicit demo route. These numbers are never a fallback for live data.
export function demoUpPoints(account: string): UpState {
  return parseUpPoints({
    version: UP_VERSION, rules_version: UP_RULES, published_at: Math.floor(Date.now() / 1000),
    players: { [account.toLowerCase()]: {
      lifetime_up: "2864500000", eligible_volume: "2450000000000000000000",
      breakdown: { participation: "92000000", ranking: "144000000", loss: "68500000", staking: "2550000000", onboarding: "10000000" },
    } },
  }, account);
}
