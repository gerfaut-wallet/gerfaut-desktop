import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { WalletMeta } from "../lib/ipc";
import { moveItem } from "../lib/reorder";
import { useWallets } from "./queries";
import { useWalletOrder } from "./walletOrder";

function meta(id: string): WalletMeta {
  return {
    id,
    name: id.toUpperCase(),
    icon: "wallet",
    network: "signet",
    kind: { type: "single_address", address: `tb1q${id}` },
    recognized_as: "address",
    created_at: 1_755_000_000,
    gap_limit: 20,
    scan_gap: 20,
    labels: {},
    last_sync: null,
    cached: {
      balance: {
        confirmed: 0,
        trusted_pending: 0,
        untrusted_pending: 0,
        pending_net_sats: null,
        immature: 0,
        total: 0,
      },
      tx_count: 0,
    },
  };
}

/** The list as a view reads it: from the vault, through the order. */
function Harness() {
  const wallets = useWallets();
  const { shown, reorder } = useWalletOrder(wallets.data ?? []);
  return (
    <>
      <p data-testid="order">{shown.map((wallet) => wallet.id).join(" ")}</p>
      <button type="button" onClick={() => reorder(moveItem(shown, 0, 1))}>
        Move the first down
      </button>
    </>
  );
}

/** A vault that lists what it is told to, and records the orders asked. */
function vault(lists: () => WalletMeta[]) {
  const asked: string[][] = [];
  mockIPC((cmd, args) => {
    switch (cmd) {
      case "list_wallets":
        return lists();
      case "reorder_wallets":
        asked.push((args as { ids: string[] }).ids);
        return undefined;
      default:
        throw new Error(`unexpected command ${cmd}`);
    }
  });
  return asked;
}

function renderHarness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

const order = () => screen.getByTestId("order").textContent;

/** Clicks without awaiting: the mock answers within a microtask, and
    the order shown before that answer is the point. */
const move = () => fireEvent.click(screen.getByRole("button", { name: "Move the first down" }));

describe("useWalletOrder", () => {
  it("shows a move at once and keeps it once the vault lists it so", async () => {
    let listed = [meta("a"), meta("b")];
    const asked = vault(() => listed);
    renderHarness();
    await waitFor(() => expect(order()).toBe("a b"));

    // The vault takes the order and lists it back that way.
    listed = [meta("b"), meta("a")];
    move();
    expect(order()).toBe("b a");
    await waitFor(() => expect(asked).toEqual([["b", "a"]]));
    await waitFor(() => expect(order()).toBe("b a"));
  });

  it("follows the vault once read back, even when it says otherwise", async () => {
    // The order is written, but the list comes back with a wallet added
    // meanwhile and in the vault's own order: that is what to show, not
    // the move as it was asked.
    let listed = [meta("a"), meta("b")];
    vault(() => listed);
    renderHarness();
    await waitFor(() => expect(order()).toBe("a b"));

    listed = [meta("c"), meta("a"), meta("b")];
    move();
    expect(order()).toBe("b a");
    await waitFor(() => expect(order()).toBe("c a b"));
  });

  it("puts the list back when the vault refuses", async () => {
    const listed = [meta("a"), meta("b")];
    mockIPC((cmd) => {
      if (cmd === "list_wallets") return listed;
      throw { kind: "storage", message: "read only" };
    });
    renderHarness();
    await waitFor(() => expect(order()).toBe("a b"));
    move();
    expect(order()).toBe("b a");
    await waitFor(() => expect(order()).toBe("a b"));
  });
});
