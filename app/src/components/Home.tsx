import { HomeStrategyShowcase } from "./HomeStrategyShowcase";
import { tr } from "../lib/i18n";
import { fmtWhen } from "../lib/arena";
import type { Notice } from "../lib/notices";
import type { Tab } from "./Topbar";

interface Props {
  /// Whether the arena contract is configured (demo mode counts as configured)
  configured: boolean;
  /// How many certificates the connected wallet has staked; only affects the entry-button wording
  /// (since §71.79 we can read which asset certificates a wallet holds, but still never its USDT
  /// or token balances, §69.16)
  myShares: bigint;
  /// The notice board (§71.41): newest first, home shows 5. null = not loaded yet
  notices: Notice[] | null;
  onGo: (t: Tab) => void;
}

/// Home presents the platform entry points and the latest notices.
export function Home({ configured, myShares, notices, onGo }: Props) {
  return (
    <div className="home">
      {/* ---------- Hero ---------- */}
      {/* The hero's backdrop is down to the grid and two pools of gold light; the code wall moved
          site-wide on 2026-09-15 (`SiteWall`, §71.73), so the background here no longer paints over
          everything — the wallpaper has to show through. */}
      <section className="hero">
        <div className="hero-in">
          <div className="hero-copy">
            <HomeStrategyShowcase />
            <div className="home-slogan">
            <h1>
              <em>{tr("Make strategies the next generation of tradable assets")}</em>
            </h1>
            <p className="lede">
              <b>{tr("UPLOOP is the world's leading aggregated index strategy platform")}</b><br />
              {tr("Built on BNB Chain")}
            </p>
            </div>
            {/* The two doors are the two nav sections (§67). On the left, the people who pay to
                compete on return; on the right, the people who deposit assets and earn bStock. The
                left door's primary button is the Strategy Builder (§67.12): the road to Master
                starts by building one index. */}
            <div className="hero-doors">
              <div className="door">
                <span className="k">{tr("Index Strategy Arena")}</span>
                <b>{tr("Let the market test your index")}</b>
                <span className="d">{tr("Combine assets, pick a direction, enter a match. Performance is calculated from Binance prices, and strategies that finish positive share the prize pool by a published weighting.")}</span>
                <div className="acts">
                  <button className="enter" onClick={() => onGo("build")}>{tr("Create index")}</button>
                  <button className="ghost big" onClick={() => onGo("arena")}>{tr("Join competition")}</button>
                </div>
              </div>
              <div className="door hot">
                <span className="k">{tr("Asset Ecosystem")}</span>
                <b>{tr("Activate assets for strategy use")}</b>
                <span className="d">{tr("Deposit a supported token to receive and stake certificates. Eligible staked certificates receive USDT distributions in proportion to certificate count, with an additional allocation for assets used in positive-return strategies.")}</span>
                <div className="acts">
                  <button className="enter" onClick={() => onGo("mint")}>{myShares > 0n ? tr("Stake tokens") : tr("Explore assets")}</button>
                  <button className="ghost big" onClick={() => onGo("meme")}>{tr("MEME Lab")}</button>
                </div>
              </div>
            </div>
          </div>
        </div>

      </section>

      {/* ---------- Notice board (§71.41) ---------- */}
      <section className="home-sec">
        <div className="board-notice">
          <div className="bn-head">
            <b>{tr("Notices")}</b>
            <a href="#notices">{tr("More")}</a>
          </div>
          {!configured ? (
            <p className="bn-empty">{tr("Notices cannot be loaded right now")}</p>
          ) : notices === null ? (
            <p className="bn-empty">{tr("Loading…")}</p>
          ) : notices.length === 0 ? (
            <p className="bn-empty">{tr("No notices yet")}</p>
          ) : (
            <ul className="bn-list">
              {notices.slice(0, 5).map((n) => (
                <li key={n.id} className={n.level === "warn" ? "warn" : undefined}>
                  <a href="#notices" title={n.text}>
                    <time>{fmtWhen(n.at)}</time>
                    <span>{n.text}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

    </div>
  );
}
