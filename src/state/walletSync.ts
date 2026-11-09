// Where the sync of each wallet stands, seen from the window.
//
// The core keeps the truth: it says when any sync of a wallet starts
// and where the wallet stands once it ends, whoever asked for it (this
// window, a rescan, a sync of every wallet, the live watch), and it
// keeps a failure until a sync succeeds, across restarts. This window
// also knows the syncs it starts itself, a moment before the core says
// so, and the answers they bring.
//
// Every word, the core's and the window's own, goes through one
// function, `syncStep` (lib/syncState.ts), the only writer of the
// three fields of the store it reads (`SyncSlice`). Each
// word carries a ticket from one counter: the core's take a fresh one,
// a sync this window starts takes one when it starts. A wallet keeps
// the ticket of the last word it took, and the answer of a request is
// dropped when the wallet has heard something newer since it was sent:
// a sync the core said more about, a sync started again.

import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo } from "react";
import { ipc } from "../lib/ipc";
import type { WalletSyncState as CoreSyncState } from "../lib/ipc";
import { statusOf, syncTicket, walletSyncOf } from "../lib/syncState";
import type { WalletSyncStatus } from "../lib/syncState";
import { useUi } from "./store";

export const SYNC_STATE = "sync://state";

/** Where the sync of one wallet stands. */
export function useWalletSync(walletId: string): WalletSyncStatus {
  const running = useUi((state) => state.syncTurns[walletId]?.running ?? false);
  const failure = useUi((state) => state.syncErrors[walletId] ?? null);
  return useMemo(() => statusOf(running, failure), [running, failure]);
}

/** Where the sync of each wallet stands, for a list of wallets. */
export function useWalletSyncOf(): (walletId: string) => WalletSyncStatus {
  const syncTurns = useUi((state) => state.syncTurns);
  const syncErrors = useUi((state) => state.syncErrors);
  return useCallback(
    (walletId: string) => walletSyncOf({ syncTurns, syncErrors }, walletId),
    [syncTurns, syncErrors],
  );
}

/** Whether a sync runs among `walletIds`, the wallets of the network
    in use, from anywhere, or this window's sync of every wallet. For
    the sidebar's sync button, which syncs that network. */
export function useSyncingAny(walletIds: readonly string[]): boolean {
  return useUi(
    (state) =>
      state.syncingAll !== null || walletIds.some((id) => state.syncTurns[id]?.running === true),
  );
}

function readWalletSync(payload: unknown): { walletId: string; state: CoreSyncState } | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { wallet_id, state, message, kind, at } = payload as Record<string, unknown>;
  if (typeof wallet_id !== "string") return null;
  switch (state) {
    case "idle":
    case "syncing":
      return { walletId: wallet_id, state: { state } };
    case "failed":
      if (typeof message !== "string" || typeof at !== "number") return null;
      return {
        walletId: wallet_id,
        state: {
          state,
          message,
          kind: kind as Extract<CoreSyncState, { state: "failed" }>["kind"],
          at,
        },
      };
    default:
      return null;
  }
}

/** Takes what the core says of a wallet's sync, now. */
function tellSync(walletId: string, state: CoreSyncState): void {
  useUi.getState().stepSync({ type: "told", walletId, ticket: syncTicket(), state });
}

/** Takes what the live watch said of a sync it ran: see the `heard`
    step. */
export function hearSync(walletId: string, failure: string | null): void {
  useUi.getState().stepSync({ type: "heard", walletId, failure });
}

/** Listens to where the syncs stand, and reads the whole list once the
    listener is in place, so nothing said before is missed: a failure
    kept from an earlier run, a sync the live watch started. On while
    the app is unlocked; behind the lock the core tells this window
    nothing, and the unlock reads the list again. */
export function useSyncEvents(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let stop: (() => void) | null = null;
    void listen(SYNC_STATE, ({ payload }) => {
      if (!live) return;
      const told = readWalletSync(payload);
      if (told) tellSync(told.walletId, told.state);
    })
      .then((unlisten) => {
        if (!live) {
          void Promise.resolve()
            .then(unlisten)
            .catch(() => {});
          return;
        }
        stop = unlisten;
        const ticket = syncTicket();
        return ipc.walletSyncStates().then((list) => {
          if (!live) return;
          const states = Object.fromEntries(
            list.flatMap((entry) => {
              const read = readWalletSync(entry);
              return read ? [[read.walletId, read.state] as const] : [];
            }),
          );
          useUi.getState().stepSync({ type: "listed", ticket, states });
        });
      })
      // No list, no listener: the syncs this window starts still say
      // where they stand.
      .catch(() => {});
    return () => {
      live = false;
      const unlisten = stop;
      if (unlisten) {
        void Promise.resolve()
          .then(unlisten)
          .catch(() => {});
      }
    };
  }, [enabled]);
}
