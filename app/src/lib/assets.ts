/// Tokens **listed for staking** in the asset catalog (DECISIONS §71.31 / §71.95), from the arena
/// API `GET /assets` (core/uploop/catalog.py: since §71.95 the match allowlist and the stakeable
/// tokens are **one table**, `symbol`, one row per asset; seeded from core/data/bstocks.json (US
/// equity tokens) plus crypto-tokens.json (crypto tokens, only ones verified on chain); the
/// operator adds tokens, lists and delists them for staking and opens or closes pools on the ops
/// console's "asset catalog" page, endpoints /ops/catalog*).
/// The staking page's "supported tokens" list comes entirely from here: the display symbol is
/// always `uSym(underlying)` (uNVDA / uBTC, the user's decision on 2026-09-16), plus the name and
/// the BNB Chain contract address; the live price is looked up in the `quotes` map of
/// `GET /quotes` under the `pair` below (since §71.95 the spot leg is keyed by **the pair
/// itself**: NVDABUSDT, BTCUSDT; the backend queries Binance spot with the same `pair` — that is
/// what the staking side reads; §71.26, prices come from Binance and nowhere else).
/// Every row also carries a `pool` field (§71.51): pools the operator has opened, and an open one
/// gets a card on the asset-staking page.
/// How many tokens one certificate costs does not come from here — one certificate is a fixed $10,
/// converted at the live Binance price and re-quoted every 30 seconds (§71.54).
/// This is a catalog and nothing more: it promises nothing about which assets will get a pool
/// (§29 / §71.25); whether a deposit actually works depends solely on whether a pool for that
/// token exists on chain (depositing is an on-chain action, and the ops switch does not touch the
/// chain).
/// Endpoint not configured / catalog not enabled in the ops console → `unconfigured`, and the list
/// says "Not configured" (§29 does not pretend); a failed fetch → `error` (App keeps the last
/// usable copy).
import type { Address } from "viem";
import { API_BASE, apiGet, arenaConfigured } from "./api";
import { CHAIN_ID } from "./env";

export interface Asset {
  /// The token's on-chain symbol(), upper case, e.g. NVDAB / BTCB (never shown on its own — only
  /// in tooltips and search)
  ticker: string;
  /// The bare asset code, e.g. NVDA / BTC (= the primary key of the catalog row; the display
  /// symbol uNVDA is derived from it, §71.95)
  underlying: string;
  /// Category (only present since the single table of §71.95): equity for US equity tokens,
  /// crypto for cryptocurrencies. An older backend omits the field → fall back to
  /// `assetClassOf(underlying)`
  class?: "crypto" | "equity";
  /// The token's on-chain name()
  name: string;
  /// BNB Chain contract address, lower case
  address: Address;
  decimals: number;
  /// The Binance spot pair (NVDAB → NVDABUSDT, BTCB → BTCUSDT). Since §71.94 **this is the price
  /// the staking page uses**, and since §71.95 it is also the key inside `/quotes`;
  /// empty = this one has no spot price, so it falls back to the bare ticker's perpetual price
  /// (`quoteOf`), and with neither the UI shows "—"
  pair: string;
  status: "listed" | "unlisted";
  sort: number;
  note: string;
  /// A pool the operator has opened (§71.51): open = a pool card on the asset-staking page,
  /// closed = one catalog row marked "no pool yet". It says nothing about the chain
  pool: "open" | "closed";
  /// Derived by the backend from pool=open. Opening a pool is also the operator's
  /// switch for exposing the USDT one-click staking entry point.
  one_click_stake?: boolean;
  updated_at: number;
}

export interface AssetsState {
  status: "unconfigured" | "error" | "ok";
  assets: Asset[];
  /// Rows whose on-chain token is registered but which the operator has **delisted from staking**
  /// (§71.136, the `delisted` section of the backend's `/assets`).
  ///
  /// 🔴 Why they are kept separately and must not be merged into `assets`: the staking cards are
  /// read from the **on-chain registry**, and that registry can only be added to, never pruned
  /// (§71.135) — delisting in the ops console does not make the on-chain entry disappear. For the
  /// frontend to be able to pull a card down, and still name it by the catalog's bare ticker
  /// (otherwise BNC falls back to its on-chain name BNCB, as the user reported on 2026-09-18), it
  /// has to be able to see these rows. But the "supported tokens" table, the ticker tape and the
  /// spot pairs only recognise listed assets, so they keep reading `assets` and nothing from here
  /// ever reaches them.
  delisted: Asset[];
}
export const emptyAssets = (): AssetsState => ({ status: "unconfigured", assets: [], delisted: [] });

interface AssetsDoc { enabled: boolean; assets?: Asset[]; delisted?: Asset[] }

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const CACHE_KEY = `uploop.assets.catalog:${CHAIN_ID}:${API_BASE}`;

export function cachedAssets(): AssetsState {
  if (!arenaConfigured()) return emptyAssets();
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
    if (cached?.status === "ok" && Number.isFinite(cached.at) && Date.now() - cached.at < 86_400_000
      && Array.isArray(cached.assets) && Array.isArray(cached.delisted)) {
      return { status: "ok", assets: rows(cached.assets), delisted: rows(cached.delisted) };
    }
  } catch { /* Metadata caching is optional. */ }
  return emptyAssets();
}

/// One section of catalog rows → a clean `Asset[]`. A bad row (no ticker, an address that does not
/// look like one) is dropped on its own and does not take the section down with it.
function rows(list: Asset[] | undefined): Asset[] {
  const out: Asset[] = [];
  for (const a of list ?? []) {
    if (typeof a?.ticker !== "string" || !a.ticker.trim() || typeof a.address !== "string" || !ADDR.test(a.address)) continue;
    out.push({
      ...a,
      ticker: a.ticker.trim().toUpperCase(),
      underlying: String(a.underlying ?? ""),
      name: String(a.name ?? ""),
      address: a.address.toLowerCase() as Address,
      // A pool counts as open only when the backend says so; anything else is treated as closed
      // (§29 does not pretend a pool exists)
      pool: a.pool === "open" ? "open" : "closed",
      one_click_stake: a.status === "listed" && a.pool === "open" && a.one_click_stake !== false,
    });
  }
  return out;
}

/// Fetch the catalog. Endpoint not configured / catalog not enabled → unconfigured; a bad row (no
/// ticker, an address that does not look like one) is dropped on its own. Network and API errors
/// are thrown for the caller to handle.
/// An older backend has no `delisted` section → an empty array, and every card still shows (the
/// §71.136 rule goes idle, but nothing is wrongly hidden; see `closedPools`).
export async function loadAssets(): Promise<AssetsState> {
  if (!arenaConfigured()) return emptyAssets();
  try {
    const d = await apiGet<AssetsDoc>("/assets");
    if (!d.enabled) {
      try { localStorage.removeItem(CACHE_KEY); } catch { /* Metadata caching is optional. */ }
      return emptyAssets();
    }
    const out = { status: "ok" as const, assets: rows(d.assets), delisted: rows(d.delisted) };
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ...out, at: Date.now() })); } catch { /* cache is optional */ }
    return out;
  } catch (error) {
    // Catalog metadata is presentation data. Keep the last usable Redis/API response so a
    // transient API restart does not blank the page; all contract state remains RPC-derived.
    const cached = cachedAssets();
    if (cached.status === "ok") return cached;
    throw error;
  }
}
