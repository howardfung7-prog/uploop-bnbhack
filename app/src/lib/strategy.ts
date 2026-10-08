import { tr } from "./i18n";
/// Strategy composition and validation.
///
/// These rules have to match `validate()` in `core/uploop/settlement/types.py` and the contract's
/// entry checks line for line. If the three drift apart you get "the UI said it was fine, the
/// transaction was rejected" — and what the user sees is gas they paid for nothing. Read
/// DECISIONS.md §2 and §30 before changing anything here.
///
/// Three tiers (§30): 3 assets and 5 assets are fixed counts; the open tier takes 6–50. Direction
/// is free in every tier — no two-sided requirement, no concentration cap. The UI says "assets";
/// the code still says legs, matching the identifiers in the contract and the runner.

export type Side = "long" | "short";

export interface Leg {
  id: number;
  symbol: string;
  side: Side;
}

export type PoolKey = "three" | "five" | "open";

export interface PoolRules {
  key: PoolKey;
  name: string;
  /// Short code shared by the schedule, the builder and the entry dialog (the user's choice,
  /// 2026-09-05): 3T / 5T / NT.
  code: string;
  minLegs: number;
  /// 🔒 Matches the contract's `Competition._legBounds(kind)`: 3 / 5 / 6–50. `MAX_LEGS = 50`.
  maxLegs: number;
}

export const POOLS: Record<PoolKey, PoolRules> = {
  three: { key: "three", name: tr("3 assets"), code: "3T", minLegs: 3, maxLegs: 3 },
  five: { key: "five", name: tr("5 assets"), code: "5T", minLegs: 5, maxLegs: 5 },
  open: { key: "open", name: tr("OPEN"), code: "NT", minLegs: 6, maxLegs: 50 },
};

export const POOL_KEYS: PoolKey[] = ["three", "five", "open"];

/// Asset count → tier. 3 → the 3-asset tier, 5 → the 5-asset tier, 6–50 → the open tier;
/// anything else (0–2, 4, more than 50) fits no tier at all.
export function tierFor(legCount: number): PoolKey | null {
  if (legCount === POOLS.three.minLegs) return "three";
  if (legCount === POOLS.five.minLegs) return "five";
  if (legCount >= POOLS.open.minLegs && legCount <= POOLS.open.maxLegs) return "open";
  return null;
}

/// The tier in plain words: "3 assets" / "6–50 assets".
export function tierRange(rules: PoolRules): string {
  return rules.minLegs === rules.maxLegs ? tr("{0} assets", rules.minLegs) : tr("{0}–{1} assets", rules.minLegs, rules.maxLegs);
}

/// 🔒 Hard rule (the user, 2026-09-05, §39): a 3T match takes 3 assets, a 5T match 5, an NT match
/// 6–50. Wrong count → a sentence saying why; right count → null. The builder will not save, the
/// entry dialog will not offer it, and App checks once more before sending the transaction — all
/// three call this one function, on the same line as the contract's `_legBounds(kind)`
/// (TooFewLegs / TooManyLegs).
export function legCountIssue(n: number, rules: PoolRules): string | null {
  if (n >= rules.minLegs && n <= rules.maxLegs) return null;
  const need = rules.minLegs === rules.maxLegs ? tr("exactly {0} assets", rules.minLegs) : tr("{0}–{1} assets", rules.minLegs, rules.maxLegs);
  return n < rules.minLegs
    ? tr("A {0} match takes {1}; this one has {2}, so {3} more are needed", rules.code, need, n, rules.minLegs - n)
    : tr("A {0} match takes {1}; this one has {2}, so {3} too many", rules.code, need, n, n - rules.maxLegs);
}

/// Whether a set of assets fits a tier: right count, no duplicates. Equivalent to
/// `passes(validate(legs, rules))`.
export function fitsTier(legs: Leg[], rules: PoolRules): boolean {
  return passes(validate(legs, rules));
}

export const BPS_TOTAL = 10_000;

/// Equal weight → basis points. Every asset counts 1×; the weight follows from the asset count
/// alone.
///
/// The contract requires the weights to sum to exactly 10000 basis points, and 10000 rarely
/// divides evenly (5 assets gives exactly 2000, but 3 gives 3333.33…). The remainder goes to the
/// first asset — a fixed, reproducible rule. Handing the remainder out at random would give the
/// same set of assets different weights on two different submissions.
export function normalize(legs: Leg[]): Map<number, number> {
  const out = new Map<number, number>();
  if (legs.length === 0) return out;

  const each = Math.floor(BPS_TOTAL / legs.length);
  for (const l of legs) out.set(l.id, each);
  out.set(legs[0].id, each + (BPS_TOTAL - each * legs.length));
  return out;
}

export interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

export function validate(legs: Leg[], rules: PoolRules): Check[] {
  const n = legs.length;
  const fixed = rules.minLegs === rules.maxLegs;
  const each = n > 0 ? tr("equal weight, {0}% each", (BPS_TOTAL / n / 100).toFixed(1)) : "";

  const checks: Check[] = fixed
    ? [{
        label: tr("Asset count"),
        ok: n === rules.minLegs,
        detail: n === rules.minLegs
          ? tr("{0} assets, {1}", n, each)
          : n < rules.minLegs
            ? tr("{0} more needed (a {1} match takes exactly {2})", rules.minLegs - n, rules.code, rules.minLegs)
            : tr("{0} too many (a {1} match takes exactly {2})", n - rules.maxLegs, rules.code, rules.maxLegs),
      }]
    : [
        {
          label: tr("Minimum assets"),
          ok: n >= rules.minLegs,
          detail: n >= rules.minLegs
            ? tr("{0} assets, {1}", n, each)
            : tr("{0} more needed (an {1} match needs at least {2})", rules.minLegs - n, rules.code, rules.minLegs),
        },
        {
          label: tr("Maximum assets"),
          ok: n <= rules.maxLegs,
          detail: n <= rules.maxLegs
            ? tr("up to {0} allowed", rules.maxLegs)
            : tr("{0} over the limit (an {1} match allows at most {2})", n - rules.maxLegs, rules.code, rules.maxLegs),
        },
      ];

  checks.push({
    label: tr("No duplicates"),
    ok: new Set(legs.map((l) => l.id)).size === n,
    detail: tr("Each asset can be picked once only — you cannot hold it long and short at the same time"),
  });

  return checks;
}

export function passes(checks: Check[]): boolean {
  return checks.length > 0 && checks.every((c) => c.ok);
}
