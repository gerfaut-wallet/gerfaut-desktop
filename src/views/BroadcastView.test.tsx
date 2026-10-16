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

function warning(
  kind: TxWarning["kind"],
  severity: TxWarning["severity"],
  message: string,
  blocking = false,
): TxWarning {
  return { kind, severity, message, blocking };
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
  fee_unknown_reason: null,
  amounts_declared: false,
  vsize: 141,
  weight: 561,
  size: 215,
  version: 2,
  locktime: 0,
  rbf: true,
  readiness: "ready",
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

  /** The lists name each row with the diagram's glyph: an output to
      someone else points away, never in, as the diagram drew it. */
  it("gives each input and output the diagram's glyph and role", async () => {
    const user = mount();
    await preview(user);

    const [spent] = within(screen.getByRole("region", { name: "Inputs" })).getAllByRole("listitem");
    expect(spent.querySelector(".lucide-wallet")).toBeInTheDocument();
    expect(spent).toHaveTextContent("Spent from this wallet:");

    const [theirs, change] = within(screen.getByRole("region", { name: "Outputs" })).getAllByRole(
      "listitem",
    );
    expect(theirs.querySelector(".lucide-arrow-up-right")).toBeInTheDocument();
    expect(theirs.querySelector(".lucide-arrow-down-left")).not.toBeInTheDocument();
    expect(theirs).toHaveTextContent("External output:");
    expect(change.querySelector(".lucide-undo-2")).toBeInTheDocument();
    expect(change).toHaveTextContent("Change back to this wallet:");
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

  /** A signature over only some outputs, or none: what the preview
      shows is not what the network has to pay. Red on the page, with
      the plain words after the core's, and red again where the send is
      decided. */
  it("warns in red when a signature leaves the outputs open", async () => {
    const user = mount({
      ...PREVIEW,
      warnings: [
        warning(
          "uncommitted_outputs",
          "alert",
          "Input 0 is signed with SIGHASH_NONE, which leaves some or all of the outputs open: whoever relays or mines this transaction can send that money elsewhere. Have it signed again over every output (SIGHASH_ALL).",
        ),
      ],
    });
    await preview(user);

    const cautions = within(screen.getByRole("region", { name: "Before you send" }));
    const [note] = cautions.getAllByRole("listitem");
    expect(note.firstElementChild).toHaveClass("bg-alert-surface", "text-alert");
    expect(note.querySelector(".lucide-unlink")).toBeInTheDocument();
    expect(note).toHaveTextContent(
      /\(SIGHASH_ALL\)\. This signature does not fix where all of the money goes: anyone who sees the transaction before it is mined can send some or all of it somewhere else\. Unless you set this up on purpose, do not broadcast it\.$/,
    );

    await user.click(screen.getByRole("button", { name: "Broadcast" }));
    const dialog = within(await screen.findByRole("dialog"));
    const reminder = dialog.getByText(/leaves some or all of its outputs open: whoever relays it can change/);
    expect(reminder.parentElement).toHaveClass("bg-alert-surface", "text-alert");
  });

  /** Every coin's value confirmed and there is still no fee: the
      outputs pay more than the inputs bring. No node takes that, so the
      core blocks the send, and the pill says the same as the caution. */
  it("says outputs over the inputs will be refused, and keeps Broadcast off", async () => {
    const user = mount({
      ...PREVIEW,
      fee_sats: null,
      fee_rate_sat_vb: null,
      readiness: "refused",
      hex: null,
      warnings: [
        warning(
          "fee_unknown",
          "info",
          "The outputs pay more than the inputs bring: the network will refuse this transaction.",
          true,
        ),
      ],
    });
    await preview(user);
    expect(screen.getByText("Will be refused")).toHaveAttribute("data-tone", "pending");
    expect(screen.queryByText("Ready to broadcast")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Broadcast" })).toBeDisabled();
  });

  /** A transaction already mined, pasted again, used to read "Ready to
      broadcast" in green beside the red line saying its coin was spent.
      The core blocks a coin spent in a block, and the pill and the
      button follow it. */
  it("never calls ready a transaction whose coin is spent in a block", async () => {
    const user = mount({
      ...PREVIEW,
      readiness: "refused",
      hex: null,
      warnings: [
        warning(
          "input_spent",
          "alert",
          "Input 0 is already spent by another transaction, which is in a block. The network will refuse this one.",
          true,
        ),
      ],
    });
    await preview(user);
    const pill = screen.getByText("Will be refused");
    expect(pill).toHaveAttribute("data-tone", "pending");
    expect(screen.queryByText("Ready to broadcast")).not.toBeInTheDocument();
    expect(screen.queryByText("Not fully signed")).not.toBeInTheDocument();
    const caution = screen.getByText(/already spent by another transaction/);
    expect(caution.parentElement).toHaveClass("bg-alert-surface", "text-alert");
    expect(screen.getByRole("button", { name: "Broadcast" })).toBeDisabled();
  });

  /** The pill says what the core says, as it says it: the screen works
      nothing out of the cautions, which may say more or less. */
  it("reads the pill off the core, never off the cautions", async () => {
    const user = mount({ ...PREVIEW, readiness: "refused", hex: null });
    await preview(user);
    expect(screen.getByText("Will be refused")).toHaveAttribute("data-tone", "pending");
    expect(screen.queryByText("Not fully signed")).not.toBeInTheDocument();
  });

  /** The pill and the Broadcast button read one thing: a refused
      transaction is never sendable, hex or no hex. */
  it("keeps the pill and the button on the same state", async () => {
    const user = mount({ ...PREVIEW, readiness: "refused" });
    await preview(user);
    expect(screen.getByText("Will be refused")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Broadcast" })).toBeDisabled();
  });

  /** Outputs over amounts only the PSBT declares stay sendable: the
      node goes by the real coins. The last look before the send says
      what happens if the declared amounts are right. */
  it("says at the confirmation when declared amounts would be refused", async () => {
    const line =
      "The outputs pay more than the inputs bring, by amounts nothing proves: if those amounts are right, the network will refuse this transaction.";
    // The reason is the core's field, read as it comes: the cautions
    // are not searched for it.
    const user = mount({
      ...PREVIEW,
      fee_sats: null,
      fee_rate_sat_vb: null,
      fee_unknown_reason: line,
      amounts_declared: true,
      warnings: [],
    });
    await preview(user);
    expect(screen.getByText("Ready to broadcast")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Broadcast" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("unknown")).toBeInTheDocument();
    expect(dialog.getByText(line)).toHaveClass("text-pending");
  });

  /** A spend still in the mempool is the node's to judge: this one may
      replace it. The caution stays red, and the send stays possible. */
  it("leaves a red caution that blocks nothing to the node", async () => {
    const user = mount({
      ...PREVIEW,
      warnings: [
        warning(
          "input_spent",
          "alert",
          "Input 0 is already spent by another transaction waiting in the mempool.",
        ),
      ],
    });
    await preview(user);
    expect(screen.getByText("Ready to broadcast")).toHaveAttribute("data-tone", "confirmed");
    expect(screen.getByRole("button", { name: "Broadcast" })).toBeEnabled();
  });

  /** Text the core cannot read: what to paste, said as an error the
      field carries — in the text colour, never the grey of a hint, and
      never in red, which belongs to the chain. */
  it("says what to paste when the text is not a transaction", async () => {
    const user = mount();
    mockIPC((cmd) => {
      if (cmd === "preview_transaction") {
        throw { kind: "invalid_input", message: "invalid transaction: not hex and not base64" };
      }
      return undefined;
    });
    const field = screen.getByLabelText("Signed transaction");
    await user.type(field, "this is not a transaction");
    await user.click(screen.getByRole("button", { name: "Preview" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "This is not a transaction Gerfaut can read. Paste a signed transaction in hex, or a PSBT.",
    );
    expect(alert).toHaveTextContent("invalid transaction: not hex and not base64");
    const headline = within(alert).getByText(/This is not a transaction/);
    expect(headline).toHaveClass("text-text");
    expect(headline).not.toHaveClass("text-muted");
    expect(alert.innerHTML).not.toMatch(/text-alert|bg-alert/);
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAttribute("aria-describedby", alert.id);
  });

  /** The error answered what was typed; typing again answers it. It
      goes at the first keystroke, and the hint comes back in the slot
      it held, so Preview stays where it was. */
  it("drops the error as soon as the text changes, in the slot of the hint", async () => {
    const user = mount();
    mockIPC((cmd) => {
      if (cmd === "preview_transaction") {
        throw { kind: "invalid_input", message: "invalid transaction: not hex and not base64" };
      }
      return undefined;
    });
    const field = screen.getByLabelText("Signed transaction");
    await user.type(field, "nope");
    await user.click(screen.getByRole("button", { name: "Preview" }));
    const alert = await screen.findByRole("alert");
    const hint = screen.getByText(/PSBT files, transaction files/);
    // One cell: the hint is kept, hidden, under the error.
    expect(alert.parentElement).toBe(hint.parentElement);
    expect(hint).toHaveClass("invisible");

    await user.type(field, "!");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(field).not.toHaveAttribute("aria-invalid");
    expect(field).toHaveAttribute("aria-describedby", hint.id);
    expect(hint).not.toHaveClass("invisible");
  });

  /** A coin nothing stood behind — no backend answered, or none knew
      it. The core says so, in amber, and the preview still shows the
      fee it summed over the PSBT's own word. The mark says which figures
      are that word; the caution says where to check them. */
  it("marks every figure that rests on the PSBT's word when a coin was not checked", async () => {
    const user = mount({
      ...PREVIEW,
      amounts_declared: true,
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

  /** No backend answered, but the PSBT carries the previous
      transaction, which proves the value: the coin is unchecked, its
      amount is not a claim, and no figure says it is. */
  it("marks no figure the previous transaction proves", async () => {
    const user = mount({
      ...PREVIEW,
      amounts_declared: false,
      inputs: [{ ...PREVIEW.inputs[0], wallet: null }],
      warnings: [
        warning(
          "input_unknown",
          "info",
          "Input 0 could not be checked: no backend answered about this coin. Its value is proven by the previous transaction the PSBT carries, the one this input spends; whether the coin is still there to spend is not.",
        ),
      ],
    });
    await preview(user);
    expect(screen.queryByText("as the PSBT claims")).not.toBeInTheDocument();
    // Nor the advice to check the amounts on the signing device: they
    // are proven.
    expect(screen.queryByText(/check the amounts on the signing device/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Broadcast" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.queryByText("as the PSBT claims")).not.toBeInTheDocument();
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

  it("says a transaction is not fully signed in amber, and keeps it", async () => {
    const user = mount({
      ...PREVIEW,
      readiness: "unsigned",
      hex: null,
      warnings: [warning("unsigned", "alert", "Some inputs carry no signature yet.", true)],
    });
    await preview(user);
    const pill = screen.getByText("Not fully signed");
    expect(screen.queryByText("Unsigned")).not.toBeInTheDocument();
    // The pill is a status: nothing leaves while Broadcast is off. The
    // red belongs to the core's caution, which says why.
    expect(pill).toHaveAttribute("data-tone", "pending");
    const caution = screen.getByText(/Some inputs carry no signature yet\./);
    expect(caution.parentElement).toHaveClass("bg-alert-surface", "text-alert");
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
      expect(
        outputs.queryByText(formatFiat(150_000, RATE, "eur", "mainnet")),
      ).not.toBeInTheDocument(),
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
