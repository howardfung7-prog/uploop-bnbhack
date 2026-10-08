/// The chain settings the first screen needs — contract addresses, the *Configured() checks and the
/// chain clock — with no viem in it (§71.174). chain.ts (the RPC clients, which do need viem) re-exports
/// everything here, so `from "./chain"` keeps working; code in the main bundle imports from this file
/// instead, so that the home and arena pages do not download viem before first paint.
import type { Address } from "viem";
import { CHAIN_ID, CHAIN_LABEL, RPC } from "./env";

export { CHAIN_ID, CHAIN_LABEL, RPC };

/// The deterministic addresses the deploy script produces on a clean anvil — true on 31337 only;
/// every other chain must be given them explicitly through VITE_*, and without them the state is
/// "not configured" (§29).
const ANVIL = {
  registry: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
  pledge: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
  usdt: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
} as const;
// Deployed BNB Chain mainnet proxies. Runtime platform addresses are still
// preferred when they pass the bytecode and chain checks in certindex.ts.
const BSC_MAINNET = {
  registry: "0xd664c5f8aba2a4c351910201741ffa52883b52f5",
  pledge: "0xfc45bfe78e6662f92b4d4b188c5657e7af719a1f",
} as const;
/// USDT per chain (BEP20 USDT, 18 decimals, §69.13 / §69.18). Mainnet is the official contract;
/// the testnet has no single standard one, so VITE_USDT has to be set.
const USDT: Record<number, Address> = {
  56: "0x55d398326f99059fF775485246999027B3197955",
  31337: ANVIL.usdt,
};
const local = CHAIN_ID === 31337;

/// The certificate system needs three addresses only: AssetRegistry / CertificateMarket /
/// CertificatePledge (§71.80). Each asset's certificate contract address is read from
/// AssetRegistry at runtime rather than configured here.
/// An address that is not configured is an empty string, so check the matching *Configured()
/// before using one.
// `||`, not `??`, for the three addresses that have a built-in default: docker-compose passes an unset
// build argument as an empty string, and `??` kept that "" instead of falling back, so the production
// bundle shipped without the mainnet registry / pledge / USDT and every page waited on
// `resolveAddresses()` (§71.174).
export const addresses = {
  registry: (import.meta.env.VITE_REGISTRY || (local ? ANVIL.registry : CHAIN_ID === 56 ? BSC_MAINNET.registry : "")) as Address,
  pledge: (import.meta.env.VITE_PLEDGE || (local ? ANVIL.pledge : CHAIN_ID === 56 ? BSC_MAINNET.pledge : "")) as Address,
  swap: (import.meta.env.VITE_SWAP || (CHAIN_ID === 56 ? "0x5B0e7E4B1f52b3a7eA5a89Efa8d1a0ECC2c727D0" : "")) as Address | "",
  market: (import.meta.env.VITE_MARKET ?? "") as Address | "",      // §33: left empty means not shown
  // Since §71.94 MEME has no contract address of its own: a burn pool is simply an asset in
  // AssetRegistry with kind == MEME, and its certificate contract is read from
  // config(asset).certificate. VITE_MEME is retired.
  usdt: (import.meta.env.VITE_USDT || USDT[CHAIN_ID] || "") as Address,
};

/// Neither batches nor listings have a "by holder" view (delivery doc §3.2: transfer events are
/// the only evidence of a holding), so the only way is to scan from 1 up to batchCount() /
/// listingCount(). That runs in chunks through viem's multicall, 500 per chunk, with no overall
/// cap — missing an old batch is worse than being slow. The long-term fix is for the backend to
/// index the events (already written into HANDOFF).
///
/// Since §71.120 that backend index exists (`lib/certindex.ts`), but **the full scan is still the
/// reference implementation**; see INDEX_ABOVE below.
export const SCAN_CHUNK = 500;

/// 🔴 While the batch / listing count is at or below this, **keep scanning in full and skip the
/// index**.
///
/// Why keep the slow path: a full scan is the route that cannot miss anything — it reads the chain
/// directly, with no third party in between. The index is fast, but it adds a link to the chain:
/// if the platform misses a batch, the page is short a batch, and silently so (exactly the kind of
/// error §29 fears most).
/// A thousand rows = two multicall chunks, a second or two. At that size the speed buys nothing
/// and is not worth the risk.
/// What really hurts is tens of thousands of batches; at that point the slow path is unusable and
/// the index earns its place.
/// Put another way: the index is only used when not using it would not work.
export const INDEX_ABOVE = 1000;

const isAddr = (s: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(s);
/// The chain is only read when both contracts the asset board and staking need are configured;
/// otherwise the page explains that the contract addresses are not set yet, without raising an
/// error (§71.30).
export function coreConfigured(): boolean {
  return isAddr(addresses.registry) && isAddr(addresses.pledge);
}
/// Buying and selling on the market is paid in USDT, so that address has to be present too (the
/// testnet has no default).
export function marketConfigured(): boolean { return isAddr(addresses.market) && isAddr(addresses.usdt); }
export function swapConfigured(): boolean { return coreConfigured() && isAddr(addresses.swap) && !/^0x0{40}$/i.test(addresses.swap) && isAddr(addresses.usdt); }

/// The on-chain time anchor: the latest block's timestamp, read once by `syncChainTime()` (chain.ts),
/// then moved forward on the local clock (🔴 a countdown must not use Date.now()).
let anchorChain = 0;
let anchorLocal = 0;
export function anchorChainTime(chainSec: number): void {
  anchorChain = chainSec;
  anchorLocal = Date.now();
}
/// Chain time now (seconds). Before the first successful sync it is the local clock.
export function chainNow(): number {
  if (!anchorChain) return Math.floor(Date.now() / 1000);
  return anchorChain + Math.floor((Date.now() - anchorLocal) / 1000);
}
