import { useEffect, useRef } from "react";

// Scroll once when an entry form opens, never on market or countdown updates.
export function useMobileEntryScroll<T extends HTMLElement>(entry: string | number | null) {
  const target = useRef<T>(null);
  useEffect(() => {
    if (entry === null || !window.matchMedia("(max-width: 760px)").matches) return;
    const frame = requestAnimationFrame(() => {
      const element = target.current;
      if (!element) return;
      element.focus({ preventScroll: true });
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
      const dialog = element.closest<HTMLElement>('[role="dialog"]');
      if (dialog) {
        // Keep modal scrolling inside the dialog, without moving the page behind it.
        dialog.scrollTo({ top: dialog.scrollTop + element.getBoundingClientRect().top - dialog.getBoundingClientRect().top - 16, behavior });
      } else {
        element.scrollIntoView({ block: "start", behavior });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [entry]);
  return target;
}
