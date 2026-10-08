/// Market / MEME Lab / Strategy Builder (§71.109).

import { Market } from "../../components/Market";
import { Meme } from "../../components/Meme";
import { Builder } from "../../components/Builder";
import { PageHead } from "../../components/PageHead";
import type { LabCase } from "../registry";
import { Stage } from "../Stage";
import * as F from "../fixtures";

type M = Parameters<typeof Market>[0];

const marketBase = (): M => ({
  board: F.board(),
  holdings: F.holdings(),
  lots: F.lots(),
  quotes: F.quotes(),
  account: F.account,
  canWrite: false,
  busy: null,
  listings: F.listings(),
  floors: F.floors(),
  feeBps: 250,
  onBuy: F.noop,
  onList: F.noop,
  onCancel: F.noop,
  onGo: F.noop,
});

const market = (over: Partial<M> = {}) => (
  <Stage>
    <PageHead tab="market" onTab={F.noop} jackpot={F.jackpotOk()} arenaConfigured />
    <Market {...marketBase()} {...over} />
  </Stage>
);

type E = Parameters<typeof Meme>[0];

const memeBase = (): E => ({
  pools: F.memePools(),
  // The demo index carries no bare codes for the MEMEs, so the "dividends paid" figure on the card shows "—"
  // by the §71.134 rule — which is exactly what should be seen on the bench, not an oversight
  dividends: F.dividends(),
  lots: F.lots(),
  account: F.account,
  canWrite: false,
  busy: null,
  onBurn: F.noop,
  onGo: F.noop,
});

const meme = (over: Partial<E> = {}) => (
  <Stage>
    <PageHead tab="meme" onTab={F.noop} jackpot={F.jackpotOk()} arenaConfigured />
    <Meme {...memeBase()} {...over} />
  </Stage>
);

export const marketCases: LabCase[] = [
  {
    id: "market-ok", group: "market", name: "Market · with listings",
    render: () => market(),
  },
  {
    id: "market-unconfigured", group: "market", name: "Market · contract unconfigured",
    note: "listings=undefined: the component takes the unconfigured branch itself (spelled out in Market.tsx's comments)",
    render: () => market({ listings: undefined, floors: F.emptyFloors(), feeBps: null }),
  },
  {
    id: "market-empty", group: "market", name: "Market · configured but not one listing",
    note: "Has to be tellable apart from unconfigured. The default filter is 'On sale', so when it is empty it should suggest a different filter",
    render: () => market({ listings: F.emptyListings(), floors: F.emptyFloors() }),
  },
  {
    id: "market-no-wallet", group: "market", name: "Market · wallet not connected",
    note: "account=null: how the 'Listed by me' and 'Held by me' filters should react",
    render: () => market({ account: null, holdings: F.emptyHoldings(), lots: F.emptyLots() }),
  },
  {
    id: "meme-ok", group: "market", name: "MEME Lab · with pools",
    render: () => meme(),
  },
  {
    id: "meme-unconfigured", group: "market", name: "MEME Lab · contract unconfigured",
    note: "pools=undefined",
    render: () => meme({ pools: undefined }),
  },
  {
    id: "meme-empty", group: "market", name: "MEME Lab · empty register",
    note: "pools=[]: configured, but no asset listed yet",
    render: () => meme({ pools: F.emptyMemePools() }),
  },
  {
    id: "meme-paused", group: "market", name: "MEME Lab · minting paused everywhere",
    note: "paused=true on every asset: all the Burn buttons go grey",
    render: () => meme({ pools: F.memePools().map((p) => ({ ...p, paused: true })) }),
  },
  {
    id: "meme-no-price", group: "market", name: "MEME Lab · no price available",
    note: "price / tokensPerCert both 0n: how many tokens a cert costs to burn cannot be worked out, so the button should be disabled",
    render: () => meme({ pools: F.memePools().map((p) => ({ ...p, price: 0n, tokensPerCert: 0n })) }),
  },
  {
    id: "builder-ok", group: "market", name: "Strategy Builder · assets available",
    note: "Live ones can be picked, inactive ones are locked. The local draft is real localStorage — do not hit Save in here",
    render: () => (
      <Stage>
        <PageHead tab="build" onTab={F.noop} jackpot={F.jackpotOk()} arenaConfigured />
        <Builder board={F.board()} />
      </Stage>
    ),
  },
  {
    id: "builder-empty", group: "market", name: "Strategy Builder · empty list",
    note: "Not a single asset: the empty state of the leg picker",
    render: () => (
      <Stage>
        <PageHead tab="build" onTab={F.noop} jackpot={F.jackpotOk()} arenaConfigured />
        <Builder board={F.emptyBoard()} />
      </Stage>
    ),
  },
];
