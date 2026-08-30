import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppLock } from "../lib/ipc";
import { useLock } from "./lock";

const PIN: AppLock = { kind: "pin", biometric: false };

describe("the app lock", () => {
  beforeEach(() => {
    useLock.setState({ lock: null, locked: false, seen: false });
  });

  it("takes the lock from the vault, and only the first read locks", () => {
    useLock.getState().syncFromSettings(PIN);
    expect(useLock.getState().locked).toBe(true);

    // Unlocking, then a settings refetch: the app must stay open.
    useLock.setState({ locked: false });
    useLock.getState().syncFromSettings(PIN);
    expect(useLock.getState().locked).toBe(false);
  });

  it("a vault with no lock never locks", () => {
    useLock.getState().syncFromSettings(null);
    expect(useLock.getState().locked).toBe(false);
    useLock.getState().lockNow();
    expect(useLock.getState().locked).toBe(false);
  });

  it("stays unlocked until it is asked to lock again", async () => {
    mockIPC((cmd) => {
      if (cmd === "verify_app_lock") {
        return { unlocked: true, failures: 0, retry_after_secs: 0 };
      }
      throw new Error(`unexpected command ${cmd}`);
    });
    useLock.getState().syncFromSettings(PIN);

    await useLock.getState().unlock("1234");
    expect(useLock.getState().locked).toBe(false);

    // Nothing brings the screen back on its own; asking does.
    useLock.getState().lockNow();
    expect(useLock.getState().locked).toBe(true);
  });

  it("a refused secret leaves the screen up", async () => {
    mockIPC((cmd) => {
      if (cmd === "verify_app_lock") {
        return { unlocked: false, failures: 1, retry_after_secs: 0 };
      }
      throw new Error(`unexpected command ${cmd}`);
    });
    useLock.getState().syncFromSettings(PIN);

    const verdict = await useLock.getState().unlock("0000");

    expect(verdict.unlocked).toBe(false);
    expect(useLock.getState().locked).toBe(true);
  });
});
