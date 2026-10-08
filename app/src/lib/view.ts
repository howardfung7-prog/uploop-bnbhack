import { useState } from "react";

/// How pool lists are displayed (DECISIONS.md §60): card grid or rows.
/// Asset Staking, the Certificate Market and the MEME Lab share one switch, stored in local
/// storage, so it survives page changes and reloads.
/// Rows by default (§71.11, user 2026-09-12); §60 defaulted to cards. A browser that has switched
/// manually keeps its own choice.
export type View = "cards" | "rows";

const KEY = "uploop.view";

function read(): View {
  try {
    return localStorage.getItem(KEY) === "cards" ? "cards" : "rows";
  } catch {
    return "rows";
  }
}

export function useView(): [View, (v: View) => void] {
  const [view, set] = useState<View>(read);
  const change = (v: View) => {
    set(v);
    try { localStorage.setItem(KEY, v); } catch { /* private mode: cannot persist, so it lasts this session only */ }
  };
  return [view, change];
}
