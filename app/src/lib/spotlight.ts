/// Pointer spotlight (§71.181): a card under the mouse gets a soft gold light that follows the
/// pointer. One delegated listener writes the pointer position into `--mx` / `--my` on the card;
/// the light itself is a `::before` in `polish.css`. Touch screens and "reduce motion" skip it, and
/// so does any card not matched by `SPOT`, so the cost is one rAF-throttled handler per page.
const SPOT = ".door, .home-strategy-showcase, .daily-card, .pool-grid:not(.rows) .pool, .up-points";

export function installSpotlight() {
  if (typeof window === "undefined" || !window.matchMedia) return;
  if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let frame = 0;
  let last: PointerEvent | null = null;
  addEventListener("pointermove", (event) => {
    last = event;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const target = last?.target;
      if (!(target instanceof Element)) return;
      const card = target.closest<HTMLElement>(SPOT);
      if (!card) return;
      const box = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${last!.clientX - box.left}px`);
      card.style.setProperty("--my", `${last!.clientY - box.top}px`);
    });
  }, { passive: true });
}
