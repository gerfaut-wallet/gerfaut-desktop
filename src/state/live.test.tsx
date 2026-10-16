import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LeftOut, ServerSoftware, WatchStatus } from "../lib/ipc";
import {
  LIVE_STATUS,
  LIVE_SYNC_FAILED,
  LIVE_WALLET_SYNCED,
  coverageOf,
  isOwnNode,
  leftOutOf,
  liveStatusLine,
  remedyWords,
  shortOfRoomWords,
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
  left_out_scripts: 0,
  left_out_wallets: 0,
  wallets: [],
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

describe("room in the live watch", () => {
  const partial = {
    wallet_id: "w-1",
    coverage: "partial" as const,
    watched_scripts: 200,
    left_out_scripts: 40,
    refused_scripts: 0,
  };
  const ANY = { per_wallet: 200, total: 2_000 };
  const OWN = { per_wallet: 20_000, total: 20_000 };
  const capped: LeftOut = {
    reason: "live_limit",
    limits: ANY,
    own_node: false,
    remedy: { type: "own_node", limits: OWN },
  };

  it("is the user's own node only for a custom server they said is theirs", () => {
    expect(isOwnNode(undefined)).toBe(false);
    expect(isOwnNode({ type: "public_esplora" })).toBe(false);
    expect(isOwnNode({ type: "custom_electrum", url: "ssl://n:50002" })).toBe(false);
    expect(isOwnNode({ type: "custom_electrum", url: "ssl://n:50002", own_node: true })).toBe(true);
    expect(isOwnNode({ type: "custom_esplora", url: "https://n/api", own_node: true })).toBe(true);
  });

  it("says a wallet's coverage only while the core says the watch leaves some out", () => {
    const short: WatchStatus = {
      ...OFF,
      state: "connected",
      left_out_scripts: 40,
      left_out_wallets: 1,
      wallets: [partial],
      left_out: capped,
    };
    expect(leftOutOf(short)).toEqual(capped);
    expect(coverageOf(short, "w-1")).toEqual(partial);
    expect(coverageOf(short, "w-other")).toBe(null);
    // No verdict, off or with room for everything: no badge.
    const roomy = { ...short, left_out_scripts: 0, left_out_wallets: 0, left_out: null };
    expect(leftOutOf(roomy)).toBe(null);
    expect(coverageOf(roomy, "w-1")).toBe(null);
    expect(coverageOf(undefined, "w-1")).toBe(null);
  });

  it("words the reason, what waits, and the way out the core gives", () => {
    const short: WatchStatus = {
      ...OFF,
      state: "connected",
      left_out_scripts: 1_240,
      left_out_wallets: 2,
      left_out: capped,
    };
    expect(shortOfRoomWords(short, capped)).toEqual({
      limits: "The live watch follows at most 200 addresses per wallet and 2\u00a0000 in all.",
      waiting: "1\u00a0240 addresses of 2 wallets are checked at the next sync instead.",
      remedy: 'Connect your own node and turn on "This is my node" in Network to follow up to 20\u00a0000.',
    });
    // At the limits of the user's own node: nothing takes more.
    expect(
      shortOfRoomWords(short, { reason: "live_limit", limits: OWN, own_node: true, remedy: null }),
    ).toMatchObject({
      limits: "The live watch follows at most 20\u00a0000 addresses, even on your own node.",
      remedy: null,
    });
    expect(shortOfRoomWords(short, { ...capped, reason: "server_refused" }).limits).toBe(
      "The server refuses some of the addresses the live watch asks it to follow.",
    );
    const one = { ...short, left_out_scripts: 1, left_out_wallets: 1 };
    expect(
      shortOfRoomWords(one, {
        reason: "server_refused",
        limits: OWN,
        own_node: true,
        remedy: {
          type: "raise_server_limit",
          server: "electrumx",
          settings: ["COST_SOFT_LIMIT", "COST_HARD_LIMIT"],
        },
      }),
    ).toEqual({
      limits: "Your node refuses some of the addresses the live watch asks it to follow.",
      waiting: "1 address of 1 wallet is checked at the next sync instead.",
      remedy:
        "Raise COST_SOFT_LIMIT and COST_HARD_LIMIT in the ElectrumX settings to follow them all.",
    });
  });

  /** The settings come from the core; the words around them follow what
      each server's documentation calls them. */
  it("names the setting of the user's node the way its software does", () => {
    const raise = (server: ServerSoftware | null, settings: string[]) =>
      remedyWords({ type: "raise_server_limit", server, settings });
    expect(raise("fulcrum", ["max_subs_per_ip"])).toBe(
      "Raise max_subs_per_ip in the Fulcrum configuration to follow them all.",
    );
    expect(raise("electrs_esplora", ["--electrum-subscription-limit"])).toBe(
      "Raise --electrum-subscription-limit on this electrs to follow them all.",
    );
    expect(raise("mempool_electrs", ["--electrum-max-subscriptions"])).toBe(
      "Raise --electrum-max-subscriptions on this electrs to follow them all.",
    );
    expect(raise(null, [])).toBe("Raise the subscription limit of your server to follow them all.");
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
