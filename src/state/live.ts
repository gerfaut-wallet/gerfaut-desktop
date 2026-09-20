// The live watch, seen from the window.
//
// The watch itself runs on the Rust side: it holds the connection,
// syncs the wallet that moved and posts the notification, whether this
// window is in front, minimised or locked. What reaches this side is a
// nudge: "this wallet was synced, read it again", and "the status
// moved, ask for it". Neither carries an amount, a name or a server,
// and behind the lock the first is not sent at all.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { ipc } from "../lib/ipc";
import type { BackendConfig, Network, WatchStatus } from "../lib/ipc";
import { useInvalidateWallet } from "./queries";
import { useUi } from "./store";

export const LIVE_WALLET_SYNCED = "live://wallet-synced";
export const LIVE_SYNC_FAILED = "live://sync-failed";
export const LIVE_STATUS = "live://status";

export const liveStatusKey = ["live-status"] as const;

function walletIdOf(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const id = (payload as { wallet_id?: unknown }).wallet_id;
  return typeof id === "string" ? id : null;
}

/** Reads again what the watch changed, the moment it says so: the
    wallet list, the wallet's Overview, its transactions and the rest.
    On while the app is unlocked. */
export function useLiveEvents(enabled: boolean): void {
  const invalidate = useInvalidateWallet();
  const client = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const stops: (() => void)[] = [];
    // A listener that cannot be removed, because the bridge is already
    // gone, is a listener nobody will call.
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
    on(LIVE_WALLET_SYNCED, (payload) => {
      const id = walletIdOf(payload);
      if (id === null) return;
      useUi.getState().setSyncError(id, null);
      invalidate(id);
    });
    on(LIVE_SYNC_FAILED, (payload) => {
      const id = walletIdOf(payload);
      const message = (payload as { message?: unknown } | null)?.message;
      if (id === null || typeof message !== "string") return;
      useUi.getState().setSyncError(id, message);
    });
    on(LIVE_STATUS, () => void client.invalidateQueries({ queryKey: liveStatusKey }));
    return () => {
      live = false;
      for (const stop of stops) quietly(stop);
    };
    // `invalidate` is a fresh closure on every render over a stable
    // client: listing it would tear the listeners down on every toast.
  }, [enabled, client]);
}

/** Where the watch stands, for Settings › Notifications. Refreshed by
    the status event; the slow refetch covers an event that was missed
    while the window slept. */
export function useLiveStatus() {
  return useQuery({
    queryKey: liveStatusKey,
    queryFn: ipc.liveStatus,
    refetchInterval: 30_000,
  });
}

const TRANSPORT: Record<NonNullable<WatchStatus["transport"]>, string> = {
  electrum: "Electrum",
  mempool_websocket: "mempool WebSocket",
  esplora_polling: "Esplora",
};

/** The status line: a state, how changes arrive, and the host. */
export function liveStatusLine(status: WatchStatus): string {
  const parts = (head: string) =>
    [head, status.transport ? TRANSPORT[status.transport] : null, status.server]
      .filter((part): part is string => part !== null && part !== "")
      .join(" · ");
  switch (status.state) {
    case "connected":
      return parts("Connected");
    case "polling":
      return ["Polling every minute", status.server]
        .filter((part): part is string => part !== null && part !== "")
        .join(" · ");
    case "connecting":
      return parts("Connecting…");
    case "reconnecting":
      return parts("Reconnecting…");
    default:
      return "Off";
  }
}

/** Whether the live connection goes to a server the person did not
    name: with the automatic public backend the core tries first an
    Electrum server run by an operator already in the rotation, because
    Electrum is what pushes. */
export function usesAutomaticBackend(
  backends: Partial<Record<Network, BackendConfig>>,
  network: Network,
): boolean {
  const backend = backends[network];
  return backend === undefined || (backend.type === "public_esplora" && !backend.server);
}
