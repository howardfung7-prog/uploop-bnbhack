import type { Ticker } from "../lib/board";
import { stakeQa } from "../lib/faq";
import { Faq } from "./Faq";

/// The questions at the foot of the "Asset Staking" page (§53): rules, how it works and the risks
/// all live here, so the body of the page is nothing but pool cards.
/// The copy is `stakeQa` in lib/faq.ts (§71.41: the Help Center and this share one copy), and the
/// only numbers in it are read from the chain (the threshold for being pickable in a strategy).
/// Not one sentence may promise a feature that does not exist.
export function StakeFaq({ board }: { board: Ticker[] }) {
  return <Faq qa={stakeQa(board)} />;
}
