import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BroadcastView, MAX_TRANSACTION_FILE_BYTES } from "./BroadcastView";
import type { BroadcastStatus, TxPreview, TxWarning } from "../lib/ipc";
import { useUi } from "../state/store";
import { formatFiat } from "../lib/format";

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
/** A round rate, so a fiat figure is easy to name in an assertion. */
const RATE = 50_000;

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
    if (cmd === "fetch_price") return { rate: RATE, currency: "eur", at: 0, source: "coingecko" };
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

  /** The caution the core added when a PSBT may lie about what it
      spends. A kind the table does not know renders no glyph at all, so
      the one caution that says the fee on screen is not the fee being
      paid would read as the quietest of the list. */
  it("reads an input the PSBT declares wrong in red, under its own glyph", async () => {
    const user = mount({
      ...PREVIEW,
      warnings: [
        warning(
          "input_mismatch",
          "alert",
          "Input 0 declares 1.00000000 BTC; the chain holds 0.00200000 BTC there.",
        ),
      ],
    });
    await preview(user);

    const cautions = within(screen.getByRole("region", { name: "Before you send" }));
    const [note] = cautions.getAllByRole("listitem");
    expect(note.firstElementChild).toHaveClass("bg-alert-surface", "text-alert");
    expect(note.querySelector(".lucide-equal-not")).toBeInTheDocument();
    expect(
      screen.getByText(/declares 1\.00000000 BTC; the chain holds/),
    ).toBeInTheDocument();
  });

  /** A coin nothing stood behind — no backend answered, or none knew
      it. The core says so, in amber, and the preview still shows the
      fee it summed over the PSBT's own word. The mark says which figures
      are that word; the caution says where to check them. */
  it("marks every figure that rests on the PSBT's word when a coin was not checked", async () => {
    const user = mount({
      ...PREVIEW,
      inputs: [{ ...PREVIEW.inputs[0], wallet: null }],
      warnings: [
        warning(
          "input_unknown",
          "info",
          "Input 0 could not be checked: no backend answered about this coin.",
        ),
      ],
    });
    await preview(user);

    // Amber, and the caution ends on what to do about it.
    const cautions = within(screen.getByRole("region", { name: "Before you send" }));
    const [note] = cautions.getAllByRole("listitem");
    expect(note.firstElementChild).toHaveClass("bg-pending-surface", "text-pending");
    expect(note).toHaveTextContent(
      "Input 0 could not be checked: no backend answered about this coin. Look the coin up on a backend you trust, or check the amounts on the signing device, before you send.",
    );

    // The inputs' total, the fee in the diagram, the fee and its rate
    // among the facts: four figures, four marks, in amber and in words.
    const inputs = screen.getByRole("region", { name: "Inputs" });
    expect(inputs).toHaveTextContent("Inputs (1) · 0.00200000 BTC · as the PSBT claims");
    // The heading is set in capitals; the mark keeps its own case there.
    expect(within(inputs).getByRole("heading")).toHaveClass("uppercase");
    expect(within(inputs).getByText("as the PSBT claims")).toHaveClass(
      "normal-case",
      "tracking-normal",
    );
    expect(screen.getByRole("region", { name: "Outputs" })).not.toHaveTextContent(
      "as the PSBT claims",
    );
    expect(
      within(screen.getByRole("region", { name: "Transaction diagram" })).getByText(
        "as the PSBT claims",
      ),
    ).toHaveClass("text-pending");
    const technical = within(screen.getByRole("region", { name: "Technical" }));
    expect(technical.getAllByText("as the PSBT claims")).toHaveLength(2);
    expect(screen.getAllByText("as the PSBT claims")).toHaveLength(4);

    // The last look before an irreversible send carries the same mark,
    // and the reminder that the cautions still stand.
    await user.click(screen.getByRole("button", { name: "Broadcast" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("as the PSBT claims")).toHaveClass("text-pending");
    expect(dialog.getByText("The cautions listed on the preview still apply.")).toBeInTheDocument();
  });

  it("marks nothing when every coin was confirmed", async () => {
    const user = mount();
    await preview(user);
    expect(screen.queryByText("as the PSBT claims")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Broadcast" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.queryByText("as the PSBT claims")).not.toBeInTheDocument();
    expect(dialog.queryByText(/still apply/)).not.toBeInTheDocument();
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

  it("gives a mined block a line of its own, away from the count", async () => {
    const now = Math.floor(Date.now() / 1000);
    const user = mount(
      PREVIEW,
      status({ confirmed: true, block_height: 4_611_010, confirmations: 3, at: now }),
    );
    await send(user);

    // On one line the comma joined the two figures: "block 4 611 010, 3
    // confirmations" was read as a height ending in a 3.
    const block = await screen.findByText("Mined in block 4 611 010");
    expect(screen.getByText("3 confirmations as of just now")).toBeInTheDocument();
    expect(screen.queryByText(/4 611 010, 3/)).not.toBeInTheDocument();
    // Split, but still announced as one thing when it changes.
    expect(block.parentElement).toHaveAttribute("aria-live", "polite");
  });

  it("counts a single confirmation in the singular", async () => {
    const now = Math.floor(Date.now() / 1000);
    const user = mount(
      PREVIEW,
      status({ confirmed: true, block_height: 4_611_010, confirmations: 1, at: now }),
    );
    await send(user);
    expect(await screen.findByText("1 confirmation as of just now")).toBeInTheDocument();
  });

  it("asks before forgetting a past broadcast, and forgets only on yes", async () => {
    useUi.setState({
      recentBroadcasts: [
        { txid: TXID, network: "signet", hex: HEX, backend: "mempool.space", at: 1_755_000_000 },
      ],
    });
    const user = mount();
    const past = () => within(screen.getByRole("region", { name: "Past broadcasts" }));
    await user.click(past().getByRole("button", { name: "Forget this broadcast" }));

    const dialog = within(await screen.findByRole("dialog", { name: "Forget this broadcast?" }));
    // What is lost and what is not, in words rather than in a colour.
    expect(dialog.getByText("This record cannot be brought back.")).toBeInTheDocument();
    expect(dialog.getByText(/on the network and is untouched/)).toBeInTheDocument();

    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(useUi.getState().recentBroadcasts).toHaveLength(1);

    await user.click(past().getByRole("button", { name: "Forget this broadcast" }));
    const asked = within(await screen.findByRole("dialog", { name: "Forget this broadcast?" }));
    await user.click(asked.getByRole("button", { name: "Forget" }));
    expect(useUi.getState().recentBroadcasts).toHaveLength(0);
    expect(screen.queryByRole("region", { name: "Past broadcasts" })).not.toBeInTheDocument();
  });

  it("prices a preview line in the chosen unit only, never in fiat", async () => {
    // The preview and the transaction detail are one page with two
    // entries: a row that carries euros here and only bitcoin there
    // would be the same list drawn by two rules.
    // The price query only runs because something on screen asks for a
    // rate, so putting a fiat line back here would fetch one and make
    // the euro figure appear: the absence below is what guards it.
    useUi.setState({ fiatEnabled: true, fiatCurrency: "eur", fiatSource: "coingecko" });
    const user = mount();
    await preview(user);
    const region = screen.getByRole("region", { name: "Outputs" });
    const outputs = within(region);
    expect(outputs.getByText("0.00150000 BTC")).toBeInTheDocument();
    await waitFor(() =>
      expect(outputs.queryByText(formatFiat(150_000, RATE, "eur"))).not.toBeInTheDocument(),
    );
    expect(region.textContent ?? "").not.toMatch(/[€$£¥]/);
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

  it("refuses a file far too large to be a transaction without reading it", async () => {
    let asked = false;
    mount();
    mockIPC((cmd) => {
      asked ||= cmd === "preview_transaction";
      return undefined;
    });
    const file = new File(["0200"], "disc.img");
    Object.defineProperty(file, "size", { value: MAX_TRANSACTION_FILE_BYTES + 1 });
    const read = vi.spyOn(file, "arrayBuffer");
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This file is too large to hold a transaction.",
    );
    expect(read).not.toHaveBeenCalled();
    expect(asked).toBe(false);
  });
});
