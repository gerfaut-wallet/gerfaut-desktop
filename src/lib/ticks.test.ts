import { describe, expect, it } from "vitest";
import { dateTicks, formatCompact, niceLevels } from "./ticks";

/** A local moment, so the calendar reads the same in every time zone. */
function at(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): number {
  return new Date(year, month - 1, day, hour, minute).getTime() / 1000;
}

describe("niceLevels", () => {
  it("rules the floor and 1-2-5 steps up to the maximum", () => {
    expect(niceLevels(150_000)).toEqual([0, 50_000, 100_000, 150_000]);
    expect(niceLevels(100_000_000)).toEqual([0, 50_000_000, 100_000_000]);
    expect(niceLevels(700_000_000)).toEqual([
      0, 200_000_000, 400_000_000, 600_000_000, 800_000_000,
    ]);
  });

  it("prefers more lines when two steps waste the same room", () => {
    expect(niceLevels(200_000_000)).toEqual([
      0, 50_000_000, 100_000_000, 150_000_000, 200_000_000,
    ]);
  });

  it("keeps three to five levels and covers the maximum", () => {
    for (const max of [3, 7, 42, 999, 1_234_567, 89_000_000, 2_100_000_000_000_000]) {
      const levels = niceLevels(max);
      expect(levels.length).toBeGreaterThanOrEqual(3);
      expect(levels.length).toBeLessThanOrEqual(5);
      expect(levels[0]).toBe(0);
      expect(levels[levels.length - 1]).toBeGreaterThanOrEqual(max);
      const step = levels[1];
      const mantissa = step / 10 ** Math.floor(Math.log10(step));
      expect([1, 2, 5]).toContain(Math.round(mantissa));
    }
  });

  it("has the floor alone for nothing, and never half a sat", () => {
    expect(niceLevels(0)).toEqual([0]);
    expect(niceLevels(1)).toEqual([0, 1]);
    expect(niceLevels(2)).toEqual([0, 1, 2]);
  });
});

describe("formatCompact", () => {
  it("writes bitcoin with the digits it needs and no more", () => {
    expect(formatCompact(0, "btc")).toBe("0");
    expect(formatCompact(50_000_000, "btc")).toBe("0.5 BTC");
    expect(formatCompact(100_000_000, "btc")).toBe("1 BTC");
    expect(formatCompact(150_000, "btc")).toBe("0.0015 BTC");
    expect(formatCompact(5, "btc")).toBe("0.00000005 BTC");
    expect(formatCompact(285_100_000_000, "btc")).toMatch(/^2.851 BTC$/);
  });

  it("folds sats into k, M, B and T", () => {
    expect(formatCompact(0, "sats")).toBe("0");
    expect(formatCompact(500, "sats")).toBe("500 sats");
    expect(formatCompact(1_250, "sats")).toBe("1.25k sats");
    expect(formatCompact(250_000, "sats")).toBe("250k sats");
    expect(formatCompact(1_500_000, "sats")).toBe("1.5M sats");
    expect(formatCompact(100_000_000, "sats")).toBe("100M sats");
    expect(formatCompact(2_500_000_000, "sats")).toBe("2.5B sats");
    expect(formatCompact(1_000_000_000_000, "sats")).toBe("1T sats");
  });
});

describe("dateTicks", () => {
  it("cuts a year in quarters, on the first of the month", () => {
    const ticks = dateTicks(at(2025, 8, 12), at(2026, 9, 3));
    expect(ticks.map((tick) => tick.label)).toEqual([
      "Oct 2025",
      "Jan 2026",
      "Apr 2026",
      "Jul 2026",
    ]);
    for (const tick of ticks) {
      expect(new Date(tick.t * 1000).getDate()).toBe(1);
    }
  });

  it("counts a few weeks in days", () => {
    const ticks = dateTicks(at(2026, 3, 1), at(2026, 4, 15));
    expect(ticks.map((tick) => tick.label)).toEqual(["1 Mar", "15 Mar", "29 Mar", "12 Apr"]);
  });

  it("counts decades in years on round multiples", () => {
    const ticks = dateTicks(at(2006, 1, 1), at(2026, 1, 1));
    expect(ticks.map((tick) => tick.label)).toEqual(["2010", "2015", "2020", "2025"]);
  });

  it("reads a span under a day in hours", () => {
    const ticks = dateTicks(at(2026, 3, 12, 9, 30), at(2026, 3, 12, 14, 30));
    expect(ticks.map((tick) => tick.label)).toEqual(["10:00", "12:00", "14:00"]);
  });

  it("falls back to a finer unit when the span's own gives one tick", () => {
    // Sixty days from the second: one first-of-month inside, so days.
    const ticks = dateTicks(at(2026, 7, 2), at(2026, 8, 31));
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks[0].label).toMatch(/^\d{1,2} [A-Z][a-z]{2}$/);
  });

  it("never exceeds the room it is given", () => {
    const ticks = dateTicks(at(2025, 8, 12), at(2026, 9, 3), 2);
    expect(ticks.map((tick) => tick.label)).toEqual(["Jan 2026", "Jul 2026"]);
  });

  it("stays inside the span", () => {
    const t0 = at(2024, 2, 29, 13);
    const t1 = at(2027, 11, 5, 7);
    for (const tick of dateTicks(t0, t1)) {
      expect(tick.t).toBeGreaterThanOrEqual(t0);
      expect(tick.t).toBeLessThanOrEqual(t1);
    }
  });

  it("names the day alone when nothing else fits", () => {
    const t0 = at(2026, 3, 12, 14, 3);
    expect(dateTicks(t0, t0 + 1)).toEqual([{ t: t0, label: "12 Mar" }]);
  });
});
