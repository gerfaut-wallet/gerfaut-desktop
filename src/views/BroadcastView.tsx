import {
  AlertTriangle,
  Ban,
  Check,
  CircleAlert,
  CircleHelp,
  Clock,
  Coins,
  EqualNot,
  ExternalLink,
  FileUp,
  Flame,
  Hourglass,
  Percent,
  PenOff,
  Radio,
  RefreshCw,
  ScanLine,
  Trash2,
  Undo2,
  Unlink,
  Wallet as WalletIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { clsx } from "clsx";
import { AddressChip } from "../components/AddressChip";
import { UnitAmount, useAmountText } from "../components/Amount";
import { Button } from "../components/Button";
import { OpenFailure, useExplorer } from "../components/ExternalLink";
import { Modal } from "../components/Modal";
import { Pill } from "../components/StatusPill";
import { Notice } from "../components/Notice";
import { ScanQrModal } from "../components/ScanQrModal";
import { BRANCH_ROLES, TxDiagram } from "../components/TxDiagram";
import type { BranchRole, TxBranch } from "../components/TxDiagram";
import type {
  Network,
  RecentBroadcast,
  TxInputPreview,
  TxOutputPreview,
  TxPreview,
  TxWarningKind,
} from "../lib/ipc";
import {
  FALSE_PROOF,
  PRIVATE_KEY_NOT_A_TRANSACTION,
  errorMessage,
  isCommandError,
  isFalseProof,
} from "../lib/ipc";
import { explorerTxUrl } from "../lib/explorer";
import {
  MASKED,
  NETWORK_LABEL,
  formatAmount,
  formatLocktime,
  groupThousands,
  opReturnPreview,
  relativeTime,
  sumSats,
} from "../lib/format";
import {
  useBroadcastTransaction,
  useForgetBroadcast,
  usePreviewTransaction,
  useRecentBroadcasts,
  useTransactionStatus,
} from "../state/queries";
import { useUi } from "../state/store";

/** PSBT file magic, BIP-174: a binary file that starts with it is
    passed to the core as hex, like any other bytes. */
const PSBT_MAGIC = [0x70, 0x73, 0x62, 0x74, 0xff];

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** The largest file read for a transaction: twice what the core takes
    as one. A bigger file is none, and reading it whole would only
    stall the window. */
export const MAX_TRANSACTION_FILE_BYTES = 8_000_000;

/** Reads an imported file into the text the core decodes: a binary
    PSBT or transaction as hex, anything else as the text it holds. */
export async function fileToInput(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPsbt = PSBT_MAGIC.every((byte, index) => bytes[index] === byte);
  if (isPsbt) return bytesToHex(bytes);
  const text = new TextDecoder("utf-8", { fatal: true });
  try {
    return text.decode(bytes).trim();
  } catch {
    return bytesToHex(bytes);
  }
}

/** What the page says when the core cannot read what was pasted as a
    transaction: what to paste instead. The core's own words follow,
    smaller, for the case it names (a single frame of an animated QR
    code, a coin spent twice). */
export const UNREADABLE_TRANSACTION =
  "This is not a transaction Gerfaut can read. Paste a signed transaction in hex, or a PSBT.";

/** A refusal to read the input, said under the field. */
interface InputError {
  headline: string;
  detail?: string;
}

/** Broadcast page: paste, import or scan a finished transaction, read
    what it does, hand it to the network, and follow it until it
    confirms. Gerfaut signs nothing here: what comes in signed goes out
    untouched, and what comes in unsigned goes back to the signer. */
export function BroadcastView({ network }: { network: Network }) {
  const { showToast } = useUi();
  const preview = usePreviewTransaction();
  const broadcast = useBroadcastTransaction();
  const recent = useRecentBroadcasts(network);
  const forget = useForgetBroadcast(network);
  const [raw, setRaw] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sent, setSent] = useState<RecentBroadcast | null>(null);
  /** A file refused before it was read: said where the core's refusal
      would be. */
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Another workspace network means another chain: start over.
  useEffect(() => {
    setRaw("");
    setSent(null);
    setFileError(null);
    preview.reset();
    broadcast.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network]);

  const decode = (input: string) => {
    setFileError(null);
    setSent(null);
    broadcast.reset();
    preview.mutate({ input, network });
  };

  const importFile = async (file: File) => {
    if (file.size > MAX_TRANSACTION_FILE_BYTES) {
      preview.reset();
      setFileError("This file is too large to hold a transaction.");
      return;
    }
    const input = await fileToInput(file);
    setRaw(input);
    decode(input);
  };

  const send = async () => {
    const hex = preview.data?.hex;
    if (!hex) return;
    setConfirmOpen(false);
    try {
      const report = await broadcast.mutateAsync({ network, hex });
      const entry: RecentBroadcast = {
        txid: report.txid,
        network,
        hex,
        backend: report.backend,
        at: report.at,
      };
      setSent(entry);
      showToast("Transaction broadcast");
    } catch {
      // The refusal is rendered below the preview, in the node's words.
    }
  };

  const startOver = () => {
    setRaw("");
    setSent(null);
    setFileError(null);
    preview.reset();
    broadcast.reset();
  };

  /** Typing again answers a refusal: it goes as soon as the text
      changes, and the hint it stood in for comes back in its place. */
  const edit = (value: string) => {
    setRaw(value);
    setFileError(null);
    if (preview.isError) preview.reset();
  };

  const inputError: InputError | null = fileError
    ? { headline: fileError }
    : preview.error
      ? isCommandError(preview.error) &&
        (preview.error.kind === "invalid_input" || preview.error.kind === "too_many_parts")
        ? { headline: UNREADABLE_TRANSACTION, detail: preview.error.message }
        : isCommandError(preview.error) && preview.error.kind === "private_material"
          ? { headline: PRIVATE_KEY_NOT_A_TRANSACTION }
          : { headline: errorMessage(preview.error) }
      : null;
  const broadcastError = broadcast.error ? errorMessage(broadcast.error) : null;

  const history = (recent.data ?? []).filter((entry) => entry.txid !== sent?.txid);

  return (
    <div className="pb-8">
      <header className="px-1 pb-5 pt-2">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.01em] text-text">
          Broadcast
        </h1>
        <p className="mt-1 font-ui text-sm text-muted">
          Send a transaction signed elsewhere to the network, and follow it until it confirms.
        </p>
      </header>

      <div className="flex flex-col gap-4">
        {!preview.data && !sent && (
          <InputCard
            raw={raw}
            onChange={edit}
            onDecode={() => decode(raw)}
            onImport={() => fileRef.current?.click()}
            onScan={() => setScanOpen(true)}
            busy={preview.isPending}
            error={inputError}
          />
        )}

        {preview.data && !sent && (
          <>
            <PreviewCard preview={preview.data} network={network} />
            {/* A node that says no risks neither funds nor privacy —
                but nothing else on the page says the send failed. */}
            {broadcastError && (
              <Notice tone="info" role="alert">
                <span className="font-medium">The network refused this transaction.</span>
                <span className="selectable mt-0.5 block break-words font-data text-xs text-muted">
                  {broadcastError}
                </span>
              </Notice>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 px-1">
              <Button variant="secondary" onClick={startOver} icon={Undo2}>
                Start over
              </Button>
              <Button
                variant="primary"
                icon={Radio}
                disabled={!sendable(preview.data)}
                busy={broadcast.isPending}
                onClick={() => setConfirmOpen(true)}
              >
                {broadcast.isPending ? "Broadcasting…" : "Broadcast"}
              </Button>
            </div>
          </>
        )}

        {sent && (
          <>
            <StatusCard entry={sent} onForget={() => forget.mutate(sent.txid)} live />
            {/* The status is inserted, it does not replace: what was
                just sent is exactly when one wants to re-read what it
                does. The two platforms differ in the facts they can
                offer, never in the layout. */}
            {preview.data && <PreviewCard preview={preview.data} network={network} />}
            <div className="px-1">
              <Button variant="primary" onClick={startOver} icon={Radio}>
                Broadcast another transaction
              </Button>
            </div>
          </>
        )}

        {history.length > 0 && (
          <section aria-label="Past broadcasts" className="mt-4">
            <h2 className="mb-2 px-1 font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
              Past broadcasts
            </h2>
            <div className="flex flex-col gap-3">
              {history.map((entry) => (
                <StatusCard
                  key={entry.txid}
                  entry={entry}
                  onForget={() => forget.mutate(entry.txid)}
                  forgetFailed={forget.isError && forget.variables === entry.txid}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".psbt,.txn,.tx,.txt,.hex,text/plain,application/octet-stream"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importFile(file);
          event.target.value = "";
        }}
      />
      <ScanQrModal
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        caption="Point the camera at a signed transaction or PSBT QR code: crypto-psbt UR or BBQr, animated or not."
        privateKey={PRIVATE_KEY_NOT_A_TRANSACTION}
        onScan={(text) => {
          setScanOpen(false);
          setRaw(text);
          decode(text);
        }}
      />
      {preview.data && (
        <Modal
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          title="Broadcast this transaction?"
          centered
        >
          <ConfirmBody preview={preview.data} />
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void send()} icon={Radio}>
              Broadcast
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// --- input -----------------------------------------------------------------

function InputCard({
  raw,
  onChange,
  onDecode,
  onImport,
  onScan,
  busy,
  error,
}: {
  raw: string;
  onChange: (value: string) => void;
  onDecode: () => void;
  onImport: () => void;
  onScan: () => void;
  busy: boolean;
  error: InputError | null;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <label
        htmlFor="broadcast-input"
        className="mb-1.5 block font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted"
      >
        Signed transaction
      </label>
      <textarea
        id="broadcast-input"
        value={raw}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        autoComplete="off"
        rows={7}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "broadcast-input-error" : "broadcast-input-hint"}
        placeholder="Paste a PSBT (base64 or hex) or a raw transaction (hex)…"
        className="field-focus selectable w-full resize-y rounded-sm border border-transparent bg-sunken p-3 font-data text-[13px] leading-relaxed text-text placeholder:text-muted"
      />
      {/* One slot under the field, for the hint or for what went wrong
          in its place: both sit in the same cell, the hint kept, hidden,
          while the error shows, and the cell holds room for the error's
          two lines. Neither one coming nor one going moves Preview. */}
      <div className="mt-2 grid min-h-10">
        <p
          id="broadcast-input-hint"
          className={clsx(
            "col-start-1 row-start-1 font-ui text-xs text-muted",
            error && "invisible",
          )}
        >
          PSBT files, transaction files, base64, hex, or an animated QR code from a
          signing device. Gerfaut never signs: a transaction missing signatures goes
          back to the signer.
        </p>
        {error && (
          // An input error is said in words, in the text colour with its
          // glyph, never in red: red is kept for what happens on chain.
          <div
            id="broadcast-input-error"
            role="alert"
            className="col-start-1 row-start-1 flex items-start gap-2"
          >
            <CircleAlert
              size={16}
              strokeWidth={1.5}
              aria-hidden
              className="mt-0.5 shrink-0 text-text"
            />
            <p className="min-w-0 font-ui text-sm font-medium text-text">
              {error.headline}
              {error.detail && (
                <span className="selectable mt-0.5 block break-words font-ui text-xs font-normal text-muted">
                  {error.detail}
                </span>
              )}
            </p>
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onImport} icon={FileUp}>
            Import a file
          </Button>
          <Button variant="secondary" onClick={onScan} icon={ScanLine}>
            Scan a QR code
          </Button>
        </div>
        <Button
          variant="primary"
          disabled={raw.trim().length === 0}
          busy={busy}
          onClick={onDecode}
        >
          {busy ? "Reading…" : "Preview"}
        </Button>
      </div>
    </div>
  );
}

// --- preview -----------------------------------------------------------------

/** The glyph of each caution. The tone is the core's answer and is read
    off `severity`; this only says what the caution is about. */
const WARNING_ICON: Record<TxWarningKind, LucideIcon> = {
  unsigned: PenOff,
  high_fee_rate: Flame,
  high_fee_share: Percent,
  locked: Clock,
  input_unknown: CircleHelp,
  input_spent: Ban,
  in_mempool: Hourglass,
  input_mismatch: EqualNot,
  fee_unknown: CircleHelp,
  dust_output: Coins,
  spends_watched: WalletIcon,
  uncommitted_outputs: Unlink,
};

/** What the reader can do about a caution, for the kinds where the
    screen knows where to look. The core says what is wrong; this only
    says what to do next, and never touches the tone. */
const WARNING_ADVICE: Partial<Record<TxWarningKind, string>> = {
  input_unknown:
    "Look the coin up on a backend you trust, or check the amounts on the signing device, before you send.",
  uncommitted_outputs:
    "This signature does not fix where all of the money goes: anyone who sees the transaction before it is mined can send some or all of it somewhere else. Unless you set this up on purpose, do not broadcast it.",
};

/** Whether the Broadcast button is on: the core's readiness, ready or
    already waiting in the mempool, which a node takes again harmlessly. */
function sendable(preview: TxPreview): boolean {
  return preview.readiness === "ready" || preview.readiness === "in_mempool";
}

/** The mark on a figure nobody confirmed: amber, and in words, since a
    colour alone tells nothing to a reader who cannot see it. It names
    whose word the figure is: the PSBT's, or, when a watched address's
    listing is among them, nobody's in particular, since that figure is
    the server's. It keeps its own case and tracking wherever it sits: in
    a heading set in capitals it would shout otherwise. */
function Claimed({ listed }: { listed: boolean }) {
  return (
    <span className="font-ui text-[11px] font-medium normal-case tracking-normal text-pending">
      {listed ? "unproven" : "as the PSBT claims"}
    </span>
  );
}

/** The fee rate as the core measured it: paid, estimated once signed, or
    the most it can be once signed. The figure, then what qualifies it. */
function feeRate(preview: TxPreview): { figure: string; signed: string | null } | null {
  const rate = preview.fee_rate_sat_vb;
  if (rate === null) return null;
  const figure = `${rate.toFixed(1)} sat/vB`;
  switch (preview.fee_rate_basis) {
    case "exact":
      return { figure, signed: null };
    case "estimated":
      return { figure: `≈ ${figure}`, signed: "once signed" };
    case "upper_bound":
      return { figure: `≤ ${figure}`, signed: "once signed" };
  }
}

/** What an input is to the watched wallets, in the diagram's words. */
function inputRole(input: TxInputPreview): BranchRole {
  return input.wallet !== null ? "wallet-in" : "external-in";
}

/** What an output is to the watched wallets, in the diagram's words. */
function outputRole(output: TxOutputPreview): BranchRole {
  if (output.op_return) return "op-return";
  if (output.wallet === null) return "external-out";
  return output.change ? "change" : "received";
}

/** The inputs of a transaction waiting to be sent, as diagram branches:
    an input is named by the outpoint it spends. */
function previewInputBranches(inputs: TxInputPreview[]): TxBranch[] {
  return inputs.map(
    (input): TxBranch => ({
      role: inputRole(input),
      label: `${input.txid}:${input.vout}`,
      amount: input.value_sats,
      isMine: input.wallet !== null,
    }),
  );
}

function previewOutputBranches(outputs: TxOutputPreview[]): TxBranch[] {
  return outputs.map(
    (output): TxBranch => ({
      role: outputRole(output),
      label: output.op_return
        ? opReturnPreview(output.op_return)
        : (output.address ?? "Script output"),
      amount: output.value_sats,
      isMine: output.wallet !== null,
    }),
  );
}

function PreviewCard({ preview, network }: { preview: TxPreview; network: Network }) {
  const { masked, unit } = useUi();
  const amount = (sats: number | null) =>
    sats === null ? "n/a" : masked ? MASKED : formatAmount(sats, unit);
  // A fee that rests on the PSBT's word is marked everywhere it shows,
  // the diagram included: a figure that looks confirmed in one place
  // and doubtful in another is read from the confident one.
  // `amounts_declared`: a value shown for a coin is one nothing proves,
  // and a total or a fee summed over it rests on the same word.
  const claimed = preview.amounts_declared;
  const listed = preview.amounts_listed;
  const feeNote =
    claimed && preview.fee_sats !== null ? <Claimed listed={listed} /> : undefined;
  const rate = feeRate(preview);

  return (
    <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
            Transaction
          </p>
          <div className="mt-1">
            <AddressChip value={preview.txid} head={12} tail={10} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="neutral">{preview.source === "psbt" ? "PSBT" : "Raw transaction"}</Pill>
          {/* Where it stands is the core's word, read as it comes. */}
          {preview.readiness === "ready" ? (
            <Pill tone="confirmed" icon={<Check size={12} strokeWidth={2} aria-hidden />}>
              Ready to broadcast
            </Pill>
          ) : preview.readiness === "in_mempool" ? (
            // Signed, and already out: the network holds it, and sending
            // it again does no harm. Neither green, as if nothing had
            // happened yet, nor red: amber, the hourglass of a
            // transaction waiting to be mined.
            <Pill tone="pending" icon={<Hourglass size={12} strokeWidth={2} aria-hidden />}>
              Already in the mempool
            </Pill>
          ) : preview.readiness === "refused" ? (
            // The core is sure the network refuses it: a coin spent in
            // a block, outputs past all the bitcoin there is or over
            // inputs proven to bring less. Signing again changes none
            // of that, so this is said before a missing signature.
            <Pill tone="pending" icon={<Ban size={12} strokeWidth={2} aria-hidden />}>
              Will be refused
            </Pill>
          ) : (
            // A status, in amber: nothing is at risk while the Broadcast
            // button stays off. The red is the core's `unsigned` caution
            // in the list below, so it is said once, where the reason is.
            <Pill tone="pending" icon={<PenOff size={12} strokeWidth={2} aria-hidden />}>
              Not fully signed
            </Pill>
          )}
          {preview.rbf && <Pill tone="neutral">RBF</Pill>}
        </div>
      </div>

      {/* Where the coins come from and where they go, before they go. */}
      <TxDiagram
        inputs={previewInputBranches(preview.inputs)}
        outputs={previewOutputBranches(preview.outputs)}
        feeSats={preview.fee_sats}
        feeNote={feeNote}
      />

      {preview.warnings.length > 0 && (
        <section aria-label="Before you send">
          <h2 className="mb-2 px-1 font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
            Before you send
          </h2>
          <ul className="flex flex-col gap-2">
            {preview.warnings.map((warning) => {
              // Checking the amounts is advice for amounts nothing
              // proves: a coin the previous transaction proves needs none.
              const advice =
                warning.kind === "input_unknown" && !preview.amounts_declared
                  ? undefined
                  : WARNING_ADVICE[warning.kind];
              return (
                // The core answers the one question that picks the tone,
                // so the same caution never reads red here and amber on
                // the phone. The glyph only says what it is about.
                <li key={warning.kind + warning.message}>
                  <Notice tone={warning.severity} icon={WARNING_ICON[warning.kind]}>
                    {warning.message}
                    {advice ? ` ${advice}` : ""}
                  </Notice>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <IoList title="Inputs" ios={preview.inputs} claimed={claimed} listed={listed} />
        <IoList title="Outputs" ios={preview.outputs} />
      </div>

      {/* The fee node carries the amount; the rate belongs here. */}
      <section aria-label="Technical" className="rounded-md border border-border p-4">
        <h2 className="mb-2.5 font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
          Technical
        </h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          <Fact label="Network">{NETWORK_LABEL[network]}</Fact>
          <Fact label="Size">{groupThousands(String(preview.size))} B</Fact>
          <Fact label="Virtual size">{groupThousands(String(preview.vsize))} vB</Fact>
          <Fact label="Weight">{groupThousands(String(preview.weight))} WU</Fact>
          <Fact label="Version">{preview.version}</Fact>
          {/* A locktime past the threshold is a date, not a height:
              printed raw it reads as a block nobody will ever see. */}
          <Fact label="Locktime">{formatLocktime(preview.locktime)}</Fact>
          {/* RBF, the word the chain gave it and the one people look
              for — the same name the transaction detail uses. */}
          <Fact label="RBF">{preview.rbf ? "signalled (BIP-125)" : "not signalled"}</Fact>
          <Fact label="Fee" note={feeNote}>
            {amount(preview.fee_sats)}
          </Fact>
          {/* Before the signatures are in, the rate is the one the
              transaction will pay once they are: said under the figure. */}
          <Fact
            label="Fee rate"
            note={
              rate?.signed || feeNote ? (
                <>
                  {rate?.signed && (
                    <span className="block font-ui text-[11px] text-muted">{rate.signed}</span>
                  )}
                  {feeNote}
                </>
              ) : undefined
            }
          >
            {rate ? rate.figure : "n/a"}
          </Fact>
        </dl>
      </section>
    </div>
  );
}

function IoList({
  title,
  ios,
  claimed = false,
  listed = false,
}: {
  title: string;
  ios: (TxInputPreview | TxOutputPreview)[];
  /** A value on this side is one nothing proves, so the total is too.
      Which row it is the core does not say, and a mark on the wrong
      row would be a claim of its own: the total carries it. */
  claimed?: boolean;
  /** Among those values, a watched address's listing: not the PSBT's. */
  listed?: boolean;
}) {
  // What the side carries, on the heading that counts it: the flow
  // summary used to say it, and a count alone answers half the question.
  const sum = sumSats(ios.map((io) => io.value_sats));
  const total = useAmountText(sum);
  return (
    <section aria-label={title} className="min-w-0">
      <h2 className="mb-2 px-1 font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
        {title} ({ios.length}) <span className="tabular">· {total}</span>
        {claimed && sum !== null && (
          <>
            {" · "}
            <Claimed listed={listed} />
          </>
        )}
      </h2>
      <ul className="flex flex-col gap-1.5">
        {ios.map((io, index) => {
          const mine = io.wallet !== null;
          const input = "signed" in io ? io : null;
          const output = "op_return" in io ? io : null;
          // The diagram's glyph for the same row: an output to someone
          // else points away, one back to the wallet points in.
          const role = BRANCH_ROLES[input ? inputRole(input) : outputRole(output!)];
          return (
            <li
              key={index}
              className={clsx(
                "flex items-center gap-3 rounded-md border px-3 py-2.5",
                mine ? "border-primary/40 bg-primary/[0.04]" : "border-border bg-surface",
                input && !input.signed && "border-alert/40",
              )}
            >
              <span
                aria-hidden
                className={clsx(
                  "inline-flex size-7 shrink-0 items-center justify-center rounded-md",
                  output?.op_return
                    ? "bg-pending-surface text-pending"
                    : mine
                      ? "bg-primary/10 text-primary"
                      : "bg-sunken text-muted",
                )}
              >
                {role.icon}
              </span>
              <span className="sr-only">{role.title}:</span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                {output?.op_return ? (
                  <>
                    <span className="font-ui text-[13px] font-medium text-pending">OP_RETURN</span>
                    <span
                      className="selectable truncate font-data text-[11px] text-muted"
                      title={output.op_return.text ?? output.op_return.hex}
                    >
                      {opReturnPreview(output.op_return)}
                    </span>
                  </>
                ) : io.address ? (
                  <AddressChip value={io.address} head={14} tail={8} />
                ) : input ? (
                  <span className="font-data text-[12px] text-muted">
                    {input.txid.slice(0, 10)}…{input.txid.slice(-6)}:{input.vout}
                  </span>
                ) : (
                  <span className="font-ui text-[13px] text-muted">Script output</span>
                )}
                <span className="flex flex-wrap items-center gap-1.5">
                  {io.wallet && (
                    <span className="font-ui text-[11px] font-medium text-primary">
                      {io.wallet.name}
                      {output?.change ? " · change" : ""}
                    </span>
                  )}
                  {input && !input.signed && (
                    <span className="font-ui text-[11px] font-medium text-alert">unsigned</span>
                  )}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <UnitAmount sats={io.value_sats} />
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Fact({
  label,
  note,
  children,
}: {
  label: string;
  /** A line under the figure, for what qualifies it. */
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="font-ui text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
        {label}
      </dt>
      <dd className="tabular mt-0.5 truncate font-ui text-sm text-text">
        {children}
        {note && <span className="block">{note}</span>}
      </dd>
    </div>
  );
}

function ConfirmBody({ preview }: { preview: TxPreview }) {
  const { masked, unit } = useUi();
  // The last figure read before an irreversible send: if it is the
  // PSBT's word, it is marked here as it was on the preview.
  const claimed = preview.amounts_declared && preview.fee_sats !== null;
  const rate = feeRate(preview);
  const outputsOpen = preview.warnings.some((warning) => warning.kind === "uncommitted_outputs");
  // A fee nobody could establish: the core's own line on why, said again
  // where the send is decided. For outputs over amounts nothing proves,
  // it is the one that says the network will refuse them if those
  // amounts are right.
  const whyNoFee = preview.fee_unknown_reason;
  return (
    <div className="flex flex-col gap-3">
      {preview.readiness === "in_mempool" ? (
        <p className="font-ui text-sm text-text">
          This transaction is already waiting in the mempool. Broadcasting it again does no
          harm: nodes that already hold it keep it, and others may relay it.
        </p>
      ) : (
        <p className="font-ui text-sm text-text">
          Once broadcast, a transaction cannot be taken back. Nodes will relay it and miners
          may include it in the next block.
        </p>
      )}
      <dl className="grid grid-cols-2 gap-3 rounded-md bg-sunken/50 p-3">
        <Fact label="Outputs">{groupThousands(String(preview.outputs.length))}</Fact>
        {/* Outputs over proven amounts, or past all the bitcoin there
            will ever be, never get here: the core blocks the send. Over
            amounts only the PSBT declares, the fee is as unknown as they
            are, and the line under the facts says what that means. */}
        <Fact label="Fee" note={claimed ? <Claimed listed={preview.amounts_listed} /> : undefined}>
          {preview.fee_sats === null
            ? "unknown"
            : masked
              ? MASKED
              : `${formatAmount(preview.fee_sats, unit)}${
                  rate ? ` · ${rate.figure}${rate.signed ? ` ${rate.signed}` : ""}` : ""
                }`}
        </Fact>
      </dl>
      {whyNoFee && <p className="font-ui text-sm text-pending">{whyNoFee}</p>}
      {/* The one caution that makes the outputs above a suggestion:
          said again here, in red, where the send is decided. */}
      {outputsOpen && (
        <Notice tone="alert" icon={Unlink}>
          A signature in this transaction leaves some or all of its outputs open: whoever
          relays it can change where the money goes.
        </Notice>
      )}
      {(claimed || preview.warnings.some((warning) => warning.severity === "alert")) && (
        <p className="font-ui text-xs text-pending">
          The cautions listed on the preview still apply.
        </p>
      )}
    </div>
  );
}

// --- status ------------------------------------------------------------------

/** Where a broadcast transaction stands, polled while it is pending. */
function StatusCard({
  entry,
  onForget,
  forgetFailed = false,
  live = false,
}: {
  entry: RecentBroadcast;
  onForget: () => void;
  /** The vault did not drop the record: said on the card, which stays,
      until the next try. Not a toast: a failure does not go away by
      itself. */
  forgetFailed?: boolean;
  /** The one just sent: polled from the start, shown large. */
  live?: boolean;
}) {
  const [watching, setWatching] = useState(live);
  const status = useTransactionStatus(entry.network, watching ? entry.hex : null);
  const [confirmForget, setConfirmForget] = useState(false);
  const url = explorerTxUrl(entry.network, entry.txid);
  const explorer = useExplorer(url);

  const standing = status.data;
  // A transaction the backend has not seen is most often one it has not
  // indexed yet, and the line below says broadcasting it again does no
  // harm: nothing is lost, so nothing is red. Amber, with its own glyph
  // and its own words — the colour is never the only carrier.
  const tone = !standing ? "neutral" : standing.confirmed ? "confirmed" : "pending";

  return (
    <div
      className={clsx(
        "rounded-lg border bg-surface",
        live ? "border-border p-5" : "border-border p-4",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
            {live ? "Sent" : `Sent ${relativeTime(entry.at)}`} · {entry.backend}
          </p>
          <div className="mt-1">
            <AddressChip value={entry.txid} head={12} tail={10} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {standing && (
            <span
              className={clsx(
                "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 font-ui text-xs font-medium",
                tone === "confirmed" && "border-confirmed/25 bg-confirmed-surface text-confirmed",
                tone === "pending" && "border-pending/25 bg-pending-surface text-pending",
              )}
              aria-live="polite"
            >
              {standing.confirmed ? (
                <Check size={12} strokeWidth={2} aria-hidden />
              ) : standing.found ? (
                <Clock size={12} strokeWidth={2} aria-hidden />
              ) : (
                <AlertTriangle size={12} strokeWidth={2} aria-hidden />
              )}
              {standing.confirmed
                ? `Confirmed · ${standing.confirmations} conf`
                : standing.found
                  ? "In the mempool"
                  : "Not seen"}
            </span>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => (watching ? void status.refetch() : setWatching(true))}
            aria-label="Check status"
          >
            <RefreshCw
              size={14}
              strokeWidth={1.5}
              aria-hidden
              className={status.isFetching ? "motion-safe:animate-spin" : undefined}
            />
            {watching ? "Refresh" : "Check"}
          </Button>
        </div>
      </div>

      <div className="mt-3 font-ui text-sm text-muted" aria-live="polite">
        {!watching && <p>Not checked since this session opened.</p>}
        {watching && status.isPending && <p>Asking the backend…</p>}
        {watching && status.isError && (
          <p>
            {isFalseProof(status.error)
              ? FALSE_PROOF
              : "The backend did not answer. Try again in a moment."}
          </p>
        )}
        {standing &&
          (standing.confirmed ? (
            <>
              {/* The height keeps a line to itself. Run into the count
                  after a comma, the grouped number swallows it: "block
                  4 611 010, 3 confirmations" reads as one figure whose
                  last group happens to be a 3. */}
              {standing.block_height !== null && (
                <p>{`Mined in block ${groupThousands(String(standing.block_height))}`}</p>
              )}
              <p>{`${groupThousands(String(standing.confirmations))} confirmation${standing.confirmations === 1 ? "" : "s"} as of ${relativeTime(standing.at)}`}</p>
            </>
          ) : standing.found ? (
            <p>Waiting to be mined.</p>
          ) : (
            <p>{`${standing.backend} does not have this transaction. It may not have been relayed, or it was dropped or replaced. Broadcasting it again does no harm.`}</p>
          ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {url && (
          <Button variant="secondary" size="sm" onClick={explorer.ask} icon={ExternalLink}>
            View on mempool.space
          </Button>
        )}
        {!live && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setConfirmForget(true)}
            aria-label="Forget this broadcast"
            icon={Trash2}
          >
            Forget
          </Button>
        )}
      </div>
      {/* Amber, as the link nothing opened below it: nothing on chain
          moves and no privacy is spent, the record simply stays. */}
      {forgetFailed && (
        <Notice tone="info" role="alert" className="mt-2">
          Could not forget this broadcast. Try again.
        </Notice>
      )}
      <OpenFailure url={explorer.failed} />

      {explorer.warning}

      <Modal
        open={confirmForget}
        onClose={() => setConfirmForget(false)}
        title="Forget this broadcast?"
        centered
      >
        {/* Amber, not red: nothing on chain moves and no privacy is
            spent — only a row in a local list goes. Red is kept for
            lost funds and lost privacy, and it is explicitly not the
            colour of a delete. The words carry the irreversibility. */}
        <Notice tone="info">
          <span className="font-medium">This record cannot be brought back.</span>
          <span className="mt-0.5 block text-xs text-muted">
            Gerfaut keeps no copy once it is forgotten.
          </span>
        </Notice>
        <p className="mt-4 font-ui text-sm text-muted">
          This only drops Gerfaut's local record of the broadcast. The transaction is on
          the network and is untouched.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmForget(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmForget(false);
              onForget();
            }}
            icon={Trash2}
          >
            Forget
          </Button>
        </div>
      </Modal>
    </div>
  );
}
