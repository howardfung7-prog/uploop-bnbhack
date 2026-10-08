import { tr } from "../lib/i18n";
import type { ReactNode } from "react";
import type { View } from "../lib/view";

/// The "Cards / Rows" switch at the top right of the toolbar (§60). Both options are labelled in
/// words, so nobody has to guess an icon.
export function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const btn = (v: View, label: string, icon: ReactNode) => (
    <button type="button" className={view === v ? "on" : ""} aria-pressed={view === v} title={label} onClick={() => onChange(v)}>
      {icon}{label}
    </button>
  );
  return (
    <div className="view-tg" role="group" aria-label={tr("Display style")}>
      {btn("cards", tr("Cards"), (
        <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="1" width="6" height="6"/><rect x="9" y="1" width="6" height="6"/><rect x="1" y="9" width="6" height="6"/><rect x="9" y="9" width="6" height="6"/></svg>
      ))}
      {btn("rows", tr("Rows"), (
        <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="1.5" width="14" height="3"/><rect x="1" y="6.5" width="14" height="3"/><rect x="1" y="11.5" width="14" height="3"/></svg>
      ))}
    </div>
  );
}
