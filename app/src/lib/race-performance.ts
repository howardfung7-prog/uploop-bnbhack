import type { RaceCycle } from "./race";

export function performancePercent(value: string): string {
  const number = Number(value);
  return `${number > 0 ? "+" : ""}${number.toFixed(3)}%`;
}

// Independently rounded legs can differ from the rounded full-precision total.
export function displayedSumMatches(cycle: RaceCycle): boolean {
  const thousandths = (value: string) => Math.round(Number(Number(value).toFixed(3)) * 1000);
  return cycle.legs.reduce((sum, leg) => sum + thousandths(leg.return_points), 0) === thousandths(cycle.return_points);
}

export function samePerformanceStrategy(
  left: { ticker: string; side: string }[], right: { ticker: string; side: string }[],
): boolean {
  const key = (legs: typeof left) => legs.map(leg => `${leg.ticker}:${leg.side}`).sort().join('|');
  return left.length === 3 && right.length === 3 && key(left) === key(right);
}

export interface PerformanceSample {
  cycle_start?: number;
  at: number;
  legs: { ticker: string; side: string; return_points: string }[];
}

export const PERFORMANCE_SAMPLE_GAP_SECONDS = 15;

export function traceSegments(samples: PerformanceSample[], leg: { ticker: string; side: string }, start: number, end: number,
  gap = PERFORMANCE_SAMPLE_GAP_SECONDS) {
  const readings = new Map<number, number>([[start, 0]]);
  for (const sample of samples) {
    const item = sample.legs.find(item => item.ticker === leg.ticker && item.side === leg.side);
    const value = item ? Number(item.return_points) : NaN;
    if (sample.at >= start && sample.at <= end && Number.isFinite(value)) readings.set(sample.at, value);
  }
  const segments: { at: number; value: number }[][] = [];
  for (const [at, value] of [...readings].sort(([a], [b]) => a - b)) {
    const segment = segments.at(-1);
    if (!segment || at - segment[segment.length - 1].at > gap) segments.push([{ at, value }]);
    else segment.push({ at, value });
  }
  return segments;
}


// Only the drawing is capped. Scores, labels and payouts keep their actual values.
export function boundedReturnY(value: number, scale = 1): number {
  return 116 - Math.max(-1, Math.min(1, value / scale)) * 96;
}

// Longer windows move further than ±1%: the axis grows to the next 1/2/5 step that fits every leg.
export function returnScale(values: number[]): number {
  const peak = Math.max(0, ...values.map(value => Math.abs(value)).filter(Number.isFinite));
  for (let step = 1; ; step *= 10) for (const scale of [step, 2 * step, 5 * step]) if (peak <= scale || scale >= 1000) return scale;
}

export function priceMovement(previous: string, current: string): "up" | "down" | "flat" {
  const before = BigInt(previous), after = BigInt(current);
  return after > before ? "up" : after < before ? "down" : "flat";
}

export function formatRacePrice(raw: string): string {
  const price = Number(raw) / 1e8;
  // Low-priced assets need more decimals, or a 15-minute move is invisible ($0.09 → $0.09).
  const digits = price >= 100 ? 2 : price >= 1 ? 4 : 5;
  return price.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
