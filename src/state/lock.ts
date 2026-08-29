// The app lock: what stands between an unlocked computer and the
// wallets.
//
// The vault is encrypted whatever happens; the lock is the curtain in
// front of it. The secret never leaves the core, which hashes it and
// slows repeated guesses down; this store holds only whether the lock
// screen is showing and when it should show again.

import { useEffect, useRef } from "react";
import { create } from "zustand";
import type { AppLock, LockVerdict } from "../lib/ipc";
import { ipc } from "../lib/ipc";

/** Whether an idle stretch of `awaySecs` should ask for the secret.
    `null` never locks on its own — the lock is then a launch-time
    question only. Zero locks the moment the window loses focus. */
export function shouldLock({
  awaySecs,
  autoLockSecs,
}: {
  awaySecs: number;
  autoLockSecs: number | null;
}): boolean {
  if (autoLockSecs === null) return false;
  if (autoLockSecs === 0) return true;
  return awaySecs >= autoLockSecs;
}

interface LockState {
  /** The lock the vault holds, without its hash; null when none. */
  lock: AppLock | null;
  /** The lock screen is showing and nothing else is in the tree. */
  locked: boolean;
  /** The vault has been asked; before that nothing is decided. */
  loaded: boolean;
  load: () => Promise<void>;
  refresh: () => Promise<void>;
  unlock: (secret: string) => Promise<LockVerdict>;
  lockNow: () => void;
}

export const useLock = create<LockState>((set, get) => ({
  lock: null,
  locked: false,
  loaded: false,

  /** Reads the lock the vault holds. A lock present means the app
      starts locked: the first thing it asks is the secret. */
  load: async () => {
    try {
      const lock = await ipc.appLock();
      set({ lock, locked: lock !== null, loaded: true });
    } catch {
      // A vault that cannot say has no lock to show: the startup error
      // screen is the one that speaks, not a lock nobody can pass.
      set({ lock: null, locked: false, loaded: true });
    }
  },

  /** Reloads after the settings changed the lock, leaving the screen
      as it is: turning a lock on does not lock the user out at once. */
  refresh: async () => {
    try {
      set({ lock: await ipc.appLock(), loaded: true });
    } catch {
      // Keep what is on screen: a failed read is not an unlock.
    }
  },

  unlock: async (secret) => {
    const verdict = await ipc.verifyAppLock(secret);
    if (verdict.unlocked) set({ locked: false });
    return verdict;
  },

  lockNow: () => {
    if (get().lock !== null) set({ locked: true });
  },
}));

/** How often the idle clock is compared against the chosen delay. */
const TICK_MS = 5000;

/** Locks the app again after the delay the user chose.
    Idle is measured from the last thing the user did in the window,
    not from a timer alone: a session spent reading a transaction is
    not an absence. Losing focus counts as leaving, which is what makes
    "Immediately" mean it. */
export function useAutoLock(): void {
  const lock = useLock((state) => state.lock);
  const locked = useLock((state) => state.locked);
  const lastActive = useRef(Date.now());

  useEffect(() => {
    if (lock === null || locked) return;
    const autoLockSecs = lock.auto_lock_secs;

    const touch = () => {
      lastActive.current = Date.now();
    };
    const check = () => {
      const away = (Date.now() - lastActive.current) / 1000;
      if (shouldLock({ awaySecs: away, autoLockSecs })) useLock.getState().lockNow();
    };
    const onBlur = () => {
      if (autoLockSecs === 0) useLock.getState().lockNow();
    };
    const onVisibility = () => {
      if (document.hidden) onBlur();
      else check();
    };
    const onKey = (event: KeyboardEvent) => {
      touch();
      if (event.ctrlKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        useLock.getState().lockNow();
      }
    };

    window.addEventListener("pointerdown", touch);
    window.addEventListener("wheel", touch, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = setInterval(check, TICK_MS);

    return () => {
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("wheel", touch);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(timer);
    };
  }, [lock, locked]);
}
