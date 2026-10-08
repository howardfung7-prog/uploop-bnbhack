/// Fake data for the status bench (§71.109).
///
/// Division of labour: **anything that looks normal** reuses the factories in `lib/demo.ts` (the very ones `?demo=1` uses),
/// and this file only writes the **departures** — empty, broken, unconfigured, signed out, short of funds, paused, phase-pinned.
/// That way "normal" on the bench and "normal" in demo mode are always the same data and cannot drift apart.
///
/// 🔴 Times are always written as an "offset from now"; never pin a timestamp.
/// The components read the clock themselves and repaint every second (Arena.tsx / Home.tsx / Jackpot.tsx / Account.tsx all keep a 1s setInterval,
/// and `chainNow()` is just `Date.now()/1000`), so a pinned locksAt slides into a different phase after a few minutes
/// and the case's name is wrong on the spot. Every constructor below therefore reads now **when it is called**, not when the module loads.

import type { Address } from "viem";
import { ENTRY_CUTOFF, USDT_UNIT, dayOfUtc } from "../lib/arena";
import type {
  DepositInfo, DepositList, Entry, Featured, Funds, Jackpot, JackpotState,
  Phase, Pool, PoolLive, ResultsState, Stats, Withdrawal,
} from "../lib/arena";
import type { ArenaSource } from "../components/Arena";
import type { AssetsState } from "../lib/assets";
import type { PointsState } from "../lib/points";
import type { Holding, Lot, MintQuote, Ticker } from "../lib/board";
import type { Quotes } from "../lib/quotes";
import type { Floor, Listing } from "../lib/market";
import type { MemePool } from "../lib/meme";
import type { Notice } from "../lib/notices";
import type { Profile } from "../lib/profile";
import { chainNow } from "../lib/chain";
import {
  DEMO_ACCOUNT, DEMO_PROFILE, demoAssets, demoBoard, demoDepositAddress, demoDeposits,
  demoEntries, demoFeatured, demoFunds, demoHoldings, demoJackpot,
  demoListings, demoMemePools, demoMints, demoMyEntries, demoNotices, demoPoints, demoPoolLive, demoPools,
  demoQuotes, demoResults, demoStats, demoWalletLots, demoWithdrawals,
} from "../lib/demo";

const U = USDT_UNIT;
const now = (): number => Math.floor(chainNow());

// ---------------------------------------------------------------- Baseline (= the demo-mode set)

/// The whole board is cached once: `demoBoard()` builds new objects every call, and Market / Account keep Maps keyed by `id`,
/// so within one case it has to be the same copy or the filtering will not line up.
let boardCache: Ticker[] | null = null;
export const board = (): Ticker[] => (boardCache ??= demoBoard());

export const quotes = (): Quotes => demoQuotes();
export const assetsOk = (): AssetsState => demoAssets();
export const pointsOk = (): PointsState => demoPoints();
export const fundsOk = (): Funds => demoFunds();
export const notices = (): Notice[] => demoNotices();
export const holdings = (): Holding[] => demoHoldings(board());
export const lots = (): Lot[] => demoWalletLots(board());
export const mints = (): Map<number, MintQuote> => demoMints(board());
export const listings = (): Listing[] => demoListings(board());
export const memePools = (): MemePool[] => demoMemePools();
/// The dividend count per asset had only one source, the retired bStock index, so it is null ("—").
export const dividends = (): Map<string, number> | null => null;
export const featured = (): Featured => demoFeatured();
export const profile = (): Profile => DEMO_PROFILE;
export const account: Address = DEMO_ACCOUNT;
export const pools = (): Pool[] => demoPools();

/// The floor-price table is derived from the listings (the same path as App.tsx:458, `floorsOf`).
export const floors = (): Map<number, Floor> => {
  const out = new Map<number, Floor>();
  for (const l of listings()) {
    const cur = out.get(l.tickerId);
    if (!cur || l.unitPrice < cur.unitPrice) out.set(l.tickerId, { unitPrice: l.unitPrice, batchId: l.batchId, assetPerCert: l.assetPerCert });
  }
  return out;
};

// ---------------------------------------------------------------- Departures: empty / unconfigured / failing

export const emptyBoard = (): Ticker[] => [];
export const emptyPools = (): Pool[] => [];
export const emptyQuotes = (): Quotes => new Map();
export const emptyNotices = (): Notice[] => [];
export const emptyHoldings = (): Holding[] => [];
export const emptyLots = (): Lot[] => [];
export const emptyListings = (): Listing[] => [];
export const emptyFloors = (): Map<number, Floor> => new Map();
export const emptyMints = (): Map<number, MintQuote> => new Map();
export const emptyMemePools = (): MemePool[] => [];
export const emptyEntries = (): Map<number, Entry[]> => new Map();

export const assetsUnconfigured = (): AssetsState => ({ status: "unconfigured", assets: [], delisted: [] });
export const assetsError = (): AssetsState => ({ status: "error", assets: [], delisted: [] });
export const pointsNone = (): PointsState => ({ kind: "none" });

/// Balance at 0: the entry dialog takes the "not enough balance · deposit first" branch.
export const fundsZero = (): Funds => ({ arena: 0n, pending: 0, withdrawable: 0n, locked: 0n, unlockAt: null });
/// Just short: cannot afford a 10 USDT match, and the interface has to work out the shortfall.
export const fundsShort = (): Funds => ({ arena: 3n * U, pending: 0, withdrawable: 3n * U, locked: 0n, unlockAt: null });
/// A withdrawal under review: the balance card has to say "N withdrawals under review".
export const fundsPending = (): Funds => ({ arena: 128n * U, pending: 2, withdrawable: 128n * U, locked: 0n, unlockAt: null });

export const jackpotOk = (): JackpotState => ({ kind: "ok", jackpot: demoJackpot(account) as Jackpot });
export const jackpotNone = (): JackpotState => ({ kind: "none" });
export const jackpotError = (): JackpotState => ({ kind: "error", message: "Could not load the jackpot" });

const ROOT = "0xabc1230000000000000000000000000000000000000000000000000000000def" as `0x${string}`;
export const resultsPending = (): ResultsState => ({ kind: "pending", root: ROOT });
export const resultsMismatch = (): ResultsState => ({ kind: "mismatch", root: ROOT });
export const resultsNone = (): ResultsState => ({ kind: "none" });

// ---------------------------------------------------------------- Phase-pinned matches

const PHASE_ID: Record<Phase, number> = {
  open: 9001, closing: 9002, locked: 9003, review: 9004, short: 9005, settled: 9006, refunding: 9007,
};

/// Builds a match pinned to a given phase. For how the phase is decided see `phaseOf` in `arena.ts`:
///   refunding → settled → now < entryClosesAt(open) → entries < 10(short) → review → now < locksAt(closing) → locked
/// so every branch has to set "all the conditions ahead of it" correctly too; changing one field is not enough.
export function poolAt(phase: Phase, over: Partial<Pool> = {}): Pool {
  const n = now();
  const SPAN = 3600;
  const p: Pool = {
    id: PHASE_ID[phase], day: dayOfUtc(n + SPAN * 2), kind: 0, buyIn: 10n * U,
    locksAt: n + SPAN, settlesAt: n + SPAN * 2, entryClosesAt: n + SPAN - ENTRY_CUTOFF,
    entries: 42, settled: false, refunding: false, settledAt: null,
    review: null, template: null, featured: null,
    gross: 520n * U, sponsored: 0n,
  };
  /// Move the lock time and the entry cutoff and settlement follow (the spacing of the three moments is fixed, §71.37)
  const at = (locksAt: number) => {
    p.locksAt = locksAt;
    p.entryClosesAt = locksAt - ENTRY_CUTOFF;
    p.settlesAt = locksAt + SPAN;
    p.day = dayOfUtc(locksAt + SPAN);
  };
  switch (phase) {
    case "open": break;
    // Entry has closed (entryClosesAt passed 20 seconds ago) but it is not locked yet (locksAt is 40 seconds out)
    case "closing": at(n + 40); break;
    case "locked": at(n - 900); break;
    case "review": at(n - SPAN - 300); p.review = "Lab: settlement reconciliation did not finish in time, awaiting a manual check"; break;
    case "short": at(n + 30); p.entries = 7; p.gross = 70n * U; break;
    case "settled": at(n - SPAN - 600); p.settled = true; p.settledAt = n - 600; break;
    // 🔴 settledAt is deliberately left null: a real match is only listed while `now - settledAt < 60` (REFUND_LINGER, §71.37),
    //    so pinning an actual moment would make this case disappear while you are looking at it. What is wanted here is
    //    "what the refunded state looks like"; the "disappears by itself after a minute" behaviour is not acted out in this cell.
    case "refunding": at(n - 600); p.entries = 7; p.refunding = true; p.gross = 70n * U; break;
  }
  return { ...p, ...over };
}

/// All seven phases laid out at once (scanned top to bottom in one schedule).
export const allPhases = (): Pool[] =>
  (["open", "closing", "locked", "review", "short", "settled", "refunding"] as Phase[]).map((ph) => poolAt(ph));

/// The pinned match (`pinLabel` reads the featured table, not the pool.featured field, see arena.ts:279).
export const featuredOne = (): Featured => new Map([[PHASE_ID.open, "Featured"]]);

// ---------------------------------------------------------------- Notices / pauses

export const noticeInfo = (): Notice[] => [{ id: 1, text: "Lab: an ordinary notice, for looking at an info-level banner's ground colour and line height.", level: "info", at: now() - 600 }];
export const noticeWarn = (): Notice[] => [{ id: 2, text: "Lab: a warning notice, for looking at a warn-level banner.", level: "warn", at: now() - 120 }];

// ---------------------------------------------------------------- ArenaSource

/// A source carrying full data (= the demo-mode set, the demo branch at App.tsx:233).
export function sourceOk(): ArenaSource {
  const b = board();
  return {
    entries: async (id) => { const p = pools().find((x) => x.id === id); return p ? demoEntries(p, b) : demoEntries(poolAt("settled", { id }), b); },
    results: async (id) => { const p = pools().find((x) => x.id === id); return p ? demoResults(p) : { kind: "none" }; },
    myEntries: async () => demoMyEntries(b),
    live: async (id) => { const p = pools().find((x) => x.id === id) ?? poolAt("locked", { id }); return demoPoolLive(p, demoEntries(p, b)); },
    depositAddress: async () => demoDepositAddress(),
    deposits: async () => demoDeposits(),
    withdrawals: async () => demoWithdrawals(),
    stats: async () => demoStats(),
  };
}

/// Nothing can be read: empty lists, results none, every record at 0. Each page's empty state is fed by this one.
export function sourceEmpty(): ArenaSource {
  return {
    entries: async () => [],
    results: async () => ({ kind: "none" }),
    myEntries: async () => new Map(),
    live: async (): Promise<PoolLive> => ({ available: false, sampleInterval: 60, opens: {}, samples: [], quotes: {}, stale: true, staleAfter: 15 }),
    depositAddress: async () => demoDepositAddress(),
    deposits: async (): Promise<DepositList> => ({ required: 15, deposits: [] }),
    withdrawals: async (): Promise<Withdrawal[]> => [],
    stats: async (): Promise<Stats> => ({ entries: 0, settled: 0, won: 0, allCorrect: 0 }),
  };
}

/// The custody backend is unconfigured / cannot hand out an address for the moment (§71.111): the endpoint **does not fail**, it returns address: null plus a sentence in plain words.
/// This one exists to watch "no empty address is shown" — this is a funds page, and an empty address box is far more dangerous than an error message.
export function sourceNoAddress(): ArenaSource {
  return {
    ...sourceOk(),
    depositAddress: async (): Promise<DepositInfo> => ({
      ...demoDepositAddress(), address: null, unavailable: "Deposits are unavailable right now, please try again shortly",
    }),
    deposits: async (): Promise<DepositList> => ({ required: 15, deposits: [] }),
  };
}

/// Every read throws: the components' catch branches (nearly all of them "treat it as empty") become visible.
///
/// 🔴 It waits 350ms before throwing, on purpose (§71.110). It used to throw immediately — and throwing immediately means the
/// "loading" state does not exist for a single frame, so the bench displays the failed state while the state before failure can never
/// be checked; pressing "Retry" also gives no sign of whether it actually ran again (clear error → fail again get batched by React into one render).
/// A real network failure takes time anyway, so being slow is the faithful simulation.
export function sourceFail(): ArenaSource {
  const boom = (): Promise<never> =>
    new Promise((_, reject) => setTimeout(() => reject(new Error("Lab: this endpoint fails on purpose")), 350));
  return { entries: boom, results: boom, myEntries: boom, live: boom, depositAddress: boom, deposits: boom, withdrawals: boom, stats: boom };
}

/// Results always return one given ResultsState — for the pending / mismatch branches, neither of which has ever shown its face.
export function sourceResults(state: ResultsState): ArenaSource {
  const s = sourceOk();
  return { ...s, results: async () => state };
}

// ---------------------------------------------------------------- No-ops

/// The bench only looks, it does not click: every write operation gets a function that does nothing.
/// Not `alert`, which would cover the screen; if you really want to confirm a click landed, look at the console.
export const noop = (...args: unknown[]): void => { if (args.length) console.info("[lab] write ignored", args); };
export const noopAsync = async (): Promise<void> => { /* the bench sends no transactions */ };
