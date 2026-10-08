/// The arena API (DECISIONS §69): the ledger lives in the backend, and the frontend reads and writes
/// only through these HTTP endpoints — it no longer reads the Competition / Distributor contracts.
///
/// The base URL comes from `VITE_API_BASE`: in development set it to `/api` and `vite.config.ts`
/// proxies that to `127.0.0.1:8787` (the API is started with `--prefix /api`); a same-origin
/// production deployment is also `/api`. Empty = not configured, and the arena page then shows the
/// rules and no numbers at all. Authenticated requests carry the persisted wallet JWT in the
/// Authorization header; the backend still revokes its database session on logout.
/// Every amount is a decimal string in USDT's smallest unit (18 decimals, §69.13); after `BigInt()`
/// it is used as-is, never rescaled.
/// Every response carries `X-Server-Time` (Unix seconds) and `serverNow()` uses it to set the clock —
/// arena countdowns always run off that, never off `Date.now()` (🔴 hard rule). Before any server
/// time has been seen it falls back to `chainNow()`.
import { tr } from "./i18n";
import { chainNow } from "./chain-config";

const RAW_BASE: string = import.meta.env.VITE_API_BASE ?? "";
export const API_BASE = RAW_BASE.trim().replace(/\/+$/, "");
const AUTH_TOKEN_KEY = "uploop-auth-jwt";
let readRevision = 0;

export function authToken(): string | null {
  try { return localStorage.getItem(AUTH_TOKEN_KEY); } catch { return null; }
}
export function setAuthToken(token: string | null): void {
  readRevision++;
  try { if (token) localStorage.setItem(AUTH_TOKEN_KEY, token); else localStorage.removeItem(AUTH_TOKEN_KEY); } catch { /* private mode */ }
}

/// Whether the arena API address is configured. If it is not, the UI says "not configured"
/// rather than inventing numbers.
export function arenaConfigured(): boolean {
  return RAW_BASE.trim() !== "";
}

/// An error returned by the API. `code` is the server's error code (Unauthorized / Insufficient /
/// InvalidEntry / BadState / Duplicate / BadSignature / LedgerError / NotSettled / Pending /
/// Mismatch …) and is a stable English identifier — branch on it.
///
/// 🔴 `message` is the server's own sentence and it is **in Chinese**: the backend also serves the
/// ops console, whose operator reads Chinese, and its message text is asserted on by the Python
/// test suite (§71.163). Never render `message` to a user — go through `apiErrorText()`, which
/// translates the `code` instead. `message` is kept on the object only for debugging.
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: Record<string, unknown>;
  constructor(status: number, code: string, message: string, body: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/// Difference between the server clock and this machine's clock, in milliseconds. Refreshed by the
/// X-Server-Time header on every response.
let offsetMs: number | null = null;
// Keep identical reads on one request while a mobile connection is still resolving. Refresh
// ticks and route changes often overlap on 4G; deduping them avoids making the wallet wait for a
// second copy of the same Redis-backed response.
const pendingGets = new Map<string, Promise<unknown>>();

function anchor(serverSec: number) {
  if (!Number.isFinite(serverSec) || serverSec <= 0) return;
  offsetMs = serverSec * 1000 - Date.now();
}

/// The server's current second (same idea as `chainNow()`: the local clock is only a stopwatch,
/// the reference point comes from the server).
export function serverNow(): number {
  if (offsetMs === null) return chainNow();
  return Math.floor((Date.now() + offsetMs) / 1000);
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown, query?: Record<string, string | number | boolean | null | undefined>): Promise<T> {
  const q = query ? Object.entries(query).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&") : "";
  const token = authToken();
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  // Bound read waits including the response body. Writes are never automatically retried or
  // cancelled: a lost response does not mean the server failed to record the operation.
  const controller = new AbortController();
  const timeout = method === "GET" ? setTimeout(() => controller.abort(), 15_000) : undefined;
  try {
    const res = await fetch(API_BASE + path + (q ? `?${q}` : ""), {
      method,
      credentials: "include",
      cache: "no-store",
      headers: Object.keys(headers).length ? headers : undefined,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const t = res.headers.get("X-Server-Time");
    if (t) anchor(Number(t));
    let json: unknown = null;
    try {
      json = await res.json();
    } catch (error) {
      if (controller.signal.aborted) throw error;
    }
    const obj = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
    if (!res.ok) {
      const code = typeof obj.error === "string" ? obj.error : `HTTP${res.status}`;
      const msg = typeof obj.message === "string" ? obj.message : tr("HTTP {0}", res.status);
      if (res.status === 401 && authToken() === token) setAuthToken(null);
      throw new ApiError(res.status, code, msg, obj);
    }
    return obj as T;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(tr("The connection is slow. Please try again."));
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export const apiGet = <T>(path: string, query?: Record<string, string | number | boolean | null | undefined>): Promise<T> => {
  const entries = Object.entries(query ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== "").sort(([a], [b]) => a.localeCompare(b));
  const key = JSON.stringify([readRevision, authToken(), path, entries]);
  const pending = pendingGets.get(key);
  if (pending) return pending as Promise<T>;
  const request = call<T>("GET", path, undefined, query).finally(() => pendingGets.delete(key));
  pendingGets.set(key, request);
  return request;
};
export const apiPost = async <T>(path: string, body: unknown = {}): Promise<T> => {
  try { return await call<T>("POST", path, body); }
  finally { readRevision++; }
};

/// Idempotency key for write endpoints (§69.5): one key per click, and the server returns the same
/// result for a repeated request.
export function newIdemKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/// Emergency switches (§71.40). The `Paused` error carries the switch key in its body, so the
/// message can name what exactly is paused. Keys match SWITCH_LABEL in `core/uploop/ops.py`.
const SWITCH_LABEL: Record<string, string> = {
  withdrawals: tr("Withdrawals"),
  entries: tr("Match entry"),
  schedule: tr("Automatic scheduling"),
  settle: tr("Automatic settlement"),
  jackpot: tr("Jackpot payouts"),
  sponsorship: tr("Prize top-ups"),
  listing: tr("Listing applications"),
};

/// Error code → the sentence a user reads (§71.163).
///
/// 🔴 Why a table here instead of translating the backend: the backend's `message` field is written
/// for the Chinese ops console and its exact wording is asserted on across the Python test suite,
/// so translating it would break the ops console and those tests at once. The `code` field, by
/// contrast, is already a stable English identifier, so mapping code → sentence gives an English UI
/// with `core/` untouched.
///
/// The accepted cost: the server's per-field detail is lost. "Your buy-in is below this match's
/// minimum of 5 USDT" becomes the generic "Your arena balance is not enough". Most of that detail is
/// duplicated by the client-side checks in `App.tsx`, which run before the request is ever sent, so
/// in practice the user sees the specific message from the client and the generic one from the
/// server only when the two disagree (a race, or a request that did not come from our UI).
const CODE_TEXT: Record<string, string> = {
  // --- the user's own mistakes -------------------------------------------------
  BadRequest: tr("Something in that request was not valid. Please check the form and try again."),
  InvalidEntry: tr("That strategy is not valid. Check the assets and directions and try again."),
  BadSignature: tr("The wallet signature could not be verified. Please sign again."),
  BadPool: tr("That match does not accept this operation."),
  Insufficient: tr("Your arena balance is not enough for this."),
  WithdrawableInsufficient: tr("Only used arena funds and winnings can be withdrawn. Unused deposits unlock after 24 hours."),
  LedgerError: tr("The amount is outside the allowed range for this operation."),
  PayloadTooLarge: tr("That request was too large."),
  UnsupportedMediaType: tr("The request format was not accepted."),
  MethodNotAllowed: tr("That operation is not supported on this endpoint."),
  TooMany: tr("Too many attempts in a row. Please wait a moment and try again."),

  // --- permission and account state --------------------------------------------
  Unauthorized: tr("Your session has expired. Please sign in to the arena again."),
  Forbidden: tr("You do not have permission to do that."),
  Frozen: tr("This account is frozen. Please contact support."),
  TotpRequired: tr("Two-factor authentication is required."),

  // --- nothing there / not ready yet -------------------------------------------
  NotFound: tr("That record could not be found."),
  NotSettled: tr("This match has not been settled yet."),
  Pending: tr("The results have not been published yet. Please check back shortly."),
  NotConfirmed: tr("Not enough block confirmations yet. Please wait a little longer."),

  // --- conflicts ----------------------------------------------------------------
  BadState: tr("That is not possible in the current state."),
  Duplicate: tr("That request has already been processed. Refresh to see the result."),
  Mismatch: tr("The result file does not match the ledger, so it will not be shown."),

  // --- the platform's side ------------------------------------------------------
  Paused: tr("This feature is paused right now. Please try again later."),
  Unavailable: tr("This feature is unavailable right now. Please try again later."),
  CertApiUnavailable: tr("The certificate index is unavailable right now."),
  RunnerDisabled: tr("This feature is not enabled on the server."),
  SymbolCheckFailed: tr("That symbol could not be verified against the exchange."),
  Upstream: tr("The market data source could not be reached. Please try again later."),
  Internal: tr("Something went wrong on our side. Please try again later."),
  Invariant: tr("The ledger stopped on an internal inconsistency. Please contact support."),
};

/// An API error → one sentence for a human.
///
/// 401 is called out separately (the session expired and needs a fresh signature login), and a
/// dead network is called out separately too — that one is almost always a local misconfiguration
/// during development, so the message names what to check.
export function apiErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return CODE_TEXT.Unauthorized;
    // Name the paused feature when the server told us which one it was
    if (e.code === "Paused") {
      const label = typeof e.body.switch === "string" ? SWITCH_LABEL[e.body.switch] : undefined;
      return label ? tr("{0} is paused right now. Please try again later.", label) : CODE_TEXT.Paused;
    }
    const known = CODE_TEXT[e.code];
    if (known) return known;
    // An unknown code still must not leak the server's Chinese sentence. Show a generic line and
    // the raw code, so a screenshot is still enough to diagnose it.
    return tr("That did not work ({0}). Please try again, or contact support if it keeps happening.", e.code);
  }
  const m = e instanceof Error ? e.message : String(e);
  if (/Failed to fetch|NetworkError|Load failed|ECONNREFUSED/i.test(m)) {
    return tr("No response from the API: check VITE_API_BASE and whether the API service is running.");
  }
  return m.split("\n")[0];
}
