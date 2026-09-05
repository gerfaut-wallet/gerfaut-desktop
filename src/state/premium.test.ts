import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { TIMING } from "../lib/premium";
import { QUIET, afterFailure, afterSuccess, usePremiumWatch, usePulse } from "./premium";

describe("counting heartbeats", () => {
  it("lets one failure pass and calls the second an outage, dated from the first", () => {
    const one = afterFailure(QUIET, 1_000);
    expect(one).toEqual({ failures: 1, firstFailureAt: 1_000, offlineSince: null });
    const two = afterFailure(one, 1_900);
    expect(two).toEqual({ failures: 2, firstFailureAt: 1_000, offlineSince: 1_000 });
    // The outage keeps its start however long it goes on.
    expect(afterFailure(two, 2_800).offlineSince).toBe(1_000);
  });

  it("forgets everything once a heartbeat verifies", () => {
    expect(afterSuccess()).toEqual(QUIET);
    expect(afterFailure(afterSuccess(), 5).offlineSince).toBe(null);
  });
});

describe("the watch", () => {
  const original = TIMING.heartbeatMs;
  afterEach(() => {
    TIMING.heartbeatMs = original;
    usePulse.getState().reset();
  });

  function Watch({ enabled }: { enabled: boolean }) {
    usePremiumWatch(enabled);
    return null;
  }

  function renderWatch(enabled: boolean) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      createElement(QueryClientProvider, { client }, createElement(Watch, { enabled })),
    );
  }

  it("asks the server at once and on its rhythm, and turns two refusals into an outage", async () => {
    TIMING.heartbeatMs = 20;
    let answer: "ok" | "down" = "down";
    let asked = 0;
    mockIPC((cmd) => {
      if (cmd !== "premium_heartbeat") throw new Error(`unexpected command ${cmd}`);
      asked += 1;
      if (answer === "down")
        return Promise.reject({ kind: "premium_unreachable", message: "timed out" }) as never;
      return { heartbeat: { now: 1, tip_height: 1 }, payload: "", signature: "", public_key: "" };
    });
    const view = renderWatch(true);
    await waitFor(() => expect(usePulse.getState().offlineSince).not.toBe(null));
    expect(asked).toBeGreaterThanOrEqual(2);
    // The server is back: the outage is over, whatever was counted.
    answer = "ok";
    await waitFor(() => expect(usePulse.getState().offlineSince).toBe(null));
    expect(usePulse.getState().failures).toBe(0);
    view.unmount();
  });

  it("stays quiet with nothing to watch", () => {
    let asked = 0;
    mockIPC(() => {
      asked += 1;
      return undefined;
    });
    usePulse.setState(afterFailure(afterFailure(QUIET, 1), 2));
    renderWatch(false);
    expect(asked).toBe(0);
    expect(usePulse.getState()).toMatchObject(QUIET);
  });
});
