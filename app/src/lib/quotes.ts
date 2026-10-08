/// Live asset prices (DECISIONS §71): the `$120.00` in the top-right corner of every pool card on
/// the staking page plus the change below it (§71.8; always against 24 hours ago), and the
/// conversion line "$10 = how many tokens" (§71.9 — amounts on cards are written with `$`, meaning
/// priced in USDT).
///
/// The data comes from the arena API's `GET /quotes` (core/uploop/prices/quotes.py: a background
/// thread pulls Binance market data and the endpoint only reads memory).
/// Since §71.94 there are **two legs**, matching the three-family model the user laid down
/// ("a staked asset … uses the spot price at staking time / an arena strategy uses the perpetual
/// price to compute the return"):
///   · **the spot leg**: for each catalog row that has a token, that token's Binance spot 24-hour
///     data, **keyed by the pair itself** (NVDABUSDT, BTCUSDT, §71.95). **This is what the staking
///     side reads**;
///   · **the perpetual leg**: the bare ticker's Binance USDⓈ-M perpetual 24-hour data (keys NVDA,
///     BTC). This is what the arena side reads, from the same source as settlement (§71.33).
/// The two sets of keys cannot collide (a pair carries the USDT suffix, a bare ticker does not),
/// so they sit side by side in one table. NVDA and NVDABUSDT are therefore two different numbers
/// (the basis), and that is deliberate.
/// Since §71.54 this is not merely a reference: one certificate is a fixed $10, and **how many
/// tokens that buys is computed live from these prices** (re-quoted every 30 seconds, `QUOTE_MS`)
/// instead of being filled in by the operator in advance (overturning §52.1).
/// The quantity quoted is the one at that instant; the price may have moved by the time the
/// deposit actually lands, so `withSlip()` allows 1% of headroom (a fall in price means the same
/// $10 buys more).
/// Endpoint not configured, quotes stale, or an asset with neither leg → that asset shows "—"
/// (§25): never a stale price, never an invented one.
/// Prices are integers on a 1e8 scale (matching PRICE_SCALE in core/uploop/fixed.py), keyed by the
/// bare ticker (NVDA, BTC — perpetual) or the spot pair (NVDABUSDT, BTCUSDT).
/// `open` is the baseline for the change: the opening price of that leg's own 24-hour window
/// (prices come from Binance only, never from a US equity exchange feed, §71.26).
/// The change is computed in the frontend: (price − open) / open; with no open the change line
/// shows "—" and the price is still shown.
import { apiGet, arenaConfigured, serverNow } from "./api";
import { bareSym } from "./ticker";
import type { Unit } from "./board";

export const PRICE_SCALE = 100_000_000n;
/// The face value of one certificate: $10 (the user's words, "we fix every certificate at ten
/// dollars", §71.54; cards write `$10`, §71.9; elsewhere on the site it is still written in USDT,
/// §22)
export const FACE_USDT = 10n;
/// The re-quote interval in milliseconds: "$10 = how many tokens" is recomputed at the new price
/// every 30 seconds (§71.54)
export const QUOTE_MS = 30_000;
/// Shared with the backend race preview: all UI quote consumers hide data
/// after the same 15-second window.
export const MARKET_MAX_AGE_SECONDS = 15;
/// The headroom on the quantity: 1% (§71.54, "the token quantity may drift up by 1%"). The price
/// moves between two quotes, and a fall means the same $10 buys more, so this is the ceiling
export const SLIP_BPS = 100n;

export interface Quote {
  pair: string;
  /// 1e8 scale
  price: bigint;
  /// The baseline for the change (the Binance 24-hour window open, on both the spot and the
  /// perpetual leg, §71.94), 1e8 scale; 0n = the source did not provide one
  open: bigint;
  /// The Unix second at which the server fetched this price
  at: number;
}
/// bare ticker → quote
export type Quotes = Map<string, Quote>;

/// The `quotes` block of `GET /quotes`: key → quote. Both legs sit in one table (§71.94) and the
/// keys cannot collide:
///   · a bare ticker (NVDA, BTC, from the perpetuals table in symbols.json) = the **perpetual**
///     price, the arena side, from the same source as settlement (§71.33);
///   · a spot pair (NVDABUSDT, BTCUSDT — the `pair` of a catalog row that has a token; since
///     §71.95 the key is the pair itself) = the **spot** price, the staking side, and what the
///     cards and the "supported tokens" list show. The frontend looks up the catalog's own `pair`
///     column rather than assembling one.
/// So NVDA and NVDABUSDT are two different numbers (the basis), and §71.56's "one and the same
/// curve" is void.
/// An asset present on neither leg is absent from the table → "—" (§25).
export const emptyQuotes = (): Quotes => new Map();

interface QuoteRow { pair?: string; price: string; open?: string; at: number; stale?: boolean }
interface QuotesDoc {
  enabled: boolean;
  at: number | null;
  stale: boolean;
  stale_after?: number;
  scale: string | number;
  quotes: Record<string, QuoteRow>;
}

/// Fetch a quote table. Every kind of "not trustworthy" returns an empty table (cards then show
/// "—"): no API configured, the source disabled, the whole table stale, the scale not matching.
/// A single quote whose `at` is more than `stale_after` behind the table's own `at` is dropped
/// too (the stale price carried over while an asset is halted must not be shown).
export async function loadQuotes(): Promise<Quotes> {
  const out = emptyQuotes();
  if (!arenaConfigured()) return out;
  const d = await apiGet<QuotesDoc>("/quotes");
  if (!d.enabled || d.stale || Number(d.scale) !== Number(PRICE_SCALE)) return out;
  const at = serverNow();
  const staleAfter = Number(d.stale_after ?? MARKET_MAX_AGE_SECONDS);
  fillRows(out, d.quotes ?? {}, at, staleAfter);
  return out;
}

/// One table, row by row, into the Map; a missing `pair` means the code itself (the equity feed
/// leg has no trading pair). A bad number drops that row alone rather than taking the whole quote
/// table down.
function fillRows(into: Quotes, rows: Record<string, QuoteRow>, at: number, staleAfter: number): void {
  for (const [sym, q] of Object.entries(rows)) {
    let price: bigint;
    try {
      price = BigInt(q.price);
    } catch {
      continue;
    }
    if (price <= 0n) continue;
    // One asset has not come back for a long time (trading halted) → hide that one, leave the rest
    const age = at - Number(q.at);
    if (q.stale || !Number.isFinite(age) || age < 0 || age > staleAfter) continue;
    let open = 0n;
    try {
      open = BigInt(q.open ?? "0");
    } catch {
      open = 0n;
    }
    into.set(sym.toUpperCase(), { pair: q.pair ?? sym, price, open: open > 0n ? open : 0n, at: Number(q.at) });
  }
}

/// One asset's quote: **look up the spot pair first** (`pair`: NVDABUSDT / BTCUSDT, the token's
/// own Binance spot price), and only then fall back to the bare ticker (uNVDA → NVDA's perpetual
/// price).
///
/// Since §71.94 the staking side must show **the token's own spot price** (the user's rule, "a
/// staked asset … uses the spot price at staking time"); the bare-ticker leg is the perpetual
/// price and belongs to the arena side (same source as settlement, §71.33). Since §71.95 the spot
/// leg is keyed by the pair itself, so what is needed here is the catalog's `pair` column: cards
/// for on-chain pools get their `pair` from the catalog by contract address via `withPairs()`,
/// and operator-opened pools and the "supported tokens" list already carry it.
/// Only with no `pair` at all (the asset is not in the catalog, or the operator cleared its pair)
/// does it fall back to the perpetual price — better than a screen full of "—", though the two
/// numbers differ slightly (the basis), which is a known tradeoff.
/// 🔴 It does not look up by token symbol (NVDAB) and does not assemble `ticker + USDT` itself:
/// the key comes from the backend, out of the catalog, and the frontend does not guess (§71.34).
/// The staking page, the market page and the account page all need this pair of fallbacks;
/// copying it around would leave one of them behind, so it lives here once.
export function quoteOf(quotes: Quotes, t: { symbol: string; pair?: string }): Quote | undefined {
  return (t.pair ? quotes.get(t.pair.toUpperCase()) : undefined) ?? quotes.get(bareSym(t.symbol));
}

/// How many tokens (in base units) $10 buys: 10 × 1e8 × 10^dec / price. Since §71.54 this is the
/// token quantity behind one certificate (recomputed every 30 seconds)
export function tokensPerFace(u: Unit, q: Quote): bigint {
  return (FACE_USDT * PRICE_SCALE * 10n ** BigInt(u.unitDecimals)) / q.price;
}

/// Add the 1% headroom (§71.54): the price moves between the quote and the actual deposit, and
/// this is the ceiling on how much more may be paid
export function withSlip(tokens: bigint): bigint {
  return (tokens * (10_000n + SLIP_BPS)) / 10_000n;
}

/// Roughly how many dollars one certificate (unit tokens) is worth (priced in USDT, 1e8 scale).
/// An on-chain pool's unit is fixed on chain, and this checks whether it really is worth $10
export function unitValue(u: Unit, q: Quote): bigint {
  return (u.unit * q.price) / 10n ** BigInt(u.unitDecimals);
}

/// Fixed-point integer (decimals decimal places) → human readable: at 1 and above, two decimal
/// places with thousands separators; below 1, four significant figures with trailing zeros kept
/// (0.2000, 0.0004213), so the number of digits in a price stays steady.
/// Staking pool quotes are 8 decimals (fmtQuote), MEME on-chain prices are 18 (fmtPrice in
/// lib/meme.ts) — one function for both.
export function fmtScaled(v: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const fs = (v % base).toString().padStart(decimals, "0");
  if (whole > 0n) return `${whole.toLocaleString()}.${fs.slice(0, 2).padEnd(2, "0")}`;
  if (v === 0n) return "0";
  const lead = fs.length - fs.replace(/^0+/, "").length;
  return `0.${fs.slice(0, Math.min(decimals, lead + 4))}`;
}

/// A 1e8-scale price (/quotes) → human readable
export const fmtQuote = (price: bigint): string => fmtScaled(price, 8);

/// A 1e8-scale price → `$120.00` (the format the user chose in §71.8: dollar sign first, digits as
/// in fmtQuote)
export const fmtUsd = (price: bigint): string => `$${fmtQuote(price)}`;

/// The change against `open`, as a percentage truncated to two decimal places; null with no open
export function change24h(q: Quote): number | null {
  if (q.open <= 0n) return null;
  return Number(((q.price - q.open) * 10000n) / q.open) / 100;
}

/// A change → human readable: `+2.35%` / `−1.20%` / `0.00%` (the minus sign is U+2212, matching
/// profit and loss on the account page)
export function fmtChange(pct: number): string {
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

/// A token amount (base units) → human readable: no decimals at 1000 and above, two below that,
/// and four significant figures under 1.
export function fmtAmount(raw: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  if (whole >= 1000n || decimals === 0) return whole.toLocaleString();
  const frac = raw % base;
  const fs = frac.toString().padStart(decimals, "0");
  if (whole >= 1n) {
    const f = fs.slice(0, 2).replace(/0+$/, "");
    return f ? `${whole.toLocaleString()}.${f}` : whole.toLocaleString();
  }
  if (frac === 0n) return "0";
  const lead = fs.length - fs.replace(/^0+/, "").length;
  const f = fs.slice(0, Math.min(decimals, lead + 4)).replace(/0+$/, "");
  return f ? `0.${f}` : "0";
}
