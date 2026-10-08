/// Live index assets · staking (§71.109).
/// §71.108 has just turned the pool-card heading `.pool-top .sym` gold, outlined and bolder — this group has it looked at once
/// in each of the two views (cards / rows) under both themes (in the rows view the size drops to 17px, and the contrast was worked out at that size).

import { StakePools } from "../../components/StakePools";
import { StakeFaq } from "../../components/StakeFaq";
import { PageHead } from "../../components/PageHead";
import type { LabCase } from "../registry";
import { Stage } from "../Stage";
import * as F from "../fixtures";

type P = Parameters<typeof StakePools>[0];

const base = (): P => ({
  board: F.board(),
  connected: true,
  readOnly: true,
  busy: null,
  quotes: F.quotes(),
  assets: F.assetsOk(),
  dividends: F.dividends(),
  mints: F.mints(),
  onDeposit: F.noop,
});

/// On the main site the staking page is `PageHead + StakePools + StakeFaq`, all three together (App.tsx:709-711).
/// The page head has to be there, because selectors like `.page-head:not(.in-hot) .subnav a.on` look for it.
const stake = (over: Partial<P> = {}, faq = false) => (
  <Stage>
    <PageHead tab="mint" onTab={F.noop} jackpot={F.jackpotOk()} arenaConfigured />
    <StakePools {...base()} {...over} />
    {faq && <StakeFaq board={over.board ?? F.board()} />}
  </Stage>
);

export const stakeCases: LabCase[] = [
  {
    id: "stake-ok", group: "stake", name: "Staking · normal (rows view by default)",
    note: "It lands on rows by default; switch to cards top right. Look at the gold and the weight of the uBTC / uGOOGL / uNVDA headings (§71.108); check .dep-unit in both views",
    render: () => stake({}, true),
  },
  {
    id: "stake-unconfigured", group: "stake", name: "Staking · asset catalog unconfigured",
    note: "assets.status=unconfigured: the pool cards are still there (they take the on-chain path), and catalog-derived columns must read '—', never 0",
    render: () => stake({ assets: F.assetsUnconfigured(), dividends: null }),
  },
  {
    id: "stake-assets-error", group: "stake", name: "Staking · asset catalog failed to load",
    note: "status=error. The wording has to be tellable apart from unconfigured: one is not set up, the other is set up but down",
    render: () => stake({ assets: F.assetsError(), dividends: null }),
  },
  {
    id: "stake-empty", group: "stake", name: "Staking · not one pool",
    note: "Empty board. In the empty state the filter box and the view switch must not be left hanging above an empty table",
    render: () => stake({ board: F.emptyBoard(), assets: F.assetsUnconfigured(), mints: F.emptyMints(), dividends: null }),
  },
  {
    id: "stake-no-quotes", group: "stake", name: "Staking · no price available",
    note: "Empty quotes + empty mints: every card's price and Deposit button should take the '—' + disabled path (§25 / §29)",
    render: () => stake({ quotes: F.emptyQuotes(), mints: F.emptyMints() }),
  },
  {
    id: "stake-disconnected", group: "stake", name: "Staking · wallet not connected",
    note: "connected=false and not a read-only preview — this time the disabled reason should say 'connect a wallet first'",
    render: () => stake({ connected: false, readOnly: false }),
  },
  {
    id: "stake-busy", group: "stake", name: "Staking · one card is sending a transaction",
    render: () => stake({ readOnly: false, busy: F.board()[0]?.id ?? 1 }),
  },
];
