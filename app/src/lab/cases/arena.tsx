/// Index strategy contest · Arena (§71.109).
///
/// One match pinned to each of the seven phases (`phaseOf`, arena.ts:153), plus the handful of switches at component level:
/// unconfigured / not signed in / entries paused / busy / empty schedule.
/// `ResultsState`'s pending and mismatch are also laid out on their own — to this day neither branch has ever
/// appeared in a browser (`?demo=1`'s `demoResults` always returns ok).

import { RacePerformancePreview } from "./race-performance";
import { Arena } from "../../components/Arena";
import type { LabCase } from "../registry";
import { Stage } from "../Stage";
import * as F from "../fixtures";
import { demoEntries, demoPoolLive } from "../../lib/demo";
import type { Entry, Pool } from "../../lib/arena";

type P = Parameters<typeof Arena>[0];

const base = (): P => ({
  pools: F.allPhases(),
  account: F.account,
  canWrite: true,
  configured: true,
  loggedIn: true,
  busy: false,
  source: F.sourceOk(),
  featured: F.featuredOne(),
  funds: F.fundsOk(),
  points: F.pointsOk(),
  followDemo: true,
  entriesPaused: false,
  onEnter: F.noop,
  onFunds: F.noop,
});

const arena = (over: Partial<P> = {}) => <Stage><Arena {...base()} {...over} /></Stage>;

/// §71.179 "My matches": every phase plus a daily 5T and NT running now, all entered by the lab account, with a
/// source that serves the in-progress price preview for each of them.
const running = (id: number, kind: 0 | 1 | 2): Pool => {
  const n = Math.floor(Date.now() / 1000), locksAt = n - 6 * 3600;
  return F.poolAt("locked", { id, kind, locksAt, entryClosesAt: locksAt - 60, settlesAt: locksAt + 86400 });
};
// `poolAt` leaves `participants` unset, which `phaseOf` would read as too few entrants.
const minePools = (): Pool[] => [...F.allPhases(), running(9010, 1), running(9011, 2)]
  .map((p) => ({ ...p, participants: p.participants ?? p.entries }));
const mineArena = (hash?: string) => {
  const pools = minePools();
  // The demo only credits entry 0 to the lab account; the daily 5T gets entry 1 as well, so the strategy picker shows.
  const entriesOf = (id: number) => {
    const p = pools.find((x) => x.id === id);
    const rows = p ? demoEntries(p, F.board()) : [];
    return p?.kind === 1 ? rows.map((e, i) => i === 1 ? { ...e, player: F.account, name: "" } : e) : rows;
  };
  const myEntries = new Map<number, Entry[]>(pools.map((p) => [p.id, entriesOf(p.id).slice(0, p.kind === 1 ? 2 : 1)]));
  if (hash !== undefined) location.hash = hash;
  return arena({
    pools, featured: new Map(), myEntries,
    source: { ...F.sourceOk(), entries: async (id) => entriesOf(id),
      live: async (id) => demoPoolLive(pools.find((x) => x.id === id)!, entriesOf(id)) },
  });
};

export const arenaCases: LabCase[] = [
  { id: "race-performance", group: "arena", name: "Race · live performance and settlement",
    note: "Three live return lines, pending entry, positive settlement, paid protection, elimination and stale quotes. Fixtures only.",
    render: () => <RacePerformancePreview /> },
  {
    id: "arena-mine", group: "arena", name: "Arena · My matches (entered / in progress)",
    note: "Press 我的比赛: entered = open + closing, in progress = locked + review; open a running row for the chart",
    render: () => mineArena(),
  },
  {
    id: "arena-mine-3t", group: "arena", name: "Activity · 3T in progress · my strategy chart",
    render: () => mineArena("arena/9003"),
  },
  {
    id: "arena-mine-5t", group: "arena", name: "Activity · 5T daily in progress · two of my strategies",
    render: () => mineArena("arena/9010"),
  },
  {
    id: "arena-mine-nt", group: "arena", name: "Activity · NT in progress · waiting for the result",
    render: () => mineArena("arena/9011"),
  },
  {
    id: "arena-phases", group: "arena", name: "Arena · all seven phases at once",
    note: "Entry open / awaiting lock / locked / under review / too few entrants / settled / refunded, one row each. Check that the countdown, the status label and the button agree with one another",
    render: () => arena(),
  },
  {
    id: "arena-open", group: "arena", name: "Phase · entry open (pinned match)",
    note: "featured supplies a pin label, so this row should jump to the top into a section of its own",
    render: () => arena({ pools: [F.poolAt("open")] }),
  },
  {
    id: "arena-closing", group: "arena", name: "Phase · entry closed · awaiting lock",
    note: "The enter button must be disabled; the countdown is running out the 40 seconds to the lock — it will flip to 'locked' while you watch, and that is correct",
    render: () => arena({ pools: [F.poolAt("closing")], featured: new Map() }),
  },
  {
    id: "arena-locked", group: "arena", name: "Phase · locked · awaiting settlement",
    render: () => arena({ pools: [F.poolAt("locked")], featured: new Map() }),
  },
  {
    id: "arena-review", group: "arena", name: "Phase · under review",
    note: "review carries a reason. §29: state the fact, promise nothing about when it will be fixed",
    render: () => arena({ pools: [F.poolAt("review")], featured: new Map() }),
  },
  {
    id: "arena-short", group: "arena", name: "Phase · too few entrants · voided and refunded",
    note: "7 entrants < MIN_ENTRIES(10)",
    render: () => arena({ pools: [F.poolAt("short")], featured: new Map() }),
  },
  {
    id: "arena-settled", group: "arena", name: "Phase · settled",
    note: "Open this row to see the ranking (the source goes through demoResults)",
    render: () => arena({ pools: [F.poolAt("settled")], featured: new Map() }),
  },
  {
    id: "arena-refunding", group: "arena", name: "Phase · refunded",
    note: "A real match disappears a minute after it is refunded (REFUND_LINGER); this cell leaves settledAt as null, so it stays",
    render: () => arena({ pools: [F.poolAt("refunding")], featured: new Map() }),
  },
  {
    id: "arena-unconfigured", group: "arena", name: "Arena · endpoint unconfigured",
    note: "configured=false: the header and the prize rules still render, but it has to say outright that nothing can be read (Arena's comments nail this down)",
    render: () => arena({ configured: false, pools: F.emptyPools(), funds: null, source: F.sourceEmpty() }),
  },
  {
    id: "arena-logged-out", group: "arena", name: "Arena · not signed in",
    note: "loggedIn=false: entering asks you to sign in first; funds is null, and the interface writes '—', not 0",
    render: () => arena({ loggedIn: false, funds: null }),
  },
  {
    id: "arena-no-wallet", group: "arena", name: "Arena · wallet not connected",
    note: "account=null + canWrite=false. The disabled reason should say to connect a wallet first, worded distinctly from the read-only case",
    render: () => arena({ account: null, canWrite: false, loggedIn: false, funds: null }),
  },
  {
    id: "arena-paused", group: "arena", name: "Arena · entries paused",
    note: "entriesPaused=true: the button greys out and says entries are paused; matches already entered are unaffected (§71.40)",
    render: () => arena({ entriesPaused: true }),
  },
  {
    id: "arena-busy", group: "arena", name: "Arena · busy",
    render: () => arena({ busy: true }),
  },
  {
    id: "arena-empty", group: "arena", name: "Arena · empty schedule",
    note: "The endpoint is up and you are signed in; there simply is not one match across these three days. What the calendar looks like with every cell empty",
    render: () => arena({ pools: F.emptyPools(), featured: new Map() }),
  },
  {
    id: "arena-funds-zero", group: "arena", name: "Arena · zero balance",
    note: "Click enter and the dialog should take the 'not enough balance · deposit first' branch",
    render: () => arena({ funds: F.fundsZero() }),
  },
  {
    id: "arena-funds-short", group: "arena", name: "Arena · balance just short (3 < 10 USDT)",
    note: "The shortfall has to be worked out, not waved away as 'not enough'",
    render: () => arena({ funds: F.fundsShort() }),
  },
  {
    id: "arena-points-none", group: "arena", name: "Arena · score table unpublished",
    note: "PointsState=none: the win-rate and perfect-rate columns take '—', not 0% (§25)",
    render: () => arena({ points: F.pointsNone() }),
  },
  {
    id: "arena-results-pending", group: "arena", name: "Results · not published yet (pending)",
    note: "The ledger has the root, the results file is not out yet. Open the settled match to see it. Nobody has ever laid eyes on this branch",
    render: () => arena({ pools: [F.poolAt("settled")], featured: new Map(), source: F.sourceResults(F.resultsPending()) }),
  },
  {
    id: "arena-results-mismatch", group: "arena", name: "Results · do not match the ledger (mismatch)",
    note: "The endpoint refuses to return them and no ranking is shown. The wording must not read like 'loading'. Equally, never once seen",
    render: () => arena({ pools: [F.poolAt("settled")], featured: new Map(), source: F.sourceResults(F.resultsMismatch()) }),
  },
  {
    id: "arena-source-fail", group: "arena", name: "Arena · every detail endpoint down",
    note: "Open any match: when the entrant list cannot be read the component catches it into an empty array — see whether that empty state says so clearly",
    render: () => arena({ source: F.sourceFail() }),
  },
];
