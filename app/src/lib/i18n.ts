/// Bilingual text: English by default, Chinese on request (§71.164).
///
/// The site shipped English-only on 2026-09-20 (§71.163). The user then asked for both languages
/// back, with a switch in the footer and English as the default. This module is the whole of that
/// mechanism — there is no i18n framework and no new dependency.
///
/// ## How a string gets translated
///
/// The English text IS the key. The function is `tr`, not the conventional `t`, because this
/// codebase already uses `t` for a Ticker in 400-odd places and the import would be shadowed:
///
///     tr("Arena")                          -> English key or Chinese translation
///     tr("Could not load: {0}", err)       -> translated text with err inserted
///
/// `ZH` (lib/i18n.zh.ts) maps that English key to the Chinese sentence. A key that is missing from
/// the catalogue falls back to the key itself, so the worst case is an untranslated English string
/// on a Chinese page — never `undefined`, never a bare identifier leaking into the interface. That
/// property is the reason the key is the English text and not an invented dotted name: there is no
/// second namespace to keep in sync, and a typo degrades instead of breaking.
///
/// 🔴 Component files therefore stay free of Chinese characters: every Chinese string the site can
/// display lives in lib/i18n.zh.ts, which is where a translator (or the operator) edits wording
/// without touching code. Comments stay English everywhere, including in the catalogue.
///
/// The invariant is checked as a byte scan, and its exact scope is "app/src, excluding ops/ and
/// excluding these two i18n modules". This file is excluded because the
/// language names below use their native scripts; it holds no page text.
///
/// ## Placeholders
///
/// Interpolation cannot be a template literal, because the two languages order their parts
/// differently. Numbered placeholders survive the reordering:
///
///     tr("Avatar for {0}", addr)           // The translation may move {0}.
///
/// The index refers to the argument position, so a translation may use them in any order, use one
/// twice, or drop one. An index with no matching argument is left in place rather than printed as
/// "undefined", which makes the mistake obvious on screen instead of silently plausible.
///
/// ## Disambiguation
///
/// One English word occasionally needs two different Chinese renderings. Append `||` and a note:
///
///     tr("Notices||site")                  // Uses the site-specific translation.
///
/// Everything from `||` onwards is stripped before the English fallback is used, so the English
/// side still reads "Notices". `||` never occurs in ordinary prose, which is why it is the marker.
///
/// ## Why switching reloads the page
///
/// `setLang` reloads rather than re-rendering. Text is read at many points that React does not
/// re-run on a state change — module-level constants (lib/faq.ts, lib/legal.ts build their arrays
/// once at import), values captured in useState initialisers, strings already written into
/// document.title. A reload recomputes all of them and cannot leave half the page in the old
/// language. Switching languages is a once-in-a-session action; correctness is worth ~300ms.
///
/// The choice is stored in localStorage and applied by the inline script in index.html before the
/// first paint, the same way the theme is (§71.102), so a Chinese reader never sees a frame of
/// English first.

import { ZH } from "./i18n.zh";

export type Lang = "en" | "zh";

/// Each language names itself, in its own script. Deliberately not run through `tr()`: the switch
/// has to be readable by someone who cannot read the interface it is currently in, so a Chinese
/// reader looking at the English site must see the language name in its native script.
export const LANG_NAME: Record<Lang, string> = { en: "English", zh: "中文" };

/// A sentence that is split across an element ("... see the <a>Disclaimer</a>.") leaves its closing
/// stop as a JSX node of its own, and the two languages do not spell it the same way: English ends
/// with "." and the Chinese locale with a full-width period. One shared key rather than one per site, so the
/// catalogue has a single entry to get right.
export const PERIOD = ".||sentence end";

/// Shared with the bootstrap script in index.html — change it in both places or the setting is lost.
const KEY = "uploop-lang";

/// The <html lang> attribute is the source of truth, exactly as ThemeToggle takes `data-theme` from
/// the DOM: the bootstrap script has already read storage and set it, and reading it back keeps the
/// two from disagreeing. Anything other than "zh" is English, so a corrupted value fails to English.
function initial(): Lang {
  return document.documentElement.getAttribute("lang") === "zh" ? "zh" : "en";
}

let current: Lang = initial();

export function lang(): Lang {
  return current;
}

/// True when the interface is Chinese. For the few places that cannot go through `tr()` — JSX whose
/// word order puts an element in a different position in each language — branch on this instead.
export function isZh(): boolean {
  return current === "zh";
}

/// Fill {0}, {1}, ... from `args`. An index with no argument is left as written (see the header).
function fill(s: string, args: readonly unknown[]): string {
  return s.replace(/\{(\d+)\}/g, (whole, digits: string) => {
    const v = args[Number(digits)];
    return v === undefined ? whole : String(v);
  });
}

/// Translate `key` and substitute any arguments. See the header for the key format.
export function tr(key: string, ...args: readonly unknown[]): string {
  const cut = key.indexOf("||");
  const english = cut === -1 ? key : key.slice(0, cut);
  const text = current === "zh" ? ZH[key] ?? english : english;
  return args.length === 0 ? text : fill(text, args);
}

/// Switch language and reload. Storage throws in private windows; as with the theme switch we
/// swallow it — but unlike the theme we must not reload in that case, because the reload would
/// come back in the old language and look like the button is broken. Setting the attribute at
/// least changes the CSS-driven labels for the rest of the session.
export function setLang(next: Lang): void {
  if (next === current) return;
  let stored = true;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    stored = false;
  }
  current = next;
  document.documentElement.setAttribute("lang", next);
  if (stored) location.reload();
}
