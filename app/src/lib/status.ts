/// Site status (DECISIONS §71.40, `GET /status`, public): the ops console's emergency switches and
/// its banner notice.
///
/// `paused[key] === true` = that feature is paused (keys: withdrawals / entries / schedule / settle
/// / jackpot / sponsorship / listing).
/// The frontend only watches two of them: `entries` (entry button greys out, reads "Entry paused")
/// and `withdrawals` (withdraw button greys out, reads "Withdrawals paused"). The rest are between
/// the ops console and the runner — users do not see them and should not. The reason is not made
/// public and the endpoint does not carry one.
/// The `notice` hangs at the top of the page; once `until` passes the server stops returning it.
/// Unreadable (API not running / not configured) = everything open, no notice: as in §29, a failed
/// read never invents a state.
import { apiGet } from "./api";

export interface SiteNotice {
  text: string;
  level: "info" | "warn";
  until: number | null;
}

export interface SiteStatus {
  paused: Record<string, boolean>;
  notice: SiteNotice | null;
  serverTime: number | null;
}

export const EMPTY_STATUS: SiteStatus = { paused: {}, notice: null, serverTime: null };

interface StatusJson {
  paused?: Record<string, boolean>;
  notice?: { text?: unknown; level?: unknown; until?: unknown } | null;
  server_time?: number;
}

export async function loadStatus(): Promise<SiteStatus> {
  const r = await apiGet<StatusJson>("/status");
  const paused: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(r.paused ?? {})) paused[k] = v === true;
  let notice: SiteNotice | null = null;
  const n = r.notice;
  if (n && typeof n.text === "string" && n.text.trim()) {
    notice = {
      text: n.text,
      level: n.level === "warn" ? "warn" : "info",
      until: typeof n.until === "number" ? n.until : null,
    };
  }
  return { paused, notice, serverTime: typeof r.server_time === "number" ? r.server_time : null };
}

export function isPaused(s: SiteStatus, key: string): boolean {
  return s.paused[key] === true;
}
