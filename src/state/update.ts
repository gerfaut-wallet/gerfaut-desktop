// Knowing that a newer Gerfaut exists, and saying so once.
//
// The check asks GitHub for the latest release of this repository and
// nothing else: no identifier goes with it, but GitHub sees the address
// it comes from. So it runs on its own at most once a day, only while
// the app is unlocked, and a setting turns it off. It takes the route
// the syncs take: with an onion backend the core sends it through Tor,
// and when Tor cannot be had it sends nothing and answers `tor`. The
// button in Settings › About goes the same way.
//
// What the network answers is read as a version or dropped. It is never
// shown as it came, and no address it carries is ever opened: the only
// page this app opens is `RELEASES_URL`, written here.
//
// Everything is kept in the vault's preferences like the rest, so
// behind the lock none of it is readable and nothing here runs.

import { useEffect } from "react";
import { create } from "zustand";
import { ipc, isCommandError } from "../lib/ipc";
import { useLock } from "./lock";
import { compareVersions, isUpdate, normalizeVersion, parseVersion } from "../lib/version";

/** Where a release is downloaded from. The one address the update
    notice and the About card ever open. */
export const RELEASES_URL = "https://github.com/gerfaut-wallet/gerfaut-desktop/releases/latest";

/** Seconds between two checks the app makes on its own. */
export const CHECK_EVERY = 24 * 60 * 60;

/** How often an open window looks at whether a day has gone by. */
const TICK_MS = 60 * 60 * 1000;

interface UpdateState {
  /** The preferences below were read from the unlocked vault. */
  ready: boolean;
  /** Check on its own; on unless turned off. */
  auto: boolean;
  /** The latest release known, normalized; null when none is. */
  latest: string | null;
  /** The version the notice was last closed on. */
  dismissed: string | null;
  /** Unix seconds of the last check the app made on its own. */
  checkedAt: number;
  /** The notice sent the user to About: the card takes the focus. */
  arriving: boolean;
  /** A check the app started on its own is on its way. */
  checking: boolean;
  /** The last check needed Tor and Tor could not be had: nothing was
      sent. Said in a line on the About card, nowhere else. */
  torUnavailable: boolean;

  hydrate: (prefs: Record<string, string>) => void;
  /** Reads the preferences from the vault itself. The cached settings
      will not do: right after an unlock they are still the ones cut
      down for the lock screen, and a refetch that answers the same
      thing never says it landed. A vault that does not answer, or
      answers from behind the lock, leaves everything as it was, so a
      check turned off is never read as left on. */
  load: () => Promise<void>;
  setAuto: (auto: boolean) => void;
  /** Takes the tag a check answered. `seen` when the user is looking
      at the answer already, so the notice has nothing left to say. */
  record: (tag: unknown, options?: { seen?: boolean }) => void;
  /** Closes the notice for this version. */
  dismiss: () => void;
  setArriving: (arriving: boolean) => void;
  setTorUnavailable: (torUnavailable: boolean) => void;
  /** Checks if the rules above allow it. Never throws. */
  checkIfDue: () => Promise<void>;
}

function persist(key: string, value: string) {
  void ipc.setAppPref(key, value).catch(() => {});
}

export const useUpdate = create<UpdateState>((set, get) => ({
  ready: false,
  auto: true,
  latest: null,
  dismissed: null,
  checkedAt: 0,
  arriving: false,
  checking: false,
  torUnavailable: false,

  hydrate: (prefs) => {
    const checkedAt = Number(prefs["update.checked_at"]);
    set({
      ready: true,
      auto: prefs["update.auto"] !== "0",
      latest: normalizeVersion(prefs["update.latest"]),
      dismissed: normalizeVersion(prefs["update.dismissed"]),
      checkedAt: Number.isSafeInteger(checkedAt) && checkedAt > 0 ? checkedAt : 0,
    });
  },

  load: async () => {
    try {
      const settings = await ipc.getSettings();
      if (useLock.getState().locked) return;
      get().hydrate(settings.app_prefs);
    } catch {
      // Nothing read, nothing known: no check, no notice.
    }
  },

  setAuto: (auto) => {
    set({ auto });
    persist("update.auto", auto ? "1" : "0");
    if (auto) void get().checkIfDue();
  },

  record: (tag, options) => {
    const latest = normalizeVersion(tag);
    if (latest === null) return;
    if (latest !== get().latest) {
      set({ latest });
      persist("update.latest", latest);
    }
    if (options?.seen) get().dismiss();
  },

  dismiss: () => {
    const { latest, dismissed } = get();
    if (latest === null || latest === dismissed) return;
    set({ dismissed: latest });
    persist("update.dismissed", latest);
  },

  setArriving: (arriving) => set({ arriving }),
  setTorUnavailable: (torUnavailable) => set({ torUnavailable }),

  checkIfDue: async () => {
    const { ready, auto, checkedAt, checking } = get();
    if (!ready || !auto || checking) return;
    const now = Math.floor(Date.now() / 1000);
    // A stamp from the future is a clock that moved, not a recent check.
    if (checkedAt <= now && now - checkedAt < CHECK_EVERY) return;
    set({ checking: true });
    try {
      // A lock that fell meanwhile ends it here, with nothing sent.
      if (useLock.getState().locked) return;
      // Stamped before the answer: offline or refused, it still counts,
      // so "at most once a day" holds whatever the network does.
      set({ checkedAt: now });
      persist("update.checked_at", String(now));
      const answer = await ipc.checkUpdate();
      set({ torUnavailable: false });
      get().record(answer?.latest);
    } catch (error) {
      // Offline, rate limited, no release yet: nothing to say. Tor
      // required and out of reach is the one case where no request
      // went out at all: the day is not spent, and About says why.
      if (isCommandError(error) && error.kind === "tor") {
        set({ torUnavailable: true, checkedAt });
        persist("update.checked_at", String(checkedAt));
      }
    } finally {
      set({ checking: false });
    }
  },
}));

/** The version the notice should announce to someone running
    `current`, or null. */
export function pendingUpdate(
  state: Pick<UpdateState, "ready" | "latest" | "dismissed">,
  current: string,
): string | null {
  const { ready, latest, dismissed } = state;
  if (!ready || latest === null || !isUpdate(latest, current)) return null;
  const next = parseVersion(latest);
  const closed = parseVersion(dismissed);
  if (next && closed && compareVersions(next, closed) <= 0) return null;
  return latest;
}

/** Runs the daily check while `enabled`, which is while the app is
    unlocked: once as it becomes true, so at every unlock, then whenever
    an open window has seen a day go by. */
export function useUpdateCheck(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const run = () => {
      if (live) void useUpdate.getState().checkIfDue();
    };
    void useUpdate.getState().load().then(run);
    const timer = setInterval(run, TICK_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [enabled]);
}
