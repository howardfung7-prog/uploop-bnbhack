import { tr } from "./lib/i18n";
import { StrictMode, Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { captureRef } from "./lib/referral";
import "./styles.css";
import "./polish.css";
import { installSpotlight } from "./lib/spotlight";

/// A tab left open across a deploy still runs the old bundle, whose lazy chunks may be gone from the
/// server; opening such a page would then fail with "Failed to fetch dynamically imported module".
/// Reload once to pick up the new build (§71.174). The timestamp stops a loop if the chunk really is
/// missing from the new build too.
installSpotlight();

addEventListener("vite:preloadError", (event) => {
  try {
    const last = Number(sessionStorage.getItem("uploop-chunk-reload") || 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem("uploop-chunk-reload", String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  location.reload();
});

/// The ops console is a hidden page (DECISIONS §71.40): when the address bar says `#ops`
/// (or `#ops/...`) we load `src/ops/OpsApp.tsx`, otherwise it is the normal site. It is not in the
/// navigation and no page links to it; its code is a separate chunk, so ordinary visitors never
/// download it.
///
/// 🔴 The ops console stays in Chinese (user 2026-09-20, §71.163) — it is an internal tool for the
/// operator. Everything under `src/ops/**` is therefore exempt from the English-only rule that
/// applies to the rest of `src/`. The loading line below is the one exception: it has to render
/// *before* the ops chunk arrives, so it cannot live inside that chunk, and it is in English like
/// the rest of this file.
const OpsApp = lazy(() => import("./ops/OpsApp"));

/// The state board is a hidden page too (§71.109): `?lab=1` loads `src/lab/LabApp.tsx`, which lays
/// out every state of every section with fake data on one page, so styles can be swept cell by cell
/// after a change. Also absent from the navigation, also a separate chunk.
///
/// 🔴 It keys off the **query, not the hash**, unlike `#ops` above: the board mounts real site
/// components, and `Arena` writes `location.hash = "arena/<id>"` itself. Routing on the hash would
/// bounce you back to the main site the moment you clicked a row.
const LabApp = lazy(() => import("./lab/LabApp"));

function isOpsHash(): boolean {
  return /^#ops(\/|$)/.test(location.hash);
}

/// The query string cannot turn into `lab=1` without a reload, so one read is enough — no listener.
function isLab(): boolean {
  return new URLSearchParams(location.search).get("lab") === "1";
}

function Root() {
  const [ops, setOps] = useState(isOpsHash);
  useEffect(() => {
    const onHash = () => {
      setOps(isOpsHash());
      const robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
      if (robots) robots.content = isLab() || isOpsHash() ? "noindex, nofollow" : "index, follow, max-image-preview:large";
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  if (isLab()) {
    return (
      <Suspense fallback={<div className="ops-loading">{tr("Loading state board…")}</div>}>
        <LabApp />
      </Suspense>
    );
  }
  if (!ops) return <App />;
  return (
    <Suspense fallback={<div className="ops-loading">{tr("Loading ops console…")}</div>}>
      <OpsApp />
    </Suspense>
  );
}

/// 🔴 Capture the referral code **before** React mounts (§71.144): `captureRef` strips `?ref=` out
/// of the address bar, and places that read the query — `isLab()` and friends — run during render.
/// Capture first, strip first, and after that nobody sees the parameter; a link forwarded on will
/// not silently carry someone else's code either. Capturing only stores it; the actual binding
/// happens after signature login (see App.tsx).
captureRef();

/// index.html carries the English title so a crawler (which has no localStorage) always reads it.
/// For a reader who picked Chinese, retitle the tab here rather than in that bootstrap script —
/// that keeps every Chinese string in lib/i18n.zh.ts instead of copying one into the HTML. Set
/// once at startup, not in an effect: switching language reloads the page (§71.164), so it cannot
/// go stale, and doing it before render avoids a visible flip in the tab.
document.title = tr("UPLOOP · Open Index Strategy Platform");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
