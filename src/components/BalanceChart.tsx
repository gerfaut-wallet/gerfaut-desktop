import { clsx } from "clsx";
import type { KeyboardEvent } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatAmount, formatTimestamp } from "../lib/format";
import type { Unit } from "../lib/format";
import type { BalancePoint } from "../lib/series";
import { dateTicks, formatCompact, niceLevels } from "../lib/ticks";

/** Room above the top level, enough for the hover dot. */
const PAD_TOP = 8;
/** The x-axis band under the floor: tick marks, a gap, a 10px label. */
const PAD_BOTTOM = 24;
/** Length of a tick mark. */
const TICK = 4;
/** Axis type size, and the width of one of its tabular glyphs: near
    enough to size the gutter and to keep a label inside the plot. */
const FONT = 10;
const GLYPH = 5.8;
const MIN_GUTTER = 44;
/** Room one date label needs; decides how many ticks a width carries. */
const TICK_ROOM = 90;
/** Within this much of the right edge the tooltip opens to the left. */
const TOOLTIP_ROOM = 180;

type Anchor = "start" | "middle" | "end";

/** Balance of the wallet over its loaded life, in the display unit: a
    step line — a balance jumps, it never slopes — over a zero floor,
    ruled at a few round levels and dated at a few calendar marks. The
    pointer or the arrow keys read one point exactly. The parent hides
    this entirely while amounts are masked. */
export function BalanceChart({ points, unit }: { points: BalancePoint[]; unit: Unit }) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [cursor, setCursor] = useState<number | null>(null);
  // Whether the keyboard put the cursor where it is. Only then is the
  // reading announced: a pointer sweeping the curve would otherwise
  // have a screen reader say every point it crossed.
  const [byKeyboard, setByKeyboard] = useState(false);
  // An id that survives `url(#…)`: the generated one carries punctuation.
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const fillId = `balance-fill-${id}`;
  const hintId = `balance-hint-${id}`;

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
    if (points.length < 2 || height < 80) return null;
    const max = Math.max(...points.map((point) => point.sats));
    const levels = niceLevels(max).map((sats) => ({ sats, label: formatCompact(sats, unit) }));
    const longest = Math.max(...levels.map((level) => level.label.length));
    const gutter = Math.max(MIN_GUTTER, Math.ceil(longest * GLYPH) + 12);
    const plotWidth = width - gutter;
    if (plotWidth < 80) return null;
    const plotHeight = height - PAD_TOP - PAD_BOTTOM;
    const floor = PAD_TOP + plotHeight;
    // The top level is the ceiling. A life spent at zero keeps a scale,
    // so its floor still has somewhere to be drawn.
    const top = Math.max(levels[levels.length - 1].sats, 1);
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;
    const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * plotWidth;
    const y = (sats: number) => floor - (sats / top) * plotHeight;
    let line = `M0,${y(points[0].sats).toFixed(1)}`;
    for (let i = 1; i < points.length; i += 1) {
      line += `H${x(points[i].t).toFixed(1)}V${y(points[i].sats).toFixed(1)}`;
    }
    line += `H${plotWidth}`;
    const area = `${line}V${floor}H0Z`;
    const maxTicks = Math.max(2, Math.min(6, Math.floor(plotWidth / TICK_ROOM)));
    // A label is anchored so that it never leaves the plot: a tick at
    // the edge writes away from it.
    const ticks = dateTicks(t0, t1, maxTicks).map((tick) => {
      const px = x(tick.t);
      const half = (tick.label.length * GLYPH) / 2;
      const anchor: Anchor = px - half < 0 ? "start" : px + half > plotWidth ? "end" : "middle";
      return { ...tick, x: px, anchor };
    });
    return { width, height, plotWidth, floor, x, y, line, area, levels, ticks };
  }, [points, size, unit]);

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
    setByKeyboard(false);
    setCursor(best);
  };

  const step = (index: number) => {
    setByKeyboard(true);
    setCursor(Math.max(0, Math.min(points.length - 1, index)));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = cursor ?? points.length - 1;
    switch (event.key) {
      case "ArrowLeft":
        step(current - 1);
        break;
      case "ArrowRight":
        step(current + 1);
        break;
      case "Home":
        step(0);
        break;
      case "End":
        step(points.length - 1);
        break;
      case "Escape":
        setCursor(null);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const flip = geometry && hovered ? geometry.x(hovered.t) > geometry.width - TOOLTIP_ROOM : false;

  return (
    <div
      ref={plotRef}
      role="group"
      aria-label="Balance history chart"
      aria-describedby={hintId}
      tabIndex={0}
      className="relative h-full min-h-[140px] select-none rounded-md"
      onPointerMove={(event) => locate(event.clientX)}
      onPointerLeave={() => setCursor(null)}
      onKeyDown={onKeyDown}
      onFocus={() => {
        setByKeyboard(true);
        setCursor((current) => current ?? points.length - 1);
      }}
      onBlur={() => setCursor(null)}
    >
      <p id={hintId} className="sr-only">
        Use the arrow keys to read each point.
      </p>
      {geometry && (
        <svg
          width={geometry.width}
          height={geometry.height}
          role="img"
          aria-label={`Wallet balance over time, currently ${formatAmount(points[points.length - 1].sats, unit)}`}
          className="block"
        >
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.14} />
              <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <g
            stroke="var(--color-border)"
            strokeOpacity={0.5}
            strokeWidth={1}
            shapeRendering="crispEdges"
          >
            {geometry.levels.map((level) => (
              <line
                key={level.sats}
                x1={0}
                x2={geometry.plotWidth}
                y1={geometry.y(level.sats)}
                y2={geometry.y(level.sats)}
              />
            ))}
            {geometry.ticks.map((tick) => (
              <line key={tick.t} x1={tick.x} x2={tick.x} y1={geometry.floor} y2={geometry.floor + TICK} />
            ))}
          </g>
          <g fill="var(--color-muted)" fontSize={FONT} className="tabular">
            {geometry.levels.map((level) => (
              <text
                key={level.sats}
                x={geometry.plotWidth + 8}
                y={geometry.y(level.sats)}
                dominantBaseline="central"
              >
                {level.label}
              </text>
            ))}
            {geometry.ticks.map((tick) => (
              <text
                key={tick.t}
                x={tick.x}
                y={geometry.floor + TICK + 4}
                textAnchor={tick.anchor}
                dominantBaseline="hanging"
              >
                {tick.label}
              </text>
            ))}
          </g>
          <path d={geometry.area} fill={`url(#${fillId})`} />
          <path
            d={geometry.line}
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth={1.5}
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
                shapeRendering="crispEdges"
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
        </svg>
      )}
      {/* Always mounted, so a reading arriving by keyboard is announced;
          quiet while the pointer drives. */}
      <div
        role="status"
        aria-live={byKeyboard ? "polite" : "off"}
        className={clsx(
          "pointer-events-none absolute top-0 rounded-md border border-border bg-surface px-2 py-1 shadow-overlay",
          !hovered && "invisible",
        )}
        style={
          hovered && geometry
            ? {
                left: geometry.x(hovered.t) + (flip ? -10 : 10),
                transform: flip ? "translateX(-100%)" : undefined,
              }
            : undefined
        }
      >
        {hovered && (
          <>
            <p className="tabular text-xs font-medium text-text">
              {formatAmount(hovered.sats, unit)}
            </p>
            <p className="tabular text-[10px] text-muted">{formatTimestamp(hovered.t)}</p>
          </>
        )}
      </div>
    </div>
  );
}
