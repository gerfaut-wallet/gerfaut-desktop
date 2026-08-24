import { clsx } from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FiatCurrency, PriceHistory, PriceRange } from "../lib/ipc";

const RANGE_LABEL: Record<PriceRange, string> = {
  day: "1D",
  week: "1W",
  month: "1M",
  year: "1Y",
  max: "Max",
};

/** Chart geometry: fixed height, labels in the right gutter. */
const HEIGHT = 156;
const PAD_TOP = 6;
const PAD_BOTTOM = 20;
const GUTTER = 52;

function formatFull(value: number, currency: FiatCurrency): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCompact(value: number, currency: FiatCurrency): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatTick(t: number, range: PriceRange): string {
  const date = new Date(t * 1000);
  if (range === "day") {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  if (range === "week" || range === "month") {
    return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }
  if (range === "year") {
    return date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  }
  return date.toLocaleDateString(undefined, { year: "numeric" });
}

/** BTC price line for the overview: a 2px Glacier line on hairline
    grid, a hover crosshair with an exact readout, range pills limited
    to what the configured source can serve. Price is public market
    data: it stays visible while wallet amounts are masked. */
export function PriceChart({
  history,
  pending,
  failed,
  currency,
  range,
  ranges,
  onRangeChange,
}: {
  history: PriceHistory | undefined;
  pending: boolean;
  failed: boolean;
  currency: FiatCurrency;
  range: PriceRange;
  ranges: PriceRange[];
  onRangeChange: (range: PriceRange) => void;
}) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [cursor, setCursor] = useState<number | null>(null);

  useEffect(() => {
    const node = plotRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      setWidth(Math.floor(entries[0].contentRect.width));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const points = history?.points ?? [];
  const geometry = useMemo(() => {
    if (points.length < 2 || width <= GUTTER) return null;
    const plotWidth = width - GUTTER;
    const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
    let min = Infinity;
    let max = -Infinity;
    for (const point of points) {
      if (point.rate < min) min = point.rate;
      if (point.rate > max) max = point.rate;
    }
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const span = max - min;
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;
    const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * plotWidth;
    const y = (rate: number) => PAD_TOP + (1 - (rate - min) / span) * plotHeight;
    const line = points
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.rate).toFixed(1)}`)
      .join("");
    const floor = PAD_TOP + plotHeight;
    const area = `${line}L${plotWidth},${floor}L0,${floor}Z`;
    return { plotWidth, plotHeight, min, max, x, y, line, area, floor };
  }, [points, width]);

  const first = points[0];
  const last = points[points.length - 1];
  const change = first && last ? ((last.rate - first.rate) / first.rate) * 100 : null;
  const hovered = cursor !== null ? points[cursor] : null;

  const locate = (clientX: number) => {
    if (!geometry || !plotRef.current || points.length === 0) return;
    const rect = plotRef.current.getBoundingClientRect();
    const px = clientX - rect.left;
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;
    const t = t0 + (px / Math.max(1, geometry.plotWidth)) * (t1 - t0);
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < points.length; i += 1) {
      const distance = Math.abs(points[i].t - t);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    setCursor(best);
  };

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="flex items-baseline gap-2.5">
          {last ? (
            <>
              <span className="tabular text-lg font-semibold text-text">
                {formatFull(hovered ? hovered.rate : last.rate, currency)}
              </span>
              {change !== null && !hovered && (
                <span className="tabular text-xs font-medium text-muted">
                  {change >= 0 ? "+" : "−"}
                  {Math.abs(change).toFixed(1)}% over {RANGE_LABEL[range]}
                </span>
              )}
              {hovered && (
                <span className="tabular text-xs text-muted">
                  {formatTick(hovered.t, range)}
                </span>
              )}
            </>
          ) : (
            <span className="font-ui text-sm text-muted">
              {pending ? "Loading price history…" : "—"}
            </span>
          )}
        </div>
        <div
          role="radiogroup"
          aria-label="Chart range"
          className="inline-flex rounded-md bg-sunken p-0.5"
        >
          {ranges.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={range === option}
              onClick={() => onRangeChange(option)}
              className={clsx(
                "cursor-pointer rounded-[6px] px-2 py-1 font-ui text-[11px] font-medium transition-colors duration-150",
                range === option
                  ? "bg-surface text-text shadow-[inset_0_0_0_1px_var(--color-border)]"
                  : "text-muted hover:text-text",
              )}
            >
              {RANGE_LABEL[option]}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={plotRef}
        className="relative mt-3 select-none"
        style={{ height: HEIGHT }}
        onPointerMove={(event) => locate(event.clientX)}
        onPointerLeave={() => setCursor(null)}
      >
        {failed && !history && (
          <p className="absolute inset-0 flex items-center justify-center font-ui text-sm text-muted">
            The price source did not answer.
          </p>
        )}
        {geometry && (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={
              first && last && change !== null
                ? `Bitcoin price over ${RANGE_LABEL[range]}: from ${formatFull(first.rate, currency)} to ${formatFull(last.rate, currency)}, ${change >= 0 ? "up" : "down"} ${Math.abs(change).toFixed(1)}%`
                : "Bitcoin price chart"
            }
            className="block"
          >
            {/* Hairline grid at the domain floor, middle, and ceiling. */}
            {[geometry.max, (geometry.min + geometry.max) / 2, geometry.min].map((level) => (
              <g key={level}>
                <line
                  x1={0}
                  x2={geometry.plotWidth}
                  y1={geometry.y(level)}
                  y2={geometry.y(level)}
                  stroke="var(--color-border)"
                  strokeWidth={1}
                  strokeDasharray={level === geometry.min ? undefined : "2 4"}
                  opacity={0.7}
                />
                <text
                  x={width - GUTTER + 8}
                  y={geometry.y(level) + 3}
                  className="tabular"
                  fill="var(--color-muted)"
                  fontSize={10}
                >
                  {formatCompact(level, currency)}
                </text>
              </g>
            ))}
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
                  cy={geometry.y(hovered.rate)}
                  r={3.5}
                  fill="var(--color-primary)"
                  stroke="var(--color-surface)"
                  strokeWidth={1.5}
                />
              </g>
            )}
            {/* Time ticks: both ends of the range. */}
            {first && last && (
              <>
                <text x={0} y={HEIGHT - 6} fill="var(--color-muted)" fontSize={10}>
                  {formatTick(first.t, range)}
                </text>
                <text
                  x={geometry.plotWidth}
                  y={HEIGHT - 6}
                  textAnchor="end"
                  fill="var(--color-muted)"
                  fontSize={10}
                >
                  {formatTick(last.t, range)}
                </text>
              </>
            )}
          </svg>
        )}
      </div>
    </div>
  );
}
