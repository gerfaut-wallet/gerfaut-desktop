import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, describe, expect, it } from "vitest";
import { shouldLock, useLock } from "./lock";

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

describe("the idle clock", () => {
  beforeEach(() => {
    useLock.setState({ lock: null, locked: false, seen: false, lastActive: 0 });
  });

  it("restarts on unlock, so the app does not lock again at once", async () => {
    // The delay is measured from the unlock, not from whenever the app
    // was mounted: without this, a 1-minute delay re-locks within the
    // next tick every single time.
    const before = useLock.getState().lastActive;
    mockIPC((cmd) => {
      if (cmd === "verify_app_lock") {
        return { unlocked: true, failures: 0, retry_after_secs: 0 };
      }
      throw new Error(`unexpected command ${cmd}`);
    });

    await useLock.getState().unlock("1234");

    const after = useLock.getState().lastActive;
    expect(after).toBeGreaterThan(before);
    expect(
      shouldLock({
        awaySecs: (Date.now() - after) / 1000,
        autoLockSecs: 60,
      }),
    ).toBe(false);
  });

  it("takes the lock from the vault, and only the first read locks", () => {
    const lock = { kind: "pin", auto_lock_secs: 60, biometric: false } as const;
    useLock.getState().syncFromSettings(lock);
    expect(useLock.getState().locked).toBe(true);

    // Unlocking, then a settings refetch: the app must stay open.
    useLock.setState({ locked: false });
    useLock.getState().syncFromSettings(lock);
    expect(useLock.getState().locked).toBe(false);
  });

  it("a vault with no lock never locks", () => {
    useLock.getState().syncFromSettings(null);
    expect(useLock.getState().locked).toBe(false);
    useLock.getState().lockNow();
    expect(useLock.getState().locked).toBe(false);
  });
});
