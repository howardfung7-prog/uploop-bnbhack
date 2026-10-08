import { tr } from "../lib/i18n";
import { useEffect, useRef, useState } from "react";
import { serverNow } from "../lib/api";
import { countdown, fmtUsdt0, urgent } from "../lib/arena";
import type { JackpotState } from "../lib/arena";

/// The perfect-score jackpot badge (§71.69, the user on 2026-09-15).
///
/// It used to be a full-width panel at the top of the arena page (§71.46); it is now shrunk into
/// the top right of the page head, to the left of "Arena / Strategy Builder", and is exactly as
/// wide as those two buttons together (the grid is `.ph-aside` in `styles.css`, two equal columns).
/// The badge has two cells (§71.70, the user on 2026-09-15): on the left the "JACKPOT" mark, a
/// metal plate bright enough to read as white, with black lettering and a highlight sweeping back
/// and forth (the site is gold on black and the "Arena" button is solid primary gold, so ordinary
/// gold here would smear into it — hence pushing all the way to the bright end); on the right, the
/// big amount above and a line of small text below (time to the payout · how many hold a perfect
/// score right now); and a "›" at the far right to say the whole thing is clickable.
/// The badge is exactly as tall as the "Arena / Strategy Builder" buttons (46px on desktop, 42px on
/// a phone), so the two lines on the right need their type sizes kept down or they will push it
/// taller.
/// On a phone the "JACKPOT" cell stretches to half width, sitting directly over the "Arena" button
/// below it (§71.71), which leaves the right half with half the room — so the words "until payout"
/// (`.jb-w`) and the trailing "›" are hidden by CSS on a narrow screen, leaving just
/// "«countdown» · «N» perfect".
/// 🔴 Do not add a fourth thing to this badge: how it works is explained in full in the Help
/// Center's "Perfect-score jackpot" section (§71.20 / §71.44), and the badge is the way in
/// (`#help/jackpot`).
///
/// Every number comes from `GET /jackpot` (the ledger); if it cannot be read it writes "—" (§25),
/// and the countdown uses serverNow (🔴 not Date.now).
/// The amount is written as in §71.66: no decimals, no "USDT", just "$1,888".
export function JackpotBadge({ state, configured }: { state: JackpotState; configured: boolean }) {
  // The countdown repaints every second. The time comes from serverNow() (the endpoint's
  // X-Server-Time, falling back to chain time), not Date.now().
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const now = serverNow();

  const j = state.kind === "ok" ? state.jackpot : null;
  const rolling = useRollUp(j ? j.accumulated : null);
  const amount = j && rolling !== null ? fmtUsdt0(rolling) : null;
  // When it cannot be read, the reason goes on the small line — it must not look like "the jackpot
  // is empty"
  const why = !configured ? tr("Jackpot data unavailable")
    : state.kind === "error" ? tr("Could not load: {0}", state.message)
    : state.kind === "none" ? tr("Loading…")
    : null;

  return (
    <a className="jp-badge" href="#help/jackpot" aria-label={tr("Perfect Score Jackpot · see the running total and how it is shared out")}>
      <span className="jb-k">JACKPOT</span>
      <span className="jb-r">
        {/* The rolling number is for the eyes only (aria-hidden); a screen reader reads the static
            final value after it, rather than being read sixty times a second */}
        <span className="jb-amt">
          {j && amount !== null ? (
            <>
              <b aria-hidden="true"><i>$</i>{amount}</b>
              <span className="sr-only">{tr("Perfect Score Jackpot, {0} USDT so far this round", fmtUsdt0(j.accumulated))}</span>
            </>
          ) : (
            <b className="mute">—</b>
          )}
        </span>
        {j ? (
          <span className="jb-sub">
            <b className={urgent(j.nextPayoutAt - now).trim() || undefined}>{countdown(j.nextPayoutAt - now)}</b>
            <span className="jb-w"> {tr("until payout")}</span> · <b>{j.players}</b> {tr("perfect")}
          </span>
        ) : (
          <span className="jb-sub">{why ?? "—"}</span>
        )}
      </span>
      <span className="jb-go" aria-hidden="true">›</span>
    </a>
  );
}

/// Rolls the amount up from 0 to the latest value (once when the page opens, and again whenever the
/// amount changes).
/// This is animation, not timekeeping: progress is measured from requestAnimationFrame's timestamp
/// (a duration, not a wall clock) and has nothing to do with serverNow or Date.now.
/// With "reduce motion" set at the system level it jumps straight to the final value.
function useRollUp(target: bigint | null, ms = 1800): bigint | null {
  const [shown, setShown] = useState<bigint | null>(null);
  const at = useRef<bigint>(0n); // the value on screen right now; starts from 0
  useEffect(() => {
    if (target === null) return;
    const start = at.current;
    const delta = target - start;
    if (delta === 0n || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      at.current = target;
      setShown(target);
      return;
    }
    let raf = 0;
    let t0 = -1;
    const step = (t: number) => {
      if (t0 < 0) t0 = t;
      const p = Math.min(1, (t - t0) / ms);
      const e = 1 - (1 - p) ** 3; // ease-out: fast then slow, like a slot machine settling
      const cur = p >= 1 ? target : start + (delta * BigInt(Math.round(e * 1_000_000))) / 1_000_000n;
      at.current = cur;
      setShown(cur);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return shown;
}
