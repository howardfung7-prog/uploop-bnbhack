/// The board's data types and the pure helpers around them — no chain reads, no viem (§71.174).
/// Split out of board.ts so App and the first-screen components can use them without pulling the RPC
/// code into the main bundle; board.ts re-exports everything here, so `from "./board"` keeps working.
import { tr } from "./i18n";
import { addresses, CHAIN_ID } from "./chain-config";
import type { Address } from "viem";
import { assetClassOf, tick, uSym } from "./ticker";
import type { AssetClass } from "./ticker";
import type { Asset, AssetsState } from "./assets";
import { fmtAmount } from "./quotes";

/// An asset's status: activated (someone has staked) / certificates outstanding / nothing at all.
/// The on-chain read for the activation threshold went offline with the old Registry (§71.80), so
/// this only grades on "has anyone staked", and no threshold number is invented (§29).
export type Status = "live" | "rallying" | "dark";

/// How many asset tokens one certificate corresponds to.
/// §71.54: one certificate is fixed at $10 and the token amount is computed live from the Binance
/// spot price (re-quoted every 30 seconds, and 1% of headroom is allowed).
/// The new contract fixes how much each certificate holds at the moment of minting, via
/// `quoteForFaceValue` (see `Lot.assetPerCert`), so there is no longer any "value fixed on chain"
/// at the asset layer: `unit` is always 0n = computed from the live price (the same goes for pools
/// the operator opened).
export interface Unit {
  /// The asset token deposited (BEP-20). Equities = Binance bStock, crypto = the corresponding
  /// token
  underlying: Address;
  /// The token amount one certificate corresponds to, in the token's smallest unit. 0n = no value
  /// fixed on chain, computed live from the current price (§71.54)
  unit: bigint;
  /// The token's decimals and symbol, purely so `unit` can be displayed in human terms ("0.05
  /// bNVDA")
  unitDecimals: number;
  unitSymbol: string;
  /// This token's Binance spot pair from the asset catalog (NVDABUSDT / BTCUSDT, §71.95): the price
  /// displayed is fetched from `/quotes` by this pair (`quoteOf`).
  /// Pools opened from the catalog (`catalogBoard`) carry it already; rows read from the chain have
  /// it filled in by `withPairs()`, matched on contract address; with neither → fall back to the
  /// bare code's perpetual price.
  /// It lives on `Unit` rather than on `Ticker` because the "my holdings" card takes a `Holding`,
  /// which has to price off the same leg — otherwise the same token would show two different
  /// numbers on the staking page and the account page (exactly what §71.56 is there to prevent)
  pair?: string;
}

export interface Ticker extends Unit {
  /// A local index (the position in the array `loadBoard` returns, + 1), used only by the React
  /// key / the busy id / routing, and **never sent on chain**.
  /// Its on-chain identity is the pair of addresses `asset` + `cert`.
  id: number;
  /// The asset token's address (= `underlying`; a synonym kept for readability)
  asset: Address;
  /// The certificate contract serving this asset. Redeemable: one instance per asset; burn (MEME):
  /// one instance shared site-wide
  cert: Address;
  /// Tokens locked and redeemable / burned and unredeemable (AssetRegistry.Mode)
  mode: "redeem" | "burn";
  /// The code of the **certificate contract itself** for this asset, u prefix included (=
  /// `BurnCertificate.symbol()` → uBNC).
  ///
  /// 🔴 Only burn assets have it and only burn assets need it (§71.138). The burn certificate
  /// contract is **one instance for the whole site**: burning $STOCKDOG and burning $BNBCAT both
  /// return **the same certificate, uBNC**, only in different batches. So those assets always show
  /// `certSymbol` (uBNC) in the market, the account page and the order book, and must not show the
  /// asset's own `symbol` (uSTOCKDOG) — that would make people think what they hold is a "dog-coin
  /// certificate" redeemable for dog coins, when the tokens went into the burn address long ago
  /// (§29).
  /// Naming always goes through `certName()`; do not pick the field yourself inside a component.
  /// Redeemable assets have one certificate instance each, so the two names are the same thing
  /// anyway: it is not read, and stays `undefined`.
  /// Unreadable (a flaky node / an older contract without the function) → `undefined` →
  /// `certName()` falls back to the asset's own u code, and no name is invented (§29).
  certSymbol?: string;
  /// The display code, u prefix included (see lib/ticker.ts). There is one source for it site-wide:
  /// the bare code on that row of the asset catalog (uBNB, uNVDA, §71.127 `catalogNamer`) — **not**
  /// the token code on chain (WBNB / NVDAB), which only appears in `unitSymbol` and in hover hints.
  /// `Lot.symbol` / `Holding.symbol` are both copied from here.
  symbol: string;
  /// Which component pool it belongs to (crypto / equities / other); see assetClassOf in
  /// lib/ticker.ts
  cls: AssetClass;
  /// The number of certs staked site-wide = Σ each batch's totalPledged
  pledged: bigint;
  /// The total number of certs currently in existence = Σ each batch's totalSupply (a deposit adds,
  /// a redemption subtracts). There is no cap, and no "total issue"
  issued: bigint;
  status: Status;
  /// This card was not read from the chain: it is a pool the operator opened in the asset catalog
  /// (§71.51). The price and the conversion are real, but the total certs staked / number of
  /// dividends have no on-chain read (shown as "—") and the deposit button is disabled. When the
  /// chain has a pool for the same token, the chain governs.
  offchain?: true;
}

/// "N certs from one batch" (§71.80). In the model the contract colleague delivered, **one mint =
/// one batch = one ERC-1155 id**, and the certs within a batch are completely fungible: they hold
/// the same token amount and were minted at the same price. Different batches hold different
/// amounts (the price moves).
/// 🔴 A `batchId` is **unique within one certificate contract and repeats across contracts** (the
/// user, 2026-09-15: "each separate contract will have its own numbering, so numbers will repeat"),
/// so the interface always shows "asset + #number" as a pair and nothing may ever print a bare
/// number on its own — build that pair with `certLabel()` / `lotLabel()`.
export interface Lot extends Unit {
  /// The certificate contract this batch of certs belongs to
  cert: Address;
  /// The batch number = the ERC-1155 id, starting at 1
  batchId: bigint;
  /// Corresponds to Ticker.id; used only by the React key / the busy id
  tickerId: number;
  symbol: string;
  /// How many certs of this batch I hold
  n: bigint;
  /// How many tokens **each** cert of this batch holds, in the token's smallest unit. Fixed at the
  /// moment of minting and unchanged afterwards
  assetPerCert: bigint;
  /// The Binance price at the moment of minting (USDT per whole token, 1e18 fixed point)
  mintPrice1e18: bigint;
  /// When it was minted (on-chain seconds)
  mintedAt: number;
}

/// My staked position in one asset: one card per asset, with a row per batch inside it.
export interface Holding extends Unit {
  /// = Ticker.id
  id: number;
  symbol: string;
  cert: Address;
  lots: Lot[];
  /// The total number of certs staked = Σ lots.n. Dividends weight by cert count (the user,
  /// 2026-09-15), so this number is the weight itself
  total: bigint;
}

/// The tokens held in one certificate → "0.0512 NVDAB". Uses `fmtAmount` (by significant figures,
/// so small amounts are not truncated to 0), the same formatter as the staking page's "$10 ≈ how
/// many tokens" line.
export function fmtCert(u: Unit, amount: bigint): string {
  return `${fmtAmount(amount, u.unitDecimals)} ${u.unitSymbol}`;
}

/// The amount in the burn sentence → "10,000 $BNBCAT" (§71.139). It differs from `fmtCert` only by
/// the `$` in front of the token name.
///
/// MEME carries a `$` everywhere (`tick()`), while `fmtCert` prints the bare name of a redeemable
/// asset (AAPLB / BTCB — which never had a `$`).
/// Without the two being written separately, "10,000 BNBCAT burned per cert" and "10,000 $BNBCAT
/// burned per cert" would appear on the same page — which is what the user meant on 2026-09-17 by
/// "the names do not agree, they need to be consistent".
export function fmtBurned(u: Unit, amount: bigint): string {
  return `${fmtAmount(amount, u.unitDecimals)} ${tick(u.unitSymbol)}`;
}

/// What to call it in the interface (§71.138): burn assets are called by the code of **the
/// certificate contract itself** (uBNC), redeemable assets by the asset's own (uNVDA).
///
/// 🔴 Every certificate name site-wide goes through this one function — `Lot.symbol` /
/// `Holding.symbol` are already written through it by `lotsOf` / `loadHoldings`, so the name a
/// component receives is right to begin with. Any component that writes `t.symbol` itself will
/// produce a certificate name that does not exist, like "uSTOCKDOG", for the cert that burning MEME
/// returns.
export function certName(t: { mode: "redeem" | "burn"; symbol: string; certSymbol?: string }): string {
  return t.mode === "burn" ? t.certSymbol ?? t.symbol : t.symbol;
}

/// The subtitle on a burn certificate's card or row: "From burning $STOCKDOG" (§71.138).
///
/// Twelve MEMEs have a card each and every one of them is called uBNC (the layout the user chose on
/// 2026-09-18), so without this line there is **no** telling them apart; and it happens to be the
/// one honest statement of where the certificate came from — the token was not "matched", it was
/// "burned".
/// The parameter is written as "anything with a `unitSymbol`" rather than a whole `Unit`: `Ticker`
/// / `Lot` / `Holding` all satisfy it naturally, and the MEME Lab's card takes a `MemePool` (which
/// keeps the token being burned in `symbol`), which has to be able to use the same sentence.
export function burnFrom(u: { unitSymbol: string }): string {
  return tr("From burning {0}", tick(u.unitSymbol));
}

/// "uNVDA #7". Numbers repeat across certificate contracts, so the asset always goes with it
/// (§71.80).
export function certLabel(symbol: string, batchId: bigint | number): string {
  return `${symbol} #${batchId}`;
}

/// "uNVDA #7 · 3 certs". Use this for lists and for button copy; do not assemble it yourself.
export function lotLabel(l: Lot, n = l.n): string {
  return tr("{0} · {1} {2}", certLabel(l.symbol, l.batchId), n, n === 1n ? "cert" : "certs");
}

/// "how many certs of this batch to act on": staking / unstaking / redeeming / listing, every write
/// operation passes this shape.
export interface Pick {
  cert: Address;
  batchId: bigint;
  n: bigint;
}

/// The React key / the key in a selection table. Numbers repeat across certificate contracts, so
/// the key has to carry the contract address.
export function lotKey(l: { cert: Address; batchId: bigint }): string {
  return `${l.cert}:${l.batchId}`;
}

/// Parsing the cert-count input: positive integers only, an empty or malformed string counts as 0
/// (= the button is disabled), and anything above the maximum is clamped back to it.
/// A certificate is a whole indivisible thing, so no decimals and no negatives are accepted here.
export function pickN(raw: string, max: bigint): bigint {
  const s = raw.trim();
  if (!/^\d+$/.test(s)) return 0n;
  const n = BigInt(s);
  return n > max ? max : n;
}

/// Tokens the operator opened a pool for in the catalog (§71.51) → a pool card, filled into
/// `Ticker`'s shape and marked `offchain`.
/// When no pool can be read on chain (the contract address is not configured yet / this one is not
/// on chain yet), the Asset Staking page lays these out as cards: the code, the live price and the
/// `1 cert = $10 ≈ how many tokens` line are all real (the price comes from Binance and the amount
/// is computed live, re-quoted every 30 seconds, §71.54), while the numbers that only exist on
/// chain (total certs staked, number of dividends) show "—" and depositing is disabled.
export function catalogBoard(assets: Asset[]): Ticker[] {
  const out: Ticker[] = [];
  for (const a of assets) {
    if (a.pool !== "open") continue;
    out.push({
      id: 0,
      asset: a.address,
      cert: "0x0000000000000000000000000000000000000000",
      mode: "redeem",
      symbol: uSym(a.underlying || a.ticker),
      // The class comes from the catalog first (§71.95, the `class` the operator filled in on that
      // one row); an older backend does not send it, so fall back to judging by the code
      cls: a.class ?? assetClassOf(a.underlying || a.ticker),
      pair: a.pair || undefined,
      underlying: a.address,
      unit: 0n,
      unitDecimals: a.decimals,
      unitSymbol: a.ticker,
      pledged: 0n,
      issued: 0n,
      status: "dark",
      offchain: true,
    });
  }
  return out;
}

/// Match the pools read from the chain against the rows of the asset catalog, on **contract
/// address** (and on token symbol when that fails), and carry the catalog's `pair` column onto the
/// card (§71.95): the prices on the cards, the market page and the account page are all fetched
/// from `/quotes` by `quoteOf` on that `pair`'s spot leg, while anything the catalog does not have
/// (or whose pair is blank) is left as it was and falls back to the perpetual price.
/// The generic is there for `Holding`: the account page's card takes a Holding rather than a
/// Ticker, but both are a `Unit`, so one leg and one piece of code serve both.
/// With an empty catalog (the endpoint is not configured / nothing has been fetched yet) the input
/// is returned as it is, creating no new objects, so the reference does not change on every render.
export function withPairs<T extends Unit>(board: T[], assets: Asset[]): T[] {
  const byAddr = new Map<string, string>();
  const byUnit = new Map<string, string>();
  for (const a of assets) {
    if (!a.pair) continue;
    byAddr.set(a.address.toLowerCase(), a.pair.toUpperCase());
    byUnit.set(a.ticker.toUpperCase(), a.pair.toUpperCase());
  }
  if (byAddr.size === 0) return board;
  let changed = false;
  const out = board.map((t) => {
    const pair = byAddr.get(t.underlying.toLowerCase()) ?? byUnit.get(t.unitSymbol.toUpperCase());
    if (!pair || pair === t.pair) return t;
    changed = true;
    return { ...t, pair };
  });
  return changed ? out : board;
}

/// The burn (MEME) entries on the board, §71.138.
///
/// One row per MEME, but behind them is **one and the same** certificate contract instance —
/// burning any of them returns uBNC, only in a different batch (the user, 2026-09-18: "one card per
/// MEME"). `offchain` ones are excluded (a pool the operator opened in the catalog that is not on
/// chain yet): those are display cards only, with no on-chain batch, and can be neither listed nor
/// staked.
export function burnBoard(board: Ticker[]): Ticker[] {
  return board.filter((t) => t.mode === "burn" && !t.offchain);
}

/// The token addresses (lower case) the operator has **not** opened a pool for in the asset
/// catalog, §71.136.
///
/// The rule the user laid down on 2026-09-18: "closing the pool has to close the whole card". The
/// staking page's cards are read from the **on-chain registry**, and the registry can only be added
/// to, never deleted from (§71.135: `AssetRegistry` has no `removeAsset`, and kind / mode are
/// written once and can never be changed again), so "take this card down" is something the chain
/// cannot do; it can only be done in the frontend, by the catalog.
///
/// 🔴 Two boundaries. The other way round is a lie, so do not change them:
/// · the catalog does **not have** this address at all (a new pool not entered into the catalog yet
///   / the catalog endpoint is not configured) → it does not join this set → the card is shown.
///   The chain governs (§71.51): that pool is real, someone's money may already be in it, and
///   hiding it on the grounds that "we did not enter it" is deception (§29).
/// · the catalog could not be fetched (status is not ok) → return an empty set and hide nothing.
///   Better to show one card too many than to hide one wrongly.
/// A card is only taken down when "the catalog really does have that row and the operator really
/// has not opened the pool" — which covers both the ones listed for staking with the pool closed
/// and the ones already delisted.
export function closedPools(assets: AssetsState): Set<string> {
  const out = new Set<string>();
  if (assets.status !== "ok") return out;
  // The delisted column has to be looked at too: the card is on chain while the operator's
  // delisting only happened in the catalog, and the two have to agree (§71.136)
  for (const a of [...assets.assets, ...assets.delisted]) {
    if (a.pool !== "open") out.add(a.address.toLowerCase());
  }
  return out;
}

/// The last board read, kept in this browser (§71.174). After a refresh the staking / market / account
/// pages draw it at once instead of showing "Loading BNBChain data" for as long as the chain takes to
/// answer; the fresh read replaces it a few seconds later. Keyed by chain and registry, so a cache from
/// another deployment or chain is never shown. Older than a day → ignored.
/// 🔴 Display only: it is a starting picture, not a source of truth. Every write reads the chain again
/// (the contract checks too), and the live read overwrites it on the first refresh.
const BOARD_CACHE_MAX_MS = 24 * 3600_000;
const boardCacheKey = () => `uploop-board:v1:${CHAIN_ID}:${addresses.registry.toLowerCase()}`;
export function cachedBoard(): Ticker[] | null {
  try {
    const raw = localStorage.getItem(boardCacheKey());
    if (!raw) return null;
    const saved = JSON.parse(raw, (_k, v) => (v && typeof v === "object" && typeof v.$big === "string" ? BigInt(v.$big) : v)) as { at: number; board: Ticker[] };
    if (!Array.isArray(saved.board) || !(Date.now() - saved.at < BOARD_CACHE_MAX_MS)) return null;
    return saved.board;
  } catch {
    return null;
  }
}
export function saveBoard(board: Ticker[]): void {
  try {
    localStorage.setItem(boardCacheKey(), JSON.stringify({ at: Date.now(), board }, (_k, v) => (typeof v === "bigint" ? { $big: v.toString() } : v)));
  } catch { /* private mode / storage full: the cache is optional */ }
}

/// How many asset tokens depositing one certificate costs (§71.80, delivery doc §4.1).
///
/// 🔴 This number **has to** come from the certificate contract's own quoting path —
/// `quoteForFaceValue(asset, faceValue())` on `RedeemableCertificate.oracle()`, then +1 smallest
/// unit to follow the contract ("Round up by one wei so a redeemable vault never runs short" in
/// `CertificateBase._createBatch`).
/// A number computed here from the Binance price would not match what the chain actually takes, and
/// what the user sees before signing would be a false number (§29).
/// The Binance price is still used to display quotes and present value, but "how much to pay"
/// recognises this one on-chain source only.
export interface MintQuote {
  /// How many tokens each certificate costs, in the token's smallest unit
  assetPerCert: bigint;
  /// One certificate's face value, in USDT's smallest unit (fixed at 10 USDT in the contract)
  faceValue: bigint;
  /// The live price the on-chain pool reports: 1 whole asset token = how many USDT, 1e18 fixed
  /// point (the second return value of `quoteForFaceValue`).
  /// The "1 token = $x" line on a MEME card uses this number — the same source and the same single
  /// call as "how much to pay" (§71.78: one number, one source).
  spotPrice1e18: bigint;
  /// Minting is off. Three situations are merged into one flag, because the interface handles them
  /// identically (greyed out + "minting paused"): the certificate contract is off as a whole
  /// (`mintPaused()`), the registry has switched this asset off on its own
  /// (`config().mintPaused`), or the burn certificate has not added this token to its own list
  /// (`isAssetEnabled()`, new in v2, §71.119).
  paused: boolean;
}

/// How many asset tokens depositing n certificates costs.
///
/// 🔴 **Minting charges no fee** (the contract colleague's 2026-09-15 delivery removed it, §71.84):
/// the certificate contract no longer has `feeBps()` / `setFee()`, the user pays only the asset
/// behind the certificate, and this is "amount per cert × number of certs" with nothing added.
/// The secondary market's fee is a separate matter and is still taken out of the seller's proceeds
/// at the `CertificateMarket.feeBps()` in force at the trade (see `lib/market.ts`).
/// This is also the number that really has to be in the wallet and the number the approval has to
/// cover (an approval leaves another 1% of headroom on top, see §71.54).
export function mintCost(q: MintQuote, n: bigint): bigint {
  return q.assetPerCert * n;
}
