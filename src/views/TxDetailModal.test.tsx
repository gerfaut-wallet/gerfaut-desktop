import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TxDetailModal } from "./TxDetailModal";
import type { TxDetail, TxIo } from "../lib/ipc";
import { formatFiat, formatTimestamp } from "../lib/format";
import { useUi } from "../state/store";

const opener = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => opener);

const TXID = "ab".repeat(32);
const SPENT = "cd".repeat(32);
const MINED_AT = 1_755_000_000;
const RATE = 100_000;

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
    status: { state: "confirmed", height: 200_000, timestamp: MINED_AT },
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
  mockIPC((cmd) => {
    if (cmd === "tx_detail") return detail;
    if (cmd === "fetch_price") {
      return { rate: RATE, currency: "eur", source: "coingecko", at: MINED_AT };
    }
    return undefined;
  });
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
    useUi.setState({ selectedTxid: null, explorerAck: false, fiatEnabled: false });
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

  it("carries a labelled Block row, the hero's height and no more", async () => {
    open();
    const technical = within(await screen.findByRole("region", { name: "Technical" }));
    // The flow summary used to carry it; the hero's bare "block N"
    // beside the pill is not a fact one can go looking for.
    expect(technical.getByText("Block")).toBeInTheDocument();
    expect(technical.getByText("200 000")).toBeInTheDocument();
  });

  it("says — for the block of a transaction nobody has mined yet", async () => {
    open({
      ...DETAIL,
      summary: { ...DETAIL.summary, status: { state: "pending" }, confirmations: 0 },
    });
    const technical = within(await screen.findByRole("region", { name: "Technical" }));
    expect(technical.getByText("Block")).toBeInTheDocument();
    expect(technical.getByText("—")).toBeInTheDocument();
  });

  it("totals each side on the heading that counts it", async () => {
    open();
    expect(
      await screen.findByRole("region", { name: "Inputs" }),
    ).toHaveTextContent("Inputs (1) · 0.00200000 BTC");
    expect(screen.getByRole("region", { name: "Outputs" })).toHaveTextContent(
      "Outputs (2) · 0.00199790 BTC",
    );
  });

  it("refuses a side total one unknown value would make wrong", async () => {
    open({ ...DETAIL, inputs: [io({ address: null, value_sats: null })] });
    expect(await screen.findByRole("region", { name: "Inputs" })).toHaveTextContent(
      "Inputs (1) · n/a",
    );
  });

  it("decodes a time-based locktime instead of calling it a block", async () => {
    // 1735689600 is 2025-01-01T00:00:00Z. Printed raw it reads as a
    // block height a thousand centuries away.
    open({ ...DETAIL, extras: { ...DETAIL.extras!, locktime: 1_735_689_600 } });
    const technical = within(await screen.findByRole("region", { name: "Technical" }));
    expect(technical.queryByText("1 735 689 600")).not.toBeInTheDocument();
    expect(technical.getByText(formatTimestamp(1_735_689_600))).toBeInTheDocument();
    // And the chip must stop promising a block above the threshold.
    expect(screen.getByTitle(/earliest time this transaction could be mined/i)).toBeInTheDocument();
  });

  it("keeps the block wording for a height-based locktime", async () => {
    open({ ...DETAIL, extras: { ...DETAIL.extras!, locktime: 840_000 } });
    const technical = within(await screen.findByRole("region", { name: "Technical" }));
    expect(technical.getByText("block 840 000")).toBeInTheDocument();
    expect(
      screen.getByTitle("Earliest block this transaction could be mined in"),
    ).toBeInTheDocument();
  });

  it("says what the coinbase and OP_RETURN chips mean", async () => {
    open({
      ...DETAIL,
      outputs: [io({ address: null, value_sats: 0, op_return: { hex: "6a", text: "hi", label: null } })],
      extras: { ...DETAIL.extras!, is_coinbase: true, coinbase_pool: "Foundry" },
    });
    expect(
      await screen.findByTitle("Coinbase: the block reward, coins minted by the miner"),
    ).toBeInTheDocument();
    expect(
      screen.getByTitle("An output carries data instead of spendable coins"),
    ).toBeInTheDocument();
  });

  it("carries the transaction id and the date once, in the panel on top", async () => {
    open();
    const summary = within(await screen.findByRole("region", { name: "Summary" }));
    expect(summary.getByRole("button", { name: "Copy Transaction ID" })).toBeInTheDocument();
    expect(summary.getByTitle(TXID)).toBeInTheDocument();
    expect(screen.getAllByTitle(TXID)).toHaveLength(1);

    const date = summary.getByText(formatTimestamp(MINED_AT));
    expect(date.tagName).toBe("TIME");
    expect(screen.getAllByText(formatTimestamp(MINED_AT))).toHaveLength(1);
  });

  it("says a transaction nobody has mined yet carries no date", async () => {
    open({
      ...DETAIL,
      summary: { ...DETAIL.summary, status: { state: "pending" }, confirmations: 0 },
    });
    const summary = within(await screen.findByRole("region", { name: "Summary" }));
    expect(summary.getByText("not yet mined")).toBeInTheDocument();
  });

  it("leaves the rate at the time to the export that owns it", async () => {
    open();
    await screen.findByRole("region", { name: "Summary" });
    expect(screen.queryByText(/rate at the time/i)).not.toBeInTheDocument();
  });

  it("lets the role icon carry the role, with no sub-line saying it again", async () => {
    open();
    const inputs = within(await screen.findByRole("region", { name: "Inputs" }));
    const outputs = within(screen.getByRole("region", { name: "Outputs" }));
    for (const words of [
      "Spent from this wallet",
      "Change back to this wallet",
      "Received by this wallet",
    ]) {
      expect(screen.queryByText(words)).not.toBeInTheDocument();
    }
    // The words stay where they cost nothing: the tooltip on the icon.
    expect(inputs.getByTitle("Spent from this wallet")).toBeInTheDocument();
    expect(outputs.getByTitle("Change back to this wallet")).toBeInTheDocument();
  });

  it("counts a line in the chosen unit only, never in fiat", async () => {
    // Nobody can tell whether a fiat figure beside an output is the
    // value on the day of the transaction or the value today.
    useUi.setState({ fiatEnabled: true, fiatCurrency: "eur", fiatSource: "coingecko" });
    open();
    // The panel on top carries one, so the quote really did arrive.
    expect(await screen.findByText(formatFiat(-150_210, RATE, "eur"))).toBeInTheDocument();
    const outputs = within(screen.getByRole("region", { name: "Outputs" }));
    expect(outputs.getByText("0.00150000 BTC")).toBeInTheDocument();
    expect(outputs.queryByText(formatFiat(150_000, RATE, "eur"))).not.toBeInTheDocument();
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
