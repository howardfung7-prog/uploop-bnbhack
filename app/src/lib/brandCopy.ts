import { tr } from "./i18n";
/**
 * The public "platform introduction" copy (final wording approved by the user 2026-09-18, DECISIONS §71.125).
 *
 * Read the three sentences in order and you have the whole introduction:
 * what it is (INTRO) → what you can do (OFFER) → where it is going (VISION).
 * The Help Center's "What is UPLOOP" and other long-form platform introductions read from here,
 * so changing this one file changes the whole site — never hand-write a variant somewhere else,
 * the two copies will drift apart sooner or later. The static search summary in index.html is shorter.
 *
 * 🔴 Before changing it, make sure every feature named in the sentence actually shipped
 * (§29: never promise a feature that does not exist).
 * The three section names in OFFER — Asset Staking / Certificate Market / MEME Lab — are the exact
 * words used in the top navigation (`components/Topbar.tsx`, the `assets` section), so someone
 * reading the introduction can actually find them.
 *
 * 🔴 A vision is a vision: it does not mean an ETF has been issued, and it does not mean a
 * user-built index is a tradable asset. That qualifier lives in the sentence right after the
 * vision paragraph in the Help Center and on the home page (`lib/faq.ts` / `components/Home.tsx`).
 * Do not delete it.
 */
export const PLATFORM_INTRO = tr("UPLOOP is an open platform for creating index strategies across stock and crypto assets.");
export const PLATFORM_OFFER = tr("You can combine underlying assets from different markets into multi-asset index strategies, choose long or short on each, test your market judgement in strategy competitions with public rules, and take part in the asset ecosystem through Asset Staking, the Certificate Market and the MEME Lab.");
export const PLATFORM_VISION = tr("Our vision is to open the portfolio logic of traditional ETFs to everyone, so that index assets are something anyone can take part in and anyone can create.");
