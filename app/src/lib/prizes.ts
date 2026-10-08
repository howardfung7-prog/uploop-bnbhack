/// rank90_v2 integer allocation; mirrored by core/uploop/settlement/ranked.py.
export const BPS_TOTAL = 10_000;
/// A pool with fewer entrants than this refunds in full and takes no fee. Matches
/// Competition.MIN_ENTRIES.
export const MIN_ENTRIES = 10;
/// The share unit used for display: parts per million. The amounts are computed straight from the
/// weights by integer division of the prize pool, never through ppm — in a thousand-player match
/// the 1 ppm truncation would accumulate into a drift of one part in a thousand.
export const SHARE_TOTAL = 1_000_000;
/// The fixed-point scale of a return (RETURN_SCALE in core/uploop/fixed.py). 1e12 = 100%.
export const RETURN_SCALE = 1_000_000_000_000n;

/// a × b / d, truncated toward zero. BigInt division already truncates toward zero, matching
/// Python's `idiv` (not `//`: the two round differently on negatives). A weight product can reach
/// 1e24, so BigInt is required.
export function mulDiv(a: bigint, b: bigint, d: bigint): bigint {
  return (a * b) / d;
}

/// One sorted match: return descending, entry_id ascending. `stake` is the buy-in actually paid
/// for that entry.
export interface FieldRow {
  entryId: number;
  player: string;
  strategyReturn: bigint;
  stake: bigint;
}

export interface Award {
  entryId: number;
  player: string;
  /// Dense return tier; equal returns share a tier.
  rank: number;
  /// Stake times the return-tier coefficient.
  weight: bigint;
  /// Share of the prize pool in parts per million, for display.
  prizePpm: number;
  prizeAmount: bigint;
}

/// ppm → a percentage string (for tables).
export function fmtShare(ppm: number): string {
  return `${(ppm / 10_000).toFixed(2)}%`;
}

// All arena matches use rank90_v2.
export const RANKED_RULE = "rank90_v2";
export const WEIGHT_SCALE = 10n ** 18n;
export const rankingSlots = (participants: number) => Math.max(3, Math.ceil(participants / 10));
export interface RankedAward extends Award { baseAmount: bigint; rankingAmount: bigint }

export function rankCoefficient(rank: number): bigint {
  if (!Number.isSafeInteger(rank) || rank < 1) throw new Error("rank must be positive");
  let lo = 0n, hi = WEIGHT_SCALE + 1n;
  const power = WEIGHT_SCALE ** 4n;
  while (lo + 1n < hi) {
    const mid = (lo + hi) / 2n;
    if (BigInt(rank) * mid ** 4n <= power) lo = mid;
    else hi = mid;
  }
  return lo;
}

function splitRanked(total: bigint, weights: bigint[]): bigint[] {
  if (total < 0n || weights.some(w => w < 0n)) throw new Error("negative allocation");
  const den = weights.reduce((a, b) => a + b, 0n);
  if (!den) {
    if (total) throw new Error("positive pool without weights");
    return weights.map(() => 0n);
  }
  const amounts = weights.map(w => total * w / den);
  const remainders = weights.map(w => total * w % den);
  const order = weights.map((_, i) => i).sort((a, b) => remainders[a] === remainders[b]
    ? a - b : remainders[a] > remainders[b] ? -1 : 1);
  const dust = Number(total - amounts.reduce((a, b) => a + b, 0n));
  for (const i of order.slice(0, dust)) amounts[i] += 1n;
  return amounts;
}

export function allocateRanked(prizePool: bigint, field: FieldRow[], participants: number): RankedAward[] {
  const descending = (a: bigint, b: bigint) => a === b ? 0 : a > b ? -1 : 1;
  const tiers = [...new Set(field.filter(r => r.strategyReturn > 0n && r.stake > 0n).map(r => r.strategyReturn))].sort(descending);
  if (!tiers.length) return [];
  const groups = tiers.map(r => field.filter(row => row.strategyReturn === r && row.stake > 0n));
  const k = rankingSlots(participants);
  const gcd = (a: bigint, b: bigint): bigint => { while (b) { const t = a % b; a = b; b = t; } return a; };
  let common = 1n;
  for (let j = 1n; j <= BigInt(k); j++) common = common * j / gcd(common, j);
  const rankingPool = prizePool - prizePool * 90n / 100n;
  const slots = splitRanked(rankingPool, Array.from({ length: k }, (_, i) => common / BigInt(i + 1)));
  const basePool = prizePool - slots.slice(0, tiers.length).reduce((a, b) => a + b, 0n);
  const coefficients = tiers.map((_, i) => rankCoefficient(i + 1));
  const bases = splitRanked(basePool, groups.map((group, i) => group.reduce((a, r) => a + r.stake, 0n) * coefficients[i]));
  const byId = new Map<number, [bigint, bigint]>();
  groups.forEach((group, i) => {
    const players = [...new Set(group.map(r => r.player.toLowerCase()))].sort();
    const wallets = players.map(p => group.filter(r => r.player.toLowerCase() === p).sort((a, b) => a.entryId - b.entryId));
    const stakes = wallets.map(w => w.reduce((a, r) => a + r.stake, 0n));
    const walletBase = splitRanked(bases[i], stakes);
    const walletBonus = splitRanked(slots[i] ?? 0n, stakes);
    wallets.forEach((wallet, j) => {
      const amounts = wallet.map(r => r.stake);
      const b = splitRanked(walletBase[j], amounts), bonus = splitRanked(walletBonus[j], amounts);
      wallet.forEach((row, x) => byId.set(row.entryId, [b[x], bonus[x]]));
    });
  });
  const display = [...new Set(field.map(r => r.strategyReturn))].sort(descending);
  return field.map(row => {
    const [baseAmount, rankingAmount] = byId.get(row.entryId) ?? [0n, 0n];
    const prizeAmount = baseAmount + rankingAmount;
    const tier = tiers.indexOf(row.strategyReturn);
    return { entryId: row.entryId, player: row.player, rank: display.indexOf(row.strategyReturn) + 1,
      weight: tier >= 0 && row.stake > 0n ? row.stake * coefficients[tier] : 0n,
      prizePpm: prizePool ? Number(prizeAmount * BigInt(SHARE_TOTAL) / prizePool) : 0,
      prizeAmount, baseAmount, rankingAmount };
  });
}
