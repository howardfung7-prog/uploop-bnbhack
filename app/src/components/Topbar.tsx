import { tr } from "../lib/i18n";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Mark } from "./Mark";
import { Wordmark } from "./Wordmark";
import { ThemeToggle } from "./ThemeToggle";
import { LangToggle } from "./LangToggle";

export type Tab = "home" | "arena" | "mint" | "market" | "meme" | "build" | "mine";

/// Top-level navigation (§67, user 2026-09-11): Home · Index Strategy Arena · Asset Ecosystem · My Account.
/// (Two section names were reworded 2026-09-14 at the user's request, and again 2026-09-15, §71.41 / §71.65.)
/// The two big sections are the platform's two sides: the Arena is the people who pay a buy-in and
/// compete on return (demand side); the Asset Ecosystem is the people who deposit tokens or burn MEME
/// for certificates and earn bStock when their asset gets used (supply side).
/// "My Account" spans both sides, so it stands on its own instead of hiding inside a section.
export type Section = "home" | "play" | "assets" | "mine";

interface SectionDef {
  key: Section;
  label: string;
  /// Which page clicking the section name lands on
  home: Tab;
  /// Sub-pages inside the section (the segmented switch under the page head). Empty = this level is the page
  pages: [Tab, string][];
  /// Highlight the whole section in magenta (§59.5 highlighted only the MEME item; §67 the user decided
  /// the whole asset section glows, and MEME keeps glowing once you are inside)
  hot?: boolean;
  /// The section's headline entry point: enlarged and filled gold in the segmented switch (§67.12).
  /// For the Arena that is the Strategy Builder
  primary?: Tab;
}

/// Not one page key (`Tab`) changed: the page components, `onGo(tab)` routing and the
/// `#arena` / `#mint` hashes all stay as they were.
export const SECTIONS: SectionDef[] = [
  { key: "home", label: tr("Home"), home: "home", pages: [] },
  { key: "play", label: tr("Index Strategy Arena"), home: "arena", pages: [["arena", tr("Arena")], ["build", tr("Strategy Builder")]], primary: "build" },
  { key: "assets", label: tr("Asset Ecosystem"), home: "mint", pages: [["mint", tr("Asset Staking")], ["market", tr("Certificate Market")], ["meme", tr("MEME Lab")]], hot: true },
  { key: "mine", label: tr("My Account"), home: "mine", pages: [] },
];

export function sectionOf(tab: Tab): Section {
  switch (tab) {
    case "arena": case "build": return "play";
    case "mint": case "market": case "meme": return "assets";
    case "mine": return "mine";
    default: return "home";
  }
}

const sectionDef = (key: Section): SectionDef => SECTIONS.find((s) => s.key === key)!;

interface Props {
  tab: Tab;
  onTab: (t: Tab) => void;
  /// Top-right slot: connect wallet / player profile
  right: ReactNode;
}

/// Top navigation bar: brand on the left, nav centre-left, wallet top right.
/// On narrow screens the nav collapses into the top-right menu button and drops down when tapped
/// (user 2026-09-14: on phones the nav must not sit at the bottom, §71.41);
/// tapping an item, pressing Esc, or clicking outside the panel all close it.
/// Clicking a section name: if you are already inside that section you stay on the current page,
/// otherwise you go to the section's home page.
export function Topbar({ tab, onTab, right }: Props) {
  const current = sectionOf(tab);
  const [menu, setMenu] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // Changing page closes the menu (tapping an item, or anything else calling onTab)
  useEffect(() => { setMenu(false); }, [tab]);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setMenu(false); };
    // Site info pages (#help and friends) do not change the tab, only the hash — that counts as
    // changing page too, so close the menu the same way
    const onHash = () => setMenu(false);
    addEventListener("keydown", onKey);
    addEventListener("mousedown", onDown);
    addEventListener("hashchange", onHash);
    return () => { removeEventListener("keydown", onKey); removeEventListener("mousedown", onDown); removeEventListener("hashchange", onHash); };
  }, [menu]);
  const links = (cls: string, skipHome: boolean) =>
    SECTIONS.filter((s) => !(skipHome && s.key === "home")).map((s) => {
      const on = current === s.key;
      const target = on ? tab : s.home;
      return (
        <a
          key={s.key}
          href={`#${target}`}
          className={`${cls}${on ? " on" : ""}${s.hot ? " hot" : ""}`}
          onClick={(e) => { e.preventDefault(); onTab(target); }}
          aria-current={on ? "page" : undefined}
        >
          {s.label}
        </a>
      );
    });

  return (
    <header className="topbar">
      <div className="tb-in">
        <a className="brand" href="#home" aria-label={tr("Uploop home")} onClick={(e) => { e.preventDefault(); onTab("home"); }}>
          <Mark />
          <Wordmark />
        </a>
        <nav className="tb-nav" aria-label={tr("Main navigation")}>{links("tb-link", false)}</nav>
        {/* The theme switch sits to the left of the balance (§71.102, user 2026-09-17). It lives in
            .tb-right rather than inside ProfileBar: the balance cell only renders once the API is
            configured, and the switch must not disappear with it */}
        <div className="tb-right"><span className="tb-lang-desktop"><LangToggle /></span><ThemeToggle />{right}</div>
        {/* Phone: top-right menu button plus a drop-down nav panel. Hidden by CSS on wide screens */}
        <div className="tb-menu-wrap" ref={box}>
          <button
            type="button"
            className={`tb-burger${menu ? " on" : ""}`}
            aria-label={menu ? tr("Close navigation") : tr("Open navigation")}
            aria-expanded={menu}
            aria-controls="tb-menu"
            onClick={() => setMenu((v) => !v)}
          >
            <i aria-hidden="true" />
          </button>
          {menu && (
            <nav className="tb-menu" id="tb-menu" aria-label={tr("Main navigation")}>
              {links("tb-mlink", false)}
              <div className="tb-menu-lang"><LangToggle /></div>
            </nav>
          )}
        </div>
      </div>
    </header>
  );
}

/// The in-section switch (used in the page head). Sections with no sub-pages (My Account) return null.
/// The MEME item glows once more on its own (§59.5 / §67).
export function SubNav({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const sec = sectionDef(sectionOf(tab));
  if (sec.pages.length === 0) return null;
  return (
    <nav className="subnav" aria-label={tr("{0} pages", sec.label)}>
      {sec.pages.map(([key, label]) => (
        <a
          key={key}
          href={`#${key}`}
          className={`${tab === key ? "on" : ""}${key === "meme" ? " hot" : ""}${sec.primary === key ? " primary" : ""}`}
          onClick={(e) => { e.preventDefault(); onTab(key); }}
          aria-current={tab === key ? "page" : undefined}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}

/// Used by the page head's small label: the section name (for sections that have sub-pages).
export const sectionLabel = (tab: Tab): string | null => {
  const sec = sectionDef(sectionOf(tab));
  return sec.pages.length > 0 ? sec.label : null;
};
export const sectionIsHot = (tab: Tab): boolean => sectionDef(sectionOf(tab)).hot === true;
