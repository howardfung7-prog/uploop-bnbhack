# UPLOOP web app

React 19 + Vite + viem. Talks to BNB Chain directly for wallets, certificates and one-click staking, and to
the UPLOOP API (`VITE_API_BASE`) for matches, quotes and the RWA price table.

```bash
npm ci
npm run dev          # http://localhost:5173/?demo=1#stake — simulated data, no backend needed
npm run build        # tsc -b && vite build
npm run check        # node scripts/check-*.mjs
```

## Where things are

| Path | What it does |
|---|---|
| `src/lib/chain-config.ts` | Chain id, RPC and contract addresses (BSC mainnet defaults) |
| `src/lib/chain.ts` | Reads from `AssetRegistry`, certificates, market and pledge |
| `src/lib/one-click-stake.ts` | `AssetSwap.quoteBuyAndMint` quotes, slippage bound, 60 s quote lifetime |
| `src/lib/rwa.ts` | Polls `/api/rwa-prices` (Binance Web3 API · RWA Data, proxied by the server) |
| `src/components/StakePools.tsx` | Staking pool cards, including the on-chain price line |
| `src/components/OneClickStake.tsx` | One-click staking dialog |
| `src/components/Market.tsx` | Certificate market (list and buy) |
| `src/lib/demo.ts` | Simulated data for `?demo=1` |
| `src/lib/i18n.ts`, `src/lib/i18n.zh.ts` | English source strings and the Chinese translation |
| `src/ops/OpsApp.tsx` | Placeholder: the operator console is not part of this repository |

## Configuration

Copy `.env.example` to `.env.local`. Every `VITE_` variable is compiled into the browser bundle, so it is
public by definition: never put keys or tokens there. On chain 56 the registry, pledge, USDT and AssetSwap
addresses have built-in defaults; set `VITE_MARKET` to show the certificate market.
