import { allocateRanked, RANKED_RULE, rankingSlots } from "./prizes";
/// Demo data. Only enabled under `?demo=1`; the interface carries a loud banner and every write
/// action is disabled.
///
/// There is exactly one reason for it: you can look at the design without running a chain. It is
/// not a reading from the chain, and the interface must never let anyone take it for one — hence a
/// banner that cannot be dismissed, greyed-out buttons, and deliberately round numbers.
/// §14's "the numbers in the interface are read from the chain" still holds: in this mode the
/// interface does not claim to be reading a chain at all.
import { tr } from "./i18n";
import { parseUnits } from "viem";
import type { Address } from "viem";
import type { Holding, Lot, MintQuote, Ticker, Unit } from "./board";
import { chainNow } from "./chain-config";
import { assetClassOf, bareSym, uSym } from "./ticker";
import { BPS_TOTAL, ENTRY_CUTOFF, RAKE_BPS, USDT_UNIT, calendarDays, dayOfUtc, parseUsdt, shiftDay, utcMidnight, weekdayOf } from "./arena";
import type { Deposit, DepositInfo, DepositList, Entry, FieldRow, Funds, Jackpot, Kind, Pool, PoolLive, ResultRow, ResultsState, Standing, Stats, Withdrawal } from "./arena";
import type { Draft } from "./drafts";
import { rankFor } from "./points";
import type { PlayerPoints, PointsState } from "./points";
import type { Listing } from "./market";
import type { MemePool } from "./meme";
import type { Profile } from "./profile";
import type { Quotes } from "./quotes";
import type { RwaPrices } from "./rwa";
import type { Notice } from "./notices";
import type { Asset, AssetsState } from "./assets";
import type { Leg, Side } from "./strategy";

// Bare codes, the same shape as the chain's symbolOf; the display prefix is added by uSym.
const SYMBOLS = [
  "NVDA", "AAPL", "TSLA", "MSFT", "AMZN", "META", "GOOGL", "AMD", "NFLX", "AVGO",
  "TSM", "ASML", "BABA", "PDD", "JPM", "XOM", "LLY", "COST", "BTC", "ETH",
  "SOL", "BNB", "DOGE", "LINK", "ARM", "SMCI", "PLTR", "COIN", "MSTR", "UBER",
  "NKE", "DIS", "BA", "INTC", "SHOP", "SNOW", "XAU", "XAG", "WTI",
];
// Already live (somebody has staked): the first 12 equities + BTC/ETH/SOL/BNB + gold, 17 in all —
// enough to build demo strategies, with something in all three tiers.
// 13 have certificates outstanding but nobody staking; the rest are empty pools.
// Since §71.80 there is no "activation threshold" reading on chain any more (`Status` grades purely
// on whether anyone has staked), so these two tables are only the demo's script for "what is hot
// and what is cold" and no longer stand for any on-chain parameter.
const LIVE = new Set([...SYMBOLS.slice(0, 12), "BTC", "ETH", "SOL", "BNB", "XAU"]);
const RALLY = [...SYMBOLS.slice(12, 18), "DOGE", "LINK", "ARM", "SMCI", "PLTR", "COIN", "XAG"];

// Roughly how many tokens one certificate of each asset holds.
// Equities = Binance bStocks (b + the code, 18 decimals), crypto = the matching token. Anything not
// listed falls back to 0.05.
// ⚠️ This table is only the fallback for assets with **no price** in DEMO_PRICE; anything with a
// price is worked out live from "$10 ÷ the demo price" (see demoFaceTokens), or a card would carry
// "1 cert = 0.05 NVDAB ≈ $6.00" and "$10 ≈ 0.0833 NVDAB" at the same time and contradict itself.
const UNIT_TOKENS: Record<string, number> = {
  NVDA: 0.05, AAPL: 0.045, TSLA: 0.03, MSFT: 0.02, AMZN: 0.045, META: 0.015, GOOGL: 0.05, AMD: 0.06, NFLX: 0.008, AVGO: 0.03,
  TSM: 0.04, ASML: 0.012, BABA: 0.07, PDD: 0.08, JPM: 0.035, XOM: 0.09, LLY: 0.013, COST: 0.01,
  BTC: 0.0001, ETH: 0.0025, SOL: 0.05, BNB: 0.012, DOGE: 50, LINK: 0.5,
  ARM: 0.07, SMCI: 0.2, PLTR: 0.06, COIN: 0.03, MSTR: 0.03, UBER: 0.1, NKE: 0.13, DIS: 0.09, BA: 0.045, INTC: 0.4, SHOP: 0.07, SNOW: 0.045,
  XAU: 0.003, XAG: 0.25, WTI: 0.15,
};
const UNIT_SYMBOL: Record<string, string> = { BTC: "BTCB", XAU: "PAXG" };
/// The demo asset catalog (§71.31): in a real run it comes from `GET /assets` (the
/// core/data/bstocks.json seed plus the operator's listings). The addresses copied here are the
/// real, verified bStock contracts (symbol() / name() read on chain on 2026-09-13), so the demo's
/// equity pools use them as the underlying and "view pool" lines up with the list; INTC / SPCX /
/// QQQ are absent from DEMO_PRICE, which conveniently demonstrates a price of "—" and a pool that
/// has not opened.
const DEMO_BSTOCK: Record<string, { ticker: string; name: string; address: Address }> = {
  NVDA: { ticker: "NVDAB", name: "NVIDIA Corp", address: "0x02fca66c1d1afb4e2a7884261eb00f63598a7436" },
  AAPL: { ticker: "AAPLB", name: "Apple", address: "0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a" },
  TSLA: { ticker: "TSLAB", name: "Tesla, Inc.", address: "0x5b1910eaad6450e50f816082aa078c41f10c292f" },
  MSFT: { ticker: "MSFTB", name: "Microsoft", address: "0x80106cb3ead06659a5ad19df39d9b4733863b9b0" },
  AMZN: { ticker: "AMZNB", name: "Amazon", address: "0x1a4b499833a79a09ad7cf1d42d7dacf71e92eb00" },
  META: { ticker: "METAB", name: "Meta Platforms", address: "0x7425889fe94f9d693e8daefe88bcced6acfef4c0" },
  GOOGL: { ticker: "GOOGLB", name: "Alphabet", address: "0x3f53de71c126bdabae20f9cd64848d317f6c3238" },
  AMD: { ticker: "AMDB", name: "Advanced Micro Devices Inc", address: "0x75fd4cf6f8392e41e70391d60c90c0d5211603a1" },
  NFLX: { ticker: "NFLXB", name: "Netflix", address: "0xd6829ea836b6fa224d099d40e54b31262f874631" },
  AVGO: { ticker: "AVGOB", name: "Broadcom", address: "0x76682c454467b3a1150ad8b6a92fc5ee2c21d7ed" },
  TSM: { ticker: "TSMB", name: "TSMC", address: "0xab78b89b5bb00236be0b4b20704cbfa04efc711c" },
  ASML: { ticker: "ASMLB", name: "ASML", address: "0xfbfb4f79cfb4c34dcd7c82bdee5a0fa199b2e7f9" },
  BABA: { ticker: "BABAB", name: "Alibaba", address: "0x4ef9d3062c7f6eba4aae4990c5036598c6eff4ec" },
  ARM: { ticker: "ARMB", name: "Arm", address: "0xd42a79ebb7f527f40faecd196ffb47ad5e8d6f8c" },
  SMCI: { ticker: "SMCIB", name: "Super Micro Computer", address: "0x387dea1d2772d716d081a29116f3effa0ffe1f36" },
  PLTR: { ticker: "PLTRB", name: "Palantir Technologies", address: "0x0ca5d51d0277bd006fd9607d3e560785ebad8222" },
  COIN: { ticker: "COINB", name: "Coinbase", address: "0x585bde7c54abb5ccd7791f923d6c2187635f3952" },
  MSTR: { ticker: "MSTRB", name: "Strategy Inc.", address: "0xe87afb3076aeb0f9b14e368de8145ae6a2826a14" },
  INTC: { ticker: "INTCB", name: "Intel Corporation", address: "0xe614e2fc6c787035ff51f452e8e826bfd32d5283" },
  SPCX: { ticker: "SPCXB", name: "SpaceX", address: "0xbe9d156892e55e7154bcd3cb0fea677f9d3103e1" },
  QQQ: { ticker: "QQQB", name: "Invesqo QQQ", address: "0x205812cdbed920aff76c6580abd681a46d11efc7" },
};

/// How many tokens "$10 per certificate" comes to at the demo price. That is the rule written all
/// over the site (§52.1 / §71.54), so the demo data has to be genuinely worth $10: where there is a
/// demo price it is worked out as $10 ÷ price (to 3 significant figures — DEMO_PRICE runs from 0.2
/// to 100000, so the result lands between 0.0001 and 50, String() will not slip into scientific
/// notation and parseUnits can take it); where there is none it falls back to UNIT_TOKENS.
/// Both "how much each certificate in a batch holds" and the deposit quote are based on it (see
/// `demoBatchesOf` / `demoMints`).
function demoFaceTokens(symbol: string): bigint {
  const p = DEMO_PRICE[symbol];
  const tokens = p !== undefined ? Number((10 / p).toPrecision(3)) : UNIT_TOKENS[symbol] ?? 0.05;
  return parseUnits(String(tokens), 18);
}

function demoUnit(symbol: string, i: number): Unit {
  const cls = assetClassOf(symbol);
  const b = DEMO_BSTOCK[symbol];
  const unitSymbol = b ? b.ticker : UNIT_SYMBOL[symbol] ?? (cls === "equity" ? `b${symbol}` : symbol);
  return {
    underlying: b ? b.address : (`0x${(0xb0000 + i).toString(16).padStart(40, "0")}` as Address),
    // §71.80: there is no longer a fixed "how much each certificate holds" on chain; every batch
    // pins its own at mint time and carries it along (see `assetPerCert` in `demoBatchesOf`).
    // 0n here means "work it out live from the current price".
    unit: 0n,
    unitDecimals: 18,
    unitSymbol,
  };
}

/// Demo certificate contract addresses: the redeemable kind has **one instance per asset**, so
/// there is one per id. The `0xce27…` (cert) prefix is deliberate — it is obvious at a glance that
/// this is a demo address and not a real contract on chain.
function demoCert(id: number): Address {
  return `0xce27${"0".repeat(32)}${id.toString(16).padStart(4, "0")}` as Address;
}

export function isDemo(): boolean {
  return new URLSearchParams(location.search).get("demo") === "1";
}

export function demoBoard(): Ticker[] {
  return SYMBOLS.map((symbol, i) => {
    const id = i + 1;
    const u = demoUnit(symbol, i);
    // 🔴 "staked / issued" are never made up here; both are summed from the batch list (the rule
    // set in §71.78: a number is written down once). That way the four statistics on a card —
    // floor price, all listed, staked, issued — cannot contradict each other.
    const batches = demoBatchesOf(symbol, id);
    const pledged = batches.reduce((a, b) => a + b.pledged + b.elsePledged, 0n);
    const issued = batches.reduce((a, b) => a + b.pledged + b.elsePledged + b.wallet + b.listed + b.elseWallet, 0n);
    return {
      id,
      asset: u.underlying,
      cert: demoCert(id),
      mode: "redeem" as const,
      symbol: uSym(symbol),
      cls: assetClassOf(symbol),
      pledged,
      issued,
      // The same test as the real `loadBoard`: somebody staking = live, certificates outstanding
      // with nobody staking = certificates but no stake
      status: pledged > 0n ? "live" : issued > 0n ? "rallying" : "dark",
      ...u,
    };
  });
}

/// My staking positions: one card per asset, with a row per batch inside it (§71.80) — unstaking is
/// filled in batch by batch, and the interface has to show how much each certificate in each batch
/// holds.
export function demoHoldings(board: Ticker[]): Holding[] {
  return board
    .map((t) => ({ t, lots: demoLots(t, "pledged") }))
    .filter(({ lots }) => lots.length > 0)
    .map(({ t, lots }) => ({
      id: t.id,
      symbol: t.symbol,
      cert: t.cert,
      lots,
      // Dividends are weighted by the number of certificates (the user, 2026-09-15), so this total
      // is the weight itself
      total: lots.reduce((a, l) => a + l.n, 0n),
      underlying: t.underlying, unit: t.unit, unitDecimals: t.unitDecimals, unitSymbol: t.unitSymbol,
    }));
}

// ---------------------------------------------------------------- the arena demo

export const DEMO_ACCOUNT: Address = "0x1111111111111111111111111111111111111111";

const NAMES = [
  tr("LongShortLou"), tr("NightTapeHunter"), "beta_zero", tr("Uncle Gamma"), tr("LongOnly"), tr("KingOfFades"), "sigma", tr("TSM Faithful"),
  tr("LowVolLane"), tr("AllInAgain"), "Alpha Hunt", tr("StopLossManiac"), tr("ValueSchool"), "quant_9", tr("meme vanguard"), tr("HedgeFundIntern"),
];

/// The demo timetable (§42 / §71.35). Every price comes from Binance, and both equity tokens and
/// crypto trade 24 hours a day, so:
///   · a daily match runs every day (locks at 00:00 UTC, settles at 00:00 UTC the next day, reading
///     Binance daily candles), with no distinction between trading days and weekends;
///   · 15-minute / 1-hour / 4-hour matches roll on the clock around the clock, regardless of
///     calendar or timezone;
///   · a weekly match locks at 00:00 UTC on Monday and settles at 00:00 UTC the following Monday,
///     reading Binance weekly candles.
/// Past pools are settled (or voided and refunded for too few entrants); present and future ones
/// are taking entries.
/// Two more are added: a free daily match every day from today (the platform sponsors a 300 USDT
/// prize pool, §26), and one "event" match (pinned by demoFeatured, with its own sponsorship).
/// The buy-in each entry pays is a multiple of the minimum. The distribution is copied from STAKES
/// in core/demo.py: most people pay the minimum and a few put more up (§66, variable buy-ins).
/// Taken by (pool, index), so it is stable and replayable.
const STAKES = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 5, 5, 10];

/// The amount unit: USDT's smallest unit (18 decimals, §69.13). Every literal is written `n * U`;
/// no bare 6-digit numbers any more.
const U = USDT_UNIT;
const stakeMult = (poolId: number, i: number) => STAKES[(i * 7 + poolId * 3) % STAKES.length];

/// A pool's turnover = every entry added up, not "entrants × entry fee" (§66).
const demoGross = (poolId: number, entries: number, buyIn: bigint): bigint => {
  let sum = 0n;
  for (let i = 0; i < entries; i++) sum += buyIn * BigInt(stakeMult(poolId, i));
  return sum;
};

export function demoPools(): Pool[] {
  const now = chainNow();
  const todayUtc = dayOfUtc(now);
  const pools: Pool[] = [];
  let id = 0;
  const add = (locksAt: number, settlesAt: number, kind: Kind, buyIn: bigint, entries: number, short = false, sponsored = 0n) => {
    const past = settlesAt < now;
    const pid = id++;
    const n = short ? 7 : entries;
    // Entry closes 1 minute before the lock (§71.37); a voided match is refunded at that moment, so
    // settledAt is that moment.
    const entryClosesAt = locksAt - ENTRY_CUTOFF;
    pools.push({
      id: pid, day: dayOfUtc(settlesAt), kind, buyIn, locksAt, settlesAt, entryClosesAt,
      entries: n, participants: n, settlementRule: RANKED_RULE, rankingSlots: rankingSlots(n), settled: past && !short, refunding: short,
      settledAt: short ? entryClosesAt : past ? settlesAt : null,
      review: null, template: null, featured: null,
      gross: demoGross(pid, n, buyIn),
      sponsored,
    });
  };
  // Daily matches (§71.35): 00:00 UTC on the lock day → 00:00 UTC the next day, reading Binance
  // daily candles.
  const pushDaily = (lockDay: number, kind: Kind, buyIn: bigint, entries: number, short = false, sponsored = 0n) =>
    add(utcMidnight(lockDay), utcMidnight(shiftDay(lockDay, 1)), kind, buyIn, entries, short, sponsored);
  for (let off = -16; off <= 12; off++) {
    const lockDay = shiftDay(todayUtc, off);
    const locksAt = utcMidnight(lockDay);
    const past = utcMidnight(shiftDay(lockDay, 1)) < now;
    // One match per tier (Open / 5 assets / 3 assets).
    for (const kind of [2, 1, 0] as const) {
      const buyIn = [10n * U, 20n * U, 50n * U][kind]; // 10 / 20 / 50 USDT
      // Entrants: deterministic pseudo-random, with the occasional pool of fewer than 10 to
      // demonstrate a refund.
      // When off is negative JS's % gives a negative remainder (-12 % 23 === -12) and the count
      // would come out negative, so normalise it first.
      const seed = (((off * 7 + kind * 13) % 23) + 23) % 23;
      const entries = past || locksAt < now ? 28 + seed * 9 + kind * 20 : Math.max(0, 6 + seed * 2 - (off * 3));
      pushDaily(lockDay, kind, buyIn, entries, past && seed === 4);
    }
    // The free 3-asset match: only today and later — a past free match has no prize to claim and is
    // not worth demonstrating.
    if (off >= 0) pushDaily(lockDay, 0, 0n, Math.max(0, 41 - off * 5), false, 300n * U);
  }
  // Short matches: rolling around the clock. A 4-hour match every 4 hours (on the UTC hour, 0/4/8…),
  // a 1-hour match every hour, a 15-minute match every quarter.
  // 3-asset tier, 10 USDT. Only a stretch either side is generated — enough to see all three of
  // "taking entries → locked → settled".
  const hour = now - (now % 3600);
  const roll = (span: number, back: number, ahead: number, salt: number) => {
    const base = span >= 4 * 3600 ? hour - (hour % span) : span === 3600 ? hour : now - (now % 900);
    for (let k = -back; k <= ahead; k++) {
      const locksAt = base + k * span;
      const settlesAt = locksAt + span;
      const seed = ((k * 5 + salt) % 17 + 17) % 17;
      const entries = locksAt < now ? 21 + seed * 4 : Math.max(0, 8 + seed - k * 2);
      add(locksAt, settlesAt, 0, 10n * U, entries);
    }
  };
  roll(4 * 3600, 6, 6, 3);
  roll(3600, 3, 6, 11);
  roll(900, 2, 6, 7);
  // A 15-minute match just voided and refunded (only 7 entrants): entry close is pinned to the start
  // of each 3-minute box, so "refunded" sits in the schedule for exactly 1 minute and then goes,
  // with the next box producing another two minutes later — demonstrating §71.37 ("the frontend
  // drops it a minute after the refund") with a reading that does not change on every reload.
  const cut = now - (now % 180);
  add(cut + ENTRY_CUTOFF, cut + ENTRY_CUTOFF + 900, 0, 10n * U, 7, true);
  // The 1-hour match that settled on the last hour is turned into "under review" (§71.37 / §69.17):
  // automatic settlement did not finish within the deadline and a person has to check it.
  const stuck = pools.find((p) => p.locksAt === hour - 3600 && p.settlesAt === hour);
  if (stuck) { stuck.settled = false; stuck.review = tr("Demo: the settlement check did not finish within the deadline and is waiting on a person"); stuck.settledAt = null; }
  // Weekly matches (§71.35): lock at 00:00 UTC on Monday, settle at 00:00 UTC the next Monday,
  // reading Binance weekly candles. The last one is locked and running, the next is taking entries.
  const toMon = (1 - weekdayOf(todayUtc) + 7) % 7;
  const thisMon = shiftDay(todayUtc, toMon);
  const mon = utcMidnight(thisMon) > now ? thisMon : shiftDay(thisMon, 7);
  add(utcMidnight(shiftDay(mon, -7)), utcMidnight(mon), 2, 100n * U, 63);
  add(utcMidnight(mon), utcMidnight(shiftDay(mon, 7)), 2, 100n * U, 19);
  // The event match: a low buy-in 5-asset match the day after tomorrow. The last id, which is what
  // demoFeatured pins.
  const d2 = calendarDays(todayUtc, 3)[1] ?? shiftDay(todayUtc, 2);
  pushDaily(d2, 1, 10n * U, 88, false, 2_000n * U);
  return pools;
}

/// The perfect-score jackpot (§71.38) as demo readings: whole numbers, obviously fake. The next
/// payout is 00:00 UTC on Monday, the same rule as the ledger.
export function demoJackpot(account: Address | null): Jackpot {
  const now = chainNow();
  const todayUtc = dayOfUtc(now);
  const toMon = (1 - weekdayOf(todayUtc) + 7) % 7;
  const thisMon = shiftDay(todayUtc, toMon);
  const mon = utcMidnight(thisMon) > now ? thisMon : shiftDay(thisMon, 7);
  const week = 202600 + Math.max(1, Math.round((utcMidnight(mon) - 1_767_571_200) / (7 * 86_400)));
  return {
    week, accumulated: 1_240n * U, shares: 31, players: 24, nextPayoutAt: utcMidnight(mon),
    last: { week: week - 1, fund: 980n * U, shares: 28, perShare: 35n * U, dust: 0n, players: 22, paidAt: utcMidnight(mon) - 7 * 86_400 },
    mine: account ? { pending: 2, total: 5 } : null,
  };
}

/// The demo account's record (§71.38), matching its row in demoPoints: 23 paid matches, 9 in the
/// money, 2 perfect scores.
export function demoStats(): Stats {
  return { entries: 26, settled: 23, won: 9, allCorrect: 2 };
}

/// The demo account's arena balance. A whole number, obviously fake. One withdrawal in the queue.
export function demoFunds(): Funds {
  return { arena: 1_240n * U, pending: 1, withdrawable: 1_180n * U, locked: 60n * U, unlockAt: Math.floor(Date.now() / 1000) + 12 * 3600 };
}

/// The demo deposit address (§71.111: in the real environment there is one per person, asked for
/// from the custody platform on the spot). A fake address; no claim to be reading an endpoint.
export function demoDepositAddress(): DepositInfo {
  return {
    address: "0xdE905170000000000000000000000000000000dd" as Address,
    unavailable: null,
    token: "0x55d398326f99059fF775485246999027B3197955" as Address,
    chainId: 56, confirmations: 15, minDeposit: 1n * U, minWithdrawal: 1n * U,
  };
}

/// The demo deposit list: one just spotted, one at 11 of 15 confirmations, one already credited.
/// In the real environment the confirmation count is what the platform reports (§71.111); here it is
/// worked out from a fake chain head, purely so all three appearances can be seen.
export function demoDeposits(): DepositList {
  const tip = 52_000_000;
  const d = (i: number, amount: bigint, block: number, credited: boolean): Deposit => ({
    txhash: `0x${"d".repeat(60)}${i.toString(16).padStart(4, "0")}`, logIndex: 0, amount, block,
    confirmations: credited ? null : Math.max(0, tip - block + 1), credited,
  });
  return { required: 15, deposits: [d(3, 200n * U, tip, false), d(2, 40n * U, tip - 10, false), d(1, 1_000n * U, tip - 4_000, true)] };
}

/// Demo withdrawals: one under review, one already handed to the payer (§71.151, the rung that can
/// no longer be cancelled), one sent to a person for a second look (§71.126), one paid, one
/// cancelled — one of each of the five states, so they can all be seen in demo mode too.
export function demoWithdrawals(): Withdrawal[] {
  const now = chainNow();
  return [
    { id: 5, amount: 3_000n * U, state: "review", requestedAt: now - 300, txhash: null, sentAt: null, review: tr("A single withdrawal of 3000 USDT is over the 1000 USDT limit and has gone to a person to check"), platformId: null, submittedAt: null },
    { id: 4, amount: 100n * U, state: "queued", requestedAt: now - 600, txhash: null, sentAt: null, review: null, platformId: null, submittedAt: null },
    { id: 3, amount: 80n * U, state: "queued", requestedAt: now - 900, txhash: null, sentAt: null, review: null, platformId: "pw_demo_3", submittedAt: now - 840 },
    { id: 2, amount: 50n * U, state: "sent", requestedAt: now - 2 * 86_400, txhash: `0x${"5e".repeat(32)}`, sentAt: now - 2 * 86_400 + 90, review: null, platformId: "pw_demo_2", submittedAt: now - 2 * 86_400 + 30 },
    { id: 1, amount: 20n * U, state: "cancelled", requestedAt: now - 5 * 86_400, txhash: null, sentAt: null, review: null, platformId: null, submittedAt: null },
  ];
}

/// Pinned events: only the one "event" match above. The on-chain version goes through VITE_FEATURED
/// (§25).
export function demoFeatured(): Map<number, string> {
  return new Map([[demoPools().length - 1, tr("Genesis event match")]]);
}

/// The entry list: names, avatars, assets. The demo account has a strategy in every pool (entryId 0).
/// The address of the i-th person on the demo list (0 is always the demo account). demoEntries and
/// demoPoints share it, so the win rate / perfect-score rate on the list line up with the person
/// (§68).
export function demoPlayer(i: number): Address {
  return i === 0 ? DEMO_ACCOUNT : (`0x${(0x2222 + i * 0x1357).toString(16).padStart(4, "0")}${"0".repeat(32)}${(i * 977).toString(16).padStart(4, "0")}` as Address);
}

export function demoEntries(pool: Pool, board: Ticker[]): Entry[] {
  // Only pick from the live ones (matching the chain's "a constituent has to be live");
  // the number of assets has to match the tier (3 assets → 3, 5 assets → 5, Open → 6–50), or the
  // list would be breaking the demo's own rules.
  const pickFrom = board.filter((t) => t.status === "live");
  // Open matches spread between 6 and the cap by index, so every match shows both "they all fit" and
  // "they do not fit, expand to see"; the cap ought to be the contract's 50, but the demo board only
  // has these live assets and, after dedup, more would not conjure new codes.
  const openMax = Math.min(50, pickFrom.length);
  const legsOf = (i: number) => pool.kind === 2
    ? 6 + ((pool.id * 5 + i * 3) % Math.max(1, openMax - 5))
    : [3, 5][pool.kind];
  const n = Math.min(pool.entries, 60);
  // §68 entry times: spread evenly backwards from entry close (the lock, or now, whichever is
  // earlier), lower indexes entering first, with at least 1 minute between entries.
  const closeReg = Math.min(pool.locksAt, chainNow());
  const gap = Math.max(60, Math.floor(Math.min(pool.settlesAt - pool.locksAt, 6 * 3600) / (n + 1)));
  return Array.from({ length: n }, (_, i) => {
    const legsN = legsOf(i);
    const start = (i * 3 + pool.id) % pickFrom.length;
    const step = [1, 3, 5][(i + pool.id) % 3]; // coprime with 16, so no repeat within 10 steps
    const pick = Array.from({ length: legsN }, (_, k) => pickFrom[(start + k * step) % pickFrom.length]?.symbol ?? `T${k + 1}`);
    const syms = [...new Set(pick)];
    // Equal weights: the bps split evenly with the remainder going to the first (the same rule as
    // core's equal_weights); assets use the bare code (§69.4)
    const legs = syms.map((sym, k) => ({
      ticker: bareSym(sym),
      side: ((k + i) % 2 === 0 ? "long" : "short") as Side,
      weightBps: Math.floor(10_000 / syms.length) + (k === 0 ? 10_000 % syms.length : 0),
    }));
    const mine = i === 0;
    return {
      entryId: i,
      player: demoPlayer(i),
      legs,
      at: closeReg - (n - i) * gap,
      amount: pool.buyIn * BigInt(stakeMult(pool.id, i)),   // §66: a free match has a buyIn of 0, so this is 0 too
      name: mine ? "" : NAMES[(i + pool.id) % NAMES.length],
      avatar: (i * 3 + pool.id) % 8,
    };
  });
}

/// Demo settlement uses rank90_v2, including dense return tiers and no principal guarantee.
/// The demo account comes second in settled pools, so the "claim" button has something to show; one
/// match in every 7 is made to fall across the board, so the "everything returned in full" path can
/// be seen too.
export function demoResults(pool: Pool): ResultsState {
  if (!pool.settled) return { kind: "none" };
  const n = pool.entries;
  const lose = pool.id % 4 === 0;                                   // the demo account loses one match in 4, so a losing row can be seen
  const allNeg = pool.id % 7 === 3;                                 // everyone down → everything returned in full
  const addr = (e: number): Address => e === 0
    ? DEMO_ACCOUNT
    : (`0x${(0x2222 + e * 0x1357).toString(16).padStart(4, "0")}${"0".repeat(32)}${(e * 977).toString(16).padStart(4, "0")}` as Address);

  // Placing → strategy index. A genuine permutation: each of 0..n-1 appears exactly once.
  // Number 1 takes first place and the demo account (number 0) second; in the matches it loses, the
  // demo account is swapped to last.
  const order = Array.from({ length: n }, (_, e) => e);
  if (n >= 2) {
    order[0] = 1; order[1] = 0;
    if (lose && n >= 3) { order[1] = n - 1; order[n - 1] = 0; }
  }

  // Returns fall with the placing and cross zero: the top make money, the bottom lose it, the same
  // shape as a real match.
  const pctOf = (r: number) => allNeg
    ? -(40 + r * 7 + (pool.id % 5) * 3)                             // in units of 0.01%, all negative
    : 620 - r * 9 - (pool.id % 5) * 3 - Math.floor((r * 900) / Math.max(1, n));
  const retOf = (r: number) => BigInt(pctOf(r)) * 100_000_000n;     // 1e12 = 100%

  const stakeOf = (entryId: number) => pool.buyIn * BigInt(stakeMult(pool.id, entryId));
  const field: FieldRow[] = order.map((entryId, k) => ({
    entryId, player: addr(entryId), stake: stakeOf(entryId), strategyReturn: retOf(k + 1),
  }));

  // Same versioned economics as engine.settle(rank90_v2).
  const refunded = !field.some(r => r.strategyReturn > 0n) || new Set(field.map(r => r.strategyReturn)).size === 1;
  const zeroPrincipal = field.reduce((acc, r) => r.strategyReturn === 0n ? acc + r.stake : acc, 0n);
  const chargeable = pool.gross - zeroPrincipal;
  const rake = chargeable * BigInt(RAKE_BPS) / BigInt(BPS_TOTAL);
  const prize = chargeable - rake + pool.sponsored;
  const awards = refunded ? [] : allocateRanked(prize, field.map(r => ({ ...r, stake: pool.buyIn ? r.stake : 1n })), n);
  const byEntry = new Map(awards.map((a) => [a.entryId, a]));

  const claims: ResultRow[] = [];
  const standings: Standing[] = [];
  field.forEach((row, k) => {
    const a = byEntry.get(row.entryId);
    // Only exactly-zero entries refund principal in a normally settled match.
    const principal = !refunded && row.strategyReturn === 0n ? row.stake : 0n;
    const amount = refunded ? row.stake : principal + (a?.prizeAmount ?? 0n);
    const rank = a?.rank ?? k + 1;
    const player = addr(row.entryId);   // FieldRow.player is a plain string; this wants viem's Address
    standings.push({
      entry_id: row.entryId, player, rank,
      strategy_return: row.strategyReturn.toString(), prize_amount: amount.toString(),
      amount: row.stake.toString(), weight: (a?.weight ?? 0n).toString(),
      base_amount: (a?.baseAmount ?? 0n).toString(), ranking_amount: (a?.rankingAmount ?? 0n).toString(),
    });
    if (amount > 0n) {
      claims.push({
        entry_id: row.entryId, to: player, amount: amount.toString(), rank,
        strategy_return: row.strategyReturn.toString(), proof: [],
      });
    }
  });

  const root = `0x${(pool.id + 1).toString(16).padStart(64, "d")}` as `0x${string}`;
  return {
    kind: "ok",
    results: {
      pool_id: pool.id, root, claims, standings,
      refunded, settlement_rule: RANKED_RULE, participants: n, ranking_slots: rankingSlots(n),
    },
  };
}

/// Live asset quotes (§71): whole demo prices on the 1e8 scale; an asset that is not listed has no
/// quote and that cell on the card reads "—", which demonstrates that state too.
/// The change line (§71.8; since §71.56 always against 24 hours ago): DEMO_CHANGE holds percentages,
/// anything unlisted counts as 0.00%, and null = the opening price could not be had, so the change
/// line reads "—".
const DEMO_PRICE: Record<string, number> = {
  NVDA: 120, AAPL: 230, TSLA: 250, MSFT: 420, AMZN: 190, META: 560, GOOGL: 170, AMD: 150, NFLX: 700, AVGO: 180,
  TSM: 190, ASML: 800, BABA: 100, PDD: 120, JPM: 220, XOM: 110, LLY: 800, COST: 900,
  BTC: 100_000, ETH: 3_500, SOL: 200, BNB: 600, DOGE: 0.2, LINK: 20, ARM: 140, SMCI: 40, PLTR: 150, COIN: 300, MSTR: 350, UBER: 80, XAU: 3_300,
};
const DEMO_CHANGE: Record<string, number | null> = {
  NVDA: 2.35, AAPL: -1.2, TSLA: 5.5, MSFT: 0.42, AMZN: -0.87, META: 1.08, GOOGL: -2.6, BTC: 0.8, ETH: -3.15, SOL: 4.2, DOGE: 0, XAU: null,
};
export function demoQuotes(): Quotes {
  const now = chainNow();
  const quotes: Quotes = new Map();
  const put = (sym: string, pair: string, p: number, chg: number | null) => {
    const price = BigInt(Math.round(p * 1e8));
    const open = chg === null ? 0n : BigInt(Math.round((p * 1e8) / (1 + chg / 100)));
    quotes.set(sym, { pair, price, open, at: now });
  };
  for (const [sym, p] of Object.entries(DEMO_PRICE)) {
    put(sym, `${sym}USDT`, p, sym in DEMO_CHANGE ? DEMO_CHANGE[sym] : 0); // do not use ??: null has to survive, to demonstrate "—"
  }
  // The bStock tokens in the catalog (§71.31): on the real site, since §71.94, these go through the
  // **spot leg** (NVDAB → NVDABUSDT), which differs slightly from the equity perpetual by the basis.
  // The demo data does not model the basis — same price, same change — so that two numbers in a
  // screenshot cannot be mistaken for a bug; to see the basis, connect to the real endpoint.
  for (const [sym, b] of Object.entries(DEMO_BSTOCK)) {
    const p = DEMO_PRICE[sym];
    // Since §71.95 the spot leg is keyed on **the pair itself** (NVDABUSDT) rather than the token
    // code — it has to match the `pair` column in demoAssets() exactly, or every card in demo mode
    // turns into "—".
    if (p !== undefined) put(`${b.ticker}USDT`, `${b.ticker}USDT`, p, sym in DEMO_CHANGE ? DEMO_CHANGE[sym] : 0);
  }
  return quotes;
}

/// The on-chain bStock prices (§71.189, demo): what `GET /rwa-prices` would carry, keyed by the
/// real token contract. The real on-chain price sits a little off the Binance spot price, so the
/// demo gives each token a small fixed gap (−0.24% … +0.24%) to show what the card line looks like;
/// assets with no demo price have no row and the line is not drawn.
export function demoRwaPrices(): RwaPrices {
  const now = chainNow();
  const out: RwaPrices = new Map();
  Object.entries(DEMO_BSTOCK).forEach(([sym, b], i) => {
    const p = DEMO_PRICE[sym];
    if (p !== undefined) out.set(b.address.toLowerCase(), { price: BigInt(Math.round(p * (1 + ((i % 5) - 2) * 0.0012) * 1e8)), at: now - 12 });
  });
  return out;
}

/// The asset catalog (§71.31, demo): what `GET /assets` looks like; in a real run the operator lists
/// and delists from the ops console.
export function demoAssets(): AssetsState {
  const now = chainNow();
  const assets: Asset[] = Object.entries(DEMO_BSTOCK).map(([underlying, b]) => ({
    ticker: b.ticker, underlying, class: "equity", name: b.name, address: b.address, decimals: 18, pair: `${b.ticker}USDT`,
    // 🔴 Since §71.136 `pool` is **the card's switch**: a closed pool is taken off the staking page
    // by `closedPools()`. In the demo the on-chain path (`demoBoard`) has already produced a card
    // for every symbol in SYMBOLS, so these rows must be marked open or the staking page in demo
    // mode would go completely blank. Anything not in SYMBOLS (in the catalog only, not on chain)
    // stays closed — which is exactly how "in the catalog, pool not open yet" should look, and
    // `catalogBoard` will not put a shelf card out for it either (§71.51).
    status: "listed", sort: 0, note: "", pool: SYMBOLS.includes(underlying) ? "open" : "closed", updated_at: now - 3_600,
  }));
  assets.sort((a, b) => a.ticker.localeCompare(b.ticker));
  // The demo has no "token registered, then delisted while staked" row (that is a state the operator
  // produces from the ops console, §71.136)
  return { status: "ok", assets, delisted: [] };
}

// ---------------------------------------------------------------- certificates and the secondary market (§71.80)

/// The asset the demo account has a listing on (uNVDA): for seeing what "your listing / cancel"
/// looks like.
const MY_LISTING_TOKEN = 1;

/// How many certificates the demo account holds in its wallet (by asset id): the ones neither staked
/// nor listed.
const MY_WALLET: Record<number, number> = { 1: 2, 2: 3, 10: 1, 19: 2 };

/// How many the demo account has staked: asset id → how many in each batch.
/// uNVDA deliberately spans two batches, for seeing "one card per asset with a row per batch" and
/// unstaking batch by batch.
/// 🔴 The keys have to fall inside LIVE (only those are given several batches), or the counts land
/// nowhere.
const MY_PLEDGED: Record<number, number[]> = { 1: [3, 2], 4: [2], 10: [1], 19: [4] };

/// The demo **secondary market** fee: 250 bps = 2.5%, taken out of the seller's proceeds on a trade.
/// App reads it from here too, rather than each writing its own copy.
/// (Minting has charged no fee since 2026-09-15 and the number is gone from the contract, see
/// §71.84.)
export const DEMO_FEE_BPS = 250;

/// Demo batches (§71.80): **one mint = one batch = one number**, and certificates within a batch are
/// identical (they hold the same amount); different batches hold different amounts, because the
/// price at the moment of minting was different.
///
/// 🔴 The numbering **starts at 1 for every certificate contract**, so numbers collide across assets
/// — which is exactly what the user said on 2026-09-15: "each independent contract has its own
/// numbering, so duplicate numbers will exist". The demo data makes them collide on purpose, to
/// check that the interface always writes "asset + #number" as a pair (`certLabel` / `lotLabel`) and
/// nowhere writes a bare number on its own.
///
/// A batch's certificates split into five non-overlapping buckets, which add up to that batch's
/// "issued".
interface DemoBatch {
  batchId: bigint;
  /// How many tokens **each** certificate in this batch holds (smallest unit)
  assetPerCert: bigint;
  mintedAt: number;
  /// Staked by me
  pledged: bigint;
  /// Sitting in my wallet (neither staked nor listed)
  wallet: bigint;
  /// Listed on the market (the seller being somebody else or me)
  listed: bigint;
  /// Staked by other people
  elsePledged: bigint;
  /// Sitting in other people's wallets
  elseWallet: bigint;
}

/// Split `total` certificates across `count` batches: as evenly as possible, with the remainder
/// going to the first few.
function spread(total: number, count: number): number[] {
  return Array.from({ length: count }, (_, k) => Math.floor(total / count) + (k < total % count ? 1 : 0));
}

/// How many of an asset's certificates are listed on the market right now. Those with no listings
/// (nobody has ever staked, or the id divides by 3) are 0 — a few empty ones are left so the
/// "nobody has listed any yet" screen can be seen.
function demoListedCount(id: number, live: boolean): number {
  return !live || id % 3 === 0 ? 0 : 3 + (id % 5);
}

/// One asset's demo batches. It takes only "bare code + id" and does not depend on `Ticker`, so that
/// `demoBoard` can sum back over it.
///
/// 🔴 This is **the single source** for the certificate side: "staked / issued" on the board, my
/// stake, the certificates in my wallet, the order book and the floor price are all derived from it.
/// The rule set in §71.78: a number is written down once, so that a card can never again say
/// "issued 170 / all listed 8" and contradict itself.
function demoBatchesOf(symbol: string, id: number): DemoBatch[] {
  const live = LIVE.has(symbol);
  if (!live && !RALLY.includes(symbol)) return [];
  const i = id - 1;
  const face = demoFaceTokens(symbol);
  // An asset somebody has staked gets 2–4 batches (so that "different batches differ, one batch does
  // not" is visible); one with certificates outstanding but no stake gets 1
  const count = live ? 2 + (id % 3) : 1;
  const mine = MY_PLEDGED[id] ?? [];
  const minePledged = mine.reduce((a, b) => a + b, 0);
  const wallet = spread(live ? MY_WALLET[id] ?? 0 : 0, count);
  const listed = spread(demoListedCount(id, live), count);
  // Site-wide staking lands around 100–170 certificates, less the demo account's own
  const elsePledged = spread(live ? 102 + (17 - (i % 17)) * 4 - minePledged : 0, count);
  const elseWallet = spread(1 + (i % 4), count);
  const now = chainNow();
  return Array.from({ length: count }, (_, k) => ({
    batchId: BigInt(k + 1),
    // How much each holds: based on "$10 at the demo price", moved ±10% deterministically by asset
    // and batch. On the real chain that difference comes from the price at the moment of minting;
    // the demo uses the batch number as a stand-in for that moment, to the same effect.
    assetPerCert: (face * BigInt(90 + ((id * 7 + k * 31) % 21))) / 100n,
    mintedAt: now - (k + 1) * 3600 * (3 + (id % 5)),
    pledged: BigInt(mine[k] ?? 0),
    wallet: BigInt(wallet[k]),
    listed: BigInt(listed[k]),
    elsePledged: BigInt(elsePledged[k]),
    elseWallet: BigInt(elseWallet[k]),
  }));
}

/// The price at the moment of minting (USDT per whole token, 1e18 fixed point), worked back from
/// "how much each certificate in this batch holds": tokens held × price = a face value of $10. In
/// the demo these two numbers have to imply each other, or the same row would carry "0.0512 NVDAB
/// each" and a mint price that does not match it.
function demoMintPrice(u: Unit, assetPerCert: bigint): bigint {
  if (assetPerCert === 0n) return 0n;
  return (10n * 10n ** 18n * 10n ** BigInt(u.unitDecimals)) / assetPerCert;
}

/// Demo batch → `Lot`. `where` picks which bucket of the batch to take.
function demoLots(t: Ticker, where: "pledged" | "wallet"): Lot[] {
  return demoBatchesOf(bareSym(t.symbol), t.id)
    .map((b) => ({ b, n: where === "pledged" ? b.pledged : b.wallet }))
    .filter(({ n }) => n > 0n)
    .map(({ b, n }) => ({
      cert: t.cert, batchId: b.batchId, tickerId: t.id, symbol: t.symbol, n,
      assetPerCert: b.assetPerCert,
      mintPrice1e18: demoMintPrice(t, b.assetPerCert),
      mintedAt: b.mintedAt,
      underlying: t.underlying, unit: t.unit, unitDecimals: t.unitDecimals, unitSymbol: t.unitSymbol,
    }));
}

/// The certificates in the demo account's wallet: the batches neither staked nor listed (only
/// possible since the targeted relaxation in §69.16).
/// Both the "sell certificates" checkbox and "My Account → certificates in your wallet" read it.
export function demoWalletLots(board: Ticker[]): Lot[] {
  return board.flatMap((t) => demoLots(t, "wallet"));
}

/// The tokens each certificate in this batch holds, converted to USDT at the demo price — the basis
/// for a listing's asking price (an asset with no demo price converts to 0, and nobody lists those
/// anyway, so it never gets this far).
function demoCertUsdt(t: Ticker, assetPerCert: bigint): bigint {
  // `Ticker.symbol` carries the u prefix (uNVDA) while DEMO_PRICE is keyed on the bare code (NVDA) —
  // strip it first, the same as quoteOf.
  const p = DEMO_PRICE[bareSym(t.symbol)];
  if (p === undefined) return 0n;
  return (assetPerCert * BigInt(Math.round(p * 1e8)) * U) / (10n ** BigInt(t.unitDecimals) * 100_000_000n);
}

/// Ascending by asking price, ties broken by listing id — the same ordering as the real
/// `loadListings`.
/// 🔴 It has to be sorted: `floorsOf` takes the sorted row 0, and without sorting the "floor price"
/// would not match the first row of the order book.
function byPrice(a: Listing, b: Listing): number {
  return a.unitPrice < b.unitPrice ? -1 : a.unitPrice > b.unitPrice ? 1 : Number(a.id - b.id);
}

/// The secondary-market order book (demo, §41 / §71.80): **one listing = N certificates from one
/// batch at one unit price**, and a buyer can take just a few of them. The demo account has one
/// listing on uNVDA (id 1), for seeing what "your listing / cancel" looks like.
///
/// The floor price and "my listings" are not written out a second time: App runs `floorsOf` /
/// `myListings` over this same list (the same two functions the real chain uses), so the floor price
/// on a card and the first row inside must agree.
export function demoListings(board: Ticker[]): Listing[] {
  const rows = board.flatMap((t) => {
    const seller = (k: number): Address =>
      `0x${"5e11e4".padEnd(32, "0")}${(0xa11ce000 + t.id * 97 + k * 7919).toString(16).padStart(8, "0")}` as Address;
    // This asset's overall premium / discount (0.86–1.15), different for each — otherwise every
    // certificate would be about $10 and the floor prices would all bunch on one number.
    const bias = 86 + ((t.id * 13) % 30);
    const cent = U / 100n;
    const book: Listing[] = demoBatchesOf(bareSym(t.symbol), t.id)
      .map((b, k) => ({ b, k }))
      .filter(({ b }) => b.listed > 0n)
      .map(({ b, k }) => ({
        id: BigInt(t.id * 100 + k + 1),
        seller: seller(k),
        cert: t.cert,
        batchId: b.batchId,
        tickerId: t.id,
        remaining: b.listed,
        // The asking price per certificate = the current value of what each one in the batch holds ×
        // this asset's premium × another 6 points either way by batch, rounded to the cent (a real
        // person does not list with 8 decimal places). This rung deliberately does not track "how
        // much it holds": dividends go by certificate count, so a batch holding less still collects a
        // whole share, and the floor-price batch is not necessarily the one holding least
        // (a side effect of §71.80 that the demo should make visible).
        unitPrice: ((demoCertUsdt(t, b.assetPerCert) * BigInt(bias + ((t.id * 29 + k * 47) % 13) - 6)) / 100n / cent) * cent,
        assetPerCert: b.assetPerCert,
      }));
    book.sort(byPrice);
    // Once sorted, put the **second cheapest** in the demo account's name, for seeing "my listing /
    // cancel"; the floor row is left to somebody else, so both the floor row and the "you" row can be
    // seen.
    if (t.id === MY_LISTING_TOKEN && book.length > 1) book[1].seller = DEMO_ACCOUNT;
    return book;
  });
  return rows.sort(byPrice);
}

/// The demo deposit quote (§71.80): $10 per certificate at the demo price, with no minting fee
/// (§71.84).
/// Assets with no demo price (INTC, XAG and so on) are **deliberately left without a quote** — price
/// and conversion on the card read "—" and depositing is disabled, which also demonstrates the real
/// chain's "the oracle cannot give a price" path (§25 / §29).
export function demoMints(board: Ticker[]): Map<number, MintQuote> {
  const out = new Map<number, MintQuote>();
  for (const t of board) {
    const sym = bareSym(t.symbol);
    if (DEMO_PRICE[sym] === undefined) continue;
    out.set(t.id, {
      assetPerCert: demoFaceTokens(sym),
      faceValue: 10n * U,
      // What one token is worth in USDT (1e18) = the face value ÷ how many tokens each certificate
      // takes; the same source as demoFaceTokens, rather than a second made-up price
      spotPrice1e18: demoFaceTokens(sym) > 0n ? (10n * U * 10n ** 18n) / demoFaceTokens(sym) : 0n,
      paused: false,
    });
  }
  return out;
}

/// The demo account's points row: 23 paid matches, 412 points lost, 9 in the money, 2 perfect
/// scores, 690 USDT of lifetime buy-ins → 234 RP, enough for "Analyst".
/// The rank is always worked out by `rankFor` (§71.159) rather than hard-coded, so changing the
/// ladder moves this too.
export function demoPoints(): PointsState {
  /// In the demo everyone enters once per match, so matches played = entries.
  const row = (n: number, win: number, perfect: number, be: number, volUsdt: number, lostU: number): PlayerPoints => {
    const { rp, rank } = rankFor({ volumeUsdt: volUsdt, pools: n, wins: win, perfect });
    return {
      points: lostU, lost: (BigInt(lostU) * U).toString(), paid_entries: n, pools_played: n,
      volume: (BigInt(volUsdt) * U).toString(), in_money: win, break_even: be, all_correct: perfect,
      recent_in_money: Math.min(win, 20), recent_break_even: Math.min(be, 20), recent: Math.min(n, 20),
      rp, rank,
    };
  };
  return {
    kind: "ok",
    table: {
      version: "uploop.points.v2",
      as_of_day: 20260904,
      pools: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      players: {
        [DEMO_ACCOUNT]: row(23, 9, 2, 4, 690, 412),
        // Everyone else's history (the §68 win-rate / perfect-score columns). Demo data, generated
        // stably from the index; a few have deliberately never played a paid match, so the "—" path
        // can be seen too.
        ...Object.fromEntries(Array.from({ length: 59 }, (_, k) => k + 1).filter((i) => i % 11 !== 4).map((i) => {
          const n = 2 + (i * 7) % 38;
          const win = Math.floor((n * (18 + (i * 13) % 50)) / 100);
          const perfect = Math.floor((win * ((i * 5) % 40)) / 100);
          const be = Math.floor(win * 0.7);
          const lostU = (n - be) * 12 + (i % 5);
          return [demoPlayer(i).toLowerCase(), row(n, win, perfect, be, n * (10 + (i * 3) % 40), lostU)];
        })),
      },
    },
  };
}

/// An activity match in progress (§71.179): deterministic prices wandering around a per-asset open,
/// sampled at the same interval the backend uses, so the demo draws the same chart as the live site.
export function demoPoolLive(pool: Pool, entries: Entry[]): PoolLive {
  const now = chainNow();
  const step = Math.max(5, Math.floor((pool.settlesAt - pool.locksAt) / 180));
  const tickers = [...new Set(entries.flatMap((e) => e.legs.map((l) => l.ticker)))];
  const seed = (t: string) => [...t].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9973, pool.id + 7);
  const open = (t: string) => BigInt(Math.round((1 + seed(t) % 400) * 1e8 * (seed(t) % 3 === 0 ? 0.01 : 1)));
  const price = (t: string, at: number) => {
    const k = seed(t), f = (at - pool.locksAt) / (pool.settlesAt - pool.locksAt);
    const move = 0.02 * (Math.sin(f * 9 + k) - Math.sin(k)) + ((k % 7) - 3) * 0.004 * f;   // 0 at the lock
    return String(open(t) + BigInt(Math.round(Number(open(t)) * move)));
  };
  const until = Math.min(now, pool.settlesAt);
  const samples = [];
  for (let at = pool.locksAt; at <= until; at += step)
    samples.push({ at, prices: Object.fromEntries(tickers.map((t) => [t, price(t, at)])) });
  return {
    available: pool.kind !== 2 && now >= pool.locksAt, sampleInterval: step,
    opens: Object.fromEntries(tickers.map((t) => [t, String(open(t))])), samples,
    quotes: now <= pool.settlesAt ? Object.fromEntries(tickers.map((t) => [t, { price: price(t, now), at: now }])) : {},
    stale: false, staleAfter: 15,
  };
}

/// "My Account": the matches the demo account has entered — only the even-numbered ones, so that not
/// every match has it (entry 0 in demoEntries is always the demo account).
export function demoMyEntries(board: Ticker[]): Map<number, Entry[]> {
  const out = new Map<number, Entry[]>();
  for (const p of demoPools()) {
    if (p.id % 2 !== 0) continue;
    const e = demoEntries(p, board)[0];
    if (e) out.set(p.id, [e]);
  }
  return out;
}


// ---------------------------------------------------------------- the strategy and profile demo

/// The demo account's saved strategies: one NT, one 5T, one 3T, plus a legacy 4-asset strategy (§39:
/// 4 assets is no tier at all, the builder cannot save it, so it can only have come across from an
/// old version), so that all three states in the entry dialog — usable / another tier / wrong number
/// of assets — can be seen.
/// Every asset is taken from the live ones.
/// They live under their own localStorage key (see drafts.ts), so leaving demo mode does not pollute
/// the real strategies.
export function demoDrafts(): Draft[] {
  const leg = (i: number, side: Side): Leg => ({ id: i + 1, symbol: uSym(SYMBOLS[i]), side });
  const at = Date.now(); // a save time is not a countdown, so browser time is fine here
  return [
    { id: "demo-a", name: tr("Tech long/short A"), pool: "open", savedAt: at - 2 * 3_600_000,
      legs: [leg(0, "long"), leg(1, "long"), leg(3, "long"), leg(4, "long"), leg(9, "long"),
             leg(2, "short"), leg(5, "short"), leg(6, "short"), leg(7, "short"), leg(8, "short")] },
    { id: "demo-b", name: tr("Semiconductor hedge"), pool: "five", savedAt: at - 26 * 3_600_000,
      legs: [leg(0, "long"), leg(7, "long"), leg(9, "long"), leg(1, "short"), leg(2, "short")] },
    { id: "demo-c", name: tr("Weekend BTC three"), pool: "three", savedAt: at - 3 * 86_400_000,
      legs: [leg(18, "long"), leg(19, "long"), leg(21, "short")] },
    { id: "demo-d", name: tr("Legacy four assets (no matching format)"), pool: "open", savedAt: at - 5 * 86_400_000,
      legs: [leg(0, "long"), leg(2, "short"), leg(1, "long"), leg(3, "short")] },
  ];
}

/// The demo account's display name and avatar.
export const DEMO_PROFILE: Profile = { name: tr("LongShortLou"), variant: 3 };

// ---------------------------------------------------------------- the MEME Lab (§59 / §71.94)

/// Demo burn-pool ids start at 9001, deliberately clear of `demoBoard()`'s 1..N — on the real chain
/// the two share one board and ids cannot collide; in the demo they are built separately, so a
/// reserved range keeps React keys and busy ids from colliding either.
const MEME_ID0 = 9001;

/// The burn certificate contract is **one instance for the whole site** (unlike the redeemable kind,
/// which is one per asset), so there is only one demo address.
const BURN_CERT: Address = "0xb0c0000000000000000000000000000000000b0c";
/// That shared certificate's own code (on the real site = `BurnCertificate.symbol()` with the u
/// prefix, §71.136).
const BURN_CERT_SYM = "uBNC";

/// Seven burn pools. The prices are deliberately round, so the formula is easy to read: 1
/// certificate = the face value ÷ the quote, e.g. $10 ÷ $0.001 = 10,000 tokens (written on the card
/// as `$10 = 10,000 tokens`, §71.10).
///
/// Since §71.94 this page reads real contracts (`AssetRegistry` + `PriceOracle` + `BurnCertificate`),
/// so the demo data only makes up fields those contracts can give: no start / end time (the contract
/// has no such notion, only a pause switch), no "number of participating addresses" (not readable on
/// chain), no "dividends paid" (dividends are off-chain).
export function demoMemePools(): MemePool[] {
  // The quote and the face value are both in USDT's smallest unit (18 decimals, the same unit as
  // fmtUsdt); written as strings to avoid counting zeros.
  const usd = (text: string): bigint => parseUsdt(text)!;
  const mk = (k: number, symbol: string, price: bigint, issued: number,
    opts: { paused?: boolean; v2?: boolean; via?: string } = {}): MemePool => {
    const decimals = 18;
    const faceValue = 10n * U;
    const tokensPerCert = price > 0n ? (faceValue * 10n ** BigInt(decimals)) / price : 0n;
    return {
      id: MEME_ID0 + k,
      token: `0x${"e".repeat(36)}${k.toString(16).padStart(4, "0")}` as Address,
      cert: BURN_CERT,
      symbol, decimals, faceValue, price, tokensPerCert,
      // The certificate code: on the real site this reads the burn certificate contract's own
      // `symbol()` (§71.136). The burn certificate is **one instance for the whole site**, so
      // whichever MEME you burn you get the same certificate — in the demo every card has to carry
      // the same code too, since giving each its own (uBNBCAT / uSTOCKDOG) would bring back the
      // illusion that burning A gets you A.
      certSymbol: BURN_CERT_SYM,
      // The balance at the burn address: worked back from the number issued, plus a little more
      // (tokens sent there from outside our contract count too, as the copy explains)
      burned: tokensPerCert * BigInt(issued) + tokensPerCert / 3n,
      issued: BigInt(issued),
      // How many of those issued are locked in the staking contract: seven tenths in the demo, not
      // all of them (at 100% you could not see that "issued ≠ staked")
      pledged: (BigInt(issued) * 7n) / 10n,
      pool: `0x${"9".repeat(36)}${k.toString(16).padStart(4, "0")}` as Address,
      priceSource: opts.v2 ? "v2" : "v3",
      quoteSymbol: opts.via ?? null,
      paused: opts.paused ?? false,
    };
  };
  return [
    mk(0, "BNBCAT", usd("0.001"), 840),
    mk(1, "STOCKDOG", usd("0.0032"), 1_520),
    mk(2, "TSLAPEPE", usd("0.00042"), 430, { v2: true }),
    mk(3, "MSTRDOGE", usd("0.018"), 96),
    // A pool with minting paused: the burn button on the card is disabled, exercising the
    // `mintPaused` path
    mk(4, "COINAPE", usd("0.00007"), 0, { paused: true }),
    // A pool quoted against WBNB rather than USDT: the card needs the extra line "converted to USDT
    // via WBNB" (§71.119)
    mk(5, "NVDAFROG", usd("0.0025"), 310, { v2: true, via: "WBNB" }),
    // A MEME whose name is not in the Latin alphabet (§65): the interface does not put a `$` in front
    // of it, and search goes by the name as written.
    mk(6, tr("КОТ"), usd("0.00085"), 620),
  ];
}

/// The MEME burn certificates the demo account holds: one batch from each of two pools. Dividends go
/// by certificate count and are paid off chain, so all that matters here is "how many".
export function demoMemeLots(pools: MemePool[]): Lot[] {
  const pick = [
    { k: 0, batchId: 12n, n: 3n, ago: 6 * 86_400 },
    { k: 2, batchId: 31n, n: 5n, ago: 19 * 86_400 },
  ];
  const now = chainNow();
  return pick.flatMap(({ k, batchId, n, ago }) => {
    const p = pools[k];
    if (!p) return [];
    return [{
      // 🔴 §71.138: this batch's name is **the certificate contract's own** code (uBNC), not the
      // token that was burned ($BNBCAT) — on the real chain what `lotsOf()` writes into
      // `Lot.symbol` is `certName(t)`. Writing `tick(p.symbol)` in the demo would make a
      // certificate called $BNBCAT appear under "My Account → certificates in your wallet", and
      // that certificate does not exist: whichever MEME you burn, you get the same uBNC (§71.136).
      cert: p.cert, batchId, tickerId: p.id, symbol: p.certSymbol, n,
      assetPerCert: p.tokensPerCert, mintPrice1e18: p.price, mintedAt: now - ago,
      underlying: p.token, unit: 0n, unitDecimals: p.decimals, unitSymbol: p.symbol,
    }];
  });
}

/// The MEME burn certificates the demo account has **staked** (§71.139): one card per pool, and only
/// one is built here (the batch from burning $STOCKDOG).
///
/// 🔴 Why this has to be built separately: `demoMemeLots()` builds what is **in the wallet**, while
/// the "my stake" card goes through `Holding`. Without it the burn-type staking card would never
/// appear in the demo — and that card happens to carry three statements that are false for the burn
/// type ("holds X tokens in total", "takes part in bStock dividends", and the "≈ $x" at the right of
/// a batch row), which could be fixed and still never be seen.
/// uBNC has only been stakeable since §71.138; that path has just opened, so the demo has to follow.
export function demoMemeHoldings(pools: MemePool[]): Holding[] {
  const pick = [{ k: 1, batchId: 20n, n: 4n, ago: 9 * 86_400 }];
  const now = chainNow();
  return pick.flatMap(({ k, batchId, n, ago }) => {
    const p = pools[k];
    if (!p) return [];
    const lot: Lot = {
      cert: p.cert, batchId, tickerId: p.id, symbol: p.certSymbol, n,
      assetPerCert: p.tokensPerCert, mintPrice1e18: p.price, mintedAt: now - ago,
      underlying: p.token, unit: 0n, unitDecimals: p.decimals, unitSymbol: p.symbol,
    };
    return [{
      id: p.id,
      // As in the wallet column, the name is the certificate's own code (uBNC), not the token that
      // was burned (§71.138)
      symbol: p.certSymbol,
      cert: p.cert,
      lots: [lot],
      total: n,
      underlying: p.token, unit: 0n, unitDecimals: p.decimals, unitSymbol: p.symbol,
    }];
  });
}

/// Demo: burn pools → the burn-type rows on the board (§71.138).
///
/// On the real chain these rows are already in the same board as `loadBoard()` (one `burnBoard()`
/// filter and there they are); in the demo the burn pools are built separately by
/// `demoMemePools()`, so they are reshaped into `Ticker` here — the market page and the account page
/// both work off the board, and without these rows uBNC could neither be listed nor survive in
/// "certificates in your wallet", where it would be dropped as an orphan.
///
/// 🔴 `certSymbol` is the same uBNC on every row (the burn certificate contract is one instance for
/// the whole site), so cards are told apart by the subtitle "From burning $BNBCAT" (`burnFrom()`) —
/// the layout the user picked on 2026-09-18: "one card per MEME".
export function demoBurnBoard(pools: MemePool[]): Ticker[] {
  return pools.map((p) => ({
    id: p.id,
    asset: p.token,
    cert: p.cert,
    mode: "burn" as const,
    certSymbol: p.certSymbol,
    // Only a fallback: `certName()` drops back to this solely when the certificate code cannot be
    // read (in the demo it always can).
    symbol: uSym(p.symbol),
    // As on the real chain: the MEME family's category also goes through `assetClassOf` (the registry
    // has no category field), and no MEME code is in any table → it lands in "Stock". The
    // burn-type card does not show that label (it shows "From burning $XXX" instead), so being wrong
    // never surfaces; the real chain's algorithm is copied here rather than a second one invented for
    // the demo.
    cls: assetClassOf(p.symbol),
    pledged: p.pledged,
    issued: p.issued,
    status: p.pledged > 0n ? ("live" as const) : p.issued > 0n ? ("rallying" as const) : ("dark" as const),
    underlying: p.token,
    // The burn type has no "fixed amount on chain": how much each certificate burned is pinned by the
    // pool price at the moment of minting and written on the batch.
    unit: 0n,
    unitDecimals: p.decimals,
    unitSymbol: p.symbol,
  }));
}

/// Demo: uBNC's order book (§71.138). The `demoListings()` set can only produce the redeemable kind
/// (`demoBatchesOf` returns an empty array for MEME codes), so the burn-type rows have to be built
/// separately.
///
/// 🔴 uBNC's asking price is **not** derived from "tokens held × the current price" (the redeemable
/// kind goes through `demoCertUsdt()`): the tokens went into the burn address at the moment of
/// minting, so there is nothing redeemable behind this certificate and what it is worth depends only
/// on what "the dividend paid per certificate" is worth (§71.136). So these prices move around the
/// $10 face value and are not pegged to any MEME's current price — the demo has to make it visible
/// that the two families are priced on entirely different logic (§29).
export function demoBurnListings(pools: MemePool[]): Listing[] {
  const cent = U / 100n;
  const rows: Listing[] = [];
  pools.forEach((p, k) => {
    // A pool with nothing issued (COINAPE) naturally has no listings
    if (p.issued === 0n) return;
    const count = 1 + (k % 2);
    for (let j = 0; j < count; j++) {
      rows.push({
        id: BigInt(90_000 + k * 10 + j),
        seller: `0x${"b4c".padEnd(32, "0")}${(0xbeef0000 + k * 331 + j * 17).toString(16).padStart(8, "0")}` as Address,
        cert: p.cert,
        batchId: BigInt(4 + k * 9 + j * 5),
        tickerId: p.id,
        remaining: BigInt(2 + ((k * 3 + j * 7) % 9)),
        // The face value ±12%, rounded to the cent (a real person does not list with 8 decimal places)
        unitPrice: ((p.faceValue * BigInt(88 + ((k * 23 + j * 41) % 25))) / 100n / cent) * cent,
        // How much each certificate in this batch burned at the time: on the real chain from
        // `batch().assetPerCert`, in the demo moved around the current price
        assetPerCert: (p.tokensPerCert * BigInt(92 + ((k * 13 + j * 29) % 17))) / 100n,
      });
    }
  });
  // The demo account lists one too, for seeing what "your listing / cancel" looks like on uBNC. The
  // batch number matches the one it holds in `demoMemeLots` (12): part of a batch in the wallet and
  // part of it on the market is perfectly normal on chain.
  const mine = pools[0];
  if (mine && mine.issued > 0n) {
    rows.push({
      id: 99_001n, seller: DEMO_ACCOUNT, cert: mine.cert, batchId: 12n, tickerId: mine.id,
      remaining: 2n, unitPrice: 10n * U + 40n * cent, assetPerCert: mine.tokensPerCert,
    });
  }
  return rows.sort(byPrice);
}


/// Demo notices (§71.41): the home page notice bar and `#notices` share this set. The content only
/// describes things this site actually does; no made-up "new listing" or "airdrop" events.
export function demoNotices(): Notice[] {
  const now = chainNow();
  const hour = 3600;
  return [
    { id: 5, text: tr("From 12:00 UTC this Wednesday there will be additional 1-hour matches; the schedule has been updated."), level: "info", at: now - 2 * hour },
    { id: 4, text: tr("Entries were paused for about 6 minutes while the Binance market data endpoint was unstable. Service is back and the matches that did not open have since been opened."), level: "warn", at: now - 26 * hour },
    { id: 3, text: tr("uAMD and uNFLX now have stakers and can be picked into a strategy."), level: "info", at: now - 3 * 24 * hour },
    { id: 2, text: tr("Last Monday's 00:00 UTC Perfect Score Jackpot has been shared out by the number of shares; the payout record is on My Account."), level: "info", at: now - 5 * 24 * hour },
    { id: 1, text: tr("The asset market is live: certificates can be listed for sale, and the fee rate is whatever is read from the chain."), level: "info", at: now - 9 * 24 * hour },
  ];
}
