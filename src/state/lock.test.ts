import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppLock, Settings } from "../lib/ipc";
import { isLockedError, lockedSettings, useLock } from "./lock";

const PIN: AppLock = { kind: "pin", biometric: false };

const FULL: Settings = {
  active_network: "signet",
  backends: { signet: { type: "custom_esplora", url: "https://mempool.space/signet/api" } },
  gap_limit: 20,
  app_prefs: {
    "desktop.theme": "dark",
    "display.unit": "sats",
    "broadcast.recent": '[{"txid":"ab","hex":"00","network":"signet"}]',
  },
  electrum_certs: { "node.example:50002": "AB:CD" },
  app_lock: PIN,
  tor: { mode: "auto", socks_proxy: null },
  premium: {
    key: "abcd-efgh-ijkm-npqr",
    certificate: "cert",
    watched: [{ wallet_id: "w-1", consented_at: 0 }],
    acknowledged_offline_until: null,
  },
};

describe("the settings kept behind the lock", () => {
  it("keeps the theme and the kind of lock, and nothing of the vault", () => {
    const shut = lockedSettings(FULL);

    expect(shut.app_prefs).toEqual({ "desktop.theme": "dark" });
    expect(shut.backends).toEqual({});
    expect(shut.electrum_certs).toEqual({});
    expect(shut.premium.key).toBeNull();
    expect(shut.premium.watched).toEqual([]);
    // What the lock screen has to ask for stays.
    expect(shut.app_lock).toEqual(PIN);
  });

  it("reads a refusal from the locked vault for what it is", () => {
    expect(isLockedError({ kind: "locked", message: "Gerfaut is locked." })).toBe(true);
    expect(isLockedError({ kind: "vault", message: "no" })).toBe(false);
    expect(isLockedError(new Error("no"))).toBe(false);
    expect(isLockedError(undefined)).toBe(false);
  });
});

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

  it("tells the core to shut the vault, not only the screen", async () => {
    // The webview drawing a curtain stops nothing: the commands behind
    // it answered descriptors and balances all the same.
    const called: string[] = [];
    mockIPC((cmd) => {
      called.push(cmd);
      if (cmd === "lock_app") return undefined;
      throw new Error(`unexpected command ${cmd}`);
    });
    useLock.getState().syncFromSettings(PIN);
    useLock.setState({ locked: false });

    useLock.getState().lockNow();

    expect(useLock.getState().locked).toBe(true);
    await Promise.resolve();
    expect(called).toEqual(["lock_app"]);
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
