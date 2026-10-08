/// The MEME Lab (DECISIONS §59; rewritten against the real contracts in §71.94, 2026-09-16): burn
/// MEME tokens, get a fixed-face-value certificate in return.
///
/// In the three-family model the user laid down on 2026-09-16, the MEME family reads: "I give you
/// the contract address, you read the on-chain SWAP pool price and work out $10 worth (burn only,
/// never enters a strategy)."
/// In the contract colleague's 2026-09-15 delivery that means an asset in `AssetRegistry` with
/// `kind == MEME` and `mode == BURN`:
///   · price: `PriceOracle` reads PancakeSwap (V3 `slot0` + a TWAP deviation gate / V2 reserves),
///     not a Binance price;
///   · mint: `BurnCertificate.mint(asset, n, to, maxAssetIn)`, tokens go straight to the burn
///     address `0x…dEaD` and cannot be redeemed;
///   · never enters the arena (the backend's `SYMBOL_CLASSES` no longer has a meme class, and
///     `enterable` is always false).
///
/// 🔴 The old version of this page talked to a `MemeBurn` contract that **exists in neither
/// contract package** (a hand-written, invented ABI; see the deleted `lib/abi.meme.ts`). This one
/// uses the real ABI throughout (`lib/abi.certs.ts`), and not one number is made up.
///
/// 🔴 Dividends: the new `BurnCertificate` has **no dividend function at all**, because dividends
/// are centralised (the user, 2026-09-15: "dividends are centralised", "dividends go by number of
/// certificates, not by number of tokens"). So this file neither reads `pendingOf` nor offers a
/// "claim" button — the chain only tracks "how much was burned, how many certs came back", and we
/// pay the money off-chain by cert count.
import { tr } from "./i18n";
import { USDT_DECIMALS, USDT_UNIT } from "./arena";
import { erc20Abi, zeroAddress } from "viem";
import type { Address } from "viem";
import { addresses, publicClient } from "./chain";
import { assetRegistryAbi, burnCertificateAbi } from "./abi.certs";
import { fmtScaled } from "./quotes";
import { burnBoard, certName } from "./board";
import type { Ticker, MintQuote } from "./board";

/// 🔴 This has to be a function and must not be read once at module top level: since §71.120 the
/// registry address is read from the platform **at runtime** (`resolveAddresses()`), and at module
/// load time it is still the build-time value. Storing it would mean never reaching the new
/// contract.
const reg = () => ({ address: addresses.registry, abi: assetRegistryAbi } as const);

/// The burn address: `BurnCertificate.DEAD()`. Tokens sent here can never be taken out again.
export const DEAD: Address = "0x000000000000000000000000000000000000dEaD";

/// One MEME burn pool = one asset in the registry with `kind == MEME`.
/// Every field comes from the chain; anything that cannot be reported (the price) is 0n, and the
/// card then shows "—" and disables burning rather than guessing (§25 / §29).
export interface MemePool {
  /// = `Ticker.id` (the index in `loadBoard` + 1). Used by the React key, the busy id and the
  /// burn button; **never goes on chain**
  id: number;
  /// The MEME token's address
  token: Address;
  /// The burn certificate contract that covers this asset (one instance for the whole site)
  cert: Address;
  /// The token's own symbol (no u prefix — the interface has to show the original name, e.g.
  /// $BNBCAT)
  symbol: string;
  /// The display code of **the certificate** that burning produces, u prefix included (uBNC) =
  /// the burn certificate contract's own `symbol()`, read once and used everywhere.
  ///
  /// 🔴 Not the same thing as `symbol` above, and the card shows both: `symbol` is **the token
  /// being burned** (BNBCAT), this is **the certificate received in return** (uBNC). The user,
  /// 2026-09-18: "the MEME Lab has to show the uBNC certificate" (§71.134) and "MEME can only be
  /// burned for a BNC certificate" (§71.136).
  ///
  /// 🔴 Correcting §71.134: it originally said `Ticker.symbol`, which is **the asset's own** u
  /// code (uBNBCAT / uSTOCKDOG), so the card would have read "burn BNBCAT, get uBNBCAT" — but
  /// there is only one burn certificate contract instance on the whole site, and burning any MEME
  /// returns the same certificate. So this has to read `BurnCertificate.symbol()` (§71.136).
  certSymbol: string;
  decimals: number;
  /// The face value of one certificate, in USDT's smallest unit (fixed at 10 USDT in the
  /// contract, not hard-coded in the frontend)
  faceValue: bigint;
  /// The on-chain pool quote: how many USDT 1 token is worth, 1e18 fixed point. 0n = no price can
  /// be reported at this moment
  price: bigint;
  /// How many tokens one certificate currently costs to burn (in the token's raw units). 0n = no
  /// price available
  tokensPerCert: bigint;
  /// How many tokens have reached the burn address (raw units) = `IERC20(token).balanceOf(DEAD)`
  burned: bigint;
  /// The total number of certificates issued for this asset
  issued: bigint;
  /// How many of this asset's certificates are **staked** = Σ each batch's
  /// `CertificatePledge.totalPledged` (= `Ticker.pledged`, read on chain).
  /// The difference from `issued`: `issued` is how many were handed out, this is how many of them
  /// are locked in the pledge contract.
  pledged: bigint;
  /// The PancakeSwap pool address (V3 pool / V2 pair); the card links out to it
  pool: Address;
  priceSource: "v3" | "v2";
  /// The symbol of the routing token used for pricing; `null` = the pool is "token / USDT"
  /// directly, with no routing.
  ///
  /// 🔴 Since v2 of the management contract, an asset may be priced in a "token / WBNB" pool with
  /// the oracle converting WBNB into USDT (`config().quote` is that routing token; the v1 ABI has
  /// no such field, §71.119).
  /// In that case the `pool` above is the "token / WBNB" pool, not a "token / USDT" pool — the
  /// card has to say so, or the price the user sees after clicking through to the pool is in a
  /// different unit from ours and they will think we got it wrong (§29).
  quoteSymbol: string | null;
  /// Minting is off (the certificate contract is paused overall, the registry has this one
  /// switched off, or this token is not on the burn certificate's list)
  paused: boolean;
}

/// Turn the burn-type (MEME) assets on the board into burn pools.
///
/// The price and "how many tokens one cert costs" reuse the `quoteForFaceValue` that
/// `loadMintQuotes` already fetched (§71.78: one number, one source) — no separate round of quote
/// requests, and therefore no way for "the price on the card" and "the amount actually taken at
/// signing" to disagree.
export async function loadMemePools(board: Ticker[], mints: Map<number, MintQuote>): Promise<MemePool[]> {
  const burn = burnBoard(board);
  return Promise.all(burn.map(async (t) => {
    const [cfg, faceValue, burned] = await Promise.all([
      publicClient.readContract({ ...reg(), functionName: "config", args: [t.asset] }),
      publicClient.readContract({ address: t.cert, abi: burnCertificateAbi, functionName: "faceValue" }),
      // 🔴 "How much was burned" is the balance of the burn address, not a scan of the `Burned`
      // events from block 0: the contract only reports `burned` in the event and has no running
      // total view, while BSC public nodes cap the block span of `getLogs`, so scanning from
      // genesis is bound to fail. The burn-address balance is exactly the contract's own
      // definition of "burned" (`deadAfter - deadBefore`): one call, always accurate. The cost:
      // tokens of the same kind sent to the burn address from outside our contract count too,
      // which is why the copy says "tokens at the burn address".
      publicClient.readContract({ address: t.asset, abi: erc20Abi, functionName: "balanceOf", args: [DEAD] }),
    ]);
    const q = mints.get(t.id);
    // The routing token's symbol is only read when routing is actually in play (most assets are
    // priced against USDT directly and `quote` is the zero address).
    // If the symbol cannot be read, write "routing token": knowing that a conversion step exists
    // matters more than knowing what it is called.
    const routed = cfg.quote !== zeroAddress
      && cfg.quote.toLowerCase() !== addresses.usdt.toLowerCase();
    const quoteSymbol = routed
      ? await publicClient.readContract({ address: cfg.quote, abi: erc20Abi, functionName: "symbol" })
          .catch(() => tr("routing token"))
      : null;
    return {
      id: t.id,
      token: t.asset,
      cert: t.cert,
      symbol: t.unitSymbol,
      // 🔴 Since §71.138 `BurnCertificate.symbol()` is read into `Ticker.certSymbol` back in
      // `loadBoard()` (the market, the account page and the order book all need the same name);
      // this only takes it out again.
      // If it cannot be read → `certName` falls back to the asset's own u code: the name will be
      // inaccurate, but it will not be invented (§29).
      certSymbol: certName(t),
      decimals: t.unitDecimals,
      faceValue: q?.faceValue ?? faceValue,
      price: q?.spotPrice1e18 ?? 0n,
      tokensPerCert: q?.assetPerCert ?? 0n,
      burned,
      issued: t.issued,
      pledged: t.pledged,
      pool: cfg.pool,
      priceSource: cfg.priceSource === 0 ? "v3" : "v2",
      quoteSymbol,
      paused: q?.paused ?? true,
    } as MemePool;
  }));
}

/// A token amount: converted to a human-readable number for its decimals, at most maxFrac decimal
/// places, with thousands separators on the whole part.
export function fmtTok(raw: bigint, decimals: number, maxFrac = 2): string {
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const frac = raw % base;
  const w = whole.toLocaleString();
  if (maxFrac === 0 || frac === 0n) return w;
  const f = frac.toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  return f ? `${w}.${f}` : w;
}

/// The token name shown in the interface: a Latin-letter code carries a $ ($BNBCAT), while a name
/// written in another script is shown as it is, with no $ forced onto it (§65).
/// 🔴 Since §71.138 the implementation lives in `lib/ticker.ts` (the certificate layer's
/// `burnFrom` needs it too). This only re-exports it so that the dozen or so
/// `import { tick } from "../lib/meme"` lines do not all have to change; the meaning is unchanged.
export { tick } from "./ticker";

/// A token price (USDT, 1e18 fixed point) → `$0.001000`: two decimal places with thousands
/// separators at 1 and above, four significant figures below 1 (§71.10, the same rules as the
/// staking pools' fmtUsd).
export function fmtPrice(price: bigint): string {
  return `$${fmtScaled(price, USDT_DECIMALS)}`;
}

/// How many USDT the tokens already at the burn address are worth (at the current quote; a
/// reference figure only, truncated to whole USDT). 0n when no price can be reported.
export function burnedUsdt(p: MemePool): bigint {
  if (p.price === 0n) return 0n;
  const v = (p.burned * p.price) / 10n ** BigInt(p.decimals);
  return v - (v % USDT_UNIT);
}

/// How many tokens burning n certificates costs, and the ceiling once 1% of slippage is allowed.
///
/// 🔴 `max` is exactly the fourth argument to `BurnCertificate.mint(asset, n, to, maxAssetIn)`:
/// the quote moves between your signature and the transaction landing, the contract re-quotes at
/// the moment it lands, and anything above `maxAssetIn` reverts the whole thing
/// (`AssetInAboveLimit`). **Never pass `type(uint256).max`** — that hands the wallet's whole
/// balance to anyone who can manipulate the pool.
/// `deposit()` in App uses `mintCost(q, n) * 101n / 100n`, which is identical to `need + need /
/// 100n` here.
export function tokensFor(p: MemePool, n: bigint): { need: bigint; max: bigint } {
  const need = p.tokensPerCert * n;
  return { need, max: need + need / 100n };
}
