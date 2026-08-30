import { useEffect, useMemo, useRef, useState } from "react";
import { LOCALE, formatAmount } from "../lib/format";
import type { Unit } from "../lib/format";
import type { BalancePoint } from "../lib/series";

const PAD_TOP = 6;
const PAD_BOTTOM = 20;
const GUTTER = 56;

/** Compact axis figure in the display unit: "2 851 BTC", "1.2M sats". */
function formatCompact(sats: number, unit: Unit): string {
  if (unit === "sats") {
    return `${new Intl.NumberFormat(LOCALE, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(sats)}`;
  }
  const btc = sats / 100_000_000;
  return new Intl.NumberFormat(LOCALE, {
    maximumSignificantDigits: 3,
  }).format(btc);
}

function formatDate(t: number): string {
  return new Date(t * 1000).toLocaleDateString(LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Balance of the wallet over its loaded life, in the display unit:
    a step line — balances change in jumps, not slopes — over a zero
    floor, in the same visual language as the rest of the instrument.
    The parent hides this entirely while amounts are masked. */
export function BalanceChart({ points, unit }: { points: BalancePoint[]; unit: Unit }) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [cursor, setCursor] = useState<number | null>(null);

  useEffect(() => {
    const node = plotRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const geometry = useMemo(() => {
    const { width, height } = size;
    if (points.length < 2 || width <= GUTTER || height < 80) return null;
    const plotWidth = width - GUTTER;
    const plotHeight = height - PAD_TOP - PAD_BOTTOM;
    const max = Math.max(...points.map((p) => p.sats), 1);
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;
    const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * plotWidth;
    // Zero-based: money reads in proportion, not in drama.
    const y = (sats: number) => PAD_TOP + (1 - sats / (max * 1.04)) * plotHeight;
    let line = `M0,${y(points[0].sats).toFixed(1)}`;
    for (let i = 1; i < points.length; i += 1) {
      const px = x(points[i].t).toFixed(1);
      line += `L${px},${y(points[i - 1].sats).toFixed(1)}L${px},${y(points[i].sats).toFixed(1)}`;
    }
    line += `L${plotWidth},${y(points[points.length - 1].sats).toFixed(1)}`;
    const floor = PAD_TOP + plotHeight;
    const area = `${line}L${plotWidth},${floor}L0,${floor}Z`;
    return { plotWidth, plotHeight, max, x, y, line, area, floor, height, width };
  }, [points, size]);

  const hovered = cursor !== null ? points[cursor] : null;

  const locate = (clientX: number) => {
    if (!geometry || !plotRef.current) return;
    const rect = plotRef.current.getBoundingClientRect();
    const px = clientX - rect.left;
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;
    const t = t0 + (px / Math.max(1, geometry.plotWidth)) * (t1 - t0);
    // Step semantics: the balance at t is the last point at or before it.
    let best = 0;
    for (let i = 0; i < points.length; i += 1) {
      if (points[i].t <= t) best = i;
    }
    setCursor(best);
  };

  return (
    <div
      ref={plotRef}
      className="relative h-full min-h-[140px] select-none"
      onPointerMove={(event) => locate(event.clientX)}
      onPointerLeave={() => setCursor(null)}
    >
      {geometry && (
        <svg
          width={geometry.width}
          height={geometry.height}
          role="img"
          aria-label={`Wallet balance over time, currently ${formatAmount(points[points.length - 1].sats, unit)}`}
          className="block"
        >
          {[geometry.max, geometry.max / 2].map((level) => (
            <g key={level}>
              <line
                x1={0}
                x2={geometry.plotWidth}
                y1={geometry.y(level)}
                y2={geometry.y(level)}
                stroke="var(--color-border)"
                strokeWidth={1}
                strokeDasharray="2 4"
                opacity={0.7}
              />
              <text
                x={geometry.width - GUTTER + 8}
                y={geometry.y(level) + 3}
                className="tabular"
                fill="var(--color-muted)"
                fontSize={10}
              >
                {formatCompact(level, unit)}
              </text>
            </g>
          ))}
          <line
            x1={0}
            x2={geometry.plotWidth}
            y1={geometry.floor}
            y2={geometry.floor}
            stroke="var(--color-border)"
            strokeWidth={1}
            opacity={0.7}
          />
          <path d={geometry.area} fill="var(--color-primary)" opacity={0.06} />
          <path
            d={geometry.line}
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {hovered && (
            <g>
              <line
                x1={geometry.x(hovered.t)}
                x2={geometry.x(hovered.t)}
                y1={PAD_TOP}
                y2={geometry.floor}
                stroke="var(--color-border)"
                strokeWidth={1}
              />
              <circle
                cx={geometry.x(hovered.t)}
                cy={geometry.y(hovered.sats)}
                r={3.5}
                fill="var(--color-primary)"
                stroke="var(--color-surface)"
                strokeWidth={1.5}
              />
            </g>
          )}
          <text x={0} y={geometry.height - 6} fill="var(--color-muted)" fontSize={10}>
            {formatDate(points[0].t)}
          </text>
          <text
            x={geometry.plotWidth}
            y={geometry.height - 6}
            textAnchor="end"
            fill="var(--color-muted)"
            fontSize={10}
          >
            {formatDate(points[points.length - 1].t)}
          </text>
        </svg>
      )}
      {hovered && (
        <div className="pointer-events-none absolute left-0 top-0 rounded-md border border-border bg-surface px-2 py-1 shadow-overlay">
          <p className="tabular text-xs font-medium text-text">
            {formatAmount(hovered.sats, unit)}
          </p>
          <p className="tabular text-[10px] text-muted">{formatDate(hovered.t)}</p>
        </div>
      )}
    </div>
  );
}
