import { PERIOD, tr } from "../lib/i18n";
import { Mark } from "./Mark";
import { Wordmark } from "./Wordmark";
import { DISCLAIMER_LEAD, X_HANDLE, X_URL } from "../lib/legal";

/// Site-wide footer (§47 / §71.41): one risk line + four site links + the official X account.
/// Since 2026-09-14 the full disclaimer is no longer printed in every page's footer; it moved to
/// its own `#disclaimer` page (the copy went into lib/legal.ts unchanged) and the footer keeps
/// only the single most important sentence. Privacy and the Help Center are site pages too,
/// not external links.
export function Footer() {
  return (
    <footer className="site-foot">
      <div className="foot-in">
        <div className="foot-brand">
          <Mark />
          <div>
            <Wordmark />
            {/* Copyright line, wording set by the user 2026-09-14 (§71.45). The year follows the
                system clock rather than being hard-coded. */}
            <small>© {new Date().getFullYear()} {tr("Uploop.io. All rights reserved.")}</small>
          </div>
        </div>
        <div className="foot-text">
          <nav className="foot-links" aria-label={tr("Site information")}>
            <a href="#notices">{tr("Notices")}</a>
            <a href="#help">{tr("Help Center")}</a>
            <a href="#disclaimer">{tr("Disclaimer")}</a>
            <a href="#privacy">{tr("Privacy Policy")}</a>
            {/* External link, laid out apart from the four site pages above (.foot-links .x);
                the whole string stays on one line */}
            <a className="x" href={X_URL} target="_blank" rel="noreferrer noopener">X {X_HANDLE}</a>
          </nav>
          {/* The sentence is split by a link, so it cannot be one tr() call. The closing stop is
              its own key because the two languages end a sentence with different stops. PERIOD is
              shared by every such split sentence on the site rather than repeated per file. */}
          <p className="foot-risk">{DISCLAIMER_LEAD} {tr("Full terms in the")} <a href="#disclaimer">{tr("Disclaimer")}</a>{tr(PERIOD)}</p>
        </div>
      </div>
    </footer>
  );
}
