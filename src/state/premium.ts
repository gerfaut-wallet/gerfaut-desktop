// The watch's own pulse: whether the server's heartbeat is still
// reaching this app.
//
// Rust fetches and verifies the heartbeat; this store only counts. One
// failure says nothing: a laptop wakes, a router blinks. Two in a row
// is an outage, dated from the first, and the banner on the Overview
// says so until someone acknowledges it or the heartbeat comes back.

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import { ipc } from "../lib/ipc";
import { TIMING } from "../lib/premium";
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
