import { tr } from "../lib/i18n";
import { useState } from "react";
import type { AssetsState } from "../lib/assets";
import type { Ticker } from "../lib/board";
import type { Quotes } from "../lib/quotes";
import { change24h, fmtChange, fmtUsd } from "../lib/quotes";
import { mixTapeCoins, symbolRows } from "../lib/symbols";
import type { SymbolRow } from "../lib/symbols";

/// The price ribbon across the top (§71.53): asset code + live price + change, scrolling past once.
///
/// It is decoration, but it is also data — every number shares its source with the page below: the
/// price comes from the arena's `GET /quotes` (Binance price, §71.26, refreshed every 30 seconds),
/// the same reading as the `$120.00` in the top right of a card on the Asset Staking page.
///
/// The list comes from `lib/symbols.ts` (on-chain pools + pools the operator has opened + catalog
/// tokens that have a price) and does not wait on the chain; since §71.73 it shares one list with
/// the background code wall.
/// Six majors are then mixed in at random (uBTC uETH uSOL uDOGE uAVAX uBNB — the user asked for
/// this by name, §71.75): the catalog is all Binance equity tokens, and without them the whole
/// ribbon would be stock codes.
/// A pool card with no quote falls back to its staking status (only on-chain pools have one); with
/// neither, it shows "—".
/// The animation is switched off under prefers-reduced-motion and becomes a static bar you can
/// scroll sideways.
export function Ribbon({ board, assets, quotes }: { board: Ticker[]; assets: AssetsState; quotes: Quotes }) {
  // The seed for mixing coins in: fixed once per page load, so the order and placing of the coins
  // only change on a refresh and never mid-scroll (see `mixTapeCoins`)
  const [seed] = useState(() => (Math.random() * 0x1_0000_0000) >>> 0);
  const items = mixTapeCoins(symbolRows(board, assets, quotes), quotes, seed);

  if (items.length === 0) {
    // Say which kind of "nothing" this is: endpoint not configured / could not be read / the catalog
    // is empty (§29, no weasel words)
    const still = assets.status === "ok" ? tr("No assets yet") : assets.status === "error" ? tr("Prices unavailable") : tr("Prices unavailable");
    return (
      <div className="ribbon">
        <div className="ribbon-still">{still}</div>
      </div>
    );
  }

  const cell = (it: SymbolRow, key: string) => {
    const chg = it.quote ? change24h(it.quote) : null;
    return (
      <span className={`ribbon-item ${it.pool ? it.pool.status : ""}`} key={key}>
        <span className="s">{it.sym}</span>
        {it.quote ? (
          <>
            <span className="q">{fmtUsd(it.quote.price)}</span>
            {chg === null
              ? <small className="chg dim">—</small>
              : <small className={`chg${chg > 0 ? " gain" : chg < 0 ? " loss" : ""}`}>{fmtChange(chg)}</small>}
          </>
        ) : it.pool ? (
          // With no quote it falls back to the staking status (read from the chain). Since §71.80
          // there is no "activation threshold" reading on chain any more, so no percentage is shown
          // here; an empty pool gets "—" per §25, not a 0.
          <span className="p">
            {it.pool.status === "live" ? tr("Fee share live") : it.pool.status === "rallying" ? tr("No stake yet") : "—"}
          </span>
        ) : (
          <span className="q dim">—</span>
        )}
      </span>
    );
  };

  // Two copies end to end: shifting by -50% lands exactly back at the start, so the seam is invisible.
  const dur = `${Math.max(30, items.length * 1.6)}s`;
  return (
    <div className="ribbon" aria-hidden="true">
      <div className="ribbon-track" style={{ ["--dur" as string]: dur }}>
        {items.map((it, i) => cell(it, `a${i}`))}
        {items.map((it, i) => cell(it, `b${i}`))}
      </div>
    </div>
  );
}
