// The watch's own pulse: whether the server's heartbeat is still
// reaching this app.
//
// Rust fetches and verifies the heartbeat; this store only counts. One
// failure says nothing: a laptop wakes, a router blinks. Two in a row
// is an outage, dated from the first, and the banner on the Overview
// says so until someone acknowledges it or the heartbeat comes back.
//
// Beside it, the account's devices: a new one waiting for approval is
// the other thing the Overview says before anything else.

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import type { Device } from "../lib/ipc";
import { ipc } from "../lib/ipc";
import { TIMING } from "../lib/premium";
import { premiumKeys } from "./premiumQueries";
import { keys } from "./queries";

/** Failures in a row before the watch counts as offline. */
export const OFFLINE_AFTER = 2;

export interface Pulse {
  /** Heartbeats that failed in a row; zero after one that verified. */
  failures: number;
  /** Unix seconds of the first failure of the run in progress. */
  firstFailureAt: number | null;
  /** Unix seconds since when the watch counts as offline; null while it
      is reaching us. */
  offlineSince: number | null;
}

export const QUIET: Pulse = { failures: 0, firstFailureAt: null, offlineSince: null };

/** One more heartbeat that did not verify, at `at`. Pure. */
export function afterFailure(pulse: Pulse, at: number): Pulse {
  const failures = pulse.failures + 1;
  const firstFailureAt = pulse.firstFailureAt ?? at;
  return {
    failures,
    firstFailureAt,
    offlineSince: failures >= OFFLINE_AFTER ? (pulse.offlineSince ?? firstFailureAt) : null,
  };
}

/** A heartbeat that verified: whatever was counted is forgotten. */
export function afterSuccess(): Pulse {
  return QUIET;
}

interface PulseState extends Pulse {
  recordFailure: (at: number) => void;
  recordSuccess: () => void;
  reset: () => void;
}

export const usePulse = create<PulseState>((set, get) => ({
  ...QUIET,
  recordFailure: (at) => set(afterFailure(get(), at)),
  recordSuccess: () => set(afterSuccess()),
  reset: () => set(QUIET),
}));

/** Asks the server for its heartbeat now and every fifteen minutes
    while `enabled`: a key is set and a wallet was agreed to. The count
    lives in the store above; a heartbeat that verifies after an outage
    also refreshes the settings, since the core lifts the acknowledgement
    it may hold. Off, the pulse goes quiet: nothing to watch means
    nothing to report. */
export function usePremiumWatch(enabled: boolean): void {
  const client = useQueryClient();
  const clientRef = useRef(client);
  clientRef.current = client;

  useEffect(() => {
    if (!enabled) {
      usePulse.getState().reset();
      return;
    }
    let cancelled = false;
    const beat = async () => {
      const before = usePulse.getState();
      try {
        await ipc.premiumHeartbeat();
        if (cancelled) return;
        usePulse.getState().recordSuccess();
        if (before.failures > 0) {
          void clientRef.current.invalidateQueries({ queryKey: keys.settings });
        }
      } catch {
        if (cancelled) return;
        usePulse.getState().recordFailure(Math.floor(Date.now() / 1000));
      }
    };
    void beat();
    const timer = setInterval(() => void beat(), TIMING.heartbeatMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled]);
}

/** The Rust side has asked the server for the devices on its own, and
    this is what it answered. Sent only while the app is unlocked. */
export const PREMIUM_DEVICES = "premium://devices";
/** Something about this device's connection moved on the Rust side:
    the server disconnected it. Everything premium is read again. */
export const PREMIUM_CHANGED = "premium://changed";

/** Keeps the device list current while the app is open and unlocked.
    The Rust side asks the server every five minutes and hands the
    answer over here; the window coming back to the front asks again
    when what it holds is more than a minute old. Nothing here keeps
    time of its own. */
export function useDeviceWatch(enabled: boolean): void {
  const client = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const stops: (() => void)[] = [];
    const quietly = (stop: () => void) => {
      void Promise.resolve()
        .then(stop)
        .catch(() => {});
    };
    const on = (event: string, handler: (payload: unknown) => void) => {
      void listen(event, ({ payload }) => {
        if (live) handler(payload);
      })
        .then((stop) => {
          if (live) stops.push(stop);
          else quietly(stop);
        })
        .catch(() => {});
    };
    on(PREMIUM_DEVICES, (payload) => {
      if (Array.isArray(payload)) client.setQueryData<Device[]>(premiumKeys.devices, payload);
    });
    on(PREMIUM_CHANGED, () => {
      void client.invalidateQueries({ queryKey: ["premium"] });
      void client.invalidateQueries({ queryKey: keys.settings });
    });
    const stale = (key: readonly unknown[]) => {
      const updated = client.getQueryState(key)?.dataUpdatedAt ?? 0;
      return Date.now() - updated >= TIMING.devicesFocusMs;
    };
    const onFocus = () => {
      for (const key of [premiumKeys.device, premiumKeys.devices]) {
        if (stale(key)) void client.invalidateQueries({ queryKey: key, exact: true });
      }
    };
    window.addEventListener("focus", onFocus);
    return () => {
      live = false;
      window.removeEventListener("focus", onFocus);
      for (const stop of stops) quietly(stop);
    };
  }, [enabled, client]);
}
