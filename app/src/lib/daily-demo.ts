import type { DailyDetail, DailyEntry, DailyLeg, DailyList, DailyRoom, DailyScore } from "./daily-arena";
import { DEMO_ACCOUNT } from "./demo";

const UNIT = 10n ** 18n;
const wallet = (index: number) => `0x${index.toString(16).padStart(40, "0")}`;
const names = ["Howard", "Mira", "Atlas", "Nova", "Kite", "Orion", "Lumen", "Sora", "Rex", "Ivy", "Nox", "Aster", "Echo", "Vega", "Flux", "Ari", "Rune", "Sol", "Mako", "Juno", "Pico", "Cyan", "Owen", "Zed", "Uma"];
const strategies = [
  ["BNB", "long"], ["BTC", "short"], ["ETH", "long"], ["SOL", "short"], ["XRP", "long"],
] as const;

const legsFor = (entry: number, sample: number): DailyLeg[] => strategies.map(([ticker, side], index) => ({
  ticker,
  symbol: ticker,
  side: entry % 2 === 0 ? side : side === "long" ? "short" : "long",
  return_points: (Math.sin(entry * 1.7 + sample * .8 + index) * .28 + (entry === 0 ? sample * .035 : 0)).toFixed(6),
}));

const scoreFor = (entry: number, sample: number): DailyScore => {
  const legs = legsFor(entry, sample);
  const total = legs.reduce((sum, leg) => sum + Number(leg.return_points ?? 0), 0);
  return { entry_id: entry + 1, player: wallet(entry + 1), rank: 1, return_points: total.toFixed(6), estimated_prize: "0", legs };
};

export function dailyDemo(now = Math.floor(Date.now() / 900) * 900, step = 8): { list: DailyList; detail: DailyDetail; now: number } {
  const sampleCount = Math.max(1, Math.min(49, step + 1));
  const starts = now - (sampleCount - 1) * 900;
  const ends = starts + 86400;
  const cutoff = starts - 900;
  const entries: DailyEntry[] = names.map((name, index) => ({
    id: index + 1,
    player: index === 0 ? DEMO_ACCOUNT : wallet(index + 1),
    name,
    changes: index === 0 ? 1 : 0,
    strategy: { name: `${name} five-asset mix`, legs: legsFor(index, 16) },
    prize: "0",
    creator_reward: index === 0 ? (250n * UNIT * 6n / 100n).toString() : "0",
    performance: null,
  }));
  const samples = Array.from({ length: sampleCount }, (_, sample) => {
    const at = starts + sample * 900;
    const scores = entries.map((_, index) => scoreFor(index, sample));
    const ranked = [...scores].sort((a, b) => Number(b.return_points) - Number(a.return_points));
    scores.forEach(score => {
      score.rank = ranked.findIndex(item => item.entry_id === score.entry_id) + 1;
      // Mirror the server's paid-slot signal so the local arena preview also
      // shows the current money-circle members in yellow.
      score.estimated_prize = score.rank <= 8 ? UNIT.toString() : "0";
    });
    return { at, scores };
  });
  const latest = samples.at(-1)!;
  entries.forEach(entry => { entry.performance = latest.scores.find(score => score.entry_id === entry.id) ?? null; });
  const room: DailyRoom = {
    id: 701,
    name: "Demo · 25-player daily arena",
    creator: DEMO_ACCOUNT,
    creator_name: "Howard",
    starts_at: starts,
    ends_at: ends,
    cutoff_at: cutoff,
    amount: (10n * UNIT).toString(),
    status: "active",
    count: entries.length,
    locked: 1,
    total_prize: (250n * UNIT).toString(),
    prize_slots: 8,
    reason: null,
    pause_reason: null,
    enabled: true,
  };
  const openRoom: DailyRoom = { ...room, id: 702, name: "Demo · registration open", starts_at: now + 3 * 3600, ends_at: now + 27 * 3600, cutoff_at: now + 3 * 3600 - 900, status: "open", count: 3, total_prize: (30n * UNIT).toString() };
  const finishedRoom: DailyRoom = { ...room, id: 700, name: "Demo · settled yesterday", starts_at: now - 30 * 3600, ends_at: now - 6 * 3600, cutoff_at: now - 30 * 3600 - 900, status: "finished" };
  const refundedRoom: DailyRoom = { ...room, id: 699, name: "Demo · equal returns refund", starts_at: now - 54 * 3600, ends_at: now - 30 * 3600, cutoff_at: now - 54 * 3600 - 900, status: "refunded", reason: "all_equal", total_prize: (30n * UNIT).toString(), count: 3 };
  const list: DailyList = { rooms: [room, openRoom, finishedRoom, refundedRoom], next_before: null, enabled: true };
  const detail: DailyDetail = {
    room,
    entries,
    samples,
    me: entries[0],
    balance: (100n * UNIT).toString(),
    operations_paused: false,
    result: null,
  };
  return { list, detail, now };
}
