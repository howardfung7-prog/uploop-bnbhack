import { tr } from "./i18n";
import { apiPost } from "./api";

export type FactionId = "hannibal" | "sun_tzu" | "elizabeth_i";
export const FACTIONS: { id: FactionId; name: string; title: string; personality: string; motto: string }[] = [
  { id: "hannibal", name: tr("Hannibal"), title: tr("The Breaker"),
    personality: tr("Find unconventional openings. Think independently and turn difficult positions into opportunities."),
    motto: tr("Find a new way forward.") },
  { id: "sun_tzu", name: tr("Sun Tzu"), title: tr("The Strategist"),
    personality: tr("Value information, patience and risk control. Read the situation and choose your moment."),
    motto: tr("Read the field before you move.") },
  { id: "elizabeth_i", name: tr("Elizabeth I"), title: tr("The Diplomat"),
    personality: tr("Bring resources and relationships together. Build alliances and think for the long term."),
    motto: tr("Build strength through alliances.") },
];

export function parseFaction(value: unknown): FactionId | null | undefined {
  if (value === null) return null;
  return FACTIONS.some(f => f.id === value) ? value as FactionId : undefined;
}

export async function chooseFaction(address: string, faction: FactionId): Promise<FactionId> {
  const result = await apiPost<{ address: string; faction: unknown }>("/faction", { address: address.toLowerCase(), faction });
  const saved = parseFaction(result.faction);
  if (result.address?.toLowerCase() !== address.toLowerCase() || saved !== faction) {
    throw new Error(tr("Your faction could not be verified. Please refresh and try again."));
  }
  return saved;
}
