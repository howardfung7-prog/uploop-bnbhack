/// Wallet signature login (DECISIONS §69.3): GET /auth/nonce → the wallet `personal_sign`s the whole
/// message the server handed back → POST /auth/login.
/// The backend also sets a legacy HttpOnly cookie, while the frontend persists the signed JWT and
/// sends it as Authorization so login survives a page refresh and API origin changes.
/// Whether you are signed in is decided purely by whether GET /me returns 200.
/// Signing in is an explicit action (the "Sign in to the arena" button) — connecting a wallet never
/// pops a signature request by itself.
import { tr } from "./i18n";
import type { Address } from "viem";
import { ApiError, apiGet, apiPost, setAuthToken } from "./api";
import { withdrawalOf } from "./arena";
import type { Withdrawal, WithdrawalJson } from "./arena";
import { sanitizeName } from "./profile";
import type { Profile } from "./profile";
import { parseFaction } from "./factions";
import type { FactionId } from "./factions";

export interface Session {
  /// The signed-in wallet, lower case
  address: Address;
  /// Arena balance (ledger, 18 decimals)
  balance: bigint;
  withdrawable: bigint;
  locked: bigint;
  unlockAt: number | null;
  /// Withdrawals under review (API state `queued`, shown as "Under review", §69.17)
  pending: Withdrawal[];
  /// This **address's** nickname and avatar pattern (§71.162).
  /// 🔴 `null` and `{ name: "", variant: 0 }` are not the same thing: the first means "this address
  /// has never picked a name", the second means "it picked one and later cleared it". App uses that
  /// to decide whether to push up a name chosen locally before signing in.
  profile: Profile | null;
  /// Undefined means an older/unavailable backend; null means not chosen.
  faction?: FactionId | null;
}

interface MeJson {
  address: string;
  balance: string;
  withdrawable?: string;
  locked?: string;
  unlock_at?: number | null;
  pending_withdrawals: WithdrawalJson[];
  profile?: { name?: string; avatar?: number } | null;
  faction?: unknown;
}

/// The current session; not signed in (401) returns null, any other error is rethrown.
export async function loadSession(): Promise<Session | null> {
  try {
    const me = await apiGet<MeJson>("/me");
    return {
      address: me.address.toLowerCase() as Address,
      faction: parseFaction(me.faction),
      balance: BigInt(me.balance),
      withdrawable: BigInt(me.withdrawable ?? me.balance),
      locked: BigInt(me.locked ?? "0"),
      unlockAt: me.unlock_at ?? null,
      pending: me.pending_withdrawals.map(withdrawalOf),
      // `profile` is optional for the sake of an older backend: while the container has not been
      // rebuilt the field is absent, which we read as "never picked a name". The page then keeps
      // using the local cache — no error, and the user's name is not wiped.
      profile: me.profile
        ? { name: sanitizeName(String(me.profile.name ?? "")), variant: Number.isInteger(me.profile.avatar) ? me.profile.avatar! : 0 }
        : null,
    };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}

/// Write the nickname and avatar to the backend (`POST /profile`, §71.162). Requires a signature
/// login first; calling it signed out gives a 401.
/// The name is filtered again here for the same reason as in `sanitizeName` — never send up
/// characters that are invisible on screen.
export async function saveProfileToServer(p: Profile): Promise<void> {
  await apiPost("/profile", { name: sanitizeName(p.name), avatar: p.variant });
}

/// `sign` is supplied by the caller (the wallet's signMessage); what gets signed is the server's
/// `message` verbatim, not one character changed.
export async function login(account: Address, sign: (message: string) => Promise<`0x${string}`>): Promise<Session> {
  const c = await apiGet<{ address: string; nonce: string; message: string }>(`/auth/nonce?address=${account.toLowerCase()}`);
  const signature = await sign(c.message);
  const result = await apiPost<{ token?: string }>("/auth/login", { address: account.toLowerCase(), signature, nonce: c.nonce });
  if (result.token) setAuthToken(result.token);
  const s = await loadSession();
  if (!s) throw new Error(tr("Signed in, but the session could not be read: your browser may be blocking cookies, or the API is on a different origin than the page."));
  return s;
}

export async function logout(): Promise<void> {
  try { await apiPost("/auth/logout", {}); } finally { setAuthToken(null); }
}
