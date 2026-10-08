/// Reproduces the main site's wrapper chain (§71.109).
///
/// 🔴 This is a key part of the bench, not decoration. Many selectors in `styles.css` are scoped by section:
///   `.arena .modal { box-shadow: none }`, `.page-head:not(.in-hot) .subnav a.on { … }`,
///   and `main` is itself the `max-width: 1360px + 32px each side` body column (§71.106's alignment line).
/// Render a component bare and the styles will not match, so the bench reports a false "looks fine".
///
/// Every case therefore goes through this layer, and **through this one place only**: when the main site's
/// wrapper chain (App.tsx:652-700) changes, only this file has to follow, rather than forty-odd cases.
///
/// Two things deliberately left out of the default render:
///   · `<Topbar>` — `position: sticky`, and forty of them stacked in the gallery would crush each other; only the shell group asks for it explicitly.
///   · `<SiteWall>` — `position: fixed`, and the site should only ever have one layer of it; LabApp renders it once for everybody.

import type { ReactNode } from "react";

export function Stage({ wide = false, children }: { wide?: boolean; children: ReactNode }) {
  return (
    <div className="shell">
      <div className="stage">
        {wide ? <main className="wide">{children}</main> : <main>{children}</main>}
      </div>
    </div>
  );
}

/// The shell without a `<main>`: for the top bar / banners / footer, which live outside main anyway.
export function Bare({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <div className="stage">{children}</div>
    </div>
  );
}
