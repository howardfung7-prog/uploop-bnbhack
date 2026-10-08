import { tr } from "../lib/i18n";
import { SubNav, sectionIsHot, sectionLabel, sectionOf } from "./Topbar";
import type { Tab } from "./Topbar";
import { JackpotBadge } from "./Jackpot";
import type { JackpotState } from "../lib/arena";

/// The one-line slogan at the top of every page (DECISIONS.md §29, §66.15, §67).
/// Since the two-level navigation of §67, the small label (.ttl) shows the section name
/// (Index Strategy Arena / Asset Ecosystem) and the right of the page head holds the section's
/// row of large buttons (enlarged in §71.46); `title` is only used as the small label on pages
/// that have no section of their own (My Account).
/// A slogan may have some swagger, but it must never promise a feature that does not exist, and
/// any number in it has to be backed by a contract constant.
///
/// The six lines share a quiet through-line: building is where you start (the road to Master),
/// the Arena is the ring, and the account page tells you how far you have got.
/// "Master" is a real rank in points.ts — the sixth rung of the seven-step ladder (900 RP,
/// 30 paid matches, 5 perfect matches, §71.159), not a figure of speech; the through-line only
/// holds up because there are actual steps to climb.
/// Two of the pages have their own single idea: assets have to be deposited before they can play,
/// and certificates let you take over a position instead of building one. The MEME page uses the
/// blunt line the user asked for, "Burn MEME, get fee-share certificates" (§66.17), and stays out
/// of the through-line.
/// The home page does not use this component (its slogan lives in the hero). The page head carries
/// only the small label and the slogan, never an explanation of how the game works
/// (§71.18 / §71.20: the rules are explained on the home page only).
/// The MEME Lab head adds .hot (magenta gradient title), the same colour as its nav highlight (§59.5).
export const PAGE_COPY: Record<Exclude<Tab, "home">, { title: string; slogan: string }> = {
  arena: {
    title: tr("Arena"),
    slogan: tr("Let the market test your index"),
  },
  build: {
    title: tr("Strategy Builder"),
    slogan: tr("Combine assets, express your view"),
  },
  mint: {
    title: tr("Asset Staking"),
    slogan: tr("Activate assets for strategy use"),
  },
  market: {
    title: tr("Certificate Market"),
    slogan: tr("Discover and trade asset certificates"),
  },
  meme: {
    title: tr("MEME Lab"),
    slogan: tr("Burn MEME, get fee-share certificates"),
  },
  mine: {
    title: tr("My Account"),
    slogan: tr("Strategy performance and asset records"),
  },
};

export function PageHead({ tab, onTab, jackpot, arenaConfigured }: {
  tab: Exclude<Tab, "home">; onTab: (t: Tab) => void;
  /// The perfect-score jackpot (§71.69): the badge only shows in the Index Strategy Arena section's
  /// page head; every other section's head is unchanged.
  jackpot: JackpotState; arenaConfigured: boolean;
}) {
  const c = PAGE_COPY[tab];
  const jp = sectionOf(tab) === "play";
  return (
    <header className={`page-head${jp ? " has-jackpot" : ""}${tab === "meme" ? " hot" : ""}${sectionIsHot(tab) ? " in-hot" : ""}`}>
      <div>
        <div className="crumb">
          <span className="ttl">{sectionLabel(tab) ?? c.title}</span>
        </div>
        <h1>{c.slogan}</h1>
      </div>
      {/* The in-section switch (Arena / Strategy Builder …) sits at the right of the head, baseline-
          aligned with the slogan; on phones it drops to its own full-width row under the slogan
          (§71.46). The Arena section adds a small jackpot badge to the left of the two buttons,
          as wide as both of them together (.ph-aside is a two-column even split, §71.69) */}
      {jp ? (
        <div className="ph-aside">
          <JackpotBadge state={jackpot} configured={arenaConfigured} />
          <SubNav tab={tab} onTab={onTab} />
        </div>
      ) : (
        <SubNav tab={tab} onTab={onTab} />
      )}
    </header>
  );
}
