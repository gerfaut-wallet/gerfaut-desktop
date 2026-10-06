import { describe, expect, it } from "vitest";
import { dayBound } from "./ExportView";

describe("a day typed for the export", () => {
  it("is a whole UTC day", () => {
    expect(dayBound("2026-01-31", false)).toBe(Date.UTC(2026, 0, 31) / 1000);
    expect(dayBound("2026-01-31", true)).toBe(Date.UTC(2026, 0, 31) / 1000 + 86_399);
  });

  it("reads a year below 100 as written, not as the 1900s", () => {
    const bound = dayBound("0024-01-01", false)!;
    expect(new Date(bound * 1000).getUTCFullYear()).toBe(24);
  });

  it("refuses a day that does not exist, or is not written as YYYY-MM-DD", () => {
    expect(dayBound("2026-02-31", false)).toBeNull();
    expect(dayBound("31/01/2026", false)).toBeNull();
    expect(dayBound("2026-1-31", false)).toBeNull();
  });
});
