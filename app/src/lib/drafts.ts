/// Saved strategies. Stored in the browser only — not on chain, not on the server.
///
/// Five at most (§25): entering a match means picking one of those five and paying. Few and
/// deliberate — the entry dialog fits on one screen, and nobody ends up with a pile of drafts
/// whose contents they no longer remember. Any strategy can be edited at any time (updated in
/// place, never copied).
///
/// This lives on one device only. Switching browsers or clearing site data loses it — so a draft
/// never holds anything that cannot be recreated. It is a list of picks; rebuilding one costs
/// half a minute.
import { tr } from "./i18n";
import type { Leg, PoolKey } from "./strategy";
import { POOLS, POOL_KEYS, fitsTier, tierFor } from "./strategy";
import { demoDrafts, isDemo } from "./demo";

export interface Draft {
  id: string;
  name: string;
  pool: PoolKey;
  legs: Leg[];
  savedAt: number;
}

/// Demo mode uses its own key, seeded from demoDrafts the first time it is opened. Live drafts
/// are keyed by the connected wallet, so switching accounts cannot expose another account's list.
const LEGACY_KEY = "uploop.drafts";
function storageKey(account?: string | null): string {
  if (isDemo()) return "uploop.drafts.demo";
  const address = account?.trim().toLowerCase();
  return address && /^0x[0-9a-f]{40}$/.test(address) ? `uploop.drafts.${address}` : LEGACY_KEY;
}
/// 🔒 Hard limit of 5. Changing this number means changing the Builder and entry-dialog copy as
/// well, and DECISIONS.md §25.
export const MAX_DRAFTS = 5;

export function loadDrafts(account?: string | null): Draft[] {
  try {
    const key = storageKey(account);
    let raw = localStorage.getItem(key);
    // Migrate the old unscoped list once, when the first wallet opens it. New writes are always
    // account-scoped; an old list cannot be safely shared between accounts.
    if (!raw && !isDemo() && key !== LEGACY_KEY && localStorage.getItem(LEGACY_KEY)) {
      raw = localStorage.getItem(LEGACY_KEY);
      if (raw) {
        localStorage.setItem(key, raw);
        localStorage.removeItem(LEGACY_KEY);
      }
    }
    if (!raw) {
      if (!isDemo()) return [];
      const seed = demoDrafts();
      write(seed, account);
      return seed;
    }
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.map(migrate).filter((d): d is Draft => d !== null) : [];
  } catch {
    return []; // private mode or corrupted data: treat it as having no drafts
  }
}

/// Drafts saved before 2026-09-04 say "arena" / "fast" (the two-pool scheme from before §30).
/// Sort them into the new tiers by asset count; one that fits no tier (four assets, say) is left
/// as-is under the open tier with `draftFits` false — the list flags it in red, the entry dialog
/// will not accept it, and the user adds one asset in the Builder. This is the only way a
/// non-conforming strategy can appear in the library (the save functions reject them).
function migrate(d: unknown): Draft | null {
  if (!d || typeof d !== "object") return null;
  const x = d as Partial<Draft> & { pool?: string };
  if (!Array.isArray(x.legs) || typeof x.id !== "string") return null;
  const pool: PoolKey = (POOL_KEYS as string[]).includes(x.pool ?? "")
    ? (x.pool as PoolKey)
    : tierFor(x.legs.length) ?? "open";
  return { id: x.id, name: x.name ?? "", pool, legs: x.legs, savedAt: x.savedAt ?? 0 };
}

function write(list: Draft[], account?: string | null) {
  try {
    localStorage.setItem(storageKey(account), JSON.stringify(list));
  } catch {
    /* out of storage: let it go — a failed draft save must not interrupt the user */
  }
}

/// 🔒 §39: a strategy's asset count must match its tier (3T = 3, 5T = 5, NT = 6–50), or the
/// library refuses it. The Builder's save button is already disabled while validation fails; this
/// is the second gate, so that however the call arrives, the library never holds a bad strategy.
export function draftFits(d: Pick<Draft, "pool" | "legs">): boolean {
  return fitsTier(d.legs, POOLS[d.pool]);
}

/// Create. Returns null when all 5 slots are taken, or when the asset count does not match the
/// tier (§39); the UI explains which.
export function saveDraft(pool: PoolKey, legs: Leg[], name?: string, account?: string | null): Draft | null {
  if (!draftFits({ pool, legs })) return null;
  const list = loadDrafts(account);
  if (list.length >= MAX_DRAFTS) return null;
  const draft: Draft = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: (name ?? "").trim().slice(0, 24) || defaultName(legs),
    pool,
    legs,
    savedAt: Date.now(),
  };
  write([draft, ...list], account);
  return draft;
}

/// Update in place. Returns null when the id is gone (deleted in another tab, say) or the asset
/// count does not match the tier (§39).
export function updateDraft(id: string, pool: PoolKey, legs: Leg[], name?: string, account?: string | null): Draft | null {
  if (!draftFits({ pool, legs })) return null;
  const list = loadDrafts(account);
  const i = list.findIndex((d) => d.id === id);
  if (i < 0) return null;
  const draft: Draft = {
    ...list[i],
    pool,
    legs,
    name: (name ?? "").trim().slice(0, 24) || defaultName(legs),
    savedAt: Date.now(),
  };
  list[i] = draft;
  write(list, account);
  return draft;
}

export function removeDraft(id: string, account?: string | null) {
  write(loadDrafts(account).filter((d) => d.id !== id), account);
}

/// Fallback when the user gives no name: build one from the first long and the first short leg
/// ("Long uAAPL / Short uTSM"), which is far easier to recognise than "Strategy 1". The symbols
/// already carry the u prefix.
function defaultName(legs: Leg[]): string {
  const l = legs.find((x) => x.side === "long")?.symbol;
  const s = legs.find((x) => x.side === "short")?.symbol;
  if (l && s) return tr("Long {0} / Short {1}", l, s);
  if (l) return tr("Long {0} · {1} assets", l, legs.length);
  if (s) return tr("Short {0} · {1} assets", s, legs.length);
  return tr("{0}-asset strategy", legs.length);
}
