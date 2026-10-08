/// A short address plus a copy icon (§71.132, the user on 2026-09-18:
/// "on Asset Staking, put the contract address to the right of every uTSLA/uBNB/uBTC and let people
/// copy it — show only the first 2 and last 4 characters, e.g. 0x...3456 (copy button)";
/// revised the same day: "don't write the word 'certificate' next to the contract address, and
/// don't write the word 'copy' either — a copy icon on its own is enough" → §71.133).
///
/// 🔴 "first 2 + last 4" is for **recognising** an address, not for **checking** one: the first two
/// characters are always `0x`, which leaves only the last 4 doing any work, and two different
/// contracts sharing their last 4 is perfectly possible. So:
///   · what gets copied is always the **full address**, never the 6 characters on screen;
///   · the full address goes into both `title` and `aria-label`, so anyone who wants to check it by
///     eye can have the whole string (§29: never hand out a truncated value that looks complete).
///
/// 🔴 There is no text on the button, only an icon — which makes `aria-label` non-optional: screen
/// reader and keyboard users have nothing else, and without it this is a button with no name at all.
import { tr } from "../lib/i18n";
import { useState } from "react";

const ZERO = "0x0000000000000000000000000000000000000000";

/// Whether this is an address worth showing and copying. The zero address counts as "none" —
/// rendering it as `0x…0000` would suggest such a contract exists, and somebody might well go and
/// search for that string in a swap (§25: no fake numbers).
export function hasAddr(a?: string | null): a is string {
  return typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a) && a.toLowerCase() !== ZERO;
}

/// `0x4902C5…eec3f` → `0x…ec3f`: first 2 plus last 4, the shape the user settled on 2026-09-18.
export function shortAddr(a: string): string {
  return `${a.slice(0, 2)}…${a.slice(-4)}`;
}

/// Put text on the clipboard. Returns **whether it actually worked**; if it did not, the interface
/// says so — a button that flashes a tick while the clipboard is in fact empty is worse than no
/// button at all (§29).
/// Exported so the ops console's "copy recovery code" can share it (§71.143): that one can afford a
/// false success even less — a recovery code is shown exactly once.
export async function writeClip(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission refused / the page is not in the foreground — fall through to the old route below
  }
  // 🔴 The old way (a temporary textarea + execCommand) cannot be dropped: `navigator.clipboard`
  // only exists in a secure context, and a page opened over http (testing on a LAN, a tunnel with no
  // https) does not have the object at all. Without this, the user clicks and nothing whatsoever
  // happens, and they assume they missed the button.
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.top = "-1000px";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

/// All three icons are 24-grid line art following `currentColor`, so they change colour with the button
const ico = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", width: 13, height: 13, "aria-hidden": true, focusable: "false" } as const;

/// Two sheets of paper overlapping = copy; every app draws it this way, so it needs no caption
const IcoCopy = () => (
  <svg {...ico}><rect x="8.5" y="8.5" width="13" height="13" rx="2.5" /><path d="M4.5 16.5h-.5a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v.5" /></svg>
);
/// A tick = it really is on the clipboard
const IcoOk = () => (<svg {...ico}><path d="M20 6.5 9.5 17 4 11.5" /></svg>);
/// A cross = it did not work. A line of small text follows it; a red cross alone cannot say whether
/// it means "failed" or "dismiss"
const IcoNo = () => (<svg {...ico}><path d="M18 6 6 18M6 6l12 12" /></svg>);

interface Props {
  /// The full address. Anything invalid, or the zero address, should be filtered out with
  /// `hasAddr()` before it gets here; this component does not guess
  a: string;
  /// What this address is, used in the tooltip and the screen-reader text, e.g. "WBNB token contract"
  what: string;
  /// One more line on what the address is for; tooltip only (the screen-reader text stays short, or
  /// every card would read out a paragraph)
  note?: string;
}

export function CopyAddr({ a, what, note }: Props) {
  const [st, setSt] = useState<"" | "ok" | "no">("");
  const copy = async () => {
    const ok = await writeClip(a);
    setSt(ok ? "ok" : "no");
    setTimeout(() => setSt(""), 1800);
  };
  return (
    <span className="caddr">
      <code title={note ? tr("{0} ({1}): {2}", what, note, a) : tr("{0}: {1}", what, a)}>{shortAddr(a)}</code>
      <button
        type="button"
        className={`cbtn${st ? ` ${st}` : ""}`}
        onClick={copy}
        title={st === "no" ? tr("This page will not allow copying — long-press or select the address above and copy it by hand") : tr("Copy the full address: {0}", a)}
        aria-label={tr("Copy the full {0} address {1}", what, a)}
      >
        {st === "ok" ? <IcoOk /> : st === "no" ? <IcoNo /> : <IcoCopy />}
        {st === "no" && <em>{tr("Copy failed")}</em>}
      </button>
    </span>
  );
}
