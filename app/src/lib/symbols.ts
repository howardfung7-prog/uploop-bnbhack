/// The site-wide list of assets (the definition used to live inside `Ribbon.tsx`, §71.53; pulled
/// out on 2026-09-15 so the ticker tape and the background code wall share one copy, §71.73).
///
/// The list = pools on chain + pools opened by the operator (§71.51) + tokens already listed in
/// the asset catalog that have a quote, deduplicated by display symbol.
/// 🔴 **It does not wait for the chain**: while the contracts are not yet deployed to BNB Chain
/// `board` is empty, and the catalog carries the list — so the tape does not sit on "No assets
/// yet" forever and the background wall does not vanish entirely.
/// A catalog token with no quote does not enter the list (since §71.94 a price has two legs:
/// catalog tokens use their own spot pair on Binance **spot**, bare tickers use **perpetuals**;
/// with neither there is no price). If quotes could not be fetched at all (not configured, not
/// reachable) the list stands as it is, and each surface says so in its own words (§29).
import type { AssetsState } from "./assets";
import type { Ticker } from "./board";
import type { Quote, Quotes } from "./quotes";
import { quoteOf } from "./quotes";
import { assetClassOf, uSym } from "./ticker";

export interface SymbolRow {
  /// Display symbol (uNVDA)
  sym: string;
  /// undefined when there is no price — the UI shows "—", never a stale price and never an
  /// invented one (§25)
  quote: Quote | undefined;
  /// The on-chain (or operator-opened) pool; absent for catalog-only assets
  pool: Ticker | undefined;
}

export function symbolRows(board: Ticker[], assets: AssetsState, quotes: Quotes): SymbolRow[] {
  const rows: SymbolRow[] = [];
  const seen = new Set<string>();
  for (const t of board) {
    if (seen.has(t.symbol)) continue;
    seen.add(t.symbol);
    // The lookup order (token spot first, then bare-ticker perpetual) exists once, in `quoteOf`:
    // this used to be a copy, and a copy drifts from the staking page within a day (§71.94)
    rows.push({ sym: t.symbol, quote: quoteOf(quotes, t), pool: t });
  }
  for (const a of assets.assets) {
    const sym = uSym(a.underlying || a.ticker);
    if (seen.has(sym)) continue;
    // The same fallback (pair spot price first, then bare-ticker perpetual; since §71.95 the key
    // is the pair itself), on the same footing as the staking page's "supported tokens" list
    const quote = quoteOf(quotes, { symbol: sym, pair: a.pair });
    if (!quote && quotes.size > 0) continue;  // quotes are running but this one has none → neither leg has it, so no placeholder
    seen.add(sym);
    rows.push({ sym, quote, pool: undefined });
  }
  return rows;
}

/// The major coins mixed into the ticker tape, as bare tickers (wrapped in `uSym()` for display →
/// uBTC; §71.75, these six named by the user on 2026-09-15).
///
/// Why not fold in all 24 coins from the quote table the way the background wall does (§71.74):
/// every tape cell carries a price and a change, so one full scroll takes as long as the cell
/// count — add more coins and the equities get pushed out of sight. Six is the user's number; add
/// or remove by editing this line.
/// The coins cannot come from the asset catalog (`GET /assets`) either — that table needs a token
/// contract address on BNB Chain and only accepts Binance equity tokens, so like the background
/// wall they come from the quote table.
export const TAPE_COINS = ["BTC", "ETH", "SOL", "DOGE", "AVAX", "BNB"];

/// Mix `TAPE_COINS` into the list at random and return the new list.
///
/// "Random" on two levels: the order of the six coins is shuffled (Fisher–Yates), and so are their
/// landing spots — though not by picking six indices outright. The list is cut into six bands and
/// one position is drawn inside each: pure randomness occasionally puts several coins next to each
/// other or all at the front, which amounts to not mixing at all.
///
/// 🔴 Only coins that really do have a price are mixed in: while quotes have not loaded, or the
/// endpoint is not configured, none are added and the tape is left to say "Market data not
/// configured" (§29 does not pretend there is market data; §25 does not use "—" as a placeholder).
/// These six are **repositioned whether or not they were already in the list**: a coin with an
/// on-chain pool, or one from the demo data, is lifted out of the list first (the whole row moves,
/// pool and active state included, so the tape still shows it at the right intensity) and then
/// shuffled and spread out together with the added ones.
/// Otherwise they would sit untouched side by side — both the on-chain `board` and the demo data
/// group the coins together, and then the mixing would not show.
export function mixTapeCoins(rows: SymbolRow[], quotes: Quotes, seed: number): SymbolRow[] {
  const want = new Set(TAPE_COINS.map(uSym));
  const has = new Map(rows.map((r) => [r.sym, r]));
  const coins: SymbolRow[] = [];
  for (const code of TAPE_COINS) {
    const sym = uSym(code);
    const row = has.get(sym);
    if (row) coins.push(row);
    else if (quotes.has(code)) coins.push({ sym, quote: quotes.get(code), pool: undefined });
  }
  if (coins.length === 0) return rows;
  const rest = rows.filter((r) => !want.has(r.sym));

  const rand = rng(seed);
  for (let i = coins.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [coins[i], coins[j]] = [coins[j], coins[i]];
  }

  const band = rest.length / coins.length;
  const out: SymbolRow[] = [];
  let at = 0;
  for (let i = 0; i < coins.length; i++) {
    // A random spot inside the band, always at least one cell along, so the next coin does not
    // land right beside the previous one
    const to = Math.min(rest.length, Math.max(at + 1, Math.floor(i * band + rand() * band)));
    out.push(...rest.slice(at, to), coins[i]);
    at = to;
  }
  out.push(...rest.slice(at));
  return out;
}

/// Replayable random numbers (mulberry32).
///
/// 🔴 Not `Math.random()`: the tape re-renders every 30 seconds when quotes refresh, and rolling
/// the dice on the spot would move every landing spot — a scrolling tape would jump and the coins
/// would change places. The seed is fixed for one page load (the number `Ribbon` holds in
/// `useState`); the same seed plus the same list always shuffles the same way, so it changes on
/// refresh and stays still while you watch it.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/// Display symbols for the major cryptocurrencies (uBTC, uETH…), sorted by symbol.
///
/// The source is the keys in `GET /quotes` that **actually carry a price** — the majors are all in
/// Binance's USDT-margined perpetuals table (§71.26; since §71.94 quotes also have a spot leg, but
/// its keys are the pairs themselves (BTCUSDT, NVDABUSDT, §71.95), which `assetClassOf()` does not
/// read as crypto, so they neither slip in nor list a coin twice).
/// There is no second hand-written list, so a coin the site cannot price can never appear here.
/// Which keys count as crypto is decided by `assetClassOf()` (the CRYPTO table in `lib/ticker.ts`),
/// the same line the asset market uses to group its pools — that table *is* the definition of
/// "major", and changing it changes both at once (§27).
export function cryptoSymbols(quotes: Quotes): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const code of quotes.keys()) {
    if (assetClassOf(code) !== "crypto") continue;
    const sym = uSym(code);
    if (seen.has(sym)) continue;
    seen.add(sym);
    out.push(sym);
  }
  return out.sort();
}
