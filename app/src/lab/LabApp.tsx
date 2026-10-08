/// The status bench (§71.109): a second front-end entry point that lays out **every state** fake data can produce on one page, to be scanned in one pass.
///
/// Why `?lab=1` rather than `#lab`:
/// the ops console goes through the hash (`#ops`, main.tsx), but the bench holds **the main site's components**, and `Arena`
/// writes `location.hash = "arena/<id>"` itself (opening a match). If the bench navigated by hash too,
/// one stray click on a row would throw the user back to the main site. A query string is not affected by the components, hence `?lab=1`;
/// as a bonus, `Arena`'s match detail can be opened inside the bench too — free extra coverage.
///
/// Three rules it holds itself to:
///   1. Never change anything in `components/` or `lib/` — all fake data is poured in from outside as props (see fixtures.ts).
///   2. Only this file renders `<SiteWall>`: it is `position: fixed` and the site should only ever have one layer of it.
///   3. `lab.css` only writes `.lab-*` and never touches a selector under inspection, or the bench would hide the very faults it is looking for.

import { useEffect, useMemo, useState } from "react";
import "./lab.css";
import { SiteWall } from "../components/Wall";
import { GROUPS, groupLabel } from "./registry";
import type { Group, LabCase } from "./registry";
import { shellCases } from "./cases/shell";
import { homeCases } from "./cases/home";
import { arenaCases } from "./cases/arena";
import { accountCases } from "./cases/account";
import { stakeCases } from "./cases/stake";
import { marketCases } from "./cases/market";
import { modalCases } from "./cases/modal";
import * as F from "./fixtures";

const CASES: LabCase[] = [
  ...shellCases, ...homeCases, ...arenaCases, ...accountCases, ...stakeCases, ...marketCases, ...modalCases,
];

const THEME_KEY = "uploop-theme";
const BAR = { light: "#F4F0E4", dark: "#0A0906" } as const;

/// Address-bar state: `?lab=1&group=arena&case=arena-open`. Query, not hash — the reason is in the file header.
function readUrl(): { group: Group | "all"; only: string | null } {
  const q = new URLSearchParams(location.search);
  const g = q.get("group");
  return {
    group: GROUPS.some((x) => x.key === g) ? (g as Group) : "all",
    only: q.get("case"),
  };
}

function writeUrl(group: Group | "all", only: string | null) {
  const q = new URLSearchParams(location.search);
  q.set("lab", "1");
  if (group === "all") q.delete("group"); else q.set("group", group);
  if (only) q.set("case", only); else q.delete("case");
  history.pushState(null, "", `${location.pathname}?${q.toString()}${location.hash}`);
}

export default function LabApp() {
  const [{ group, only }, setUrl] = useState(readUrl);
  const [theme, setTheme] = useState<"dark" | "light">(
    () => (document.documentElement.dataset.theme === "light" ? "light" : "dark"),
  );
  /// The code wall is on by default: the §71.103 fault where the code shows through and sits on top of the text in the light theme is invisible with the wall off.
  const [wall, setWall] = useState(true);
  const [rail, setRail] = useState(false);

  useEffect(() => {
    const f = () => setUrl(readUrl());
    addEventListener("popstate", f);
    return () => removeEventListener("popstate", f);
  }, []);

  const go = (g: Group | "all", c: string | null) => { writeUrl(g, c); setUrl({ group: g, only: c }); scrollTo(0, 0); };

  const flip = () => {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BAR[next]);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* private window; switching in memory is enough */ }
    setTheme(next);
  };

  const shown = useMemo(() => {
    if (only) return CASES.filter((c) => c.id === only);
    return group === "all" ? CASES : CASES.filter((c) => c.group === group);
  }, [group, only]);

  return (
    <div className={`lab${only ? " solo" : ""}`}>
      {/* The site-wide backdrop, this one layer only. With an empty list the component renders nothing itself */}
      {wall && <SiteWall board={F.board()} assets={F.assetsOk()} quotes={F.quotes()} />}

      {/* Contents on the left: collapsed by default, floating above the content when open.
          🔴 It must not become a fixed column that squeezes the body narrower — change the body width and the media queries and the §71.106 alignment line all go false. */}
      <button type="button" className="lab-rail-btn" onClick={() => setRail((v) => !v)} aria-expanded={rail}>
        {rail ? "×" : "Contents"}
      </button>
      {rail && (
        <nav className="lab-rail" aria-label="Case contents">
          <button type="button" className={`lab-g${group === "all" && !only ? " on" : ""}`} onClick={() => go("all", null)}>
            All <small>{CASES.length}</small>
          </button>
          {GROUPS.map((g) => {
            const list = CASES.filter((c) => c.group === g.key);
            return (
              <div key={g.key} className="lab-grp">
                <button type="button" className={`lab-g${group === g.key && !only ? " on" : ""}`} onClick={() => go(g.key, null)}>
                  {g.label} <small>{list.length}</small>
                </button>
                <ul>
                  {list.map((c) => (
                    <li key={c.id}>
                      <button type="button" className={only === c.id ? "on" : ""} onClick={() => go(g.key, c.id)}>{c.name}</button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
      )}

      {/* Toolbar: pinned bottom right, small and out of the way. Bottom right because almost everything under inspection sits in the top half of the page */}
      <div className="lab-bar">
        <span className="lab-count">{shown.length} / {CASES.length}</span>
        <button type="button" onClick={flip}>{theme === "light" ? "☾ Dark" : "☀ Light"}</button>
        <button type="button" className={wall ? "on" : ""} onClick={() => setWall((v) => !v)}>Code wall</button>
        {only && <button type="button" onClick={() => go(group, null)}>Gallery</button>}
        <a href={location.pathname}>Main site</a>
      </div>

      <div className="lab-list">
        {shown.map((c) => (
          <section className="lab-case" key={c.id}>
            <header className="lab-head">
              <span className="lab-tag">{groupLabel(c.group)}</span>
              <h2>{c.name}</h2>
              {c.note && <p>{c.note}</p>}
              <button type="button" className="lab-solo" onClick={() => go(c.group, only ? null : c.id)}>
                {only ? "Gallery" : "Solo"}
              </button>
            </header>
            <div className="lab-body">{c.render()}</div>
          </section>
        ))}
        {shown.length === 0 && <p className="lab-none">No such case.<button type="button" onClick={() => go("all", null)}>Show all</button></p>}
      </div>
    </div>
  );
}
