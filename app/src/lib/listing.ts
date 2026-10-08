/// Listing applications for the MEME Lab (DECISIONS §63 / §71.86): one form, five fields.
/// By default it goes to our own backend, `POST /listings` (it lands on the ops console's
/// "listing applications" page, which only the operator sees). VITE_LISTING_URL is an override:
/// set it to an http/https address and the form posts there instead. With neither configured the
/// app does not pretend to have sent anything — the user copies the text out instead; the same is
/// true under ?demo=1. The frontend promises nothing about review.
import { tr } from "./i18n";
import type { Address } from "viem";
import { API_BASE, ApiError, apiErrorText, arenaConfigured } from "./api";

export interface Listing {
  name: string;
  token: string;
  marketCap: string;
  tg: string;
  isDev: boolean | null;
}

export const EMPTY_LISTING: Listing = { name: "", token: "", marketCap: "", tg: "", isDev: null };

export function listingUrl(): string {
  const u = (import.meta.env.VITE_LISTING_URL ?? "").trim();
  if (/^https?:\/\//.test(u)) return u;                     // an external address is configured: post there
  return arenaConfigured() ? `${API_BASE}/listings` : "";   // nothing configured: post to our own backend (§71.86)
}

/// Field-by-field validation; returns the first problem, or null when everything passes.
export function validateListing(l: Listing): string | null {
  if (!l.name.trim()) return tr("Enter the token name");
  if (!/^0x[0-9a-fA-F]{40}$/.test(l.token.trim())) return tr("The token address must be 40 hex characters starting with 0x");
  if (!l.marketCap.trim()) return tr("Enter the market cap (USDT)");
  if (!/^\d+(\.\d+)?$/.test(l.marketCap.trim().replace(/,/g, ""))) return tr("The market cap must be a number, in USDT");
  if (!l.tg.trim()) return tr("Enter a Telegram contact");
  if (l.isDev === null) return tr("Tell us whether you are the DEV address of this token");
  return null;
}

function norm(l: Listing, applicant: Address | null) {
  return {
    name: l.name.trim(),
    token: l.token.trim().toLowerCase(),
    marketCapUsdt: l.marketCap.trim().replace(/,/g, ""),
    tg: l.tg.trim().replace(/^@/, ""),
    isDev: l.isDev === true,
    applicant: applicant ?? null,
  };
}

/// The plain text offered for copying, carrying exactly the fields that would be sent.
export function listingText(l: Listing, applicant: Address | null): string {
  const n = norm(l, applicant);
  return [
    tr("Uploop MEME Lab · listing application"),
    tr("Token name: {0}", n.name),
    tr("Token address: {0}", n.token),
    tr("Market cap: {0} USDT", n.marketCapUsdt),
    tr("Telegram: @{0}", n.tg),
    tr("DEV address: {0}", n.isDev ? tr("yes") : tr("no")),
    tr("Wallet: {0}", n.applicant ?? tr("not connected")),
  ].join("\n");
}

/// POST to `listingUrl()`. Anything other than 2xx throws, so the UI can show the reason and fall
/// back to copying.
/// 🔴 The server's own `message` is in Chinese (it also serves the ops console, §71.163), so it is
/// never shown. The error `code` goes through `apiErrorText()` instead, exactly as it does for
/// every other endpoint; the thrown Error already carries the English sentence, so a caller that
/// simply prints `.message` stays correct.
export async function submitListing(l: Listing, applicant: Address | null): Promise<void> {
  const url = listingUrl();
  if (!url) throw new Error(tr("Applications are not open yet."));
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...norm(l, applicant), source: "uploop-meme", submittedAt: new Date().toISOString() }),
  });
  if (!r.ok) {
    let body: Record<string, unknown> = {};
    try {
      const j: unknown = await r.json();
      if (j && typeof j === "object") body = j as Record<string, unknown>;
    } catch { /* not JSON: fall back to the status code alone */ }
    const code = typeof body.error === "string" ? body.error : `HTTP${r.status}`;
    throw new Error(apiErrorText(new ApiError(r.status, code, "", body)));
  }
}
