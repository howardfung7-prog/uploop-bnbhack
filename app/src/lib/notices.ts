/// The notice board (DECISIONS §71.41, `GET /notices`, public): notices published from the ops
/// console, newest first.
///
/// Not the same thing as the top banner (the `notice` inside `/status`): the banner carries only
/// the current one and drops off when it expires. This is the history — the home page takes 5, the
/// site's "All notices" page takes 50. Who published a notice is not made public.
///
/// 🔴 The text itself is typed by the operator in the ops console, which stays in Chinese
/// (§71.163). The frontend renders whatever the operator wrote, so a notice is in English only
/// once the operator writes it in English. No code change can fix that.
/// Unreadable (API not running / not configured / ops console disabled) = empty list, the UI says
/// "No notices yet" and invents nothing (§29).
import { apiGet } from "./api";

export interface Notice {
  id: number;
  text: string;
  level: "info" | "warn";
  /// When it was published (Unix seconds, server time)
  at: number;
}

interface NoticesJson {
  notices?: { id?: unknown; text?: unknown; level?: unknown; at?: unknown }[];
}

export async function loadNotices(limit = 5): Promise<Notice[]> {
  const r = await apiGet<NoticesJson>(`/notices?limit=${limit}`);
  const out: Notice[] = [];
  for (const n of r.notices ?? []) {
    if (typeof n.id !== "number" || typeof n.text !== "string" || !n.text.trim()) continue;
    out.push({ id: n.id, text: n.text, level: n.level === "warn" ? "warn" : "info", at: typeof n.at === "number" ? n.at : 0 });
  }
  return out;
}
