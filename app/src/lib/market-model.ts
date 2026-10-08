/// The market's data types and the pure helpers around them — no chain reads, no viem (§71.174).
/// Split out of market.ts so App can sort listings and work out floors without pulling the RPC code
/// into the main bundle; market.ts re-exports everything here, so `from "./market"` keeps working.
import type { Address } from "viem";

/// The cheapest single cert currently on sale for one asset.
export interface Floor {
  /// USDT per cert (smallest unit)
  unitPrice: bigint;
  /// Which batch the cheapest one belongs to (ids repeat across certificate contracts, so always
  /// write it together with the asset when displaying it)
  batchId: bigint;
  /// How many tokens one cert of that batch holds, in the token's smallest unit — cheap may mean
  /// nothing more than "holds less"
  assetPerCert: bigint;
}

export interface Listing {
  /// Listing id (the on-chain listingId, starting at 1)
  id: bigint;
  seller: Address;
  /// Which certificate contract the certs being sold belong to
  cert: Address;
  /// Which batch
  batchId: bigint;
  /// Which asset it belongs to (= Ticker.id, a local index)
  tickerId: number;
  /// How many certs are still for sale. The contract supports partial fills, so this shrinks as
  /// they sell
  remaining: bigint;
  /// USDT per cert (smallest unit)
  unitPrice: bigint;
  /// How many tokens one cert of this batch holds, in the token's smallest unit (filled in from
  /// batch(), because the interface has to show it)
  assetPerCert: bigint;
}

/// Ask price ascending, ties broken by listing id.
///
/// 🔴 `floorsOf` takes entry 0 of the sorted list, so any order book that is **assembled** has to
/// go through this function first — in demo mode the market page joins two sections (the
/// redeemable ones and the burn ones, §71.138), each sorted on its own but unsorted once joined,
/// and without sorting the floor price would not match the first row of the book (§29).
export function sortListings(listings: Listing[]): Listing[] {
  return [...listings].sort((a, b) => (a.unitPrice < b.unitPrice ? -1 : a.unitPrice > b.unitPrice ? 1 : Number(a.id - b.id)));
}

/// The floor price per asset; assets with no listing are absent from the map. The argument must
/// come from `loadListings` (already sorted by unit price ascending).
export function floorsOf(listings: Listing[]): Map<number, Floor> {
  const out = new Map<number, Floor>();
  for (const l of listings) {
    if (out.has(l.tickerId)) continue;   // already ascending, so the first one is the floor
    out.set(l.tickerId, { unitPrice: l.unitPrice, batchId: l.batchId, assetPerCert: l.assetPerCert });
  }
  return out;
}

/// Every active listing for one asset, cheapest per cert first.
export function listingsOf(listings: Listing[], tickerId: number): Listing[] {
  return listings.filter((l) => l.tickerId === tickerId);
}

/// The ones I listed.
export function myListings(listings: Listing[], me: Address): Listing[] {
  const who = me.toLowerCase();
  return listings.filter((l) => l.seller.toLowerCase() === who);
}

/// The listing at the floor price (smallest id on a tie); used by "buy at the floor price".
export function floorListing(listings: Listing[]): Listing | null {
  return listings[0] ?? null;
}

/// 250 → "2.5%", 100 → "1%". Only used to display the feeBps read from the chain; the rate is
/// never hard-coded.
export function fmtBps(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : bps % 10 === 0 ? 1 : 2)}%`;
}

/// What buying n certs costs: the buyer pays the asking price (§33.4), and the fee comes out of
/// what the seller receives.
export function costOf(l: Listing, n: bigint): bigint {
  return l.unitPrice * n;
}
