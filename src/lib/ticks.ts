// Axes for the balance chart: the levels a y-axis is ruled at, the
// calendar ticks of an x-axis, and the short figures that fit a gutter.

import { LOCALE, groupThousands } from "./format";
import type { Unit } from "./format";

/** The steps a decade is cut in: 1, 2, 5, then the next decade. */
const MANTISSAS = [1, 2, 5];

/** Levels of a y-axis from zero up to at least `max`, in sats: steps of
    1, 2 or 5 on a decade, three to five levels including the floor.
    The step wasting the least room above `max` wins; on a tie, the one
    ruling more lines. Nothing to show has the floor alone, and a step
    never cuts a sat in two. */
export function niceLevels(max: number): number[] {
  if (!(max > 0)) return [0];
  let best: number[] | null = null;
  let bestHeadroom = Infinity;
  const low = Math.floor(Math.log10(max / 5));
  const high = Math.ceil(Math.log10(max));
  for (let exponent = low; exponent <= high; exponent += 1) {
    for (const mantissa of MANTISSAS) {
      const step = mantissa * 10 ** exponent;
      if (step < 1) continue;
      const count = Math.ceil(max / step) + 1;
      if (count < 3 || count > 5) continue;
      const headroom = step * (count - 1) - max;
      const tighter = headroom < bestHeadroom;
      const finer = headroom === bestHeadroom && best !== null && count > best.length;
      if (tighter || finer) {
        best = Array.from({ length: count }, (_, index) => step * index);
        bestHeadroom = headroom;
      }
    }
  }
  return best ?? [0, max];
}

/** A level of the y-axis in the display unit, short enough for a
    gutter: "0.5 BTC", "1 BTC", "250k sats". Zero is "0". A small
    amount keeps the digits it needs rather than rounding to nothing. */
export function formatCompact(sats: number, unit: Unit): string {
  const whole = Math.round(sats);
  if (whole === 0) return "0";
  return unit === "btc" ? `${compactBtc(whole)} BTC` : `${compactSats(whole)} sats`;
}

/** Eight decimals with the trailing zeros dropped, thousands grouped. */
function compactBtc(sats: number): string {
  const whole = groupThousands(String(Math.floor(sats / 100_000_000)));
  const frac = String(sats % 100_000_000)
    .padStart(8, "0")
    .replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

const SCALES: [number, string][] = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "k"],
];

/** Thousands folded into a suffix, up to three decimals kept. */
function compactSats(sats: number): string {
  for (const [size, suffix] of SCALES) {
    if (sats >= size) {
      const figure = (sats / size).toFixed(3).replace(/\.?0+$/, "");
      return `${groupThousands(figure)}${suffix}`;
    }
  }
  return groupThousands(String(sats));
}

export interface AxisTick {
  /** Unix timestamp, seconds. */
  t: number;
  label: string;
}

type DateUnit = "hour" | "day" | "month" | "year";

const UNITS: DateUnit[] = ["hour", "day", "month", "year"];

/** The steps each unit may be counted in. */
const STEPS: Record<DateUnit, number[]> = {
  hour: [1, 2, 3, 6, 12],
  day: [1, 2, 7, 14],
  month: [1, 2, 3, 6],
  year: [1, 2, 5, 10, 20, 50, 100],
};

const HOUR = 3_600;
const DAY = 24 * HOUR;

/** The unit a span reads in: hours under two days, days under two
    months, months under two years, years beyond. */
function preferredUnit(span: number): DateUnit {
  if (span < 2 * DAY) return "hour";
  if (span < 60 * DAY) return "day";
  if (span < 730 * DAY) return "month";
  return "year";
}

/** Local calendar boundaries of one unit inside [t0, t1], `step`
    apart: hours on the hour, days at midnight, months on the first,
    years on January. A step of several hours, months or years lands
    on its multiples, so quarters start in January and half-days at
    noon. */
function boundaries(unit: DateUnit, step: number, t0: number, t1: number): number[] {
  const start = new Date(t0 * 1000);
  const year = start.getFullYear();
  const month = start.getMonth();
  const day = start.getDate();
  let cursor: Date;
  let aligned: () => boolean;
  let advance: (by: number) => void;
  switch (unit) {
    case "hour":
      cursor = new Date(year, month, day, start.getHours());
      aligned = () => cursor.getHours() % step === 0;
      advance = (by) => cursor.setHours(cursor.getHours() + by);
      break;
    case "day":
      cursor = new Date(year, month, day);
      aligned = () => true;
      advance = (by) => cursor.setDate(cursor.getDate() + by);
      break;
    case "month":
      cursor = new Date(year, month, 1);
      aligned = () => cursor.getMonth() % step === 0;
      advance = (by) => cursor.setMonth(cursor.getMonth() + by);
      break;
    case "year":
      cursor = new Date(year, 0, 1);
      aligned = () => cursor.getFullYear() % step === 0;
      advance = (by) => cursor.setFullYear(cursor.getFullYear() + by);
      break;
  }
  while (cursor.getTime() / 1000 < t0 || !aligned()) advance(1);
  const out: number[] = [];
  while (cursor.getTime() / 1000 <= t1 && out.length <= 1_000) {
    out.push(cursor.getTime() / 1000);
    advance(step);
  }
  return out;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** A tick in the words of its unit: "14:00", "12 Mar", "Mar 2026", "2026". */
function tickLabel(t: number, unit: DateUnit): string {
  const date = new Date(t * 1000);
  const month = date.toLocaleDateString(LOCALE, { month: "short" });
  switch (unit) {
    case "hour":
      return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    case "day":
      return `${date.getDate()} ${month}`;
    case "month":
      return `${month} ${date.getFullYear()}`;
    case "year":
      return String(date.getFullYear());
  }
}

/** Calendar ticks over [t0, t1], at most `maxTicks` of them: the unit
    the span reads in, at the step landing closest to four ticks; a
    neighbouring unit only when that one cannot give two. Ties go to
    the coarser step — fewer marks read calmer. A span too short to
    cross any boundary gets its first day, alone. */
export function dateTicks(t0: number, t1: number, maxTicks = 6): AxisTick[] {
  const target = Math.min(4, maxTicks);
  const preferred = preferredUnit(t1 - t0);
  let best: { ts: number[]; unit: DateUnit; score: number } | null = null;
  for (const unit of UNITS) {
    for (const step of STEPS[unit]) {
      const ts = boundaries(unit, step, t0, t1);
      if (ts.length === 0 || ts.length > maxTicks) continue;
      const score =
        Math.abs(ts.length - target) * 10 +
        (unit === preferred ? 0 : 5) +
        (ts.length < 2 ? 20 : 0);
      if (best === null || score <= best.score) best = { ts, unit, score };
    }
  }
  if (best === null) return [{ t: t0, label: tickLabel(t0, "day") }];
  const { ts, unit } = best;
  return ts.map((t) => ({ t, label: tickLabel(t, unit) }));
}
