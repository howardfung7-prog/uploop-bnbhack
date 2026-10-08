import { tr } from "../lib/i18n";
import { useState } from "react";

/// The dark / light switch in the top bar (§71.102, user 2026-09-17: "put a dark-mode /
/// light-mode switch to the left of the balance in the nav bar", asking for the smallest
/// possible change, a fast switch and a stable one).
///
/// Switching does exactly one thing: it changes `data-theme` on <html>. The light theme is one
/// block of token overrides at the end of styles.css, `:root[data-theme="light"]` — flip the
/// attribute and the browser recomputes the custom properties, recolouring the whole site in a
/// single frame. There is no context and the theme is never pushed into the React tree, so no
/// component re-renders; this component's own useState only decides which icon to draw. That is
/// where "fast" and "stable" come from: nothing async and no state sync on the switch path.
///
/// Dark by default: the dark ground is this site's own colour (§14), and it deliberately does not
/// follow the system's prefers-color-scheme — only an explicit click counts.
/// The choice is stored in localStorage, and on reload the inline script in index.html sets the
/// attribute before the stylesheet loads, so there is no white flash.

const KEY = "uploop-theme";
type Theme = "dark" | "light";

/// Bar colour (light = warm paper white, dark = near black), used by mobile browsers for the
/// address bar. The values match --ground in styles.css.
const BAR: Record<Theme, string> = { light: "#F4F0E4", dark: "#0A0906" };

export function ThemeToggle() {
  // Read the initial value from the DOM, not from localStorage: the inline script already set the
  // attribute, and taking the DOM as the source of truth keeps the two from disagreeing
  const [theme, setTheme] = useState<Theme>(
    () => (document.documentElement.dataset.theme === "light" ? "light" : "dark"),
  );
  const light = theme === "light";
  const label = light ? tr("Switch to dark mode") : tr("Switch to light mode");

  const flip = () => {
    const next: Theme = light ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BAR[next]);
    // localStorage throws in private windows; swallowing it is fine — the switch still works for
    // this session, it just will not be remembered
    try { localStorage.setItem(KEY, next); } catch { /* failing to store does not block the switch */ }
    setTheme(next);
  };

  return (
    <button type="button" className="tb-theme" onClick={flip} title={label} aria-label={label}>
      {light ? (
        // Currently light → draw a moon: the icon shows what clicking will turn it into
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20.5 14.3A8.6 8.6 0 0 1 9.7 3.5a8.6 8.6 0 1 0 10.8 10.8Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.6v2.2M12 19.2v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.6 12h2.2M19.2 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
        </svg>
      )}
    </button>
  );
}
