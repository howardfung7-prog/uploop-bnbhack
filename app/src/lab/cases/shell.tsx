/// The shell: top bar, banners, ticker, footer (§71.109).
/// This is the only group that renders `<Topbar>` — it is sticky, and the gallery cannot have them everywhere.

import { Topbar } from "../../components/Topbar";
import { ProfileBar } from "../../components/ProfileBar";
import { Ribbon } from "../../components/Ribbon";
import { Footer } from "../../components/Footer";
import { EMPTY as EMPTY_PROFILE } from "../../lib/profile";
import { pointsOf } from "../../lib/points";
import type { LabCase } from "../registry";
import { Bare } from "../Stage";
import * as F from "../fixtures";

/// One top bar: the cell in the top right corner is whatever `ProfileBar` makes of it, so all the parameters are exposed here.
function Bar(p: {
  connected: boolean; loggedIn: boolean; configured: boolean; named: boolean;
  funds: ReturnType<typeof F.fundsOk> | null; busy?: boolean; canWrite?: boolean;
}) {
  const points = F.pointsOk();
  return (
    <Topbar
      tab="home"
      onTab={F.noop}
      right={
        <ProfileBar
          address={p.connected ? F.account : null}
          profile={p.named ? F.profile() : EMPTY_PROFILE}
          onChange={F.noop}
          onConnect={F.noop}
          onDisconnect={F.noop}
          walletName={p.connected ? "MetaMask" : null}
          points={pointsOf(points, p.connected ? F.account : null)}
          pointsState={points}
          holdings={p.connected ? F.holdings() : []}
          pools={F.pools()}
          myEntries={F.emptyEntries()}
          funds={p.funds}
          arenaConfigured={p.configured}
          loggedIn={p.loggedIn}
          busy={p.busy ?? false}
          canWrite={p.canWrite ?? true}
          onLogin={F.noop}
          onLogout={F.noop}
          onFunds={F.noop}
          onGo={F.noop}
        />
      }
    />
  );
}

/// The site banner (the block at App.tsx:678-686). Its structure is copied verbatim here, because `.site-banner`'s styles key off these class names.
function SiteBanner({ paused, text, warn }: { paused?: boolean; text?: string; warn?: boolean }) {
  return (
    <div className={`site-banner${warn || paused ? " warn" : ""}`} role="status">
      {paused && <b>Entries paused</b>}
      {paused && <b>Withdrawals paused</b>}
      {text && <span>{text}</span>}
    </div>
  );
}

export const shellCases: LabCase[] = [
  {
    id: "topbar-disconnected", group: "shell", name: "Top bar · wallet not connected",
    note: "The top right should hold nothing but Connect wallet, with no balance cell; the theme switch must still be there (§71.102: it may not vanish along with the balance)",
    render: () => <Bare><Bar connected={false} loggedIn={false} configured named={false} funds={null} /></Bare>,
  },
  {
    id: "topbar-unnamed", group: "shell", name: "Top bar · connected, no name set",
    note: "The name falls back to the first four and last four of the address; the balance reads '—', not 0 (§25)",
    render: () => <Bare><Bar connected loggedIn={false} configured named={false} funds={null} /></Bare>,
  },
  {
    id: "topbar-full", group: "shell", name: "Top bar · signed in with a balance",
    note: "Balance, avatar and rank all present; click the avatar for the popover (this cell is clickable)",
    render: () => <Bare><Bar connected loggedIn configured named funds={F.fundsOk()} /></Bare>,
  },
  {
    id: "topbar-unconfigured", group: "shell", name: "Top bar · endpoint unconfigured",
    note: "arenaConfigured=false: the balance cell should not render at all, and no hole may be left on the right",
    render: () => <Bare><Bar connected loggedIn={false} configured={false} named funds={null} /></Bare>,
  },
  {
    id: "topbar-readonly", group: "shell", name: "Top bar · read-only / busy",
    note: "canWrite=false + busy: how the greyed-out buttons look. Under both themes the grey has to read as 'disabled', not as 'never drawn'",
    render: () => <Bare><Bar connected loggedIn configured named funds={F.fundsPending()} busy canWrite={false} /></Bare>,
  },
  {
    id: "banner-demo", group: "shell", name: "Banner · demo data",
    note: "`.demo-banner`. In the light theme it needs a solid ground of its own so the code wall cannot show through the text (§71.103). The copy is a verbatim copy of App.tsx:915 — if the site's wording changes, change it here too",
    render: () => (
      <Bare>
        <div className="demo-banner" role="status">
          <b>Demo mode</b>These numbers are simulated, for a look around only; you cannot enter a match or send a transaction.
        </div>
      </Bare>
    ),
  },
  {
    id: "banner-notice", group: "shell", name: "Banner · notice, info",
    render: () => <Bare><SiteBanner text={F.noticeInfo()[0].text} /></Bare>,
  },
  {
    id: "banner-warn", group: "shell", name: "Banner · notice, warn",
    render: () => <Bare><SiteBanner text={F.noticeWarn()[0].text} warn /></Bare>,
  },
  {
    id: "banner-paused", group: "shell", name: "Banner · entries and withdrawals paused at once",
    note: "The two <b> sit side by side and the gap between them comes from CSS; a notice follows, to see all three segments in a row",
    render: () => <Bare><SiteBanner paused text="Lab: matches you have already entered are unaffected while things are paused." /></Bare>,
  },
  {
    id: "ribbon-ok", group: "shell", name: "Ticker · with prices",
    render: () => <Bare><Ribbon board={F.board()} assets={F.assetsOk()} quotes={F.quotes()} /></Bare>,
  },
  {
    id: "ribbon-empty", group: "shell", name: "Ticker · no prices",
    note: "With no items the whole strip does not render — this cell should be blank, with no empty band left holding height",
    render: () => <Bare><Ribbon board={F.emptyBoard()} assets={F.assetsUnconfigured()} quotes={F.emptyQuotes()} /></Bare>,
  },
  {
    id: "footer", group: "shell", name: "Footer · with the disclaimer",
    note: "Line height and contrast of that long disclaimer paragraph in the light theme (§71.45 / the disclaimer went in on 2026-09-17)",
    render: () => <Bare><Footer /></Bare>,
  },
];
