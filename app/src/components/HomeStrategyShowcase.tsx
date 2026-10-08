import { useEffect, useState } from "react";
import { tr } from "../lib/i18n";
import "./HomeStrategyShowcase.css";

const TAU = Math.PI * 2;
const ASSETS = ["uNVDA", "uBNB", "uTSLA"];

// Integer hundredths keep the visible leg returns and their total exactly equal.
// Every frequency is an integer, so the 30-second loop joins without a jump.
function returnsAt(phase: number) {
  return [
    Math.round(180 * Math.sin(phase) + 65 * Math.sin(phase * 3)),
    Math.round(145 * Math.sin(phase + 1.2) + 90 * Math.cos(phase * 2)),
    Math.round(170 * Math.sin(phase - 0.6) - 55 * Math.cos(phase * 3)),
  ];
}
const formatReturn = (value: number) => `${value > 0 ? "+" : ""}${(value / 100).toFixed(2)}%`;

export function HomeStrategyShowcase() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let start = performance.now();
    let last = 0;
    const tick = (now: number) => {
      if (now - last >= 32) {
        setPhase(((now - start) % 30_000) / 30_000 * TAU);
        last = now;
      }
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      if (motion.matches) setPhase(0);
      else { start = performance.now(); frame = requestAnimationFrame(tick); }
    };
    sync();
    motion.addEventListener("change", sync);
    return () => { cancelAnimationFrame(frame); motion.removeEventListener("change", sync); };
  }, []);

  const legs = returnsAt(phase);
  const total = legs.reduce((sum, value) => sum + value, 0);
  const rank = total >= 300 ? 1 : total >= 100 ? 2 : total >= 0 ? 6 : total >= -200 ? 8 : 9;
  const path = Array.from({ length: 81 }, (_, i) => {
    const value = returnsAt(phase - (80 - i) / 80 * TAU * .45).reduce((sum, leg) => sum + leg, 0);
    return `${i ? "L" : "M"}${i * 4},${65 - value / 12}`;
  }).join(" ");

  return <div className="home-strategy-showcase" aria-label={tr("Strategy performance demo")}>
    <div className="home-demo-heading"><span className="home-demo-dot" />{tr("Three assets. One strategy.")}</div>
    <div className="home-demo-stage">
      <div className="home-demo-combination">
        <div className="home-demo-total" data-negative={total < 0}>
          <div className="home-demo-return-label"><span>{tr("Strategy return")}</span><span key={rank} className="home-demo-inline-rank" aria-label={tr("Demo rank: {0}", rank)}>NO{rank}</span></div>
          <strong>{formatReturn(total)}</strong>
        </div>
        <svg className="home-demo-trace" viewBox="0 0 320 130" aria-hidden="true">
          <path className="home-demo-baseline" d="M0 65H320" />
          <path className="home-demo-trail" d={path} />
          <circle cx="320" cy={65 - total / 12} r="4" />
        </svg>
        <div className="home-demo-basket">
          {ASSETS.map((asset, index) => <div className="home-demo-leg" key={asset}>
            <div><b>{asset}</b><span className={index === 0 ? "short" : "long"}>{tr(index === 0 ? " Short " : " Long ").trim()}</span></div>
            <strong data-negative={legs[index] < 0}>{formatReturn(legs[index])}</strong>
          </div>)}
        </div>
      </div>

    </div>
  </div>;
}
