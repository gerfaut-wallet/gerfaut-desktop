import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Pickaxe,
  Repeat2,
  ScrollText,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import type { ReactNode } from "react";
import { clsx } from "clsx";
import type { Network, TxExtras, TxIo } from "../lib/ipc";
import {
  MASKED,
  formatAmount,
  formatAmountSigned,
  groupThousands,
} from "../lib/format";
import { explorerTxUrl } from "../lib/explorer";
import { useTxDetail } from "../state/queries";
import { useUi } from "../state/store";
import { AddressChip } from "../components/AddressChip";
import { StackedAmount, useFiatValue } from "../components/Amount";
import { Button, IconButton } from "../components/Button";
import { FlowDiagram, opReturnPreview } from "../components/FlowDiagram";
import { Modal } from "../components/Modal";
import { StatusPill } from "../components/StatusPill";

/** Transaction detail as a large centered modal: summary, flow diagram
    with feature badges, input and output tables, raw hex, explorer link
    behind a privacy warning. */
export function TxDetailModal({ walletId, network }: { walletId: string; network: Network }) {
  const { selectedTxid, selectTx, explorerAck, setExplorerAck } = useUi();
  const detail = useTxDetail(walletId, selectedTxid);
  const [confirmExplorer, setConfirmExplorer] = useState(false);
  const [skipNextTime, setSkipNextTime] = useState(false);

  const explorerUrl =
    detail.data && explorerTxUrl(network, detail.data.summary.txid);

  const openExplorer = () => {
    if (explorerUrl) void openUrl(explorerUrl);
  };

  const extras = detail.data?.extras ?? null;

  return (
    <Modal
      open={selectedTxid !== null}
      onClose={() => selectTx(null)}
      title="Transaction"
      width={980}
    >
      {detail.isPending && <p className="font-ui text-sm text-muted">Loading…</p>}
      {detail.isError && (
        <p className="font-ui text-sm text-muted">
          This transaction could not be loaded.
        </p>
      )}
      {detail.data && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <NetAmount sats={detail.data.summary.net_sats} />
            <span className="flex items-center gap-2 pt-1">
              <StatusPill
                status={detail.data.summary.status}
                confirmations={detail.data.summary.confirmations}
              />
              {detail.data.summary.status.state === "confirmed" && (
                <span className="font-data text-xs text-muted">
                  block {groupThousands(String(detail.data.summary.status.height))}
                </span>
              )}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-border bg-background p-4 lg:grid-cols-4">
            <MetaItem label="Transaction id">
              <AddressChip value={detail.data.summary.txid} head={8} tail={8} />
            </MetaItem>
            <MetaItem label="Fee">
              {detail.data.summary.fee_sats !== null ? (
                <FeeAmount sats={detail.data.summary.fee_sats} />
              ) : (
                <MetaText>n/a</MetaText>
              )}
            </MetaItem>
            <MetaItem label="Fee rate">
              <MetaText>
                {detail.data.fee_rate_sat_vb !== null
                  ? `${detail.data.fee_rate_sat_vb.toFixed(1)} sat/vB`
                  : "n/a"}
              </MetaText>
            </MetaItem>
            {extras ? (
              <>
                <MetaItem label="Size">
                  <MetaText>{groupThousands(String(extras.size_bytes))} B</MetaText>
                </MetaItem>
                <MetaItem label="Virtual size">
                  <MetaText>{groupThousands(String(extras.vsize))} vB</MetaText>
                </MetaItem>
                <MetaItem label="Weight">
                  <MetaText>{groupThousands(String(extras.weight_wu))} WU</MetaText>
                </MetaItem>
                <MetaItem label="Version">
                  <MetaText>{extras.version}</MetaText>
                </MetaItem>
                <MetaItem label="Sigops">
                  <MetaText>{groupThousands(String(extras.sigops))}</MetaText>
                </MetaItem>
              </>
            ) : (
              <MetaItem label="Virtual size">
                <MetaText>{groupThousands(String(detail.data.vsize))} vB</MetaText>
              </MetaItem>
            )}
          </dl>

          <div className="flex flex-col gap-3">
            <FlowDiagram
              inputs={detail.data.inputs}
              outputs={detail.data.outputs}
              feeSats={detail.data.summary.fee_sats}
              feeRate={detail.data.fee_rate_sat_vb}
              isCoinbase={extras?.is_coinbase ?? false}
              coinbasePool={extras?.coinbase_pool ?? null}
            />
            {extras && <FeatureBadges extras={extras} outputs={detail.data.outputs} />}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <IoTable
              title={`Inputs (${detail.data.inputs.length})`}
              ios={detail.data.inputs}
              side="in"
              coinbase={extras?.is_coinbase ?? false}
            />
            <IoTable
              title={`Outputs (${detail.data.outputs.length})`}
              ios={detail.data.outputs}
              side="out"
              coinbase={false}
            />
          </div>

          {extras && extras.raw_hex.length > 0 && <RawTransaction hex={extras.raw_hex} />}

          {explorerUrl !== "" && explorerUrl !== undefined && (
            <div className="flex justify-end">
              <Button
                variant="ghost"
                onClick={() => {
                  if (explorerAck) openExplorer();
                  else setConfirmExplorer(true);
                }}
              >
                View on mempool.space
                <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
              </Button>
            </div>
          )}
        </div>
      )}

      <Modal
        open={confirmExplorer}
        onClose={() => setConfirmExplorer(false)}
        title="Open an external explorer"
        width={460}
        z={60}
        centered
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-2.5 rounded-md border border-alert/25 bg-alert-surface p-3">
            <AlertTriangle
              size={16}
              strokeWidth={1.75}
              aria-hidden
              className="mt-0.5 shrink-0 text-alert"
            />
            <p className="font-ui text-sm font-medium text-alert">
              This opens the transaction on mempool.space, a third-party
              website. Its operator can link this transaction to your IP
              address.
            </p>
          </div>
          <p className="font-ui text-sm text-muted">
            Consider a VPN or Tor if that link matters to you.
          </p>
          <label className="flex cursor-pointer items-center gap-2 font-ui text-sm text-text">
            <input
              type="checkbox"
              checked={skipNextTime}
              onChange={(event) => setSkipNextTime(event.target.checked)}
              className="size-4 accent-(--color-primary)"
            />
            Do not show this warning again
          </label>
          <div className="flex justify-end gap-2">
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
              Open explorer
            </Button>
          </div>
        </div>
      </Modal>
    </Modal>
  );
}

function NetAmount({ sats }: { sats: number }) {
  const { masked, unit } = useUi();
  const fiat = useFiatValue(sats);
  const secondary =
    unit === "btc" ? formatAmount(sats, "sats") : formatAmount(sats, "btc");
  return (
    <div className="selectable">
      <div className="font-data text-[26px] font-medium leading-[1.15] tracking-[-0.01em] text-text">
        {masked ? MASKED : formatAmountSigned(sats, unit)}
      </div>
      <div className="mt-0.5 font-data text-[13px] text-muted">
        {masked ? MASKED : fiat ? `${secondary} · ${fiat}` : secondary}
      </div>
    </div>
  );
}

/** Fee in the chosen unit, no fiat: the meta strip stays scannable. */
function FeeAmount({ sats }: { sats: number }) {
  const { masked, unit } = useUi();
  return (
    <span className="selectable whitespace-nowrap font-data text-[13px] text-text">
      {masked ? MASKED : formatAmount(sats, unit)}
    </span>
  );
}

function MetaItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="mb-1 font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
        {label}
      </dt>
      <dd className="overflow-hidden">{children}</dd>
    </div>
  );
}

function MetaText({ children }: { children: ReactNode }) {
  return (
    <span className="selectable whitespace-nowrap font-data text-[13px] text-text">
      {children}
    </span>
  );
}

/** One feature chip: label plus optional icon, palette colors only. */
function Badge({
  tone,
  icon,
  children,
}: {
  tone: "neutral" | "pending" | "confirmed";
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 font-ui text-[11px] font-medium",
        tone === "pending" && "border border-pending/25 bg-pending-surface text-pending",
        tone === "confirmed" && "border border-confirmed/25 bg-confirmed-surface text-confirmed",
        tone === "neutral" && "bg-sunken text-muted",
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/** The transaction's options at a glance, under the flow diagram. */
function FeatureBadges({ extras, outputs }: { extras: TxExtras; outputs: TxIo[] }) {
  const hasOpReturn = outputs.some((io) => io.op_return !== null);
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      {extras.is_coinbase ? (
        <Badge tone="confirmed" icon={<Pickaxe size={12} strokeWidth={1.75} aria-hidden />}>
          Coinbase{extras.coinbase_pool ? ` · ${extras.coinbase_pool}` : ""}
        </Badge>
      ) : extras.rbf_signaled ? (
        <Badge tone="pending" icon={<Repeat2 size={12} strokeWidth={1.75} aria-hidden />}>
          RBF
        </Badge>
      ) : (
        <Badge tone="neutral">Final</Badge>
      )}
      {extras.segwit && <Badge tone="neutral">SegWit</Badge>}
      {extras.taproot && <Badge tone="neutral">Taproot</Badge>}
      <Badge tone="neutral">Version {extras.version}</Badge>
      {extras.locktime > 0 && (
        <Badge tone="neutral">Locktime {groupThousands(String(extras.locktime))}</Badge>
      )}
      {hasOpReturn && (
        <Badge tone="pending" icon={<ScrollText size={12} strokeWidth={1.75} aria-hidden />}>
          OP_RETURN
        </Badge>
      )}
    </div>
  );
}

/** The raw serialized transaction, collapsed by default. */
function RawTransaction({ hex }: { hex: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const showToast = useUi((s) => s.showToast);

  const copy = async () => {
    await navigator.clipboard.writeText(hex);
    setCopied(true);
    showToast("Copied");
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-1 font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted transition-colors duration-150 hover:text-text"
      >
        {open ? (
          <ChevronDown size={14} strokeWidth={1.75} aria-hidden />
        ) : (
          <ChevronRight size={14} strokeWidth={1.75} aria-hidden />
        )}
        Raw transaction
      </button>
      {open && (
        <div className="relative mt-2">
          <p className="selectable max-h-44 overflow-y-auto break-all rounded-md bg-sunken p-3 pr-12 font-data text-[11px] leading-relaxed text-muted">
            {hex}
          </p>
          <IconButton
            label="Copy raw transaction"
            className="absolute right-2 top-2"
            onClick={() => void copy()}
          >
            {copied ? (
              <Check size={14} strokeWidth={1.5} aria-hidden className="text-confirmed" />
            ) : (
              <Copy size={14} strokeWidth={1.5} aria-hidden />
            )}
          </IconButton>
        </div>
      )}
    </div>
  );
}

function IoTable({
  title,
  ios,
  side,
  coinbase,
}: {
  title: string;
  ios: TxIo[];
  side: "in" | "out";
  coinbase: boolean;
}) {
  return (
    <div className="min-w-0">
      <h2 className="mb-2 font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
        {title}
      </h2>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full border-collapse">
          <tbody>
            {ios.map((io, index) => (
              <tr
                key={index}
                className="border-b border-border last:border-b-0"
              >
                <td className="min-w-0 px-3 py-2">
                  {io.op_return ? (
                    <span className="flex min-w-0 items-center gap-1.5">
                      <ScrollText
                        size={14}
                        strokeWidth={1.75}
                        aria-hidden
                        className="shrink-0 text-pending"
                      />
                      <span className="shrink-0 font-data text-[13px] text-pending">
                        OP_RETURN
                      </span>
                      <span
                        className="selectable min-w-0 truncate font-data text-[11px] text-muted"
                        title={io.op_return.text ?? io.op_return.hex}
                      >
                        {opReturnPreview(io.op_return)}
                      </span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      {io.address ? (
                        <AddressChip value={io.address} />
                      ) : (
                        <span className="font-data text-[13px] text-muted">
                          {side === "in" && coinbase ? "coinbase" : "script output"}
                        </span>
                      )}
                      {io.is_mine && (
                        <span className="rounded-full bg-sunken px-1.5 py-px font-ui text-[10px] font-medium uppercase tracking-[0.04em] text-muted">
                          {io.change ? "change" : "mine"}
                        </span>
                      )}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right align-top">
                  {io.value_sats !== null ? (
                    <StackedAmount sats={io.value_sats} />
                  ) : io.op_return ? null : (
                    <span className="font-data text-[13px] text-muted">n/a</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
