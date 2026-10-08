import { tr } from "../lib/i18n";
import { useMemo } from "react";
import { qrMatrix } from "../lib/qr";

/// A QR code (§71.157). Drawn as SVG: hard edges at any size, no blur, and no canvas or ref needed.
///
/// 🔴 The colours are hard-coded black on white and **do not follow the theme**. Inverting it in
/// dark mode (light code on a dark ground) makes a good half of all scanners fail to see it at all —
/// a QR code's finder patterns are defined as dark modules on a light ground. This code sits on the
/// deposit page: failing to scan would be bad, scanning as some other string would be far worse, so
/// here it is better to clash with the page than to follow it.
///
/// If encoding fails (the text is too long) it returns null rather than throwing: this is a funds
/// page, one missing image is survivable, a blank screen is not.
export function QrCode({ text, size = 148, label }: { text: string; size?: number; label?: string }) {
  const m = useMemo(() => {
    try { return qrMatrix(text); } catch { return null; }
  }, [text]);
  if (!m) return null;

  const n = m.length;
  const quiet = 4;                    // The quiet zone: the spec wants at least 4 blank cells all round, and with less than that many scanners cannot find the edge
  const side = n + quiet * 2;
  // Every dark module goes into **one** path rather than n² <rect>s: on a 29×29 code that saves several hundred DOM nodes
  let d = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) if (m[y][x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
  }
  return (
    <svg className="qr" width={size} height={size} viewBox={`0 0 ${side} ${side}`}
         role="img" aria-label={label ?? tr("QR code")} shapeRendering="crispEdges">
      <rect width={side} height={side} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
