import { tr } from "./i18n";
/// How asset symbols are displayed: always with a `u` prefix — uNVDA, uBTC.
///
/// A certificate references a Binance price, not the share itself. The prefix reminds the reader
/// of that: this is a synthetic reference asset on Uploop, not the stock in a brokerage account
/// (the same way wBTC is not BTC).
///
/// Display layer only. Whatever the on-chain `symbolOf` holds is left alone, and this is
/// idempotent: a symbol that already carries the `u` prefix is not prefixed twice, so if the
/// contract side ever switches to uNVDA as well, the UI will not turn it into uuNVDA.
export function uSym(raw: string): string {
  const s = raw.trim();
  if (/^u[A-Z0-9]/.test(s)) return s;
  return `u${s}`;
}

/// The **token** name as shown in the UI (not the certificate name): a Latin-script ticker gets a
/// `$` ($BNBCAT), a name in another script is written as-is rather than forced into `$` (§65).
/// This used to live in `lib/meme.ts`; §71.138 moved it here — the certificate layer
/// (`burnFrom` in `lib/board.ts`) needs it too, and board should not have to depend on meme.
/// `lib/meme.ts` still re-exports the name, so no caller changes.
export function tick(symbol: string): string {
  return /^[\x21-\x7e]+$/.test(symbol) ? `$${symbol}` : symbol;
}

/// Constituent categories: crypto / equities / other (gold, silver, crude oil and so on).
///
/// ⚠️ A stopgap: the Registry contract has no category field, so this is a lookup table keyed on
/// the bare symbol. A newly listed asset that is in neither the CRYPTO nor the OTHER table falls
/// back to "Stock" — so listing a crypto or commodity asset means editing this file too.
/// The real fix is to put the category into the Registry (a contract change, and a fresh audit),
/// see DECISIONS.md §27.
export type AssetClass = "crypto" | "equity" | "other";

export const CLASS_ORDER: AssetClass[] = ["crypto", "equity", "other"];
export const CLASS_LABEL: Record<AssetClass, string> = {
  crypto: tr("Crypto"), equity: tr("Stock"), other: tr("Other"),
};
export const CLASS_HINT: Record<AssetClass, string> = {
  crypto: tr("BTC, ETH and the like"), equity: tr("Listed company shares"), other: tr("Gold, silver, crude oil and the like"),
};

const CRYPTO = new Set([
  "BTC", "ETH", "SOL", "BNB", "DOGE", "LINK", "XRP", "ADA", "AVAX", "TON", "DOT", "MATIC", "POL",
  "LTC", "TRX", "SHIB", "UNI", "ATOM", "NEAR", "ARB", "OP", "SUI", "APT", "PEPE", "WIF", "BCH", "ETC",
  // Added 2026-09-15: a few that really do have a quote in `GET /quotes` but were missing from this
  // table, and so used to fall back into "Stock" (§71.74)
  "AAVE", "FIL", "ICP", "INJ", "TIA",
]);
const OTHER = new Set(["XAU", "GOLD", "XAG", "SILVER", "WTI", "BRENT", "OIL", "NG", "COPPER", "XPT", "XPD"]);

export function assetClassOf(raw: string): AssetClass {
  const bare = raw.trim().replace(/^u(?=[A-Z0-9])/, "");
  if (CRYPTO.has(bare)) return "crypto";
  if (OTHER.has(bare)) return "other";
  return "equity";
}

/// Display symbol → bare symbol (drop the `u` prefix). The entry endpoint and the ledger's asset
/// allowlist both use bare symbols (NVDA, BTC, §69.4).
export function bareSym(raw: string): string {
  return raw.trim().replace(/^u(?=[A-Z0-9])/, "");
}
