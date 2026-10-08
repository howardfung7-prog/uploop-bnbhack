import { LANG_NAME, lang, setLang, tr } from "../lib/i18n";
import type { Lang } from "../lib/i18n";

/// The English / Chinese switch in the top navigation. English is the default when no language
/// preference has been saved.
///
/// There is no local state, unlike ThemeToggle: `setLang` reloads the page, so the component is
/// rebuilt from scratch in the new language and has nothing to keep in sync. The one case where
/// the reload does not happen is a private window with localStorage blocked; see setLang.
///
/// The label is the language you would switch *to*, written in that language — a reader who cannot
/// read the current interface can still find their way out.
export function LangToggle() {
  const next: Lang = lang() === "en" ? "zh" : "en";
  const label = tr("Switch the site language to {0}", LANG_NAME[next]);

  return (
    <button type="button" className="tb-lang" onClick={() => setLang(next)} title={label} aria-label={label}>
      {/* A globe rather than a flag: a language is not a country, and the site is not region-locked */}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3Z" />
      </svg>
      {LANG_NAME[next]}
    </button>
  );
}
