// Knowing that a newer Gerfaut exists, and saying so once.
//
// The core decides all of it and keeps it in the vault: when the app
// asks GitHub on its own (at most once a day, never within a day of the
// first session, and a day Tor is needed and cannot be had does not
// count), which release is worth announcing (never a pre-release) and
// which one the user closed. This store holds what the core said last,
// and tells it when the window is unlocked and when the user answers.
//
// The check asks GitHub for the latest release of this repository and
// nothing else: no identifier goes with it, but GitHub sees the address
// it comes from. It takes the route the syncs take: with an onion
// backend the core sends it through Tor, and when Tor cannot be had it
// sends nothing and says so. The button in Settings › About goes the
// same way.
//
// No address the network answers is ever opened: the only page this
// app opens is `RELEASES_URL`, written here. Behind the lock nothing
// here runs, and the commands refuse.

import { useEffect } from "react";
import { create } from "zustand";
import { ipc, type UpdateStatus } from "../lib/ipc";
import { useLock } from "./lock";

/** Where a release is downloaded from. The one address the update
    notice and the About card ever open. */
export const RELEASES_URL = "https://github.com/gerfaut-wallet/gerfaut-desktop/releases/latest";

/** How often an open window tells the core it is still open, so that
    a day gone by brings the next check. */
const TICK_MS = 60 * 60 * 1000;

interface UpdateState {
  /** What the core said last; null until it has said anything. */
  status: UpdateStatus | null;
  /** The notice sent the user to About: the card takes the focus. */
  arriving: boolean;
  /** A session the window opened is on its way to the core. */
  checking: boolean;

  /** Reads what the core says, asking GitHub nothing. A core that does
      not answer, or answers from behind the lock, leaves everything as
      it was. */
  load: () => Promise<void>;
  /** The window is unlocked: the core checks if a check is due, and
      says what to announce. Never throws. */
  session: () => Promise<void>;
  /** Takes what the button's check answered. */
  record: (status: UpdateStatus) => void;
  setAuto: (auto: boolean) => void;
  /** Closes the notice on the release it announces. */
  dismiss: () => void;
  setArriving: (arriving: boolean) => void;
}

export const useUpdate = create<UpdateState>((set, get) => ({
  status: null,
  arriving: false,
  checking: false,

  load: async () => {
    try {
      const status = await ipc.updateStatus();
      if (!useLock.getState().locked) set({ status });
    } catch {
      // Nothing read, nothing known: no notice.
    }
  },

  session: async () => {
    if (get().checking) return;
    // A lock that fell meanwhile ends it here, with nothing sent.
    if (useLock.getState().locked) return;
    set({ checking: true });
    try {
      const status = await ipc.updateSession();
      if (!useLock.getState().locked) set({ status });
    } catch {
      // Locked meanwhile, or a core that did not answer: nothing to say.
    } finally {
      set({ checking: false });
    }
  },

  record: (status) => set({ status }),

  setAuto: (auto) => {
    const { status } = get();
    if (status) set({ status: { ...status, automatic: auto } });
    void ipc
      .setUpdateAutomatic(auto)
      .then(() => (auto ? get().session() : get().load()))
      .catch(() => get().load());
  },

  dismiss: () => {
    const { status } = get();
    const version = status?.announce;
    if (!status || !version) return;
    set({ status: { ...status, announce: null } });
    // What the core kept is the truth: a vault that could not write it
    // brings the notice back.
    void ipc
      .dismissUpdate(version)
      .catch(() => {})
      .then(() => get().load());
  },

  setArriving: (arriving) => set({ arriving }),
}));

/** Opens a session while `enabled`, which is while the app is unlocked:
    once as it becomes true, so at every unlock, then every hour an open
    window stays open. A release already known shows at once, before
    any check is answered. */
export function useUpdateCheck(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const run = () => {
      if (live) void useUpdate.getState().session();
    };
    void useUpdate.getState().load().then(run);
    const timer = setInterval(run, TICK_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [enabled]);
}
