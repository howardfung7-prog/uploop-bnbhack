import { apiGet } from "./api";
import { tr } from "./i18n";

export interface OneClickConfig {
  chain_id: number;
  enabled: boolean;
  swap_address: string;
  slippage_bps: number;
  max_certificates: number;
  deadline_minutes: number;
  disabled_assets: string[];
}
export interface OneClickConfigDoc { config: OneClickConfig; revision: string; chain_id: number }
const CACHE_KEY = "uploop.one-click-stake.config";
const CACHE_TTL_MS = 30_000;
const address = (a: unknown): a is string => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a) && !/^0x0{40}$/i.test(a);
const integer = (n: unknown, lo: number, hi: number): boolean => typeof n === "number" && Number.isInteger(n) && n >= lo && n <= hi;

export function parseOneClickConfig(value: unknown): OneClickConfigDoc {
  const d = value as Partial<OneClickConfigDoc> | null;
  const c = d?.config;
  if (!c || typeof c.enabled !== "boolean" || ![56, 97, 31337].includes(c.chain_id) || d?.chain_id !== c.chain_id
    || typeof d.revision !== "string" || !/^[a-f0-9]{64}$/.test(d.revision)
    || (c.swap_address !== "" && !address(c.swap_address))
    || c.swap_address.toLowerCase() === "0x4c0eb20a540e82c273dba445854a50a707f2bf73"
    || !integer(c.slippage_bps, 0, 100) || !integer(c.max_certificates, 1, 100) || !integer(c.deadline_minutes, 1, 30)
    || !Array.isArray(c.disabled_assets) || c.disabled_assets.length > 1000 || !c.disabled_assets.every(address)) {
    throw new Error(tr("One-click staking configuration is unavailable. Please try again."));
  }
  return d as OneClickConfigDoc;
}
export async function loadOneClickConfig(): Promise<OneClickConfigDoc> {
  const now = Date.now();
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw) as { at?: number; value?: unknown };
      if (typeof cached.at === "number" && now - cached.at < CACHE_TTL_MS) return parseOneClickConfig(cached.value);
    }
  } catch { /* private mode or malformed cache: fetch a fresh copy */ }
  try {
    const value = await apiGet<unknown>("/one-click-stake/config");
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), value })); } catch { /* cache is optional */ }
    return parseOneClickConfig(value);
  } catch {
    // A short-lived cached policy is still useful while the API is restarting. The contract is
    // re-read immediately before signing, so this never replaces on-chain safety checks.
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) return parseOneClickConfig((JSON.parse(raw) as { value?: unknown }).value);
    } catch { /* fall through to the normal translated error */ }
    throw new Error(tr("One-click staking configuration is unavailable. Please try again."));
  }
}
