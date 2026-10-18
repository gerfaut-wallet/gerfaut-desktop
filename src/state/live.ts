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
import { groupThousands } from "../lib/format";
import { failureMessage, ipc } from "../lib/ipc";
import type {
  BackendConfig,
  Coverage,
  LeftOut,
  Network,
  Remedy,
  WalletCoverage,
  WatchStatus,
} from "../lib/ipc";
import { keys, useInvalidateWallet } from "./queries";
import { useUi } from "./store";

export const LIVE_WALLET_SYNCED = "live://wallet-synced";
export const LIVE_SYNC_FAILED = "live://sync-failed";
export const LIVE_STATUS = "live://status";

export const liveStatusKey = keys.liveStatus;

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
      const { message, kind } = (payload ?? {}) as { message?: unknown; kind?: unknown };
      if (id === null || typeof message !== "string") return;
      useUi.getState().setSyncError(id, failureMessage({ kind, message }));
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

/** The status line while the network in use holds no wallet: nothing to
    watch, so nothing runs, until the first one comes. As on Android. */
export const LIVE_NO_WALLET_LINE = "Off until you add a wallet.";

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

/** What the watch takes on any server and on the user's own node, as
    the core has it, for the words under "This is my node". The same for
    the whole run, so asked once. */
export function useLiveLimits() {
  return useQuery({
    queryKey: keys.liveLimits,
    queryFn: ipc.liveLimits,
    staleTime: Infinity,
  });
}

/** Whether the user said this backend is their own node ("This is my
    node"). A public backend never is. */
export function isOwnNode(config: BackendConfig | undefined): boolean {
  return config !== undefined && config.type !== "public_esplora" && config.own_node === true;
}

/** Why the live watch, running, leaves addresses to the syncs, and the
    way out, as the core decides it; null when it leaves none out: the
    one case where how much of a wallet it hears is worth a word. */
export function leftOutOf(status: WatchStatus | undefined): LeftOut | null {
  return status?.left_out ?? null;
}

/** How much of one wallet the live watch hears, or null when there is
    nothing to say: the watch is off, or it has room for every address,
    and then every wallet is live. */
export function coverageOf(
  status: WatchStatus | undefined,
  walletId: string,
): WalletCoverage | null {
  if (leftOutOf(status) === null) return null;
  return status!.wallets.find((wallet) => wallet.wallet_id === walletId) ?? null;
}

/** A wallet's coverage in the words of its badge. */
export const COVERAGE_WORDS: Record<Coverage, string> = {
  live: "Live",
  partial: "Partly live",
  sync_only: "At next sync",
};

function count(n: number, one: string, many: string): string {
  return `${groupThousands(String(n))} ${n === 1 ? one : many}`;
}

/** What a wallet's badge leaves out: how many of its addresses wait. */
export function waitingWords(coverage: WalletCoverage): string {
  return coverage.left_out_scripts === 0
    ? "Every address is followed live."
    : `${count(coverage.left_out_scripts, "address waits", "addresses wait")} for the next sync.`;
}

/** The note under the status when the live watch is short of room, in
    the words of the core's verdict: why, what that leaves to the syncs,
    and the way out, if there is one. */
export function shortOfRoomWords(
  status: WatchStatus,
  leftOut: LeftOut,
): {
  limits: string;
  waiting: string;
  remedy: string | null;
} {
  const { limits, own_node: ownNode } = leftOut;
  const limitsWords =
    leftOut.reason === "server_refused"
      ? ownNode
        ? "Your node refuses some of the addresses the live watch asks it to follow."
        : "The server refuses some of the addresses the live watch asks it to follow."
      : ownNode
        ? `The live watch follows at most ${groupThousands(String(limits.total))} addresses, even on your own node.`
        : `The live watch follows at most ${groupThousands(String(limits.per_wallet))} addresses per wallet and ${groupThousands(String(limits.total))} in all.`;
  const waiting = `${count(status.left_out_scripts, "address", "addresses")} of ${count(
    status.left_out_wallets,
    "wallet",
    "wallets",
  )} ${status.left_out_scripts === 1 ? "is" : "are"} checked at the next sync instead.`;
  return {
    limits: limitsWords,
    waiting,
    remedy: leftOut.remedy === null ? null : remedyWords(leftOut.remedy),
  };
}

/** The way out the core names, in words: a node of one's own, or on it,
    the setting the core named for the software it runs, phrased the way
    that software's documentation does. */
export function remedyWords(remedy: Remedy): string {
  if (remedy.type === "own_node") {
    return `Connect your own node and turn on "This is my node" in Network to follow up to ${groupThousands(String(remedy.limits.total))}.`;
  }
  const settings = remedy.settings.join(" and ");
  if (settings === "") return "Raise the subscription limit of your server to follow them all.";
  switch (remedy.server) {
    case "fulcrum":
      return `Raise ${settings} in the Fulcrum configuration to follow them all.`;
    case "electrumx":
      return `Raise ${settings} in the ElectrumX settings to follow them all.`;
    case "electrs_esplora":
    case "mempool_electrs":
      return `Raise ${settings} on this electrs to follow them all.`;
    default:
      return "Raise the subscription limit of your server to follow them all.";
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
