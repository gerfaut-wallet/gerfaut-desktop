import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { UtxoInfo } from "../lib/ipc";
import { PRICE_TABLE } from "../test/fixtures";
import { UtxoTable } from "./UtxoTable";

function utxo(vout: number, confirmations: number): UtxoInfo {
  return {
    txid: "cd".repeat(32),
    vout,
    address: `tb1qcoin${vout}`,
    value_sats: 10_000 * (vout + 1),
    status:
      confirmations === 0
        ? { state: "pending" }
        : { state: "confirmed", height: 200_000 - confirmations + 1, timestamp: 1_755_000_000 },
    confirmations,
    keychain: "external",
    derivation_index: vout,
  };
}

/** The table with what its amounts ask for: the settings and a price
    table, no price. */
function renderTable(utxos: UtxoInfo[]) {
  mockIPC((cmd) => {
    if (cmd === "get_settings") return { active_network: "signet", app_prefs: {} };
    if (cmd === "price_table") return PRICE_TABLE;
    return null;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <UtxoTable utxos={utxos} />
    </QueryClientProvider>,
  );
}

/** The row holding a coin's outpoint, found by what it shows. */
function rowOf(vout: number): HTMLElement {
  const row = screen.getByText(`:${vout}`, { exact: false }).closest("tr");
  if (!row) throw new Error(`no row for output ${vout}`);
  return row;
}

describe("UtxoTable", () => {
  /** A coin counts its blocks like a transaction does: the pill and
      the pie under six, the muted check from six on. */
  it("gives each coin its standing", () => {
    renderTable([utxo(0, 3), utxo(1, 6), utxo(2, 0)]);

    const counting = rowOf(0);
    // The row is named from what it holds: the sentence once, and the
    // short count left to the eye.
    const spokenOnce = (name: string) =>
      name.split("3 of 6 confirmations").length === 2 && !/\b3 conf\b/.test(name);
    expect(screen.getByRole("row", { name: spokenOnce })).toBe(counting);
    expect(counting.querySelector("[data-glyph='pie']")).toHaveAttribute("data-parts", "3");
    expect(within(counting).getByText("3 conf")).toHaveAttribute("aria-hidden", "true");

    const settled = rowOf(1);
    expect(settled.querySelector("[data-tone]")).toBe(null);
    expect(settled.querySelector("[title='Confirmed'] [data-glyph='check']")).not.toBe(null);

    const pending = rowOf(2);
    expect(pending.querySelector("[data-tone='pending']")).toHaveTextContent("Pending");
    expect(pending.querySelector("[data-glyph='pie']")).toBe(null);
  });
});
