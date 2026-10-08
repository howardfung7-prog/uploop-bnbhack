/// <reference types="vite/client" />

interface ImportMetaEnv {
  /// Separately versioned UP ledger; never reuse legacy points.json for growth points.
  readonly VITE_UP_POINTS_URL?: string;
  /// The chain the site runs on (DECISIONS §71.30): 56 = BNB Chain mainnet (the default), 97 = testnet, 31337 = a local anvil. The WalletConnect session follows it too.
  readonly VITE_CHAIN_ID?: string;
  /// The RPC; left empty it uses that chain's default public node (mainnet bsc-dataseed.bnbchain.org, local 127.0.0.1:8545).
  readonly VITE_RPC?: string;
  /// The three core contracts. Empty on 31337 = the deterministic addresses from Deploy.s.sol; empty on any other chain = "the contract addresses are not configured", and the chain is not read.
  readonly VITE_FRAGMENTS?: string;
  readonly VITE_STAKING?: string;
  readonly VITE_REGISTRY?: string;
  /// AssetSwap, which buys the underlying token on PancakeSwap and mints/pledges the certificate in one transaction.
  readonly VITE_SWAP?: string;
  /// The arena endpoint (DECISIONS §69): in development set it to `/api` (vite.config.ts proxies to 127.0.0.1:8787, and the API is started with `--prefix /api`);
  /// on the production site, same-origin, it is `/api` as well. Left empty, the arena page says "the endpoint is not configured" and shows no numbers at all.
  readonly VITE_API_BASE?: string;
  /// BEP-20 USDT (18 decimals). On mainnet it defaults to the official contract 0x55d3…7955, on 31337 to MockUSDT; on a testnet it has to be set explicitly.
  readonly VITE_USDT?: string;
  /// The certificate secondary market, FragmentMarket (§33); left empty it is not shown.
  readonly VITE_MARKET?: string;
  readonly VITE_POINTS_BASE?: string;
  /// Featured matches: `poolId[:label],…`, e.g. `12:Genesis event match,15`. Weekly matches need no entry; they are featured automatically (§25).
  readonly VITE_FEATURED?: string;
  /// Where a MEME Lab listing application is submitted (POST JSON, §63). Left empty → it goes to our own back end at `POST /listings`
  /// (which needs `VITE_API_BASE`, §71.86); with neither set → the user is given the text to copy on submit.
  readonly VITE_LISTING_URL?: string;
  /// The WalletConnect project id (obtained from Reown Cloud; a public value, not a secret, §71.28 addendum 2); left empty → the WalletConnect row in the picker reads "Not configured".
  readonly VITE_WC_PROJECT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window { ethereum?: unknown }
