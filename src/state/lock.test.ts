import { describe, expect, it } from "vitest";
import { shouldLock } from "./lock";

describe("when the lock comes back", () => {
  it("never on its own when the timing is off", () => {
    expect(shouldLock({ awaySecs: 100_000, autoLockSecs: null })).toBe(false);
  });

  it("at once when the timing is zero", () => {
    expect(shouldLock({ awaySecs: 0, autoLockSecs: 0 })).toBe(true);
  });

  it("only past the chosen delay", () => {
    expect(shouldLock({ awaySecs: 59, autoLockSecs: 60 })).toBe(false);
    expect(shouldLock({ awaySecs: 60, autoLockSecs: 60 })).toBe(true);
    expect(shouldLock({ awaySecs: 301, autoLockSecs: 300 })).toBe(true);
  });
});
