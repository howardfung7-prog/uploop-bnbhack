/// My Account (§71.109).
/// This page stitches four things together (matches / staking / dividends / MEME certificates), so there are a great many
/// "one of the four is missing" combinations — and `?demo=1` always has all four full, so the empty states have never once been looked at here.

import { Account } from "../../components/Account";
import type { LabCase } from "../registry";
import { Stage } from "../Stage";
import * as F from "../fixtures";

type P = Parameters<typeof Account>[0];

const base = (): P => ({
  account: F.account,
  readOnly: true,
  busy: null,
  holdings: F.holdings(),
  lots: F.lots(),
  quotes: F.quotes(),
  pools: F.pools(),
  board: F.board(),
  funds: F.fundsOk(),
  arenaConfigured: true,
  jackpot: F.jackpotOk(),
  source: F.sourceOk(),
  onUnstake: F.noop,
  onRedeem: F.noop,
  onStake: F.noop,
  onGo: F.noop,
  floors: F.floors(),
  meme: { pools: F.memePools() },
});

const acct = (over: Partial<P> = {}) => <Stage><Account {...base()} {...over} /></Stage>;

export const accountCases: LabCase[] = [
  {
    id: "account-full", group: "account", name: "My Account · all four full",
    note: "Baseline. Matches / staking / dividends / MEME certificates all have something in them",
    render: () => acct(),
  },
  {
    id: "account-no-wallet", group: "account", name: "My Account · wallet not connected",
    note: "account=null: the whole page should be a single line saying 'connect a wallet first', not four empty boxes stacked up",
    render: () => acct({ account: null, holdings: [], lots: [], funds: null, source: F.sourceEmpty(), meme: undefined }),
  },
  {
    id: "account-not-logged-in", group: "account", name: "My Account · wallet connected but not signed in to the arena",
    note: "funds=null: the balance reads '—'; the matches block is still readable (myEntries is public data)",
    render: () => acct({ funds: null }),
  },
  {
    id: "account-empty", group: "account", name: "My Account · entirely empty",
    note: "Never entered, never staked, no certificates, no withdrawals. The four empty states must each be worded differently, and each has to say where to go next",
    render: () => acct({
      holdings: F.emptyHoldings(), lots: F.emptyLots(), source: F.sourceEmpty(),
      funds: F.fundsZero(), floors: F.emptyFloors(), meme: { pools: [] },
    }),
  },
  {
    id: "account-unconfigured", group: "account", name: "My Account · arena endpoint unconfigured",
    note: "arenaConfigured=false: the whole matches block has to say outright that it is unconfigured, while staking / dividends display as usual",
    render: () => acct({ arenaConfigured: false, funds: null, source: F.sourceEmpty(), jackpot: F.jackpotNone() }),
  },
  {
    id: "account-no-meme", group: "account", name: "My Account · MEME contract unconfigured",
    note: "meme=undefined: the MEME certificates block does not render",
    render: () => acct({ meme: undefined }),
  },
  {
    id: "account-jackpot-none", group: "account", name: "Jackpot · no record (none)",
    render: () => acct({ jackpot: F.jackpotNone() }),
  },
  {
    id: "account-jackpot-error", group: "account", name: "Jackpot · failed to load (error)",
    note: "This branch only appears when the endpoint is down, and has never been seen in a browser. The error wording must not come out as '0 shares'",
    render: () => acct({ jackpot: F.jackpotError() }),
  },
  {
    id: "account-source-fail", group: "account", name: "My Account · every endpoint down",
    note: "myEntries / stats / withdrawals all throw. The page has to stay standing, not go blank",
    render: () => acct({ source: F.sourceFail() }),
  },
  {
    id: "account-busy", group: "account", name: "My Account · one row is sending a transaction",
    note: "busy is one id; only that row's button should spin, the others are unaffected",
    render: () => acct({ readOnly: false, busy: F.board()[0]?.id ?? 1 }),
  },
];
