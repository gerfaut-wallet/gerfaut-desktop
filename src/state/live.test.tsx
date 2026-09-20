import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WatchStatus } from "../lib/ipc";
import {
  LIVE_STATUS,
  LIVE_SYNC_FAILED,
  LIVE_WALLET_SYNCED,
  liveStatusLine,
  useLiveEvents,
  useLiveStatus,
  usesAutomaticBackend,
} from "./live";
import { keys } from "./queries";
import { useUi } from "./store";

const OFF: WatchStatus = {
  state: "off",
  transport: null,
  server: null,
  detail: null,
  watched_scripts: 0,
  pushed_scripts: 0,
};

describe("the status line", () => {
  it("says the state, how changes arrive, and the host", () => {
    expect(
      liveStatusLine({ ...OFF, state: "connected", transport: "electrum", server: "node.example" }),
    ).toBe("Connected · Electrum · node.example");
    expect(
      liveStatusLine({
        ...OFF,
        state: "connected",
        transport: "mempool_websocket",
        server: "mempool.space",
      }),
    ).toBe("Connected · mempool WebSocket · mempool.space");
    expect(
      liveStatusLine({
        ...OFF,
        state: "polling",
        transport: "esplora_polling",
        server: "blockstream.info",
      }),
    ).toBe("Polling every minute · blockstream.info");
    expect(liveStatusLine({ ...OFF, state: "reconnecting" })).toBe("Reconnecting…");
    expect(
      liveStatusLine({ ...OFF, state: "connecting", transport: "electrum", server: "a.onion" }),
    ).toBe("Connecting… · Electrum · a.onion");
    expect(liveStatusLine(OFF)).toBe("Off");
  });

  it("knows when the person named no server", () => {
    expect(usesAutomaticBackend({}, "mainnet")).toBe(true);
    expect(usesAutomaticBackend({ signet: { type: "public_esplora" } }, "signet")).toBe(true);
    expect(
      usesAutomaticBackend({ mainnet: { type: "public_esplora", server: "mempool" } }, "mainnet"),
    ).toBe(false);
    expect(
      usesAutomaticBackend({ mainnet: { type: "custom_electrum", url: "ssl://n:50002" } }, "mainnet"),
    ).toBe(false);
  });
});

/** Counts how often each query is read, the way the window would. */
function Probe({ enabled }: { enabled: boolean }) {
  useLiveEvents(enabled);
  const status = useLiveStatus();
  return <p>{status.data ? liveStatusLine(status.data.status) : "…"}</p>;
}

describe("the events of the watch", () => {
  let statusReads = 0;
  let status: WatchStatus = OFF;

  beforeEach(() => {
    statusReads = 0;
    status = OFF;
    useUi.setState({ syncErrors: {} });
    mockIPC(
      (cmd) => {
        if (cmd === "live_status") {
          statusReads += 1;
          return { enabled: true, status };
        }
        throw new Error(`unexpected command ${cmd}`);
      },
      { shouldMockEvents: true },
    );
  });
  afterEach(() => clearMocks());

  function mount(enabled = true) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(keys.snapshot("w1"), { marker: "w1" });
    client.setQueryData(keys.snapshot("w2"), { marker: "w2" });
    client.setQueryData(keys.wallets("signet"), []);
    render(
      <QueryClientProvider client={client}>
        <Probe enabled={enabled} />
      </QueryClientProvider>,
    );
    return client;
  }

  const stale = (client: QueryClient, key: readonly unknown[]) =>
    client.getQueryState(key)?.isInvalidated === true;

  it("reads a wallet again the moment the watch has synced it, and only that one", async () => {
    const client = mount();
    expect(await screen.findByText("Off")).toBeInTheDocument();
    // Listening is asynchronous: give the three listeners a turn.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    await act(() => emit(LIVE_WALLET_SYNCED, { wallet_id: "w1" }));
    await waitFor(() => expect(stale(client, keys.snapshot("w1"))).toBe(true));
    expect(stale(client, keys.wallets("signet"))).toBe(true);
    expect(stale(client, keys.snapshot("w2"))).toBe(false);
  });

  it("asks for the status again when it moves", async () => {
    mount();
    expect(await screen.findByText("Off")).toBeInTheDocument();
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    const before = statusReads;

    status = { ...OFF, state: "connected", transport: "electrum", server: "node.example" };
    await act(() => emit(LIVE_STATUS, null));
    expect(await screen.findByText("Connected · Electrum · node.example")).toBeInTheDocument();
    expect(statusReads).toBeGreaterThan(before);
  });

  it("shows a sync the watch could not make, and clears it at the next good one", async () => {
    mount();
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    await act(() => emit(LIVE_SYNC_FAILED, { wallet_id: "w1", message: "timed out" }));
    await waitFor(() => expect(useUi.getState().syncErrors.w1).toBe("timed out"));
    await act(() => emit(LIVE_WALLET_SYNCED, { wallet_id: "w1" }));
    await waitFor(() => expect(useUi.getState().syncErrors.w1 ?? null).toBeNull());
  });

  it("ignores a payload that is not what the Rust side sends", async () => {
    const client = mount();
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    await act(() => emit(LIVE_WALLET_SYNCED, { wallet_id: 7 }));
    await act(() => emit(LIVE_WALLET_SYNCED, "w1"));
    await act(() => emit(LIVE_SYNC_FAILED, { wallet_id: "w1", message: { html: "<b>" } }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(stale(client, keys.snapshot("w1"))).toBe(false);
    expect(useUi.getState().syncErrors.w1 ?? null).toBeNull();
  });

  it("listens to nothing while disabled, which is while the app is locked", async () => {
    const client = mount(false);
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    await act(() => emit(LIVE_WALLET_SYNCED, { wallet_id: "w1" }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(stale(client, keys.snapshot("w1"))).toBe(false);
  });
});
