import type { CSSProperties } from "react";
import type { AssetsState } from "../lib/assets";
import type { Ticker } from "../lib/board";
import type { Quotes } from "../lib/quotes";
import { cryptoSymbols, symbolRows } from "../lib/symbols";
import { assetClassOf } from "../lib/ticker";

/// The site-wide background "wall of real asset codes" (there since §24; moved out of the home-page
/// hero and across the whole site on 2026-09-15 at the user's request, §71.73).
///
/// It is wallpaper and nothing more: the asset codes on the list (uNVDA, uBTC…) tiled across a
/// screenful, rotated −5°, at 5% opacity, fixed to the viewport so it does not scroll.
/// It used to live only inside the home-page hero (`.hero-wall`), and its list only knew the
/// on-chain `board` — with no contract deployed `board` was empty, the whole wall failed to render,
/// and what the user saw was "the background pattern has gone".
/// The list now goes through `lib/symbols.ts` (on-chain pools + pools the operator has opened +
/// catalog tokens that have a price), the same one the price ribbon uses, and does not wait on the
/// chain.
///
/// **One cell in five is a crypto asset** (§71.74, the user on 2026-09-15: "do not make it all
/// stocks").
/// The catalog is nothing but Binance equity tokens, so tiling it straight out fills the wall with
/// stock codes. The coins are majors that genuinely have a price in `GET /quotes`
/// (`cryptoSymbols()`), mixed in at 1:4 and spread evenly rather than piled at the end. They are
/// written with the same `u` prefix as the equities (uBTC, uETH, §ticker).
///
/// 🔴 Only codes from the real list go on the wall; if the list is empty (catalog not configured,
/// or not fetched yet) the whole thing does not render — no invented codes to pad it out (§29).
/// Codes with an on-chain pool are shaded in three grades by status (`live` / `rallying` / `dark`),
/// while those only in the catalog or the quote table get one flat shade — which makes this wall
/// incidentally a map of "which assets are in play", not a randomly printed pattern.
/// `aria-hidden` + `pointer-events: none`: for the eyes only. It blocks no clicks and a screen
/// reader will not read it out.
export function SiteWall({ board, assets, quotes, animated = false }: { board: Ticker[]; assets: AssetsState; quotes: Quotes; animated?: boolean }) {
  const rows = symbolRows(board, assets, quotes);

  // Two heaps: coins in one, everything else (stocks, gold, oil and so on) in the other. Coins
  // already on the list (those with an on-chain pool) go in the coin heap, then majors that have not
  // appeared in the quote table are added — so a coin with an on-chain pool keeps its shading.
  const coins: Cell[] = [];
  const stocks: Cell[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    seen.add(r.sym);
    (assetClassOf(r.sym) === "crypto" ? coins : stocks).push({ sym: r.sym, status: r.pool ? r.pool.status : "" });
  }
  for (const sym of cryptoSymbols(quotes)) {
    if (seen.has(sym)) continue;
    seen.add(sym);
    coins.push({ sym, status: "" });
  }
  if (coins.length === 0 && stocks.length === 0) return null;

  // One coin every COIN_EVERY cells = a fifth. If either heap is empty the whole wall uses the
  // other; both cycle modulo their length until the wall is full.
  const cells: Cell[] = [];
  for (let i = 0, ci = 0, si = 0; i < CELLS; i++) {
    const coin = stocks.length === 0 || (coins.length > 0 && i % COIN_EVERY === COIN_EVERY - 1);
    cells.push(coin ? coins[ci++ % coins.length] : stocks[si++ % stocks.length]);
  }

  return (
    <div className={`site-wall${animated ? " animated" : ""}`} aria-hidden="true">
      {cells.map((c, i) => (
        <span key={i} className={`${c.status}${MOTION[i] ? " wall-pulse" : ""}`} style={MOTION[i]}>{c.sym}</span>
      ))}
    </div>
  );
}

interface Cell {
  /// The displayed code (uNVDA, uBTC)
  sym: string;
  /// The on-chain pool's status, which sets the shade; an empty string when there is no on-chain pool
  status: string;
}

/// 1:4 — one cell in five is a coin, exactly a fifth.
const COIN_EVERY = 5;
/// Enough to cover 2560×1440 (a 48px monospace face gives roughly 16 columns × 30 rows); on a
/// smaller screen the surplus is clipped by `.site-wall`'s overflow.
/// A fixed number rather than measuring the viewport, so no resize listener is needed: dragging the
/// window never leaves a momentary hole in the wall.
const CELLS = 520;

// A fixed seed gives every cell its own rhythm, and keeps a quote refresh from re-sampling and
// restarting the animation.
// About a third of the codes pulse, which leaves quiet areas and keeps the cost of a background
// animation down.
const MOTION = Array.from({ length: CELLS }, (_, i): CSSProperties | undefined => {
  const seed = Math.imul(i + 1, 2654435761) >>> 0;
  if (seed % 3 !== 0) return undefined;
  return {
    "--wall-duration": `${2.8 + (seed % 23) / 10}s`,
    "--wall-delay": `${-(seed % 137) / 10}s`,
    "--wall-peak": 1.06 + (seed % 9) / 100,
    "--wall-low": .90 + (seed % 7) / 100,
  } as CSSProperties;
});
