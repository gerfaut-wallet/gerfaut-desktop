import { describe, expect, it } from "vitest";
import type { RecentBroadcast, TxPreview } from "../lib/ipc";
import { FIRST_FLOW, stepBroadcast } from "./broadcast";
import type { BroadcastEvent, BroadcastFlow } from "./broadcast";

const PREVIEW = { txid: "ab".repeat(32), hex: "0200" } as TxPreview;
const ENTRY: RecentBroadcast = {
  txid: PREVIEW.txid,
  network: "signet",
  hex: "0200",
  backend: "mempool.space",
  at: 1_755_000_000,
};

const run = (...events: BroadcastEvent[]): BroadcastFlow =>
  events.reduce(stepBroadcast, FIRST_FLOW);

describe("stepBroadcast", () => {
  it("follows a transaction from the field to the network", () => {
    const flow = run(
      { type: "preview", ticket: 1 },
      { type: "previewed", ticket: 1, preview: PREVIEW },
      { type: "send", ticket: 2 },
      { type: "sent", ticket: 2, entry: ENTRY },
    );
    expect(flow).toEqual({ phase: "sent", ticket: 2, preview: PREVIEW, entry: ENTRY });
  });

  it("drops the answer of a send the page left", () => {
    const flow = run(
      { type: "preview", ticket: 1 },
      { type: "previewed", ticket: 1, preview: PREVIEW },
      { type: "send", ticket: 2 },
      { type: "reset", ticket: 3 },
      { type: "preview", ticket: 4 },
      { type: "sent", ticket: 2, entry: ENTRY },
    );
    expect(flow).toEqual({ phase: "previewing", ticket: 4 });
  });

  it("drops a preview read for an input the page no longer holds", () => {
    const flow = run(
      { type: "preview", ticket: 1 },
      { type: "fileRefused", ticket: 2, message: "too large" },
      { type: "previewed", ticket: 1, preview: PREVIEW },
    );
    expect(flow).toEqual({
      phase: "compose",
      ticket: 2,
      refusal: { kind: "file", message: "too large" },
    });
  });

  it("keeps the preview under a refused send, and clears the refusal on the next", () => {
    const refused = run(
      { type: "preview", ticket: 1 },
      { type: "previewed", ticket: 1, preview: PREVIEW },
      { type: "send", ticket: 2 },
      { type: "sendFailed", ticket: 2, error: "no" },
    );
    expect(refused).toEqual({ phase: "ready", ticket: 2, preview: PREVIEW, refusal: "no" });
    expect(stepBroadcast(refused, { type: "send", ticket: 3 })).toEqual({
      phase: "sending",
      ticket: 3,
      preview: PREVIEW,
    });
  });
});
