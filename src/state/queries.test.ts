import { createElement } from "react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import { FALSE_PROOF } from "../lib/ipc";
import type { PriceQuote } from "../lib/ipc";
import { coreCase } from "../test/core";
import { useUi } from "./store";
import { liveAnswer, useSyncWallet } from "./queries";

const QUOTE: PriceQuote = {
  rate: 100_000,
  currency: "eur",
  source: "coingecko",
  at: 1_755_000_000,
};

/** A price display uses the last answer only while it still holds. */
describe("the price a display may use", () => {
  it("is the last answer, in the chosen currency", () => {
    expect(liveAnswer({ isError: false, data: QUOTE, fetchStatus: "idle" }, "eur")).toBe(QUOTE);
  });

  it("is none before the first answer", () => {
    expect(liveAnswer({ isError: false, data: undefined, fetchStatus: "fetching" }, "eur")).toBeNull();
  });

  /** The cache keeps the answer before a failed refresh: it is an hour
      old by the time anyone reads it, and says nothing of it. */
  it("is none once the last request failed, whatever the cache holds", () => {
    expect(liveAnswer({ isError: true, data: QUOTE, fetchStatus: "idle" }, "eur")).toBeNull();
  });

  /** Held back offline, a refresh leaves the query a success with the
      answer before it: no fresher than a failed one. */
  it("is none while a refresh waits for the network", () => {
    expect(liveAnswer({ isError: false, data: QUOTE, fetchStatus: "paused" }, "eur")).toBeNull();
  });

  it("is none in another currency than the one chosen", () => {
    expect(liveAnswer({ isError: false, data: QUOTE, fetchStatus: "idle" }, "usd")).toBeNull();
  });
});

/** A sync the core gave up on for a server's false proof: the wallet
    says it in the app's words, not in the core's, which name a check a
    person cannot act on. */
describe("a sync refused for a false proof", () => {
  afterEach(() => clearMocks());

  it("is said in the app's words under the wallet", async () => {
    mockIPC((cmd) => {
      if (cmd === "sync_wallet") return Promise.reject(coreCase("CoreError", "false_proof"));
      throw new Error(`unexpected command ${cmd}`);
    });
    useUi.setState({ syncErrors: {} });
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);
    const { result } = renderHook(() => useSyncWallet(), { wrapper });

    result.current.mutate("w1");
    await waitFor(() => expect(useUi.getState().syncErrors.w1).toBe(FALSE_PROOF));
  });
});
