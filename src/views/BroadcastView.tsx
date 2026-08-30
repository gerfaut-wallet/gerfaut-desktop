import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Clock,
  ExternalLink,
  FileUp,
  Info,
  Radio,
  RefreshCw,
  ScanLine,
  Trash2,
  Undo2,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { clsx } from "clsx";
import { AddressChip } from "../components/AddressChip";
import { StackedAmount } from "../components/Amount";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { Notice } from "../components/Notice";
import { ScanQrModal } from "../components/ScanQrModal";
import { TxDiagram } from "../components/TxDiagram";
import type { TxBranch } from "../components/TxDiagram";
import type {
  Network,
  TxInputPreview,
  TxOutputPreview,
  TxPreview,
  TxWarning,
} from "../lib/ipc";
import { isCommandError } from "../lib/ipc";
import { explorerTxUrl } from "../lib/explorer";
import {
  MASKED,
  formatAmount,
  groupThousands,
  opReturnPreview,
  relativeTime,
} from "../lib/format";
import {
  useBroadcastTransaction,
  usePreviewTransaction,
  useTransactionStatus,
} from "../state/queries";
import type { RecentBroadcast } from "../state/store";
import { useUi } from "../state/store";

/** PSBT file magic, BIP-174: a binary file that starts with it is
    passed to the core as hex, like any other bytes. */
const PSBT_MAGIC = [0x70, 0x73, 0x62, 0x74, 0xff];

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

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

/** Broadcast page: paste, import or scan a finished transaction, read
    what it does, hand it to the network, and follow it until it
    confirms. Gerfaut signs nothing here: what comes in signed goes out
    untouched, and what comes in unsigned goes back to the signer. */
export function BroadcastView({ network }: { network: Network }) {
  const { recentBroadcasts, rememberBroadcast, forgetBroadcast, showToast } = useUi();
  const preview = usePreviewTransaction();
  const broadcast = useBroadcastTransaction();
  const [raw, setRaw] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sent, setSent] = useState<RecentBroadcast | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Another workspace network means another chain: start over.
  useEffect(() => {
    setRaw("");
    setSent(null);
    preview.reset();
    broadcast.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network]);

  const decode = (input: string) => {
    setSent(null);
    broadcast.reset();
    preview.mutate({ input, network });
  };

  const importFile = async (file: File) => {
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
      rememberBroadcast(entry);
      setSent(entry);
      showToast("Transaction broadcast");
    } catch {
      // The refusal is rendered below the preview, in the node's words.
    }
  };

  const startOver = () => {
    setRaw("");
    setSent(null);
    preview.reset();
    broadcast.reset();
  };

  const previewError = preview.error
    ? isCommandError(preview.error)
      ? preview.error.message
      : String(preview.error)
    : null;
  const broadcastError = broadcast.error
    ? isCommandError(broadcast.error)
      ? broadcast.error.message
      : String(broadcast.error)
    : null;

  const history = recentBroadcasts.filter(
    (entry) => entry.network === network && entry.txid !== sent?.txid,
  );

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
            onChange={setRaw}
            onDecode={() => decode(raw)}
            onImport={() => fileRef.current?.click()}
            onScan={() => setScanOpen(true)}
            busy={preview.isPending}
            error={previewError}
          />
        )}

        {preview.data && !sent && (
          <>
            <PreviewCard preview={preview.data} />
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
              <Button variant="ghost" onClick={startOver}>
                <Undo2 size={15} strokeWidth={1.5} aria-hidden />
                Start over
              </Button>
              <Button
                variant="primary"
                disabled={!preview.data.ready || broadcast.isPending}
                onClick={() => setConfirmOpen(true)}
              >
                <Radio size={16} strokeWidth={1.5} aria-hidden />
                {broadcast.isPending ? "Broadcasting…" : "Broadcast"}
              </Button>
            </div>
          </>
        )}

        {sent && (
          <>
            <StatusCard entry={sent} onForget={() => forgetBroadcast(sent.txid)} live />
            <div className="px-1">
              <Button variant="primary" onClick={startOver}>
                <Radio size={16} strokeWidth={1.5} aria-hidden />
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
                  onForget={() => forgetBroadcast(entry.txid)}
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
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void send()}>
              <Radio size={16} strokeWidth={1.5} aria-hidden />
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
  error: string | null;
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
        rows={7}
        placeholder="Paste a PSBT (base64 or hex) or a raw transaction (hex)…"
        className="selectable w-full resize-y rounded-sm bg-sunken p-3 font-data text-[13px] leading-relaxed text-text outline-none placeholder:text-muted/60 focus-visible:shadow-[inset_0_0_0_2px_var(--color-primary)]"
      />
      {error && (
        <p role="alert" className="mt-2 font-ui text-sm text-muted">
          {error}
        </p>
      )}
      <p className="mt-2 font-ui text-xs text-muted">
        PSBT files, transaction files, base64, hex, or an animated QR code from a
        signing device. Gerfaut never signs: a transaction missing signatures goes
        back to the signer.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1">
          <Button variant="ghost" onClick={onImport}>
            <FileUp size={16} strokeWidth={1.5} aria-hidden />
            Import a file
          </Button>
          <Button variant="ghost" onClick={onScan}>
            <ScanLine size={16} strokeWidth={1.5} aria-hidden />
            Scan a QR code
          </Button>
        </div>
        <Button variant="primary" disabled={raw.trim().length === 0 || busy} onClick={onDecode}>
          {busy ? "Reading…" : "Preview"}
        </Button>
      </div>
    </div>
  );
}

// --- preview -----------------------------------------------------------------

const WARNING_STYLE: Record<TxWarning["kind"], "alert" | "pending" | "info"> = {
  unsigned: "alert",
  input_spent: "alert",
  input_unknown: "alert",
  high_fee_rate: "pending",
  high_fee_share: "pending",
  locked: "pending",
  fee_unknown: "pending",
  dust_output: "pending",
  spends_watched: "info",
};

/** The inputs of a transaction waiting to be sent, as diagram branches:
    an input is named by the outpoint it spends. */
function previewInputBranches(inputs: TxInputPreview[]): TxBranch[] {
  return inputs.map(
    (input): TxBranch => ({
      role: input.wallet !== null ? "wallet-in" : "external-in",
      label: `${input.txid}:${input.vout}`,
      amount: input.value_sats,
      isMine: input.wallet !== null,
    }),
  );
}

function previewOutputBranches(outputs: TxOutputPreview[]): TxBranch[] {
  return outputs.map(
    (output): TxBranch => ({
      role: output.op_return
        ? "op-return"
        : output.wallet !== null
          ? output.change
            ? "change"
            : "received"
          : "external-out",
      label: output.op_return
        ? opReturnPreview(output.op_return)
        : (output.address ?? "non-standard script"),
      amount: output.value_sats,
      isMine: output.wallet !== null,
    }),
  );
}

function PreviewCard({ preview }: { preview: TxPreview }) {
  const { masked, unit } = useUi();
  const amount = (sats: number | null) =>
    sats === null ? "n/a" : masked ? MASKED : formatAmount(sats, unit);

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
          {preview.ready ? (
            <Pill tone="confirmed" icon={<Check size={12} strokeWidth={2} aria-hidden />}>
              Ready to broadcast
            </Pill>
          ) : (
            <Pill tone="pending" icon={<AlertTriangle size={12} strokeWidth={2} aria-hidden />}>
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
      />

      {preview.warnings.length > 0 && (
        <ul aria-label="Cautions" className="flex flex-col gap-2">
          {preview.warnings.map((warning) => {
            const tone = WARNING_STYLE[warning.kind];
            return (
              <li
                key={warning.kind + warning.message}
                className={clsx(
                  "flex items-start gap-2.5 rounded-md border p-3",
                  tone === "alert" && "border-alert/25 bg-alert-surface",
                  tone === "pending" && "border-pending/25 bg-pending-surface",
                  tone === "info" && "border-border bg-sunken/40",
                )}
              >
                {/* The glyph rides the first line of the message, the
                    way the shared note does it: a box exactly one line
                    tall, never a nudge that is right at one size only. */}
                <span className="flex h-4 shrink-0 items-center">
                  {tone === "info" ? (
                    <Info size={15} strokeWidth={1.75} aria-hidden className="text-muted" />
                  ) : (
                    <AlertTriangle
                      size={15}
                      strokeWidth={1.75}
                      aria-hidden
                      className={tone === "alert" ? "text-alert" : "text-pending"}
                    />
                  )}
                </span>
                <p
                  className={clsx(
                    "font-ui text-xs leading-4",
                    tone === "alert" && "text-alert",
                    tone === "pending" && "text-pending",
                    tone === "info" && "text-muted",
                  )}
                >
                  {warning.message}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <IoList title="Inputs" side="in" ios={preview.inputs} />
        <IoList title="Outputs" side="out" ios={preview.outputs} />
      </div>

      {/* The fee node carries the amount; the rate belongs here. */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-md border border-border p-4 sm:grid-cols-4">
        <Fact label="Size">{groupThousands(String(preview.size))} B</Fact>
        <Fact label="Virtual size">{groupThousands(String(preview.vsize))} vB</Fact>
        <Fact label="Weight">{groupThousands(String(preview.weight))} WU</Fact>
        <Fact label="Version">{preview.version}</Fact>
        <Fact label="Locktime">
          {preview.locktime > 0 ? groupThousands(String(preview.locktime)) : "none"}
        </Fact>
        {/* RBF, the word the chain gave it and the one people look
            for — the same name the transaction detail uses. */}
        <Fact label="RBF">{preview.rbf ? "signalled (BIP-125)" : "not signalled"}</Fact>
        <Fact label="Fee">{amount(preview.fee_sats)}</Fact>
        <Fact label="Fee rate">
          {preview.fee_rate_sat_vb !== null ? `${preview.fee_rate_sat_vb.toFixed(1)} sat/vB` : "n/a"}
        </Fact>
      </dl>
    </div>
  );
}

function IoList({
  title,
  side,
  ios,
}: {
  title: string;
  side: "in" | "out";
  ios: (TxInputPreview | TxOutputPreview)[];
}) {
  return (
    <section aria-label={title} className="min-w-0">
      <h2 className="mb-2 px-1 font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
        {title} ({ios.length})
      </h2>
      <ul className="flex flex-col gap-1.5">
        {ios.map((io, index) => {
          const mine = io.wallet !== null;
          const input = "signed" in io ? io : null;
          const output = "op_return" in io ? io : null;
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
                  mine ? "bg-primary/10 text-primary" : "bg-sunken text-muted",
                )}
              >
                {side === "in" ? (
                  <ArrowUpRight size={14} strokeWidth={1.75} />
                ) : (
                  <ArrowDownLeft size={14} strokeWidth={1.75} />
                )}
              </span>
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
                  <span className="font-ui text-[13px] text-muted">non-standard script</span>
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
                {io.value_sats !== null ? (
                  <StackedAmount sats={io.value_sats} />
                ) : (
                  <span className="font-ui text-[13px] text-muted">unknown</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="font-ui text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
        {label}
      </dt>
      <dd className="tabular mt-0.5 truncate font-ui text-sm text-text">{children}</dd>
    </div>
  );
}

function Pill({
  tone,
  icon,
  children,
}: {
  tone: "neutral" | "confirmed" | "pending";
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 font-ui text-xs font-medium",
        tone === "neutral" && "border-border bg-sunken text-muted",
        tone === "confirmed" && "border-confirmed/25 bg-confirmed-surface text-confirmed",
        tone === "pending" && "border-pending/25 bg-pending-surface text-pending",
      )}
    >
      {icon}
      {children}
    </span>
  );
}

function ConfirmBody({ preview }: { preview: TxPreview }) {
  const { masked, unit } = useUi();
  return (
    <div className="flex flex-col gap-3">
      <p className="font-ui text-sm text-text">
        Once broadcast, a transaction cannot be taken back. Nodes will relay it and miners
        may include it in the next block.
      </p>
      <dl className="grid grid-cols-2 gap-3 rounded-md bg-sunken/50 p-3">
        <Fact label="Outputs">{groupThousands(String(preview.outputs.length))}</Fact>
        <Fact label="Fee">
          {preview.fee_sats === null
            ? "unknown"
            : masked
              ? MASKED
              : `${formatAmount(preview.fee_sats, unit)}${
                  preview.fee_rate_sat_vb !== null
                    ? ` · ${preview.fee_rate_sat_vb.toFixed(1)} sat/vB`
                    : ""
                }`}
        </Fact>
      </dl>
      {preview.warnings.some((w) => WARNING_STYLE[w.kind] !== "info") && (
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
  live = false,
}: {
  entry: RecentBroadcast;
  onForget: () => void;
  /** The one just sent: polled from the start, shown large. */
  live?: boolean;
}) {
  const { explorerAck, setExplorerAck } = useUi();
  const [watching, setWatching] = useState(live);
  const status = useTransactionStatus(entry.network, watching ? entry.hex : null);
  const [confirmExplorer, setConfirmExplorer] = useState(false);
  const [skipNextTime, setSkipNextTime] = useState(false);
  const url = explorerTxUrl(entry.network, entry.txid);

  const openExplorer = () => {
    if (url) void openUrl(url);
  };

  const standing = status.data;
  const tone = !standing
    ? "neutral"
    : standing.confirmed
      ? "confirmed"
      : standing.found
        ? "pending"
        : "alert";

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
                tone === "alert" && "border-alert/25 bg-alert-surface text-alert",
              )}
              aria-live="polite"
            >
              {tone === "confirmed" ? (
                <Check size={12} strokeWidth={2} aria-hidden />
              ) : tone === "pending" ? (
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
            variant="ghost"
            className="h-8 px-2"
            onClick={() => (watching ? void status.refetch() : setWatching(true))}
            aria-label="Check status"
          >
            <RefreshCw
              size={14}
              strokeWidth={1.5}
              aria-hidden
              className={status.isFetching ? "animate-spin" : undefined}
            />
            {watching ? "Refresh" : "Check"}
          </Button>
        </div>
      </div>

      <p className="mt-3 font-ui text-sm text-muted" aria-live="polite">
        {!watching && "Not checked since this session opened."}
        {watching && status.isPending && "Asking the backend…"}
        {watching && status.isError && "The backend did not answer. Try again in a moment."}
        {standing &&
          (standing.confirmed
            ? `Mined in block ${groupThousands(String(standing.block_height ?? 0))}, ${standing.confirmations} confirmation${standing.confirmations === 1 ? "" : "s"} as of ${relativeTime(standing.at)}.`
            : standing.found
              ? "Waiting to be mined."
              : `${standing.backend} does not have this transaction. It may not have been relayed, or it was dropped or replaced. Broadcasting it again does no harm.`)}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {url && (
          <Button
            variant="ghost"
            className="h-8"
            onClick={() => (explorerAck ? openExplorer() : setConfirmExplorer(true))}
          >
            <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
            View on mempool.space
          </Button>
        )}
        {!live && (
          <Button variant="ghost" className="h-8" onClick={onForget} aria-label="Forget this broadcast">
            <Trash2 size={14} strokeWidth={1.5} aria-hidden />
            Forget
          </Button>
        )}
      </div>

      <Modal
        open={confirmExplorer}
        onClose={() => setConfirmExplorer(false)}
        title="Open an external explorer?"
        centered
      >
        {/* Handing an operator the link between this transaction and an
            IP address is a privacy loss: red, by the rule. */}
        <Notice tone="alert">
          <span className="font-medium">
            The explorer's operator can link this transaction to your IP address.
          </span>
          <span className="mt-0.5 block text-xs text-muted">
            Use a VPN or Tor if that matters to you.
          </span>
        </Notice>
        <label className="mt-4 flex cursor-pointer items-center gap-2 font-ui text-sm text-text">
          <input
            type="checkbox"
            checked={skipNextTime}
            onChange={(event) => setSkipNextTime(event.target.checked)}
            className="accent-(--color-primary)"
          />
          Do not show this warning again
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmExplorer(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (skipNextTime) setExplorerAck(true);
              setConfirmExplorer(false);
              openExplorer();
            }}
          >
            Open
          </Button>
        </div>
      </Modal>
    </div>
  );
}
