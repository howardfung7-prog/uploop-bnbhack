/// The case list (§71.109).
///
/// One case = "one section + one set of fake data + one line saying which state it is acting out".
/// Data is built inside `render()`, not when the module loads — times are worked out as an "offset from now" (see the note at the top of fixtures.ts).

import type { ReactNode } from "react";

export type Group = "shell" | "home" | "arena" | "account" | "stake" | "market" | "modal";

export const GROUPS: { key: Group; label: string }[] = [
  { key: "shell", label: "Shell" },
  { key: "home", label: "Home" },
  { key: "arena", label: "Arena" },
  { key: "account", label: "My Account" },
  { key: "stake", label: "Staking" },
  { key: "market", label: "Market / MEME" },
  { key: "modal", label: "Dialogs" },
];

export interface LabCase {
  /// The address fragment in single-case mode: `?lab=1#case/<id>`. Lowercase with hyphens, ASCII only
  id: string;
  group: Group;
  name: string;
  /// What to watch in this cell. Write "what to look at", not "what it is"
  note?: string;
  render: () => ReactNode;
}

export const groupLabel = (g: Group): string => GROUPS.find((x) => x.key === g)?.label ?? g;
