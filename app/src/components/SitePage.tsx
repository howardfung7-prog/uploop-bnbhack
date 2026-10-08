import { PERIOD, tr } from "../lib/i18n";
import { useEffect, useRef, useState } from "react";
import { fmtWhen } from "../lib/arena";
import type { Ticker } from "../lib/board";
import { helpGroups } from "../lib/faq";
import { DISCLAIMER, PRIVACY, PRIVACY_UPDATED, X_HANDLE, X_URL } from "../lib/legal";
import type { Notice } from "../lib/notices";
import { Faq } from "./Faq";
import type { Tab } from "./Topbar";

/// The site's information pages (DECISIONS §71.41): notices / Help Center / disclaimer / privacy.
///
/// None of the four is in the top navigation (none is a `Tab`); they are reached from the footer
/// and the home-page notice bar, at `#notices` / `#help` / `#disclaimer` / `#privacy`. The Help
/// Center is paged by section (`#help/<section>`, with a table of contents down the left) and its
/// copy shares a source with the foot of each page (lib/faq.ts), so the two cannot disagree. If the
/// notices cannot be read it says so rather than inventing any (§29).
/// (The `Site` type and `readSite()` live in ./site-route, so App can route without this chunk.)
import type { Site } from "./site-route";
export type { Site };
export { readSite } from "./site-route";

/// 🔴 A subtitle is only written when it **genuinely adds something** (§71.89). The two the notices
/// page and the Help Center used to carry — "every notice the operator has published, most recent
/// first…" and "paged by section; pick one from the table of contents on the left…" — described who
/// posts them and how the page is arranged, and left the reader knowing no more about any rule, so
/// they were dropped at the user's request. Not blanked to an empty string: dropped.
/// The disclaimer's line is a legal notice to the reader and the privacy page's is the date it was
/// updated, so both stay.
const HEAD: Record<Site, { title: string; sub?: string }> = {
  notices: { title: tr("Notices") },
  help: { title: tr("Help Center") },
  disclaimer: { title: tr("Disclaimer"), sub: tr("This disclaimer is a condition of using the site. Please read it in full before entering a match or using any feature.") },
  privacy: { title: tr("Privacy policy"), sub: tr("Last updated {0}", PRIVACY_UPDATED) },
};

interface Props {
  page: Site;
  /// Notices (most recent first; App fetches them once for everyone). null = not read yet.
  notices: Notice[] | null;
  /// Whether the arena endpoint is configured: without it the notices cannot be read, so say why
  /// rather than showing "none"
  configured: boolean;
  board: Ticker[];
  /// The secondary-market fee rate, read from the chain; null = not read yet, in which case the
  /// questions do not quote a rate
  feeBps: number | null;
  onGo: (t: Tab) => void;
}

export function SitePage({ page, notices, configured, board, feeBps, onGo }: Props) {
  const h = HEAD[page];
  return (
    <main className={`site-page${page === "help" ? " help-page" : ""}`}>
      <div className="site-head">
        <h1>{h.title}</h1>
        {h.sub && <p>{h.sub}</p>}
      </div>
      {page === "notices" ? <Notices notices={notices} configured={configured} />
        : page === "help" ? <Help board={board} feeBps={feeBps} onGo={onGo} />
        : page === "disclaimer" ? <Prose paras={DISCLAIMER} />
        : <Privacy />}
      <p className="site-back">
        <button className="link" onClick={() => onGo("home")}>{tr("Back to home")}</button>
      </p>
    </main>
  );
}

function Notices({ notices, configured }: { notices: Notice[] | null; configured: boolean }) {
  // "The endpoint is not configured" is our problem and means nothing to a visitor (§71.89). But it
  // cannot become "no notices" either — that sentence is only true once we have actually read back
  // "there are none" (§29). So say what is so: it could not be read.
  if (!configured) return <div className="site-empty">{tr("Notices cannot be loaded right now")}</div>;
  if (notices === null) return <div className="site-empty">{tr("Loading…")}</div>;
  if (notices.length === 0) return <div className="site-empty">{tr("No notices yet")}</div>;
  return (
    <div className="notice-list">
      {notices.map((n) => (
        <article key={n.id} className={`notice-row${n.level === "warn" ? " warn" : ""}`}>
          <time>{fmtWhen(n.at)}</time>
          <p>{n.text}</p>
        </article>
      ))}
    </div>
  );
}

function Help({ board, feeBps, onGo }: { board: Ticker[]; feeBps: number | null; onGo: (t: Tab) => void }) {
  const groups = helpGroups(board, feeBps);
  const seg = useHashSeg();
  const cur = groups.find((g) => g.key === seg) ?? groups[0];

  // Changing section = a new page, so go back to the top; the first arrival is left alone (it may
  // have come in from elsewhere carrying an anchor)
  const first = useRef(true);
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!first.current) scrollTo({ top: 0, behavior: "smooth" });
    first.current = false;
    // On a phone the table of contents is a single horizontal row: bring the selected item into
    // view (on desktop it does not scroll sideways, so the assignment does nothing)
    const on = nav.current?.querySelector<HTMLElement>("a.on");
    if (nav.current && on) nav.current.scrollLeft = on.offsetLeft - nav.current.offsetLeft - 12;
  }, [cur.key]);

  return (
    <div className="help-wrap">
      <nav className="help-side" aria-label={tr("Help Center contents")} ref={nav}>
        <b>{tr("Contents")}</b>
        {groups.map((g) => (
          <a key={g.key} href={`#help/${g.key}`} className={g.key === cur.key ? "on" : ""} aria-current={g.key === cur.key ? "page" : undefined}>
            {g.title}
          </a>
        ))}
        <b className="more">{tr("Also")}</b>
        <a href="#notices">{tr("Notices")}</a>
        <a href="#disclaimer">{tr("Disclaimer")}</a>
        <a href="#privacy">{tr("Privacy policy")}</a>
      </nav>
      <div className="help-body">
        <div className="help-h">
          <h2>{cur.title}</h2>
          <p>{cur.where}</p>
        </div>
        <Faq qa={cur.qa} title={null} id={`faq-${cur.key}`} />
        <p className="site-note">
          {tr("For anything this page does not cover: the rules of an individual match are whatever that match's own rules say on the")} <button className="link" onClick={() => onGo("arena")}>{tr("schedule")}</button> {tr("page; anything else can be raised through the official X account")} <a href={X_URL} target="_blank" rel="noreferrer noopener">{X_HANDLE}</a>{tr(".||after the X handle in the help note")}
          {tr("The full risk warnings and terms of liability are in the")} <a href="#disclaimer">{tr("disclaimer")}</a>{tr(", which takes precedence over the explanatory text on this page.")}
        </p>
      </div>
    </div>
  );
}

/// The Help Center's section is the second segment of the hash (`#help/arena`). Changing only that
/// segment leaves App's tab and site untouched, so React does not re-render — hence listening for
/// hashchange here.
function useHashSeg(): string {
  const read = () => location.hash.slice(1).split("/")[1] ?? "";
  const [seg, setSeg] = useState(read);
  useEffect(() => {
    const on = () => setSeg(read());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return seg;
}

function Prose({ paras }: { paras: string[] }) {
  return <div className="site-prose">{paras.map((t, i) => <p key={i}>{t}</p>)}</div>;
}

function Privacy() {
  return (
    <div className="site-prose">
      {PRIVACY.map((s) => (
        <section key={s.h}>
          <h2>{s.h}</h2>
          {s.p.map((t, i) => <p key={i}>{t}</p>)}
        </section>
      ))}
      <p className="site-note">
        {tr("Contact: the official X account")} <a href={X_URL} target="_blank" rel="noreferrer noopener">{X_HANDLE}</a>{tr(PERIOD)}
        {tr("See also the")} <a href="#disclaimer">{tr("disclaimer")}</a>{tr(PERIOD)}
      </p>
    </div>
  );
}
