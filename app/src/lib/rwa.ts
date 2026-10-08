/// The on-chain price of each listed bStock, from **Binance Web3 API · RWA Data** (§71.189).
///
/// The Web3 API signs every request with a secret key (HMAC-SHA256), so the browser never calls it:
/// the api process runs a background thread that asks `GET /rwa/price` for every staked equity
/// token in one batch every 30 seconds, and `GET /rwa-prices` only reads that memory
/// (core/uploop/prices/rwa.py).
/// 🔴 Display only: the card shows it as a second line under the conversion (the token's own price
/// on BNB Chain, and how far it sits from the Binance spot price at the top right). It does not
/// feed deposits, quotes or settlement.
/// Keys not configured, the table stale (5 minutes without a successful refresh), or an asset with
/// no row → the line is simply not drawn (§25: never a stale price, never an invented one).
import { useEffect, useState } from "react";
import { apiGet, arenaConfigured } from "./api";
import { demoRwaPrices, isDemo } from "./demo";
import { PRICE_SCALE, QUOTE_MS } from "./quotes";

export interface RwaPrice {
  /// The token's on-chain price in USDT, 1e8 scale (same as /quotes)
  price: bigint;
  /// Unix second of the price on the source side; null = the source did not say
  at: number | null;
}
/// lowercase token contract address → on-chain price
export type RwaPrices = Map<string, RwaPrice>;

interface RwaRow { token_price: string; updated_at?: number | null }
interface RwaDoc { enabled: boolean; stale: boolean; prices: Record<string, RwaRow> }

/// A positive decimal string ("120.5", "0.000123") → 1e8-scale integer; anything else → null.
/// Digits past the eighth decimal are cut, the same as every other price on the site.
export function toScaled(s: string): bigint | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s.trim());
  if (!m) return null;
  const v = BigInt(m[1]) * PRICE_SCALE + BigInt((m[2] ?? "").slice(0, 8).padEnd(8, "0"));
  return v > 0n ? v : null;
}

export async function loadRwaPrices(): Promise<RwaPrices> {
  const out: RwaPrices = new Map();
  if (!arenaConfigured()) return out;
  const d = await apiGet<RwaDoc>("/rwa-prices");
  if (!d.enabled || d.stale) return out;
  for (const [addr, r] of Object.entries(d.prices ?? {})) {
    const price = toScaled(String(r.token_price ?? ""));
    if (price !== null) out.set(addr.toLowerCase(), { price, at: r.updated_at ?? null });
  }
  return out;
}

/// Polled every 30 seconds. A failed poll keeps the last table: the server already empties it once
/// it is 5 minutes old, so what is kept is never older than that.
export function useRwaPrices(): RwaPrices {
  const [prices, setPrices] = useState<RwaPrices>(() => new Map());
  useEffect(() => {
    let alive = true;
    const demo = isDemo();
    const pull = () => (demo ? Promise.resolve(demoRwaPrices()) : loadRwaPrices())
      .then((p) => { if (alive) setPrices(p); }, () => {});
    void pull();
    const t = setInterval(pull, QUOTE_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return prices;
}

/// The on-chain price against the spot price, in percent truncated to two decimals
export function rwaGap(onchain: bigint, spot: bigint): number | null {
  if (spot <= 0n) return null;
  return Number(((onchain - spot) * 10000n) / spot) / 100;
}
