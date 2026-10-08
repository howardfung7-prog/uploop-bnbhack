/// The certificate secondary market (DECISIONS.md §33, §71.80): fixed-price USDT listings, with
/// the contract holding the certificates in escrow.
/// Since §71.80 the id is the **batch**: one listing = N certs from the same batch at one unit
/// price, and partial fills are supported (buy as many as you want).
/// The interface only shows each asset's **current floor price** (the cheapest per-cert listing
/// among the active ones) and how many tokens one cert of that batch holds; no trade history, no
/// average price, no chart — the user explicitly asked for the same feel as an NFT market, where
/// only the floor matters.
/// Every number comes from the on-chain `CertificateMarket`; with the contract not configured,
/// nothing is shown and nothing is guessed.
import { tr } from "./i18n";
import type { Address } from "viem";
import { addresses, publicClient, SCAN_CHUNK, INDEX_ABOVE } from "./chain";
import { listingRefs } from "./certindex";
import { certificateMarketAbi, redeemableCertificateAbi } from "./abi.certs";
import type { Ticker } from "./board";
import { sortListings } from "./market-model";
import type { Listing } from "./market-model";
export * from "./market-model";

const market = () => ({ address: addresses.market as Address, abi: certificateMarketAbi });

/// Listing status: 0 NONE / 1 ACTIVE / 2 FILLED / 3 CANCELLED (ICertificateMarket.Status).
const ACTIVE = 1;

/// Which listing ids to read this round, cut into multicall chunks.
///
/// §71.120: the backend index can name "which listing ids are live right now" directly, narrowing
/// `listingCount()` entries down to a few dozen.
/// 🔴 But three situations always fall back to the full scan (1 up to `listingCount()`):
///   1. the index is unusable (no backend wired up / the platform is down) — `listingRefs()`
///      returns `null`;
///   2. 🔴 the index says it **did not get through them all** (`truncated`) — a half-read order
///      book looks exactly like a complete one, the floor price would be wrong, and a wrong floor
///      price is something people place orders against (§29);
///   3. the listing count is not above `INDEX_ABOVE` — at that size the full scan takes a second
///      or two, and there is no reason to assume the platform has missed nothing just to save
///      that.
async function blocks(count: bigint): Promise<bigint[][]> {
  const cut = (ids: bigint[]): bigint[][] => {
    const out: bigint[][] = [];
    for (let i = 0; i < ids.length; i += SCAN_CHUNK) out.push(ids.slice(i, i + SCAN_CHUNK));
    return out;
  };
  if (count > BigInt(INDEX_ABOVE)) {
    const got = await listingRefs();
    if (got && !got.truncated) {
      const ids = got.refs
        .map((r) => r.listingId)
        .filter((id) => id >= 1n && id <= count)     // do not read ids the chain does not have; a revert would drag the whole page down
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      return cut(ids);
    }
    if (got?.truncated) console.warn(tr("[cert] The listing index did not get through them all; falling back to the full scan (slow, but the floor price is certain to be right)"));
  }
  const all: bigint[] = [];
  for (let i = 1n; i <= count; i++) all.push(i);
  return cut(all);
}

/// Every active listing on the site, cheapest per cert first.
///
/// 🔴 The contract has no "listings by asset" view, only `listingCount()` + `listing(id)`, so the
/// only way is to scan from 1 up to listingCount() in multicall chunks (the same approach as the
/// batch scan, see lib/board.ts).
/// The long-term fix is for the backend to index the `Listed` / `Purchased` / `Cancelled` events,
/// which is already written into HANDOFF.
///
/// Only listings priced in USDT are taken (the user, 2026-09-15: listings take USDT only). The
/// contract itself still allows BNB and other ERC-20s; the interface never shows them and offers
/// no currency choice. Before launch, ask the contract colleague to turn BNB off
/// (`setPaymentToken(address(0), false)`).
export async function loadListings(board: Ticker[]): Promise<Listing[]> {
  const count = await publicClient.readContract({ ...market(), functionName: "listingCount" });
  const usdt = addresses.usdt.toLowerCase();
  const out: Listing[] = [];
  for (const ids of await blocks(count)) {
    const rows = await Promise.all(ids.map((id) =>
      publicClient.readContract({ ...market(), functionName: "listing", args: [id] })));
    const live = ids
      .map((id, k) => ({ id, l: rows[k] }))
      .filter(({ l }) => l.status === ACTIVE && l.remaining > 0n && l.currency.toLowerCase() === usdt);
    if (live.length === 0) continue;
    // How many tokens one cert holds is known only to the certificate contract, not to the
    // listing — fill it in with one batch() call per row.
    const batches = await Promise.all(live.map(({ l }) =>
      publicClient.readContract({ address: l.certificate, abi: redeemableCertificateAbi, functionName: "batch", args: [l.id] })));
    live.forEach(({ id, l }, k) => {
      const b = batches[k];
      const t = board.find((x) =>
        x.cert.toLowerCase() === l.certificate.toLowerCase() && x.asset.toLowerCase() === b.asset.toLowerCase());
      if (!t) return;   // an asset that is not on our board (just listed, frontend not refreshed yet): not shown, not guessed
      out.push({
        id, seller: l.seller, cert: l.certificate, batchId: l.id, tickerId: t.id,
        remaining: l.remaining, unitPrice: l.unitPrice, assetPerCert: b.assetPerCert,
      });
    });
  }
  return sortListings(out);
}

export async function loadFeeBps(): Promise<number> {
  return Number(await publicClient.readContract({ ...market(), functionName: "feeBps" }));
}

