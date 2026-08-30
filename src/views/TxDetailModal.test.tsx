import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TxDetailModal } from "./TxDetailModal";
import type { TxDetail, TxIo } from "../lib/ipc";
import { useUi } from "../state/store";

const opener = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => opener);

const TXID = "ab".repeat(32);
const SPENT = "cd".repeat(32);

function io(overrides: Partial<TxIo> = {}): TxIo {
  return {
    address: "tb1qexample",
    value_sats: 100_000,
    is_mine: false,
    change: false,
    op_return: null,
    prev_txid: null,
    prev_vout: null,
    ...overrides,
  };
}

const DETAIL: TxDetail = {
  summary: {
    txid: TXID,
    net_sats: -150_210,
    fee_sats: 210,
    status: { state: "confirmed", height: 200_000, timestamp: 1_755_000_000 },
    confirmations: 12,
  },
  inputs: [
    io({
      address: "tb1qmine",
      value_sats: 200_000,
      is_mine: true,
      prev_txid: SPENT,
      prev_vout: 1,
    }),
  ],
  outputs: [
    io({ address: "tb1qtheirs", value_sats: 150_000 }),
    io({ address: "tb1qchange", value_sats: 49_790, is_mine: true, change: true }),
  ],
  vsize: 141,
  fee_rate_sat_vb: 1.5,
  extras: {
    size_bytes: 215,
    vsize: 141,
    weight_wu: 561,
    version: 2,
    locktime: 0,
    rbf_signaled: true,
    segwit: true,
    taproot: false,
    is_coinbase: false,
    coinbase_pool: null,
    coinbase_height: null,
    coinbase_tag: null,
    sigops: 1,
    raw_hex: "02000000abcdef",
  },
};

function open(detail: TxDetail = DETAIL) {
  mockIPC((cmd) => (cmd === "tx_detail" ? detail : undefined));
  useUi.setState({ selectedTxid: TXID });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TxDetailModal walletId="w-1" network="signet" />
    </QueryClientProvider>,
  );
}

describe("TxDetailModal", () => {
  beforeEach(() => {
    opener.openUrl.mockClear();
    useUi.setState({ selectedTxid: null, explorerAck: false });
  });

  it("names the replaceable flag the way the chain names it", async () => {
    open();
    expect(await screen.findByText("RBF")).toBeInTheDocument();
    expect(screen.queryByText("Replaceable")).not.toBeInTheDocument();
    expect(screen.getByText("SegWit")).toBeInTheDocument();
  });

  it("keeps the explorer in the hero, and behind its warning", async () => {
    open();
    const user = userEvent.setup();
    const hero = within(await screen.findByRole("region", { name: "Summary" }));

    await user.click(hero.getByRole("button", { name: /view on mempool\.space/i }));
    expect(await screen.findByText(/third-party website/i)).toBeInTheDocument();
    expect(opener.openUrl).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Open explorer" }));
    expect(opener.openUrl).toHaveBeenCalledWith(`https://mempool.space/signet/tx/${TXID}`);
  });

  it("says a transfer to oneself by its name", async () => {
    open({
      ...DETAIL,
      summary: { ...DETAIL.summary, net_sats: -210 },
      outputs: [io({ address: "tb1qchange", value_sats: 199_790, is_mine: true, change: true })],
    });
    expect(await screen.findByText("Sent to yourself")).toBeInTheDocument();
  });

  it("reads in the order the questions come in", async () => {
    open();
    const hero = await screen.findByRole("region", { name: "Summary" });
    const diagram = screen.getByRole("region", { name: "Transaction diagram" });
    const inputs = screen.getByRole("region", { name: "Inputs" });
    const technical = screen.getByRole("region", { name: "Technical" });

    const before = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(hero, diagram)).toBe(true);
    expect(before(diagram, inputs)).toBe(true);
    // The facts one goes looking for wait below the lists.
    expect(before(inputs, technical)).toBe(true);
  });
});
