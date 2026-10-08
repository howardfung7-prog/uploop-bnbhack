import { tr } from "./i18n";
import { readContractWithFallback, addresses, SCAN_CHUNK, INDEX_ABOVE } from "./chain";
import { holdingRefs } from "./certindex";
import { assetRegistryAbi, redeemableCertificateAbi, burnCertificateAbi, certificatePledgeAbi, priceOracleAbi } from "./abi.certs";
import { erc20Abi } from "viem";
import type { Address } from "viem";
import { assetClassOf, uSym } from "./ticker";
import type { AssetClass } from "./ticker";
import { loadAssets } from "./assets";
import type { Asset } from "./assets";
import { certName } from "./board-model";
import type { Ticker, Lot, Holding, MintQuote } from "./board-model";
export * from "./board-model";

/// 🔴 These have to be functions and must not be read once at module top level: since §71.120 both
/// addresses are read from the platform **at runtime** (`certindex.resolveAddresses()`), and at
/// module load time they are still the build-time values. Storing them would mean never reaching
/// the new contract.
const reg = () => ({ address: addresses.registry, abi: assetRegistryAbi } as const);
const pledgeC = () => ({ address: addresses.pledge, abi: certificatePledgeAbi } as const);

/// AssetRegistry.Kind (0 STOCK / 1 TOKEN / 2 MEME) → our own class.
/// The code alone could decide it (`assetClassOf`), but the kind in the registry was filled in by
/// the operator in person, so it is trusted first.
function clsOf(kind: number, symbol: string): AssetClass {
  if (kind === 0) return "equity";
  if (kind === 1) return "crypto";
  return assetClassOf(symbol);
}

/// Cut 1..n into blocks of SCAN_CHUNK. The contract has no "query by holder" view (delivery doc
/// §3.2), so the only way is to scan the lot; viem's multicall merges one block into a single RPC
/// call.
function chunks(n: bigint): bigint[][] {
  const out: bigint[][] = [];
  for (let start = 1n; start <= n; start += BigInt(SCAN_CHUNK)) {
    const end = start + BigInt(SCAN_CHUNK) - 1n > n ? n : start + BigInt(SCAN_CHUNK) - 1n;
    const block: bigint[] = [];
    for (let i = start; i <= end; i++) block.push(i);
    out.push(block);
  }
  if (n > 2000n) console.warn(tr("[cert] There are already {0} batches and scanning the lot will be slow; time for the backend event index (HANDOFF §14.2)", n));
  return out;
}

/// Cut a list of **specific** batch numbers into multicall blocks (used once the index has spoken,
/// instead of counting from 1 to the end).
function blocksOf(ids: bigint[]): bigint[][] {
  const out: bigint[][] = [];
  for (let i = 0; i < ids.length; i += SCAN_CHUNK) out.push(ids.slice(i, i + SCAN_CHUNK));
  return out;
}

/// "Which batches this address has touched", as the backend index reports it, grouped by
/// certificate contract (the key is the lower-case address).
/// `null` = the index is unusable, so everything goes through the full scan.
async function refsByCert(who: Address): Promise<Map<string, bigint[]> | null> {
  const refs = await holdingRefs(who);
  if (refs === null) return null;
  const out = new Map<string, bigint[]>();
  for (const r of refs) {
    const k = r.cert.toLowerCase();
    const list = out.get(k);
    if (list) list.push(r.batchId);
    else out.set(k, [r.batchId]);
  }
  return out;
}

/// A token's decimals and symbol. The same token may be referenced by several assets, so it is read
/// only once.
async function tokenMeta(tokens: Address[]): Promise<Map<Address, { decimals: number; symbol: string }>> {
  const out = new Map<Address, { decimals: number; symbol: string }>();
  await Promise.all([...new Set(tokens)].map(async (address) => {
    const [decimals, symbol] = await Promise.all([
      readContractWithFallback({ address, abi: erc20Abi, functionName: "decimals" }),
      readContractWithFallback({ address, abi: erc20Abi, functionName: "symbol" }),
    ]);
    out.set(address, { decimals, symbol });
  }));
  return out;
}

/// The display code recognises only the bare code from the asset catalog (§71.127).
///
/// On chain, `AssetRegistry.assetSymbol()` is the **token** code written in at the moment of
/// registration (WBNB, NVDAB, BTCB); it is the catalog row's `underlying` (BNB, NVDA, BTC) that is
/// the site's public name for it, and the "supported tokens" table further down the staking page has
/// always used that (as the comment on `Asset.underlying` also says). Take one from each side and
/// the same token appears on the same page under two names, **uWBNB** and **uBNB**, looking like two
/// different coins (which the user reported on 2026-09-18).
/// This lays the catalog's name over the on-chain read, matched by contract address, so both sides
/// share one name from then on.
/// (Correcting §71.135: that on-chain code is not in fact unchangeable — `setAssetSymbol(asset,
/// symbol)` does exist, it just takes the owner to call it, so the contract colleague has to send
/// the transaction; the frontend's naming does not depend on it, and the catalog still governs
/// here.)
///
/// 🔴 The catalog passed in has to include **both the listed and the delisted columns** (§71.136):
/// delisted rows are not in the `assets` column of `/assets`, and given only the listed ones,
/// something like BNC — "delisted by the operator, still registered on chain" — has no name to look
/// up and falls back to the on-chain BNCB (which the user reported on 2026-09-18).
///
/// Not found in the catalog (a new pool not entered yet / the endpoint is not configured / the
/// catalog failed to load) → keep the on-chain name as it is, and invent nothing (§29).
/// 🔴 This changes **the card's title only**. The deposit button talks about the token that is
/// actually locked into the contract (`unitSymbol` = the on-chain `symbol()`, "Deposit 0.01331
/// WBNB"), and that sentence has to be true, so it does not follow along.
function catalogNamer(catalog: Asset[]): (addr: Address, onchain: string) => string {
  const byAddr = new Map<string, string>();
  for (const a of catalog) if (a.underlying) byAddr.set(a.address.toLowerCase(), a.underlying);
  return (addr, onchain) => uSym(byAddr.get(addr.toLowerCase()) || onchain);
}

/// The burn certificate contract's own code (`BurnCertificate.symbol()`, with the u prefix →
/// uBNC).
/// Burn certificates are **one instance for the whole site**, so this deduplicates by contract
/// address and reads once per site.
/// Unreadable (a flaky node / an older contract without the function) → it does not enter the map,
/// `certName()` falls back to the asset's own u code, and no name is invented (§29).
///
/// 🔴 §71.138 moved this here from `lib/meme.ts`: the name uBNC used to be needed only by the MEME
/// Lab page, and now the market, the account page and the order book all need it (the Certificate
/// Market started accepting burn certificates), so it has to be written into `Ticker.certSymbol`
/// once inside `loadBoard()`, and every page then gets a board that carries the right name to begin
/// with.
async function certSymbols(certs: Address[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all([...new Set(certs.map((c) => c.toLowerCase()))].map(async (addr) => {
    const s = await readContractWithFallback({ address: addr as Address, abi: burnCertificateAbi, functionName: "symbol" })
      .catch(() => null);
    if (s) out.set(addr, uSym(String(s)));
  }));
  return out;
}

/// The asset board: which assets the registry has, which certificate contract each of them belongs
/// to, how many certs were issued and how many are staked.
/// The old `listedIds()` is no longer needed — one `assets()` call gives every asset at once.
export async function loadBoard(): Promise<Ticker[]> {
  // The catalog is only used to name the cards (§71.127). It is fetched in parallel with the
  // registry, so it costs no extra time; if it cannot be fetched, fall back to the on-chain code.
  // A match endpoint being unreachable must never bring the whole on-chain board down — the two
  // have nothing to do with each other.
  const [assets, catalog]: [Address[], Asset[]] = await Promise.all([
    readContractWithFallback({ ...reg(), functionName: "assets" }),
    // Both the listed and the delisted columns: without the delisted one (still registered on
    // chain), all that can be shown is the on-chain name (§71.136)
    loadAssets().then((s) => [...s.assets, ...s.delisted], () => [] as Asset[]),
  ]);
  const named = catalogNamer(catalog);
  const rows = await Promise.all(assets.map(async (asset) => {
    const [cfg, symbol] = await Promise.all([
      readContractWithFallback({ ...reg(), functionName: "config", args: [asset] }),
      readContractWithFallback({ ...reg(), functionName: "assetSymbol", args: [asset] }),
    ]);
    return { asset, cfg, symbol };
  }));
  const [meta, certSyms] = await Promise.all([
    tokenMeta(rows.map((r) => r.asset)),
    // Read only for burn assets: a redeemable asset has one certificate instance, and the
    // certificate's code and the asset's code are the same thing anyway (§71.138)
    certSymbols(rows.filter((r) => r.cfg.mode !== 0).map((r) => r.cfg.certificate)),
  ]);

  return Promise.all(rows.map(async (r, i) => {
    const m = meta.get(r.asset) ?? { decimals: 18, symbol: "?" };
    const cert = r.cfg.certificate;
    const [issued, pledged] = await totals(cert, r.asset);
    return {
      id: i + 1,
      asset: r.asset,
      cert,
      mode: r.cfg.mode === 0 ? "redeem" : "burn",
      certSymbol: r.cfg.mode === 0 ? undefined : certSyms.get(cert.toLowerCase()),
      symbol: named(r.asset, r.symbol),
      // The class follows the catalog's name too: the kind=2 (MEME) tier has to look the code up in
      // a table, where `WBNB` is not found and `BNB` is
      cls: clsOf(r.cfg.kind, named(r.asset, r.symbol)),
      underlying: r.asset,
      unit: 0n,
      unitDecimals: m.decimals,
      unitSymbol: m.symbol,
      issued,
      pledged,
      status: pledged > 0n ? "live" : issued > 0n ? "rallying" : "dark",
    } as Ticker;
  }));
}

/// How many certs an asset issued and how many are staked = the sum of `totalSupply` /
/// `totalPledged` over every batch in its name.
/// The burn certificate contract (MEME) is one instance for the whole site with other assets'
/// batches mixed into it, so it has to be filtered by `batch(id).asset`.
async function totals(cert: Address, asset: Address): Promise<[bigint, bigint]> {
  const c = { address: cert, abi: redeemableCertificateAbi } as const;
  const count = await readContractWithFallback({ ...c, functionName: "batchCount" });
  let issued = 0n;
  let pledged = 0n;
  for (const block of chunks(count)) {
    const [supplies, batches, held] = await Promise.all([
      Promise.all(block.map((id) => readContractWithFallback({ ...c, functionName: "totalSupply", args: [id] }))),
      Promise.all(block.map((id) => readContractWithFallback({ ...c, functionName: "batch", args: [id] }))),
      Promise.all(block.map((id) => readContractWithFallback({ ...pledgeC(), functionName: "totalPledged", args: [cert, id] }))),
    ]);
    block.forEach((_, k) => {
      if (batches[k].asset.toLowerCase() !== asset.toLowerCase()) return;
      issued += supplies[k];
      pledged += held[k];
    });
  }
  return [issued, pledged];
}

/// Scan one certificate contract and pick out the batches `owner` has a balance in (`balanceOf` for
/// the wallet, `pledgedOf` for the pledge contract).
/// The contract has no view that "lists which batches an address holds", so the only way is to scan
/// the lot — already written into HANDOFF as a request for the colleague to add one.
///
/// Since §71.120 a `hint` can be supplied: the backend index saying "this address has only touched
/// these batches". Supplying it does not guarantee it is used —
/// 🔴 while the total batch count is not above `INDEX_ABOVE`, the full scan is used as before. The
/// full scan only reads the chain and cannot possibly miss anything, and at this size it is one or
/// two seconds slower; the index adds a step, and if it misses a batch the page is short a batch
/// with nobody the wiser.
/// The index only comes into play when there is no working without it. `hint = null` = there is no
/// index, so always scan the lot.
async function lotsOf(t: Ticker, who: Address, where: "wallet" | "pledged", hint: bigint[] | null = null): Promise<Lot[]> {
  const c = { address: t.cert, abi: redeemableCertificateAbi } as const;
  const count = await readContractWithFallback({ ...c, functionName: "batchCount" });
  const out: Lot[] = [];
  // The batch numbers the index supplied still have to be checked against the chain's own
  // `batchCount()`: anything out of range is dropped, in case the platform hands over a number the
  // chain does not have at all and `batch(id)` reverts, dragging the whole page down.
  const picked = hint !== null && count > BigInt(INDEX_ABOVE)
    ? blocksOf(hint.filter((id) => id >= 1n && id <= count).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))
    : chunks(count);
  for (const block of picked) {
    const held = where === "wallet"
      ? await readContractWithFallback({ ...c, functionName: "balanceOfBatch", args: [block.map(() => who), block] })
      : await Promise.all(block.map((id) => readContractWithFallback({ ...pledgeC(), functionName: "pledgedOf", args: [who, t.cert, id] })));
    const hits = block.filter((_, k) => held[k] > 0n);
    if (hits.length === 0) continue;
    const batches = await Promise.all(hits.map((id) => readContractWithFallback({ ...c, functionName: "batch", args: [id] })));
    hits.forEach((id, k) => {
      const b = batches[k];
      // The burn certificate contract is shared site-wide, with other assets' batches mixed in.
      if (b.asset.toLowerCase() !== t.asset.toLowerCase()) return;
      out.push({
        // 🔴 The name goes through `certName`: a burn batch's real name is uBNC (the certificate
        // contract's own code), not the asset's own uSTOCKDOG — that certificate cannot be
        // exchanged back for dog coins, because the tokens went into the burn address the moment it
        // was minted (§71.138)
        cert: t.cert, batchId: id, tickerId: t.id, symbol: certName(t),
        n: held[block.indexOf(id)],
        assetPerCert: b.assetPerCert, mintPrice1e18: b.mintPrice1e18, mintedAt: Number(b.mintedAt),
        underlying: t.underlying, unit: t.unit, unitDecimals: t.unitDecimals, unitSymbol: t.unitSymbol,
      });
    });
  }
  return out.sort((a, b) => (a.batchId < b.batchId ? -1 : a.batchId > b.batchId ? 1 : 0));
}

/// My staked positions (the `CertificatePledge` ledger). One card per asset, with a row per batch
/// inside it.
/// There is no warm-up and no lock-up (the user cancelled the 7-day warm-up on 2026-09-15 in favour
/// of alignment to a 15-minute clock; see `nextSnapshot` in lib/arena.ts).
export async function loadHoldings(who: Address, board: Ticker[]): Promise<Holding[]> {
  const byCert = await refsByCert(who);
  const rows = await Promise.all(board.map(async (t) => {
    if (t.offchain) return null;
    // A certificate contract the index does not mention = this address has touched no batch of it
    // at all, and `[]` is the answer (not "unknown").
    const lots = await lotsOf(t, who, "pledged", byCert ? byCert.get(t.cert.toLowerCase()) ?? [] : null);
    if (lots.length === 0) return null;
    return {
      // A burn asset's position card is called uBNC too (§71.138), from the same source as the name
      // `lotsOf` writes into every batch
      id: t.id, symbol: certName(t), cert: t.cert, lots,
      total: lots.reduce((s, l) => s + l.n, 0n),
      underlying: t.underlying, unit: t.unit, unitDecimals: t.unitDecimals, unitSymbol: t.unitSymbol,
    } as Holding;
  }));
  return rows.filter((h): h is Holding => h !== null);
}

/// The certificates in the wallet that are **not staked**: to sell some, stake some or redeem some,
/// the batches on hand have to be known first.
/// 🔴 This is the **one exception** to §69.16 "the frontend does not read the contents of a user's
/// wallet" (decided by the user, 2026-09-15): it lists only the asset certificates we issued
/// ourselves, and the wallet's USDT balance, asset-token balances and MEME-token balances are all
/// still never read.
export async function loadLots(who: Address, board: Ticker[]): Promise<Lot[]> {
  const byCert = await refsByCert(who);
  const rows = await Promise.all(board.map((t) => (t.offchain
    ? Promise.resolve([])
    : lotsOf(t, who, "wallet", byCert ? byCert.get(t.cert.toLowerCase()) ?? [] : null))));
  return rows.flat();
}


/// The deposit quote for each asset, keyed by `Ticker.id`.
/// An asset that cannot be quoted does not enter this map (the pool has no liquidity, or the V3
/// spot price deviates from the TWAP beyond the limit and `PriceDeviationTooHigh` reverts outright)
/// — the interface shows "—" and disables depositing, and no number is guessed (§25 / §29).
export async function loadMintQuotes(board: Ticker[]): Promise<Map<number, MintQuote>> {
  const out = new Map<number, MintQuote>();
  await Promise.all(board.map(async (t) => {
    if (t.offchain) return;
    // `faceValue()` / `mintPaused()` / `oracle()` have identical signatures on redeemable and burn
    // certificates (they all live in `CertificateBase`), so both families share this stretch; what
    // really forks is "how to mint", handled by `mode` in App's `deposit()`.
    const c = { address: t.cert, abi: redeemableCertificateAbi } as const;
    try {
      const [faceValue, certPaused, cfg, oracle, enabled] = await Promise.all([
        readContractWithFallback({ ...c, functionName: "faceValue" }),
        readContractWithFallback({ ...c, functionName: "mintPaused" }),
        readContractWithFallback({ ...reg(), functionName: "config", args: [t.asset] }),
        readContractWithFallback({ ...c, functionName: "oracle" }),
        // Burn certificates gained a token list of their own in v2 (§71.119): minting reverts with
        // `AssetNotEnabled` for anything not on the list. Read it up front and fold it into
        // `paused` so the card greys out directly — better than letting someone finish signing and
        // then eat a revert (§29).
        // 🔴 This one `.catch`es to "allowed" on its own: burn certificates from an early
        // deployment do not have the function, and switching off an asset that actually works
        // because the read failed is worse than letting it through; when minting really is
        // impossible the contract's own check is still there, and the error just arrives later.
        t.mode === "burn"
          ? readContractWithFallback({
              address: t.cert, abi: burnCertificateAbi, functionName: "isAssetEnabled", args: [t.asset],
            }).catch(() => true)
          : Promise.resolve(true),
      ]);
      const [assetAmount, spotPrice1e18] = await readContractWithFallback({
        address: oracle, abi: priceOracleAbi, functionName: "quoteForFaceValue", args: [t.asset, faceValue],
      });
      out.set(t.id, {
        assetPerCert: assetAmount + 1n,
        faceValue,
        spotPrice1e18,
        paused: certPaused || cfg.mintPaused || !enabled,
      });
    } catch {
      // No quote, no entry in the map. The interface shows "—" and disables depositing, which beats
      // reporting a guessed number.
    }
  }));
  return out;
}

