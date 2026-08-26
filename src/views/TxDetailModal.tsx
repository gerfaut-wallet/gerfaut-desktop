import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  Layers,
  Lock,
  Pickaxe,
  Repeat2,
  ScrollText,
  Sprout,
  Undo2,
  Wallet as WalletIcon,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import type { ReactNode } from "react";
import { clsx } from "clsx";
import type { Network, TxDetail, TxExtras, TxIo } from "../lib/ipc";
import {
  MASKED,
  formatAmount,
  formatAmountSigned,
  formatTimestamp,
  groupThousands,
} from "../lib/format";
import { explorerTxUrl } from "../lib/explorer";
import { useTxDetail } from "../state/queries";
import { useUi } from "../state/store";
import { AddressChip } from "../components/AddressChip";
import { StackedAmount, useFiatValue } from "../components/Amount";
import { Button, IconButton } from "../components/Button";
import { FlowSummary, opReturnPreview } from "../components/FlowSummary";
import { Modal } from "../components/Modal";
import { StatusPill } from "../components/StatusPill";

/** Transaction detail: the amount and its status first, the flow in
    one line, then two calm fact cards, the inputs and outputs, and the
    raw transaction behind a disclosure. Same facts as before, read in
    the order a person asks for them. */
export function TxDetailModal({ walletId, network }: { walletId: string; network: Network }) {
  const { selectedTxid, selectTx, explorerAck, setExplorerAck } = useUi();
  const detail = useTxDetail(walletId, selectedTxid);
  const [confirmExplorer, setConfirmExplorer] = useState(false);
  const [skipNextTime, setSkipNextTime] = useState(false);

  const explorerUrl = detail.data && explorerTxUrl(network, detail.data.summary.txid);

  const openExplorer = () => {
    if (explorerUrl) void openUrl(explorerUrl);
  };

  return (
    <Modal open={selectedTxid !== null} onClose={() => selectTx(null)} title="Transaction" width={960}>
      {detail.isPending && <p className="font-ui text-sm text-muted">Loading…</p>}
      {detail.isError && (
        <p className="font-ui text-sm text-muted">This transaction could not be loaded.</p>
      )}
      {detail.data && (
        <div className="flex flex-col gap-6">
          <Hero detail={detail.data} />

          <FlowSummary
            inputs={detail.data.inputs}
            outputs={detail.data.outputs}
            feeSats={detail.data.summary.fee_sats}
            feeRate={detail.data.fee_rate_sat_vb}
            isCoinbase={detail.data.extras?.is_coinbase ?? false}
            coinbasePool={detail.data.extras?.coinbase_pool ?? null}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <FactsCard title="Details">
              <Fact label="Transaction ID">
                <AddressChip value={detail.data.summary.txid} head={10} tail={8} />
              </Fact>
              <Fact label="Date">
                {detail.data.summary.status.state === "confirmed" &&
                detail.data.summary.status.timestamp ? (
                  <Value>{formatTimestamp(detail.data.summary.status.timestamp)}</Value>
                ) : (
                  <Value muted>not yet mined</Value>
                )}
              </Fact>
              <Fact label="Block">
                {detail.data.summary.status.state === "confirmed" ? (
                  <Value>{groupThousands(String(detail.data.summary.status.height))}</Value>
                ) : (
                  <Value muted>—</Value>
                )}
              </Fact>
              <Fact label="Confirmations">
                <Value>{groupThousands(String(detail.data.summary.confirmations))}</Value>
              </Fact>
              <Fact label="Fee">
                {detail.data.summary.fee_sats !== null ? (
                  <FeeAmount sats={detail.data.summary.fee_sats} />
                ) : (
                  <Value muted>n/a</Value>
                )}
              </Fact>
              <Fact label="Fee rate">
                <Value>
                  {detail.data.fee_rate_sat_vb !== null
                    ? `${detail.data.fee_rate_sat_vb.toFixed(1)} sat/vB`
                    : "n/a"}
                </Value>
              </Fact>
            </FactsCard>

            <FactsCard title="Technical">
              {detail.data.extras ? (
                <>
                  <Fact label="Size">
                    <Value>{groupThousands(String(detail.data.extras.size_bytes))} B</Value>
                  </Fact>
                  <Fact label="Virtual size">
                    <Value>{groupThousands(String(detail.data.extras.vsize))} vB</Value>
                  </Fact>
                  <Fact label="Weight">
                    <Value>{groupThousands(String(detail.data.extras.weight_wu))} WU</Value>
                  </Fact>
                  <Fact label="Version">
                    <Value>{detail.data.extras.version}</Value>
                  </Fact>
                  <Fact label="Locktime">
                    <Value>
                      {detail.data.extras.locktime > 0
                        ? groupThousands(String(detail.data.extras.locktime))
                        : "none"}
                    </Value>
                  </Fact>
                  <Fact label="Sigops">
                    <Value>{groupThousands(String(detail.data.extras.sigops))}</Value>
                  </Fact>
                  <Fact label="Flags">
                    <Flags extras={detail.data.extras} outputs={detail.data.outputs} />
                  </Fact>
                </>
              ) : (
                <Fact label="Virtual size">
                  <Value>{groupThousands(String(detail.data.vsize))} vB</Value>
                </Fact>
              )}
            </FactsCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <IoList
              title="Inputs"
              ios={detail.data.inputs}
              side="in"
              extras={detail.data.extras}
              coinbaseValue={detail.data.outputs.reduce(
                (total, io) => total + (io.value_sats ?? 0),
                0,
              )}
            />
            <IoList
              title="Outputs"
              ios={detail.data.outputs}
              side="out"
              extras={detail.data.extras}
              coinbaseValue={null}
            />
          </div>

          <div className="flex flex-wrap items-start justify-between gap-3 border-t border-border/60 pt-4">
            {detail.data.extras && detail.data.extras.raw_hex.length > 0 ? (
              <RawTransaction hex={detail.data.extras.raw_hex} />
            ) : (
              <span />
            )}
            {explorerUrl !== "" && explorerUrl !== undefined && (
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
            )}
          </div>
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
              This opens the transaction on mempool.space, a third-party website. Its
              operator can link this transaction to your IP address.
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

/** What happened, in one glance: direction, amount, status. */
function Hero({ detail }: { detail: TxDetail }) {
  const { masked, unit } = useUi();
  const sats = detail.summary.net_sats;
  const fiat = useFiatValue(sats);
  const coinbase = detail.extras?.is_coinbase ?? false;
  const direction = coinbase ? "Block reward" : sats >= 0 ? "Received" : "Sent";
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="selectable">
        <p className="font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
          {direction}
        </p>
        <p className="tabular mt-1 text-[28px] font-semibold leading-[1.1] tracking-[-0.02em] text-text">
          {masked ? MASKED : formatAmountSigned(sats, unit)}
        </p>
        {fiat && <p className="tabular mt-1 text-[13px] text-muted">{fiat}</p>}
      </div>
      <div className="flex items-center gap-2 pb-1">
        <StatusPill status={detail.summary.status} confirmations={detail.summary.confirmations} />
        {detail.summary.status.state === "confirmed" && (
          <span className="tabular text-xs text-muted">
            block {groupThousands(String(detail.summary.status.height))}
          </span>
        )}
      </div>
    </div>
  );
}

/** Fee in the chosen unit, no fiat: facts stay scannable. */
function FeeAmount({ sats }: { sats: number }) {
  const { masked, unit } = useUi();
  return <Value>{masked ? MASKED : formatAmount(sats, unit)}</Value>;
}

function FactsCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-lg border border-border bg-surface px-5 py-4">
      <h2 className="mb-2 font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
        {title}
      </h2>
      <dl className="flex flex-col">{children}</dl>
    </section>
  );
}

/** One label / value line; values keep their own typography. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/50 py-2 last:border-b-0">
      <dt className="shrink-0 font-ui text-[13px] text-muted">{label}</dt>
      <dd className="flex min-w-0 justify-end text-right">{children}</dd>
    </div>
  );
}

function Value({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <span
      className={clsx(
        "selectable tabular whitespace-nowrap text-[13px] font-medium",
        muted ? "text-muted" : "text-text",
      )}
    >
      {children}
    </span>
  );
}

/** One feature chip: label plus icon, every tone bordered alike. */
function Badge({
  tone,
  icon,
  title,
  children,
}: {
  tone: "neutral" | "pending" | "confirmed" | "accent";
  icon?: ReactNode;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={clsx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 font-ui text-[11px] font-medium",
        tone === "pending" && "border-pending/25 bg-pending-surface text-pending",
        tone === "confirmed" && "border-confirmed/25 bg-confirmed-surface text-confirmed",
        tone === "accent" && "border-primary/25 bg-primary/[0.08] text-primary",
        tone === "neutral" && "border-border bg-sunken text-muted",
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/** The transaction's options as a tidy row of chips inside the facts. */
function Flags({ extras, outputs }: { extras: TxExtras; outputs: TxIo[] }) {
  const hasOpReturn = outputs.some((io) => io.op_return !== null);
  return (
    <span className="flex flex-wrap justify-end gap-1.5">
      {extras.is_coinbase ? (
        <Badge tone="confirmed" icon={<Pickaxe size={12} strokeWidth={1.75} aria-hidden />}>
          Coinbase{extras.coinbase_pool ? ` · ${extras.coinbase_pool}` : ""}
        </Badge>
      ) : extras.rbf_signaled ? (
        <Badge
          tone="pending"
          icon={<Repeat2 size={12} strokeWidth={1.75} aria-hidden />}
          title="Replaceable: the sender can bump the fee (BIP-125)"
        >
          Replaceable
        </Badge>
      ) : (
        <Badge
          tone="neutral"
          icon={<Lock size={12} strokeWidth={1.75} aria-hidden />}
          title="Final: no input signals replace-by-fee"
        >
          Final
        </Badge>
      )}
      {extras.segwit && (
        <Badge
          tone="accent"
          icon={<Layers size={12} strokeWidth={1.75} aria-hidden />}
          title="At least one input carries witness data"
        >
          SegWit
        </Badge>
      )}
      {extras.taproot && (
        <Badge
          tone="accent"
          icon={<Sprout size={12} strokeWidth={1.75} aria-hidden />}
          title="At least one input spends a Taproot output"
        >
          Taproot
        </Badge>
      )}
      {extras.locktime > 0 && (
        <Badge
          tone="neutral"
          icon={<Clock size={12} strokeWidth={1.75} aria-hidden />}
          title="Earliest block this transaction could be mined in"
        >
          Locktime
        </Badge>
      )}
      {hasOpReturn && (
        <Badge tone="pending" icon={<ScrollText size={12} strokeWidth={1.75} aria-hidden />}>
          OP_RETURN
        </Badge>
      )}
    </span>
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
    <div className="min-w-0 flex-1">
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

/** Inputs or outputs as airy rows: a role chip, the address, the
    amount. Wallet rows carry a Glacier edge and an emphasized chip. */
function IoList({
  title,
  ios,
  side,
  extras,
  coinbaseValue,
}: {
  title: string;
  ios: TxIo[];
  side: "in" | "out";
  extras: TxExtras | null;
  /** Sum of the outputs: what a coinbase input actually creates. */
  coinbaseValue: number | null;
}) {
  const coinbase = extras?.is_coinbase ?? false;
  return (
    <section aria-label={title} className="min-w-0">
      <h2 className="mb-2 px-1 font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
        {title} ({ios.length})
      </h2>
      <ul className="flex flex-col gap-1.5">
        {ios.map((io, index) => {
          const mine = io.is_mine;
          const isCoinbaseRow = side === "in" && coinbase;
          return (
            <li
              key={index}
              className={clsx(
                "flex items-center gap-3 rounded-md border px-3 py-2.5",
                mine ? "border-primary/40 bg-primary/[0.04]" : "border-border bg-surface",
              )}
            >
              <RoleIcon io={io} side={side} coinbase={isCoinbaseRow} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                {io.op_return ? (
                  <>
                    <span className="font-ui text-[13px] font-medium text-pending">OP_RETURN</span>
                    <span
                      className="selectable truncate font-data text-[11px] text-muted"
                      title={io.op_return.text ?? io.op_return.hex}
                    >
                      {opReturnPreview(io.op_return)}
                    </span>
                  </>
                ) : isCoinbaseRow ? (
                  <>
                    <span className="font-ui text-[13px] font-medium text-text">Coinbase</span>
                    <span
                      className="truncate font-ui text-[11px] text-muted"
                      title={extras?.coinbase_tag ?? undefined}
                    >
                      {extras?.coinbase_height !== null && extras?.coinbase_height !== undefined
                        ? `block ${groupThousands(String(extras.coinbase_height))}`
                        : "newly minted"}
                      {extras?.coinbase_pool ? ` · ${extras.coinbase_pool}` : ""}
                    </span>
                  </>
                ) : io.address ? (
                  <>
                    <span>
                      <AddressChip value={io.address} head={10} tail={8} emphasis={mine} />
                    </span>
                    {mine && (
                      <span className="font-ui text-[11px] text-muted">
                        {side === "in"
                          ? "Spent from this wallet"
                          : io.change
                            ? "Change back to this wallet"
                            : "Received by this wallet"}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="font-ui text-[13px] text-muted">
                    {side === "in" ? "Unknown input" : "Script output"}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-right">
                {io.value_sats !== null ? (
                  <StackedAmount sats={io.value_sats} />
                ) : isCoinbaseRow && coinbaseValue !== null ? (
                  <StackedAmount sats={coinbaseValue} />
                ) : (
                  <span className="font-ui text-[13px] text-muted">n/a</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Role chips: 32px squares, the same vocabulary as the lists. */
function RoleIcon({ io, side, coinbase }: { io: TxIo; side: "in" | "out"; coinbase: boolean }) {
  const common = { size: 15, strokeWidth: 1.75, "aria-hidden": true } as const;
  const chip = (title: string, tone: string, icon: ReactNode) => (
    <span
      title={title}
      className={clsx("inline-flex size-8 shrink-0 items-center justify-center rounded-lg", tone)}
    >
      {icon}
    </span>
  );
  if (coinbase) return chip("Newly minted coins", "bg-sunken text-muted", <Pickaxe {...common} />);
  if (io.op_return) {
    return chip("Data output", "bg-pending-surface text-pending", <ScrollText {...common} />);
  }
  if (!io.is_mine) {
    return chip(
      side === "in" ? "External input" : "External output",
      "bg-sunken text-muted",
      <ArrowUpRight {...common} />,
    );
  }
  if (side === "in") {
    return chip("Spent from this wallet", "bg-primary/10 text-primary", <WalletIcon {...common} />);
  }
  return io.change
    ? chip("Change back to this wallet", "bg-primary/10 text-primary", <Undo2 {...common} />)
    : chip("Received by this wallet", "bg-primary/10 text-primary", <ArrowDownLeft {...common} />);
}
