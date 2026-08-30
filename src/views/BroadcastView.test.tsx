import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BroadcastView } from "./BroadcastView";
import type { BroadcastStatus, TxPreview, TxWarning } from "../lib/ipc";
import { useUi } from "../state/store";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

// The scanner's own test proves it decodes frames; what matters here is
// what this page asks it to look for.
vi.mock("../components/ScanQrModal", () => ({
  ScanQrModal: ({ open, caption }: { open: boolean; caption?: string }) =>
    open ? <p>{caption}</p> : null,
}));

const TXID = "ab".repeat(32);
const PREV = "cd".repeat(32);
const HEX = "0200000000010112ab";

function warning(kind: TxWarning["kind"], severity: TxWarning["severity"], message: string) {
  return { kind, severity, message };
}

/** A signed transaction spending one watched coin, paying out and
    keeping the change. */
const PREVIEW: TxPreview = {
  txid: TXID,
  source: "psbt",
  network: "signet",
  inputs: [
    {
      txid: PREV,
      vout: 1,
      value_sats: 200_000,
      address: "tb1qmine",
      signed: true,
      wallet: { id: "w-1", name: "Cold" },
    },
  ],
  outputs: [
    {
      index: 0,
      value_sats: 150_000,
      address: "tb1qtheirs",
      op_return: null,
      wallet: null,
      change: false,
    },
    {
      index: 1,
      value_sats: 49_790,
      address: "tb1qchange",
      op_return: null,
      wallet: { id: "w-1", name: "Cold" },
      change: true,
    },
  ],
  fee_sats: 210,
  fee_rate_sat_vb: 1.5,
  vsize: 141,
  weight: 561,
  size: 215,
  version: 2,
  locktime: 0,
  rbf: true,
  ready: true,
  warnings: [],
  hex: HEX,
};

const REPORT = { txid: TXID, backend: "mempool.space", at: 1_755_000_000 };

function status(overrides: Partial<BroadcastStatus> = {}): BroadcastStatus {
  return {
    txid: TXID,
    found: true,
    confirmed: false,
    block_height: null,
    confirmations: 0,
    backend: "mempool.space",
    at: 1_755_000_000,
    ...overrides,
  };
}

function mount(preview: TxPreview = PREVIEW, standing: BroadcastStatus = status()) {
  mockIPC((cmd) => {
    if (cmd === "preview_transaction") return preview;
    if (cmd === "broadcast_transaction") return REPORT;
    if (cmd === "transaction_status") return standing;
    return undefined;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <BroadcastView network="signet" />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

/** Paste something and read what it does. */
async function preview(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Signed transaction"), HEX);
  await user.click(screen.getByRole("button", { name: "Preview" }));
  await screen.findByRole("region", { name: "Technical" });
}

/** Preview, confirm, send. */
async function send(user: ReturnType<typeof userEvent.setup>) {
  await preview(user);
  await user.click(screen.getByRole("button", { name: "Broadcast" }));
  const dialog = within(await screen.findByRole("dialog"));
  await user.click(dialog.getByRole("button", { name: "Broadcast" }));
  await screen.findByText(/Sent · mempool\.space/);
}

describe("BroadcastView", () => {
  beforeEach(() => {
    useUi.setState({ masked: false, recentBroadcasts: [] });
  });

  it("tells the scanner what this page is waiting for", async () => {
    const user = mount();
    await user.click(screen.getByRole("button", { name: "Scan a QR code" }));
    // Pointing someone at a descriptor while they hold a signed
    // transaction is worse than saying nothing.
    expect(screen.getByText(/signed transaction or PSBT QR code/i)).toBeInTheDocument();
    expect(screen.queryByText(/descriptor/i)).not.toBeInTheDocument();
  });

  it("reads the tone of a caution off the core, never off a local table", async () => {
    const user = mount({
      ...PREVIEW,
      warnings: [
        warning("high_fee_rate", "alert", "The fee rate is far above what the chain asks."),
        warning("input_unknown", "info", "An input was not found on this network."),
      ],
    });
    await preview(user);

    const cautions = within(screen.getByRole("region", { name: "Before you send" }));
    const [loud, quiet] = cautions.getAllByRole("listitem");
    // The hand-written map called a high fee rate amber and an unknown
    // input red — exactly the drift the core's severity ends.
    expect(loud.firstElementChild).toHaveClass("bg-alert-surface", "text-alert");
    expect(quiet.firstElementChild).toHaveClass("bg-pending-surface", "text-pending");
    // The glyph still names the kind, and it is not the tone's own.
    expect(loud.querySelector(".lucide-flame")).toBeInTheDocument();
    expect(quiet.querySelector(".lucide-circle-question-mark")).toBeInTheDocument();
  });

  it("sets the cautions at the size every other note is read at", async () => {
    const user = mount({
      ...PREVIEW,
      warnings: [warning("locked", "info", "A time lock keeps this out of the chain for now.")],
    });
    await preview(user);
    expect(
      screen.getByText("A time lock keeps this out of the chain for now."),
    ).toHaveClass("text-sm", "leading-5");
  });

  it("calls a transaction that cannot be sent unsigned, in red", async () => {
    const user = mount({ ...PREVIEW, ready: false, hex: null });
    await preview(user);
    const pill = screen.getByText("Unsigned");
    expect(screen.queryByText("Not fully signed")).not.toBeInTheDocument();
    // Believing a transaction went out when it cannot is one of the
    // four cases red is kept for.
    expect(pill).toHaveClass("bg-alert-surface", "text-alert");
    expect(screen.getByRole("button", { name: "Broadcast" })).toBeDisabled();
  });

  it("keeps the preview under the status once the transaction is sent", async () => {
    const user = mount();
    await send(user);

    // The status is inserted, it does not replace: the moment after
    // sending is exactly when one re-reads what was sent.
    const sent = screen.getByText(/Sent · mempool\.space/);
    const diagram = screen.getByRole("region", { name: "Transaction diagram" });
    expect(screen.getByRole("region", { name: "Inputs" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Technical" })).toBeInTheDocument();
    expect(sent.compareDocumentPosition(diagram) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("paints a transaction the backend has not seen amber, not red", async () => {
    const user = mount(PREVIEW, status({ found: false }));
    await send(user);

    const pill = await screen.findByText("Not seen");
    // Most often it is simply not indexed yet, and the page says so:
    // broadcasting it again does no harm. Nothing is lost, nothing red.
    expect(pill).toHaveClass("bg-pending-surface", "text-pending");
    expect(pill).not.toHaveClass("bg-alert-surface");
    expect(screen.getByText(/Broadcasting it again does no harm/)).toBeInTheDocument();
  });

  it("totals each side on the heading that counts it", async () => {
    const user = mount();
    await preview(user);
    expect(screen.getByRole("region", { name: "Inputs" })).toHaveTextContent(
      "Inputs (1) · 0.00200000 BTC",
    );
    expect(screen.getByRole("region", { name: "Outputs" })).toHaveTextContent(
      "Outputs (2) · 0.00199790 BTC",
    );
  });

  it("refuses a side total one unknown value would make wrong", async () => {
    const user = mount({
      ...PREVIEW,
      inputs: [{ ...PREVIEW.inputs[0], value_sats: null, address: null, wallet: null }],
    });
    await preview(user);
    const inputs = within(screen.getByRole("region", { name: "Inputs" }));
    expect(screen.getByRole("region", { name: "Inputs" })).toHaveTextContent("Inputs (1) · n/a");
    // And the row itself says n/a, the word the detail page uses.
    expect(inputs.getAllByText("n/a").length).toBeGreaterThan(0);
    expect(screen.queryByText("unknown")).not.toBeInTheDocument();
  });

  it("hides the totals with the amounts", async () => {
    useUi.setState({ masked: true });
    const user = mount();
    await preview(user);
    expect(screen.getByRole("region", { name: "Inputs" })).toHaveTextContent("Inputs (1) · •••••");
  });

  it("carries the network and its own heading on the facts", async () => {
    const user = mount();
    await preview(user);
    const technical = within(screen.getByRole("region", { name: "Technical" }));
    expect(technical.getByRole("heading", { name: "Technical" })).toBeInTheDocument();
    expect(technical.getByText("Network")).toBeInTheDocument();
    expect(technical.getByText("Signet")).toBeInTheDocument();
  });

  it("decodes a time-based locktime instead of calling it a block", async () => {
    // 1735689600 is 2025-01-01T00:00:00Z, not a block height.
    const user = mount({ ...PREVIEW, locktime: 1_735_689_600 });
    await preview(user);
    const technical = within(screen.getByRole("region", { name: "Technical" }));
    expect(technical.queryByText("1 735 689 600")).not.toBeInTheDocument();
    expect(technical.getByText(/2024|2025/)).toBeInTheDocument();
  });

  it("names an output with no address the way the detail page does", async () => {
    const user = mount({
      ...PREVIEW,
      outputs: [{ ...PREVIEW.outputs[0], address: null }],
    });
    await preview(user);
    await waitFor(() =>
      expect(screen.getAllByText("Script output").length).toBeGreaterThan(0),
    );
    expect(screen.queryByText("non-standard script")).not.toBeInTheDocument();
  });
});
