/// The certificate index (DECISIONS §71.120): ask the backend "which entries should I read on
/// chain", then read exactly those on chain anyway.
///
/// 🔴 This file produces no **displayed number** at all.
/// It answers two questions only: "which (certificate contract, batch id) pairs has this address
/// touched" and "which listing ids are live right now".
/// Share counts, face values, unit prices and remaining quantities are all still read through
/// `publicClient.readContract` (`board.ts` / `market.ts`).
///
/// Why it exists: the contracts have no "by holder" view (delivery doc §3.2: transfer events are
/// the only evidence of a holding), so the frontend can only scan from batch 1 up to
/// `batchCount()`. Once there are many batches that becomes unusably slow.
/// The platform already has an event index, and one question to it narrows "which entries to read"
/// down to a single-digit number.
///
/// 🔴 Not getting the index is not an error — it is a **fall back to the old way**: the full scan.
/// Slow, but nothing is missed and no number is off (§29).
/// So every function here returns `null` on failure; a caller that sees `null` takes the slow path
/// and shows no error dialog.
///
/// 🔴 The frontend never calls the platform's `/v1` directly: the AppSecret has to stay in the
/// backend, and sending it to a browser is the same as publishing it.
/// We only call our own backend's `/api/cert/*` (`core/uploop/api/app.py`).
import { tr } from "./i18n";
import type { Address } from "viem";
import { addresses, CHAIN_ID, publicClient } from "./chain";
import { apiGet, arenaConfigured } from "./api";

/// One "go read this on chain" pointer: which certificate contract, which batch.
export interface CertRef {
  cert: Address;
  batchId: bigint;
}

/// One live listing: the listing id plus the batch it sells (price and quantity are still read on
/// chain).
export interface ListingRef extends CertRef {
  listingId: bigint;
}

const isAddr = (s: unknown): s is string => typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s);
const isNum = (s: unknown): s is string => typeof s === "string" && /^[0-9]+$/.test(s);

function refsOf(rows: unknown, extra?: "listing"): (CertRef & { listingId?: bigint })[] {
  if (!Array.isArray(rows)) return [];
  const out: (CertRef & { listingId?: bigint })[] = [];
  for (const raw of rows) {
    const r = raw as Record<string, unknown>;
    // The backend has already checked the shape (a failed check comes back as 503). Checking it
    // again here is not distrust of the backend: these values are about to be put into a
    // transaction — the check costs almost nothing, and getting it wrong once costs real money.
    if (!isAddr(r.certificate) || !isNum(r.id)) continue;
    const ref: CertRef & { listingId?: bigint } = { cert: r.certificate as Address, batchId: BigInt(r.id) };
    if (extra === "listing") {
      if (!isNum(r.listing_id)) continue;
      ref.listingId = BigInt(r.listing_id as string);
    }
    out.push(ref);
  }
  return out;
}

// ------------------------------------------------- Step 2: read the contract addresses at runtime

/// The chain ID the platform reports (`chain_id` in `GET /v1/system`). null = not asked yet, or
/// the answer never arrived.
let reportedChain: number | null = null;
/// Whether any address really was swapped on this page load (for troubleshooting, and for
/// `indexNote()`).
let swapped = false;
let resolving: Promise<void> | null = null;

// Keep an unavailable index from being queried on every board refresh. The chain scan remains
// the source-of-truth fallback, so a short negative cache only delays the next optional lookup.
const INDEX_FAILURE_COOLDOWN_MS = 30_000;
const indexFailureUntil = new Map<string, number>();
const indexRequests = new Map<string, Promise<unknown>>();

async function cachedIndexRequest<T>(key: string, request: () => Promise<T>): Promise<T | null> {
  const now = Date.now();
  if ((indexFailureUntil.get(key) ?? 0) > now) return null;
  const running = indexRequests.get(key);
  if (running) return running as Promise<T | null>;
  const task = request()
    .then((value) => {
      indexFailureUntil.delete(key);
      return value;
    })
    .catch(() => {
      indexFailureUntil.set(key, Date.now() + INDEX_FAILURE_COOLDOWN_MS);
      return null;
    })
    .finally(() => indexRequests.delete(key));
  indexRequests.set(key, task);
  return task;
}

/// Read the contract addresses from the platform at runtime (§71.120). **Runs once per page.**
///
/// The platform's own docs say "do not hard-code the certificate contract addresses": when a
/// contract upgrade changes the proxy address, we do not have to rebuild and redeploy — a refresh
/// keeps up.
///
/// 🔴 Three gates; failing any one of them means the build-time addresses (`VITE_REGISTRY` and
/// friends) are used as they are. Never swap half of them on a hunch:
///   1. the backend is not wired to the platform / the platform cannot be read → `system` is null;
///   2. 🔴 the chain the platform names does not match the chain this site is on → **swap nothing**.
///      A chain mismatch loses money (§71.117 got burned by exactly this): approving USDT on the
///      testnet against BSC's market address hands the allowance to a contract that does not exist
///      on that chain, and nobody can get it back;
///   3. an address is not shaped like one → skip that entry.
///
/// This function **never throws**: if it fails, the page simply carries on with the old addresses,
/// and nothing should pop up.
export async function resolveAddresses(): Promise<void> {
  if (resolving) return resolving;
  resolving = (async () => {
    if (!arenaConfigured()) return;      // no backend wired up: no such route, take the old way quietly
    try {
      const got = await apiGet<{ system: null | { chain_id: number; contracts: Record<string, string> } }>("/cert/system");
      const sys = got.system;
      if (!sys) return;
      reportedChain = typeof sys.chain_id === "number" ? sys.chain_id : null;
      if (reportedChain !== CHAIN_ID) {
        console.warn(tr("[cert] The platform says the certificate system is on chain {0}, this site is on chain {1}: keeping the addresses from the build configuration.", reportedChain, CHAIN_ID));
        return;
      }
      const c = sys.contracts ?? {};
      // An address that already matches the build needs no check (the usual case once the build
      // carries the mainnet defaults). The rest are checked side by side rather than one after
      // another — each check is a round trip to the RPC, and the board waits on this (§71.174).
      const keys = (["registry", "pledge", "market", "usdt"] as const).filter((key) => {
        const next = c[key];
        const before = addresses[key];
        return isAddr(next) && !(before && before.toLowerCase() === next.toLowerCase());
      });
      const verified = await Promise.all(keys.map(async (key) => {
        const next = c[key];
        // Do not trust a platform address until the configured chain proves that
        // bytecode exists there. A stale or malformed platform response otherwise
        // replaces a valid build address and makes every read return empty data.
        try {
          const code = await publicClient.getBytecode({ address: next as Address });
          if (!code || code === "0x") {
            console.warn(`[cert] Ignoring ${key} address without contract code: ${next}`);
            return false;
          }
          return true;
        } catch (error) {
          console.warn(`[cert] Could not validate ${key} address; keeping the build address`, error);
          return false;
        }
      }));
      keys.forEach((key, i) => {
        if (!verified[i]) return;
        const next = c[key];
        const before = addresses[key];
        // A swapped address has to leave a trace: the first question when something goes wrong is
        // "which contract are you actually talking to".
        console.info(`[cert] ${key} address taken from the platform: ${before || "(none configured)"} → ${next}`);
        addresses[key] = next as Address;
        swapped = true;
      });
    } catch {
      // Backend down, network gone, answer unintelligible — to the user these are all one thing:
      // carry on with the old addresses.
    }
  })();
  return resolving;
}

/// Whether any address really was swapped on this load (for troubleshooting; `false` may also mean
/// the platform's addresses simply matched the build's).
export function addressesSwapped(): boolean {
  return swapped;
}

// --------------------------------------- Step 3: use the index instead of scanning the whole range

/// Which batches this address has touched. `null` = the index is unusable, so the caller should
/// run the full scan.
///
/// 🔴 An empty array and `null` are two different things: an empty array = the platform confirms
/// this address holds nothing (the page shows "none yet"); `null` = nobody told us (the page has
/// to go and scan, and must not show "none yet"). That is precisely why the backend returns 503
/// rather than an empty list when it fails.
///
/// `view=latest` is used: it counts blocks that could still be reorganised away. That sounds
/// dangerous but is safe here — the index only picks "which entries to read", and every entry it
/// picks is then verified on chain. Picking a few too many costs one wasted read; picking too few
/// is what actually breaks things, because a freshly minted certificate has to show up in "my
/// holdings" straight away.
export async function holdingRefs(who: Address): Promise<CertRef[] | null> {
  if (!arenaConfigured()) return null;
  const got = await cachedIndexRequest(`holdings:${who.toLowerCase()}`, async () => {
    const response = await apiGet<{ batches: unknown }>(`/cert/holdings?address=${who}&view=latest`);
    return response;
  });
  if (!got) return null;
  try {
    return refsOf(got.batches) as CertRef[];
  } catch {
    return null;
  }
}

/// The listing ids that are still live. `null` = the index is unusable, so run the full scan.
///
/// `truncated` true = there are too many listings and this pass did not get through them all.
/// 🔴 That must be carried all the way to the interface: "only some of the listings are shown" and
/// "these are all the listings there are" look identical, and not saying so is lying (§29).
export async function listingRefs(): Promise<{ refs: ListingRef[]; truncated: boolean } | null> {
  if (!arenaConfigured()) return null;
  const got = await cachedIndexRequest("listings", () => apiGet<{ listings: unknown; truncated?: boolean }>("/cert/listings?view=latest"));
  if (!got) return null;
  try {
    return { refs: refsOf(got.listings, "listing") as ListingRef[], truncated: got.truncated === true };
  } catch {
    return null;
  }
}
