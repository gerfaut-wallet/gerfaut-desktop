// The sync states of the wallets, as one value per wallet and one
// transition: see `state/walletSync.ts` for who says what.

import { failureMessage } from "./ipc";
import type { WalletSyncState as CoreSyncState } from "./ipc";

/** Where a wallet's sync stands for the screens. While a sync runs, the
    failure of the one before stays said where a screen says it. */
export type WalletSyncStatus =
  | { state: "idle" }
  | { state: "syncing"; failure: string | null }
  | { state: "failed"; message: string };

/** The fields of the store this module writes, and nothing else does. */
export interface SyncSlice {
  /** The words of the last failed sync of each wallet, until one
      succeeds; still there while it syncs again. */
  syncErrors: Record<string, string>;
  /** Per wallet, the ticket of the last word it took, and whether a
      sync of it runs. */
  syncTurns: Record<string, { ticket: number; running: boolean }>;
  /** The ticket of the sync of every wallet this window runs, if one
      runs. */
  syncingAll: number | null;
}

/** An outcome per wallet: null for a good sync, else what failed. */
export type SyncOutcomes = Record<string, string | null>;

export type SyncStep =
  /** This window starts a sync of a wallet. */
  | { type: "started"; walletId: string; ticket: number }
  /** That sync answered. */
  | { type: "finished"; walletId: string; ticket: number; failure: string | null }
  /** The core said where a wallet stands. */
  | { type: "told"; walletId: string; ticket: number; state: CoreSyncState }
  /** What the live watch said of a sync it ran: a failure, or null for
      a good one. It comes apart from the core's states, in no set order
      with them: taken only while no sync of the wallet runs, and it
      never says whether one does. */
  | { type: "heard"; walletId: string; failure: string | null }
  /** The core's list, asked for with this ticket. */
  | { type: "listed"; ticket: number; states: Record<string, CoreSyncState> }
  /** This window starts a sync of every wallet. */
  | { type: "allStarted"; ticket: number }
  /** That sync answered, wallet by wallet. */
  | { type: "allFinished"; ticket: number; outcomes: SyncOutcomes };

let lastTicket = 0;

/** A ticket newer than every one before. */
export function syncTicket(): number {
  lastTicket += 1;
  return lastTicket;
}

function withFailure(
  errors: Record<string, string>,
  walletId: string,
  failure: string | null,
): Record<string, string> {
  if (failure === null) {
    if (!(walletId in errors)) return errors;
    const rest = { ...errors };
    delete rest[walletId];
    return rest;
  }
  return errors[walletId] === failure ? errors : { ...errors, [walletId]: failure };
}

/** The words a screen shows for a failure the core keeps. */
function coreFailure(state: CoreSyncState): string | null {
  return state.state === "failed" ? failureMessage(state) : null;
}

/** Takes one word the core said of a wallet, at `ticket`. A wallet that
    has heard something newer keeps it. */
function tell(slice: SyncSlice, walletId: string, ticket: number, state: CoreSyncState): SyncSlice {
  if ((slice.syncTurns[walletId]?.ticket ?? 0) > ticket) return slice;
  const running = state.state === "syncing";
  return {
    ...slice,
    syncTurns: { ...slice.syncTurns, [walletId]: { ticket, running } },
    // A sync that starts leaves the failure before it said.
    syncErrors: running ? slice.syncErrors : withFailure(slice.syncErrors, walletId, coreFailure(state)),
  };
}

/** The one transition: where the syncs stand after `step`. */
export function syncStep(slice: SyncSlice, step: SyncStep): SyncSlice {
  switch (step.type) {
    case "started":
      return {
        ...slice,
        syncTurns: { ...slice.syncTurns, [step.walletId]: { ticket: step.ticket, running: true } },
      };
    case "finished": {
      // The core said more of this sync, or another one started.
      if (slice.syncTurns[step.walletId]?.ticket !== step.ticket) return slice;
      return {
        ...slice,
        syncTurns: {
          ...slice.syncTurns,
          [step.walletId]: { ticket: step.ticket, running: false },
        },
        syncErrors: withFailure(slice.syncErrors, step.walletId, step.failure),
      };
    }
    case "told":
      return tell(slice, step.walletId, step.ticket, step.state);
    case "heard":
      if (slice.syncTurns[step.walletId]?.running) return slice;
      return { ...slice, syncErrors: withFailure(slice.syncErrors, step.walletId, step.failure) };
    case "listed":
      return Object.entries(step.states).reduce(
        (next, [walletId, state]) => tell(next, walletId, step.ticket, state),
        slice,
      );
    case "allStarted":
      return { ...slice, syncingAll: step.ticket };
    case "allFinished": {
      let syncErrors = slice.syncErrors;
      for (const [walletId, failure] of Object.entries(step.outcomes)) {
        // A wallet the core has said more of since this sync started
        // keeps what it said.
        const turn = slice.syncTurns[walletId];
        if (turn && (turn.running || turn.ticket > step.ticket)) continue;
        syncErrors = withFailure(syncErrors, walletId, failure);
      }
      return {
        ...slice,
        syncErrors,
        syncingAll: slice.syncingAll === step.ticket ? null : slice.syncingAll,
      };
    }
  }
}

export function statusOf(running: boolean, failure: string | null): WalletSyncStatus {
  if (running) return { state: "syncing", failure };
  return failure === null ? { state: "idle" } : { state: "failed", message: failure };
}

/** Where the sync of a wallet stands, from the fields of the store. */
export function walletSyncOf(
  slice: Pick<SyncSlice, "syncTurns" | "syncErrors">,
  walletId: string,
): WalletSyncStatus {
  return statusOf(slice.syncTurns[walletId]?.running ?? false, slice.syncErrors[walletId] ?? null);
}

/** The failure a screen says for a wallet: the last one, also while a
    new sync runs. */
export function failureOf(status: WalletSyncStatus): string | null {
  switch (status.state) {
    case "idle":
      return null;
    case "syncing":
      return status.failure;
    case "failed":
      return status.message;
  }
}
