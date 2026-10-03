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
  coverageOf,
  isOwnNode,
  liveStatusLine,
  raiseWords,
  serverRefused,
  shortOfRoom,
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
  };

  it("is the user's own node only for a custom server they said is theirs", () => {
    expect(isOwnNode(undefined)).toBe(false);
    expect(isOwnNode({ type: "public_esplora" })).toBe(false);
    expect(isOwnNode({ type: "custom_electrum", url: "ssl://n:50002" })).toBe(false);
    expect(isOwnNode({ type: "custom_electrum", url: "ssl://n:50002", own_node: true })).toBe(true);
    expect(isOwnNode({ type: "custom_esplora", url: "https://n/api", own_node: true })).toBe(true);
  });

  it("says a wallet's coverage only while the running watch leaves some out", () => {
    const short: WatchStatus = {
      ...OFF,
      state: "connected",
      left_out_scripts: 40,
      left_out_wallets: 1,
      wallets: [partial],
    };
    expect(shortOfRoom(short)).toBe(true);
    expect(coverageOf(short, "w-1")).toEqual(partial);
    expect(coverageOf(short, "w-other")).toBe(null);
    // Off, the counters mean nothing: no badge, whatever they hold.
    expect(shortOfRoom({ ...short, state: "off" })).toBe(false);
    expect(coverageOf({ ...short, state: "off" }, "w-1")).toBe(null);
    // Room for everything: every wallet is live, and nothing is said.
    const roomy = { ...short, left_out_scripts: 0, left_out_wallets: 0 };
    expect(shortOfRoom(roomy)).toBe(false);
    expect(coverageOf(roomy, "w-1")).toBe(null);
    expect(coverageOf(undefined, "w-1")).toBe(null);
  });

  /** The setting each server documents, read from its `server.version`
      answer: ElectrumX caps a cost per session, not a count, and the two
      electrs forks name their flags differently. */
  it("names the setting that lets the user's node follow more", () => {
    expect(raiseWords("Fulcrum 1.12.0")).toBe(
      "Raise max_subs_per_ip in the Fulcrum configuration to follow them all.",
    );
    expect(raiseWords("ElectrumX 1.18.0")).toBe(
      "Raise COST_SOFT_LIMIT and COST_HARD_LIMIT in the ElectrumX settings to follow them all.",
    );
    expect(raiseWords("electrs-esplora 0.4.1")).toBe(
      "Raise --electrum-subscription-limit on this electrs to follow them all.",
    );
    expect(raiseWords("mempool-electrs 3.4.0-dev")).toBe(
      "Raise --electrum-max-subscriptions on this electrs to follow them all.",
    );
    // Caps nothing: there is no setting to name.
    expect(raiseWords("electrs/0.10.9")).toBe(null);
    expect(raiseWords("SomethingElse 2.0")).toBe(
      "Raise the subscription limit of your server to follow them all.",
    );
    expect(raiseWords(null)).toBe(
      "Raise the subscription limit of your server to follow them all.",
    );
  });

  it("puts the node's setting after what waits, and nothing at the cap", () => {
    const refused: WatchStatus = {
      ...OFF,
      state: "connected",
      watched_scripts: 4_000,
      pushed_scripts: 3_700,
      left_out_scripts: 300,
      left_out_wallets: 1,
      server_software: "ElectrumX 1.18.0",
    };
    expect(shortOfRoomWords(refused, true)).toEqual({
      limits: "Your node refuses some of the addresses the live watch asks it to follow.",
      waiting: "300 addresses of 1 wallet are checked at the next sync instead.",
      remedy:
        "Raise COST_SOFT_LIMIT and COST_HARD_LIMIT in the ElectrumX settings to follow them all.",
    });
    expect(shortOfRoomWords({ ...refused, watched_scripts: 20_000 }, true).remedy).toBe(null);
  });

  /** The Electrum server of mempool.space takes 100 subscriptions per
      connection: a list of 150, far below the watch's own limits, leaves
      50 out because the server refused them, and the note says so. */
  it("blames the server, not the watch's limits, for what it refused", () => {
    const refusing: WatchStatus = {
      ...OFF,
      state: "connected",
      watched_scripts: 150,
      pushed_scripts: 100,
      left_out_scripts: 50,
      left_out_wallets: 1,
      wallets: [{ wallet_id: "w-1", coverage: "partial", watched_scripts: 100, left_out_scripts: 50 }],
    };
    expect(serverRefused(refusing)).toBe(true);
    expect(shortOfRoomWords(refusing, false)).toEqual({
      limits: "The server refuses some of the addresses the live watch asks it to follow.",
      waiting: "50 addresses of 1 wallet are checked at the next sync instead.",
      remedy: 'Connect your own node and turn on "This is my node" to follow up to 20\u00a0000.',
    });

    // The list full on the user's own node, and the node took half of
    // it: its own limit, Blockstream's electrs here, not the watch's.
    const halfTaken: WatchStatus = {
      ...refusing,
      watched_scripts: 20_000,
      pushed_scripts: 10_000,
      left_out_scripts: 10_000,
      wallets: [
        { wallet_id: "w-1", coverage: "partial", watched_scripts: 10_000, left_out_scripts: 10_000 },
      ],
      server_software: "electrs-esplora 0.4.1",
    };
    expect(shortOfRoomWords(halfTaken, true)).toMatchObject({
      limits: "Your node refuses some of the addresses the live watch asks it to follow.",
      remedy: "Raise --electrum-subscription-limit on this electrs to follow them all.",
    });

    // Every script heard, one of them by two wallets: past the caps,
    // not refused.
    const capped: WatchStatus = {
      ...refusing,
      watched_scripts: 3,
      wallets: [
        { wallet_id: "w-1", coverage: "partial", watched_scripts: 2, left_out_scripts: 50 },
        { wallet_id: "w-2", coverage: "live", watched_scripts: 2, left_out_scripts: 0 },
      ],
    };
    expect(serverRefused(capped)).toBe(false);
    expect(shortOfRoomWords(capped, false).limits).toBe(
      "The live watch follows at most 200 addresses per wallet and 2\u00a0000 in all.",
    );
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
