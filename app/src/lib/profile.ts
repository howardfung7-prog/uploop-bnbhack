/// The player profile: display name + avatar variant.
///
/// 🔴 Since §71.162 (2026-09-20) these two fields **follow the wallet address**, and the real copy
/// lives in the backend (read from the `profile` field of `GET /me`, written with `POST /profile`).
/// What is left in this file is only a per-address browser cache, for two reasons: so you can pick
/// a name before signing in, and so a reload does not flash the short address first.
///
/// This comment used to say "**the backend is deliberately left out of this**: the §6 boundary is
/// that money does not pass through the backend, and a backend existing purely for avatars brings
/// moderation, takedown and long-term hosting costs". That sentence was retired on 2026-09-20 for
/// two reasons:
///  1. It assumed "stand up a backend just for nicknames". The backend has long existed by now
///     (signature login + ledger + arena balance), and the nickname is one four-column table next
///     to tables that are already there — the marginal cost is roughly zero;
///  2. It treated the nickname as "a preference on this machine". It is not — it is a property of
///     the **address**. Kept under one global localStorage key, signing in with another wallet or
///     from another machine showed you the previous address's name (user, 2026-09-20: "I just
///     signed in with my phone wallet, a different address, and it is still that nickname").
///
/// The §6 boundary is untouched: there is not a cent in this table, it takes no part in settlement,
/// and deleting a row only loses a name.

import { tr } from "./i18n";
import { DEMO_PROFILE, isDemo } from "./demo";

/// One slot per address. Demo mode uses its own prefix so it never mixes with real wallet names.
const PREFIX = isDemo() ? "uploop.profile.demo." : "uploop.profile.";
const keyOf = (address: string): string => PREFIX + address.toLowerCase();

/// The pre-§71.162 global key (**not split by address**). Delete it when the page opens.
///
/// 🔴 Why delete rather than "migrate it onto the current address": nobody can say **which address**
/// the name in that slot belonged to. Claiming it for whatever wallet happens to be connected now
/// would reproduce the exact bug the user reported (sign in with another wallet, the name follows
/// you over). Better to have them type the name again — that takes three seconds.
try {
  localStorage.removeItem("uploop.profile");
  localStorage.removeItem("uploop.profile.demo");
} catch {
  /* private mode: nothing to do */
}

export interface Profile {
  name: string;
  variant: number;
}

export const EMPTY: Profile = { name: "", variant: 0 };

/// Limits on the display name. Unbounded length wrecks leaderboard layout; control and zero-width
/// characters let one name impersonate another (homoglyphs) or hide a line break inside a row.
/// 🔴 `NAME_MAX` / `_INVISIBLE` in the backend's `core/uploop/api/app.py` match these one for one —
/// this pair is for the experience (blocked as you type), that pair is the actual defence (anyone
/// can POST to the endpoint directly).
export const NAME_MAX = 16;

/// Written as escape sequences, never as literal characters — literal control characters are
/// invisible in an editor, get mangled by copy-paste, and cannot be spotted in code review. In
/// order: C0 controls, DEL and C1, no-break space, zero-width and direction marks, direction
/// overrides, word joiner and invisible operators, BOM.
const INVISIBLE =
  /[\u0000-\u001F\u007F-\u009F\u00A0\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

export function sanitizeName(raw: string): string {
  return raw.replace(INVISIBLE, "").trim().slice(0, NAME_MAX);
}

/// The profile cached on this machine for that address. With no wallet connected (`address` empty)
/// there is no profile to speak of.
export function loadProfile(address?: string | null): Profile {
  if (!address) return isDemo() ? DEMO_PROFILE : EMPTY;
  try {
    const raw = localStorage.getItem(keyOf(address));
    if (!raw) return isDemo() ? DEMO_PROFILE : EMPTY;
    const p = JSON.parse(raw);
    return {
      name: sanitizeName(String(p.name ?? "")),
      variant: Number.isInteger(p.variant) ? p.variant : 0,
    };
  } catch {
    return EMPTY;
  }
}

export function saveProfile(address: string | null | undefined, p: Profile) {
  if (!address) return;
  try {
    localStorage.setItem(keyOf(address), JSON.stringify({ ...p, name: sanitizeName(p.name) }));
  } catch {
    /* private mode: nothing to do */
  }
}

/// With no name picked, use the first two and last four address characters. This label never
/// replaces the full wallet identity used for matching accounts.
export function displayName(p: { name?: string | null }, address?: string | null): string {
  const name = sanitizeName(p.name ?? "");
  if (name) return name;
  if (address) return `${address.slice(0, 2)}…${address.slice(-4)}`;
  return tr("Not connected");
}
