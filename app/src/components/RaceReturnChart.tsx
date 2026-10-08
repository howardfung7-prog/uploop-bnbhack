import { Fragment, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { tr } from "../lib/i18n";
import { uSym } from "../lib/ticker";
import { performancePercent, traceSegments, boundedReturnY, priceMovement, formatRacePrice } from "../lib/race-performance";
import type { PerformanceSample } from "../lib/race-performance";

type Leg = { ticker: string; side: string };
type Quote = { open?: string; close?: string };
// The arrow compares the latest price with this cycle's opening price, and the colour
// follows the leg's side: a short leg is winning while the price sits below the open.
function AssetPrice({ quote, side, openLabel }: { quote?: Quote; side: string; openLabel: string }) {
  const { open, close } = quote ?? {};
  const direction = open && close ? priceMovement(open, close) : "flat";
  const tone = direction === "flat" ? undefined : (direction === "down") === (side === "short") ? "gain" : "loss";
  return <span className="race-return-price" data-tone={tone}>
    <span className="race-price-direction" aria-hidden="true">{direction === "up" ? "↑" : direction === "down" ? "↓" : ""}</span>
    {close ? `$${formatRacePrice(close)}` : "—"}
    {open && close && <small className="race-return-open">{openLabel} ${formatRacePrice(open)}</small>}
  </span>;
}
type Tick = { at: number; label: string };
/// The race chart. The optional props let a longer window (activity matches, §71.179) reuse the exact
/// same drawing; left out, every one of them keeps the 15-minute race defaults.
export function RaceReturnChart({ legs, start, end, samples, values, pending, quotes, interrupted,
  scale = 1, gap, ticks, finishLabel, ariaLabel, caption, pendingCaption, openLabel }: {
  legs: Leg[]; start: number; end: number; samples: PerformanceSample[];
  values: (number | null)[]; pending: boolean; quotes: (Quote | undefined)[]; interrupted?: boolean;
  scale?: number; gap?: number; ticks?: Tick[]; finishLabel?: string; ariaLabel?: string;
  caption?: string; pendingCaption?: string; openLabel?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const samplesRef = useRef(samples);
  const [drawSamples, setDrawSamples] = useState(samples);
  const [width, setWidth] = useState(760);
  samplesRef.current = samples;
  useEffect(() => {
    setDrawSamples(samples);
    const timer = setInterval(() => setDrawSamples(samplesRef.current), 5_000);
    return () => clearInterval(timer);
  }, [start, end]);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(240, entries[0].contentRect.width)));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const left = 38, right = width - 12, mid = 116;
  const x = (at: number) => left + (at - start) / (end - start) * (right - left);
  const y = (value: number) => boundedReturnY(value, scale);
  const axis = ticks ?? [0, 5, 10, 15].map(minute => ({ at: start + minute * 60, label: tr("{0} min", minute) }));
  const axisLabel = (ratio: number) => ratio === 0 ? "0"
    : `${ratio > 0 ? "+" : "−"}${Math.abs(ratio * scale).toFixed(scale >= 5 ? 0 : 1)}`;
  const lastAt = drawSamples.length ? Math.max(...drawSamples.map(sample => sample.at)) : start;
  const series = legs.map(leg => traceSegments(drawSamples, leg, start, end, gap));
  const hasGap = series.some(segments => segments.length > 1);
  const showInterruption = !pending && (interrupted || hasGap);
  return <div className="race-return-chart" ref={container}>
    <div className="race-return-legend">{legs.map((leg, index) => <div key={`${leg.ticker}:${leg.side}`} style={{ "--trace": `var(--trace-${index})` } as CSSProperties}>
      <div className="race-return-asset-head"><span className="race-return-swatch" /><div><b>{uSym(leg.ticker)}</b><small>{leg.side === "long" ? tr("Long") : tr("Short")} {leg.side === "long" ? "↑" : "↓"}</small></div>
      <strong>{values[index] == null ? "—" : performancePercent(String(values[index]))}</strong></div>
      <AssetPrice quote={quotes[index]} side={leg.side} openLabel={openLabel ?? tr("Cycle open")} />
    </div>)}</div>
    <svg viewBox={`0 0 ${width} 266`} role="img" aria-label={ariaLabel ?? tr("Three-asset returns over 15 minutes; the center line is zero return.")}>
      <rect className="race-return-positive" x={left} y={20} width={right - left} height={mid - 20} />
      <rect className="race-return-negative" x={left} y={mid} width={right - left} height={mid - 20} />
      {[-1, -.8, -.6, -.4, -.2, 0, .2, .4, .6, .8, 1].map(ratio => <g key={ratio}>
        <line className={ratio === 0 ? "race-return-zero" : "race-return-grid"} x1={left} x2={right} y1={y(ratio * scale)} y2={y(ratio * scale)} />
        <text className="race-return-axis" x={left - 6} y={y(ratio * scale) + 3} textAnchor="end">{axisLabel(ratio)}</text>
      </g>)}
      {axis.map((tick, i) => <g key={tick.at}>
        <line className="race-return-grid" x1={x(tick.at)} x2={x(tick.at)} y1={20} y2={212} />
        <text className="race-return-axis" x={x(tick.at)} y={238} textAnchor={i === 0 ? "start" : i === axis.length - 1 ? "end" : "middle"}>{tick.label}</text>
      </g>)}
      <text className="race-return-axis" x={right} y={12} textAnchor="end">{finishLabel ?? tr("15 min · finish")}</text>
      {!pending && lastAt > start && <line className="race-return-cursor" x1={x(lastAt)} x2={x(lastAt)} y1={20} y2={212} />}
      {legs.map((leg, index) => {
        const segments = series[index];
        const last = segments.at(-1)?.at(-1);
        return <g className="race-return-series" key={`${leg.ticker}:${leg.side}`} style={{ "--trace": `var(--trace-${index})` } as CSSProperties}>
          <circle cx={left} cy={mid} r={3} />
          {segments.map((segment, i) => {
            const coordinates = (points: typeof segment) => points.map((point, j) => `${j ? "L" : "M"}${x(point.at).toFixed(2)},${y(point.value).toFixed(2)}`).join(" ");
            const newest = i === segments.length - 1 && segment.length > 1;
            const previous = segments[i - 1]?.at(-1);
            return <Fragment key={i}>
              {previous && segment[0] && <path className="race-return-gap" d={`M${x(previous.at).toFixed(2)},${y(previous.value).toFixed(2)} L${x(segment[0].at).toFixed(2)},${y(segment[0].value).toFixed(2)}`} />}
              <path d={coordinates(newest ? segment.slice(0, -1) : segment)} />
              {newest && <path className="race-return-growing" key={segment[segment.length - 1].at} pathLength={1} d={coordinates(segment.slice(-2))} />}
            </Fragment>;
          })}
          {last && <circle className="race-return-tip" cx={x(last.at)} cy={y(last.value)} r={4}><title>{uSym(leg.ticker)} {performancePercent(String(last.value))}</title></circle>}
        </g>;
      })}
    </svg>
    <div className="race-return-interruption-slot"><p className="race-return-interruption" style={{ visibility: showInterruption ? "visible" : "hidden" }} role="status" aria-live="polite">{tr("Market data interrupted. Waiting for recovery. This will not affect the result.")}</p></div>
    <p className="race-return-caption">{pending ? pendingCaption ?? tr("Your three assets start tracking when entry takes effect.") : caption ?? tr("Lines flatten beyond ±1%; cards show actual returns. Dashed sections indicate missing data.")}</p>
  </div>;
}
