import { describe, expect, it } from "vitest";
import { failureOf, syncStep, walletSyncOf } from "./syncState";
import type { SyncSlice, SyncStep } from "./syncState";

const EMPTY: SyncSlice = { syncErrors: {}, syncTurns: {}, syncingAll: null };

function run(...steps: SyncStep[]): SyncSlice {
  return steps.reduce(syncStep, EMPTY);
}

describe("the sync state of a wallet", () => {
  it("is syncing from the start of a sync this window runs, then where it ended", () => {
    const started = run({ type: "started", walletId: "a", ticket: 1 });
    expect(walletSyncOf(started, "a")).toEqual({ state: "syncing", failure: null });
    expect(walletSyncOf(started, "b")).toEqual({ state: "idle" });
    const failed = syncStep(started, { type: "finished", walletId: "a", ticket: 1, failure: "timed out" });
    expect(walletSyncOf(failed, "a")).toEqual({ state: "failed", message: "timed out" });
  });

  it("keeps the last failure said while a new sync runs, and drops it on a good one", () => {
    const again = run(
      { type: "started", walletId: "a", ticket: 1 },
      { type: "finished", walletId: "a", ticket: 1, failure: "timed out" },
      { type: "started", walletId: "a", ticket: 2 },
    );
    const status = walletSyncOf(again, "a");
    expect(status).toEqual({ state: "syncing", failure: "timed out" });
    expect(failureOf(status)).toBe("timed out");
    const good = syncStep(again, { type: "finished", walletId: "a", ticket: 2, failure: null });
    expect(walletSyncOf(good, "a")).toEqual({ state: "idle" });
  });

  it("drops the answer of a sync the core said more of", () => {
    const told = run(
      { type: "started", walletId: "a", ticket: 1 },
      { type: "told", walletId: "a", ticket: 2, state: { state: "syncing" } },
      { type: "told", walletId: "a", ticket: 3, state: { state: "failed", message: "refused", kind: "sync", at: 1 } },
      // The window's own answer comes after the core's last word.
      { type: "finished", walletId: "a", ticket: 1, failure: null },
    );
    expect(walletSyncOf(told, "a")).toEqual({ state: "failed", message: "refused" });
  });

  it("drops the answer of a sync started again since", () => {
    const again = run(
      { type: "started", walletId: "a", ticket: 1 },
      { type: "started", walletId: "a", ticket: 2 },
      { type: "finished", walletId: "a", ticket: 1, failure: "stale" },
    );
    expect(walletSyncOf(again, "a")).toEqual({ state: "syncing", failure: null });
  });

  it("says a false proof in the app's words, as for a failed call", () => {
    const told = run({
      type: "told",
      walletId: "a",
      ticket: 1,
      state: { state: "failed", message: "the server sent a false proof", kind: "false_proof", at: 1 },
    });
    expect(failureOf(walletSyncOf(told, "a"))).not.toBe("the server sent a false proof");
  });

  it("takes the core's list only where nothing newer was said", () => {
    const listed = run(
      { type: "told", walletId: "a", ticket: 5, state: { state: "syncing" } },
      {
        type: "listed",
        ticket: 4,
        states: {
          a: { state: "idle" },
          b: { state: "failed", message: "kept from before", kind: "sync", at: 1 },
        },
      },
    );
    expect(walletSyncOf(listed, "a")).toEqual({ state: "syncing", failure: null });
    expect(walletSyncOf(listed, "b")).toEqual({ state: "failed", message: "kept from before" });
  });

  it("takes a sync of every wallet wallet by wallet, except where the core said more", () => {
    const all = run(
      { type: "allStarted", ticket: 1 },
      { type: "told", walletId: "b", ticket: 2, state: { state: "syncing" } },
      { type: "told", walletId: "b", ticket: 3, state: { state: "idle" } },
      { type: "allFinished", ticket: 1, outcomes: { a: "timed out", b: "stale" } },
    );
    expect(all.syncingAll).toBeNull();
    expect(walletSyncOf(all, "a")).toEqual({ state: "failed", message: "timed out" });
    expect(walletSyncOf(all, "b")).toEqual({ state: "idle" });
  });

  it("ends a sync of every wallet only with its own answer", () => {
    const two = run({ type: "allStarted", ticket: 1 }, { type: "allStarted", ticket: 2 });
    expect(syncStep(two, { type: "allFinished", ticket: 1, outcomes: {} }).syncingAll).toBe(2);
    expect(syncStep(two, { type: "allFinished", ticket: 2, outcomes: {} }).syncingAll).toBeNull();
  });
});
