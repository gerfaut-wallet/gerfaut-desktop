// The app lock: what stands between an unlocked computer and the
// wallets.
//
// The vault is encrypted whatever happens; the lock is the curtain in
// front of it. The secret never leaves the core, which hashes it and
// slows repeated guesses down; this store holds only whether the lock
// screen is showing and when it should show again.

import { useEffect } from "react";
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
  /** The vault has been read once, so a lock present has already put
      the screen up. */
  seen: boolean;
  /** When the user last did something, so the idle clock starts from
      the unlock and not from whenever the app was mounted. */
  lastActive: number;
  touch: () => void;
  /** Takes the lock from the settings the vault just handed over.
      The vault is the single source of truth here; this store only
      knows whether the screen is up right now. The first read with a
      lock in it locks — a later one never does, so turning a lock on
      does not shut the user out of the screen they are standing on. */
  syncFromSettings: (lock: AppLock | null) => void;
  unlock: (secret: string) => Promise<LockVerdict>;
  lockNow: () => void;
}

export const useLock = create<LockState>((set, get) => ({
  lock: null,
  locked: false,
  seen: false,
  lastActive: Date.now(),

  touch: () => set({ lastActive: Date.now() }),

  syncFromSettings: (lock) => {
    const first = !get().seen;
    set({ lock, seen: true, locked: first ? lock !== null : get().locked });
  },

  unlock: async (secret) => {
    const verdict = await ipc.verifyAppLock(secret);
    // The idle clock restarts here: typing a secret on the lock screen
    // is not activity the auto-lock ever saw.
    if (verdict.unlocked) set({ locked: false, lastActive: Date.now() });
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

  useEffect(() => {
    if (lock === null || locked) return;
    const autoLockSecs = lock.auto_lock_secs;

    const touch = () => useLock.getState().touch();
    const check = () => {
      const away = (Date.now() - useLock.getState().lastActive) / 1000;
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
