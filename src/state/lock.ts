// The app lock: what stands between an unlocked computer and the
// wallets.
//
// The vault is encrypted whatever happens; the lock is the curtain in
// front of it. The secret never leaves the core, which hashes it and
// slows repeated guesses down; this store holds only whether the lock
// screen is showing.
//
// Gerfaut asks for the secret when it opens and stays open until the
// window is closed. There is no delay to pick and no idle clock: a
// lock that fires while its owner reads a transaction teaches them to
// turn it off. Ctrl+L is how someone leaving the desk draws the
// curtain again.

import { useEffect } from "react";
import { create } from "zustand";
import type { AppLock, LockVerdict } from "../lib/ipc";
import { ipc } from "../lib/ipc";

interface LockState {
  /** The lock the vault holds, without its hash; null when none. */
  lock: AppLock | null;
  /** The lock screen is showing and nothing else is in the tree. */
  locked: boolean;
  /** The vault has been read once, so a lock present has already put
      the screen up. Nothing of a wallet may render before this. */
  seen: boolean;
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

  syncFromSettings: (lock) => {
    const first = !get().seen;
    set({ lock, seen: true, locked: first ? lock !== null : get().locked });
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

/** Ctrl+L: the only way back to the lock screen short of closing the
    window. Bound while a lock exists and the app is open — on the lock
    screen itself the shortcut has nothing left to do. */
export function useLockShortcut(): void {
  const lock = useLock((state) => state.lock);
  const locked = useLock((state) => state.locked);

  useEffect(() => {
    if (lock === null || locked) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        useLock.getState().lockNow();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lock, locked]);
}
