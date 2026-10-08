# UPLOOP

**Index strategy competitions and tokenized-stock staking on BNB Chain.**

Live: **https://uploop.io** · Demo with simulated data (no wallet, no funds): **https://uploop.io/?demo=1#stake**

UPLOOP has two halves that feed each other:

1. **Strategy competitions.** A player builds an index from tokenized US stocks (bStocks) and crypto assets,
   enters a match (minimum entry 5 USDT; rounds can be as short as 15 minutes) and is ranked by the index
   return between the lock time and the settlement time. Prices come only from Binance market data, so every
   player is scored against the same public source.
2. **bStock staking certificates.** A holder deposits a bStock (for example NVDAB) into an on-chain
   certificate contract and receives certificates with a $10 face value. Certificates stay redeemable for
   the deposited tokens. Matches charge a 14% fee on entries, split 7 to certificate stakers as a fee share,
   1 to a prize pool, 3 to referrals and 3 to the platform.

Nothing on UPLOOP promises a return. A staker's fee share depends entirely on match activity, and
match results depend on market moves.

## What this repository contains

This is a public showcase cut from our private monorepo for the **BNB Chain Tokenized Stocks hackathon**.
It contains the parts that touch BNB Chain and the Binance Web3 API:

| Path | What it is |
|---|---|
| `app/` | The production web app (React 19 + Vite + viem). Wallet connection, the staking pools, one-click staking, the certificate market and the competition UI. |
| `core/uploop/prices/rwa.py` | The server-side proxy for **Binance Web3 API · RWA Data** (signed requests, batching, staleness rules). |
| `core/tests/test_rwa.py` | Offline unit tests for that proxy (signing, request path encoding, parsing, staleness). |
| `contracts/` | Solidity sources and ABIs of the certificate system deployed on BSC mainnet (registry, oracle, certificates, market, pledge). |

Not included: the match ledger and settlement engine, the operator console, deployment and custody
configuration, and our internal design log. Code comments cite that log as `§NN`; those references
are kept so the code matches what runs in production, but the log itself stays private.

## Binance Web3 API · RWA Data

Each staking pool card shows the token's own on-chain price on BNB Chain under the Binance spot conversion,
together with the gap between the two. That number comes from `GET /api/v1/dex/market/rwa/price`.

```
browser ──GET /api/rwa-prices──▶ UPLOOP API (in-memory table)
                                     ▲
                    background thread, every 30 s
                                     │
              signed GET web3.binance.com/build/api/v1/dex/market/rwa/price
              chainId=56, up to 100 token addresses per call
```

- **The secret key never reaches the browser.** Every Web3 API request is signed with
  HMAC-SHA256 over `timestamp + METHOD + requestPath + body`, so the call runs on our server
  (`core/uploop/prices/rwa.py`). The browser only reads our cached table (`app/src/lib/rwa.ts`).
- **One batched request** covers every listed equity token, which keeps us far below the
  1200 requests / 60 s limit.
- **Display only.** The price is not used for deposits, quotes or settlement.
- **Never stale.** If no refresh has succeeded for 5 minutes, the server withholds the whole table and the
  card hides the line. Without API keys the thread does not start and the endpoint returns `enabled: false`.

The card rendering is in `app/src/components/StakePools.tsx` (`Pool`, the `pool-rwa` line).

## One-click staking via PancakeSwap

A user who holds USDT but not the bStock can stake in one transaction. The `AssetSwap` contract buys the
token on PancakeSwap and mints the certificate in the same call. The app quotes first with
`quoteBuyAndMint(certificate, asset, count)`, shows the USDT cost, the 3% service fee and the
50 bps slippage bound, and lets a quote live for 60 seconds before asking for a new one
(`app/src/lib/one-click-stake.ts`, `app/src/components/OneClickStake.tsx`).

## Mainnet contracts (BSC, chain id 56)

| Contract | Address |
|---|---|
| AssetRegistry (proxy) | [`0xd664C5F8aba2A4C351910201741fFa52883b52f5`](https://bscscan.com/address/0xd664C5F8aba2A4C351910201741fFa52883b52f5) |
| CertificateMarket (proxy) | [`0x71b9Eb4F30431f739Ce5835ef8E857ea48BaBe76`](https://bscscan.com/address/0x71b9Eb4F30431f739Ce5835ef8E857ea48BaBe76) |
| CertificatePledge (proxy) | [`0xfC45bFe78E6662F92B4D4b188c5657E7aF719a1F`](https://bscscan.com/address/0xfC45bFe78E6662F92B4D4b188c5657E7aF719a1F) |
| PriceOracle | [`0xeE9e63bCEF7A5fC6E9C9d70da3D00AEF3D39Ae26`](https://bscscan.com/address/0xeE9e63bCEF7A5fC6E9C9d70da3D00AEF3D39Ae26) |
| AssetSwap (one-click staking) | [`0x5B0e7E4B1f52b3a7eA5a89Efa8d1a0ECC2c727D0`](https://bscscan.com/address/0x5B0e7E4B1f52b3a7eA5a89Efa8d1a0ECC2c727D0) |
| USDT (BEP-20) | [`0x55d398326f99059fF775485246999027B3197955`](https://bscscan.com/address/0x55d398326f99059fF775485246999027B3197955) |

The app only needs the registry, pledge and market addresses; every per-asset certificate contract is read
from `AssetRegistry` at runtime. The `AssetSwap` source is not part of this repository; its ABI is in
`app/src/lib/abi.asset-swap.ts`.

## About the price data

Matches are scored on Binance USDⓈ-M perpetual candles, because they give stocks and crypto the same
24/7 price basis. They are used only as a **price reference**. UPLOOP does not offer perpetual, margin
or leveraged trading.

## Build and test

Requirements: Node 20+ (the checks were run on Node 24) and Python 3.9+ (the Python code uses the standard library only).

```bash
cd app
npm ci
npm run build        # type-check + production bundle
npm run check        # UI model checks (one-click staking, arena rules, sanitising)
npm run dev          # http://localhost:5173 — open /?demo=1#stake for simulated data
```

```bash
cd core
python3 -m unittest discover -s tests -v    # RWA proxy tests, offline
```

`npm run dev` without a backend works in demo mode (`?demo=1`). Live pages need the UPLOOP API, which is
not part of this repository. `app/.env.example` lists the build-time settings.

## Hackathon timeline

| Date (2026) | Work |
|---|---|
| Sep 15 | Certificate contract package (registry, oracle, certificates, market, pledge) |
| Sep 22 | One-click staking through PancakeSwap (`AssetSwap`) |
| Oct 5 | Switched to BSC mainnet USDT |
| Oct 7 | Binance Web3 API · RWA Data: server-signed proxy, on-chain price line on every pool card |
| Oct 7 | Mobile layout fixes for the staking pages |

## License

MIT, see [LICENSE](LICENSE). The contract sources already carry `SPDX-License-Identifier: MIT`.
The UPLOOP name and logo are not covered by the license.
