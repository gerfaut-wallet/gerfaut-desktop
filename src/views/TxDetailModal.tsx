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
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";
import { clsx } from "clsx";
import type { Network, PriceHistory, PricePoint, TxDetail, TxExtras, TxIo } from "../lib/ipc";
import {
  MASKED,
  formatAmount,
  formatAmountSigned,
  formatFiat,
  formatTimestamp,
  groupThousands,
  opReturnPreview,
} from "../lib/format";
import { explorerTxUrl } from "../lib/explorer";
import { useTxDetail } from "../state/queries";
import { useUi } from "../state/store";
import { AddressChip } from "../components/AddressChip";
import { StackedAmount, useFiatValue } from "../components/Amount";
import { Button, IconButton } from "../components/Button";
import { Modal } from "../components/Modal";
import { StatusPill } from "../components/StatusPill";
import { TxDiagram } from "../components/TxDiagram";
import type { TxBranch } from "../components/TxDiagram";

/** Transaction detail: how much and what state, then the three facts
    one looks for first, then the diagram, then the inputs and outputs
    in full, and only then the technical facts and the raw bytes — the
    order the questions come in, not the order the chain serializes. */
export function TxDetailModal({ walletId, network }: { walletId: string; network: Network }) {
  const { selectedTxid, selectTx, explorerAck, setExplorerAck } = useUi();
  const detail = useTxDetail(walletId, selectedTxid);
  const [confirmExplorer, setConfirmExplorer] = useState(false);
  const [skipNextTime, setSkipNextTime] = useState(false);

  const explorerUrl = detail.data ? explorerTxUrl(network, detail.data.summary.txid) : "";

  const openExplorer = () => {
    if (explorerUrl) void openUrl(explorerUrl);
  };

  // The warning stands between the page and the explorer wherever the
  // button sits: moving it up the page does not move it out of the way.
  const askExplorer = () => {
    if (explorerAck) openExplorer();
    else setConfirmExplorer(true);
  };

  return (
    <Modal open={selectedTxid !== null} onClose={() => selectTx(null)} title="Transaction" width={960}>
      {detail.isPending && <p className="font-ui text-sm text-muted">Loading…</p>}
      {detail.isError && (
        <p className="font-ui text-sm text-muted">This transaction could not be loaded.</p>
      )}
      {detail.data && (
        <div className="flex flex-col gap-6">
          <Hero detail={detail.data} onExplorer={explorerUrl === "" ? null : askExplorer} />

          <KeyFacts detail={detail.data} />

          <TxDiagram
            inputs={inputBranches(detail.data)}
            outputs={outputBranches(detail.data)}
            feeSats={detail.data.summary.fee_sats}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <IoList
              title="Inputs"
              ios={detail.data.inputs}
              side="in"
              extras={detail.data.extras}
              coinbaseValue={coinbaseReward(detail.data)}
            />
            <IoList
              title="Outputs"
              ios={detail.data.outputs}
              side="out"
              extras={detail.data.extras}
              coinbaseValue={null}
            />
          </div>

          <TechnicalFacts detail={detail.data} />

          {detail.data.extras && detail.data.extras.raw_hex.length > 0 && (
            <div className="border-t border-border/60 pt-4">
              <RawTransaction hex={detail.data.extras.raw_hex} />
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

/** A coinbase input spends nothing: what it creates is the reward. */
function coinbaseReward(detail: TxDetail): number {
  return detail.outputs.reduce((total, io) => total + (io.value_sats ?? 0), 0);
}

/** Every input and every output the wallet's own: the net is only the
    fee, and "Sent" would name it wrong. */
function isSelfTransfer(detail: TxDetail): boolean {
  return (
    detail.inputs.length > 0 &&
    detail.outputs.length > 0 &&
    detail.inputs.every((io) => io.is_mine) &&
    detail.outputs.every((io) => io.is_mine)
  );
}

/** Inputs as diagram branches. An input is named by its outpoint: two
    inputs can carry the same address, never the same outpoint — and the
    outpoint comes from the transaction, not from the backend, so it is
    there even when the value is not. */
function inputBranches(detail: TxDetail): TxBranch[] {
  const coinbase = detail.extras?.is_coinbase ?? false;
  const reward = coinbaseReward(detail);
  return detail.inputs.map((io): TxBranch => {
    const outpoint = io.prev_txid ? `${io.prev_txid}:${io.prev_vout ?? 0}` : "Unknown input";
    return {
      role: coinbase ? "coinbase" : io.is_mine ? "wallet-in" : "external-in",
      label: coinbase ? "Coinbase" : outpoint,
      amount: io.value_sats ?? (coinbase ? reward : null),
      isMine: io.is_mine,
    };
  });
}

/** Outputs as diagram branches: of an output one asks where to. */
function outputBranches(detail: TxDetail): TxBranch[] {
  return detail.outputs.map(
    (io): TxBranch => ({
      role: io.op_return
        ? "op-return"
        : io.is_mine
          ? io.change
            ? "change"
            : "received"
          : "external-out",
      label: io.op_return ? opReturnPreview(io.op_return) : (io.address ?? "Script output"),
      amount: io.value_sats,
      isMine: io.is_mine,
    }),
  );
}

/** What happened, in one glance: direction, amount, status — and the
    explorer within reach, behind its warning. */
function Hero({ detail, onExplorer }: { detail: TxDetail; onExplorer: (() => void) | null }) {
  const { masked, unit } = useUi();
  const sats = detail.summary.net_sats;
  const fiat = useFiatValue(sats);
  const coinbase = detail.extras?.is_coinbase ?? false;
  const direction = coinbase
    ? "Block reward"
    : isSelfTransfer(detail)
      ? "Sent to yourself"
      : sats >= 0
        ? "Received"
        : "Sent";
  return (
    <section aria-label="Summary" className="flex flex-wrap items-start justify-between gap-4">
      <div className="selectable">
        <p className="font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
          {direction}
        </p>
        <p className="tabular mt-1 text-[28px] font-semibold leading-[1.1] tracking-[-0.02em] text-text">
          {masked ? MASKED : formatAmountSigned(sats, unit)}
        </p>
        {fiat && <p className="tabular mt-1 text-[13px] text-muted">{fiat}</p>}
      </div>
      <div className="flex flex-col items-end gap-2.5">
        <div className="flex items-center gap-2">
          <StatusPill status={detail.summary.status} confirmations={detail.summary.confirmations} />
          {detail.summary.status.state === "confirmed" && (
            <span className="tabular text-xs text-muted">
              block {groupThousands(String(detail.summary.status.height))}
            </span>
          )}
        </div>
        {onExplorer && (
          <Button variant="secondary" onClick={onExplorer}>
            View on mempool.space
            <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
          </Button>
        )}
      </div>
    </section>
  );
}

/** How far a loaded price point may sit from the transaction and still
    speak for it: a daily sample, either side. */
const NEAR_ENOUGH_SECONDS = 36 * 3600;

/** The price when the transaction was mined, when the app already holds
    a series that covers it — the overview loads one. Nothing is fetched
    from here: a rate we do not have is a fact we do not show. */
function useRateAtTime(timestamp: number | null): string | null {
  const { fiatEnabled, fiatCurrency, fiatSource, masked } = useUi();
  const client = useQueryClient();
  if (!fiatEnabled || masked || timestamp === null) return null;
  const cached = client.getQueriesData<PriceHistory>({
    queryKey: ["price-history", fiatSource, fiatCurrency],
  });
  let best: PricePoint | null = null;
  for (const [, history] of cached) {
    for (const point of history?.points ?? []) {
      if (best === null || Math.abs(point.t - timestamp) < Math.abs(best.t - timestamp)) {
        best = point;
      }
    }
  }
  if (best === null || Math.abs(best.t - timestamp) > NEAR_ENOUGH_SECONDS) return null;
  return `${formatFiat(100_000_000, best.rate, fiatCurrency)} / BTC`;
}

/** The three facts one looks for first. Three, not ten: the rest is
    technical and waits below the lists. */
function KeyFacts({ detail }: { detail: TxDetail }) {
  const status = detail.summary.status;
  const timestamp = status.state === "confirmed" ? status.timestamp : null;
  const rate = useRateAtTime(timestamp);
  return (
    <dl className="flex flex-wrap items-start gap-x-10 gap-y-3 rounded-lg border border-border bg-surface px-5 py-3.5">
      <div className="min-w-0">
        <KeyLabel>Transaction ID</KeyLabel>
        <dd className="-ml-2 mt-0.5">
          <AddressChip value={detail.summary.txid} head={12} tail={10} />
        </dd>
      </div>
      <div className="min-w-0">
        <KeyLabel>Date</KeyLabel>
        <dd className="mt-1.5">
          {timestamp !== null ? (
            <Value>{formatTimestamp(timestamp)}</Value>
          ) : (
            <Value muted>not yet mined</Value>
          )}
        </dd>
      </div>
      {rate !== null && (
        <div className="min-w-0">
          <KeyLabel>Rate at the time</KeyLabel>
          <dd className="mt-1.5">
            <Value>{rate}</Value>
          </dd>
        </div>
      )}
    </dl>
  );
}

function KeyLabel({ children }: { children: ReactNode }) {
  return (
    <dt className="font-ui text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
      {children}
    </dt>
  );
}

/** The facts one goes looking for, never the ones one reads: they have
    no business above the diagram. */
function TechnicalFacts({ detail }: { detail: TxDetail }) {
  const extras = detail.extras;
  return (
    <FactsCard title="Technical">
      <Fact label="Confirmations">
        <Value>{groupThousands(String(detail.summary.confirmations))}</Value>
      </Fact>
      {extras ? (
        <>
          <Fact label="Size">
            <Value>{groupThousands(String(extras.size_bytes))} B</Value>
          </Fact>
          <Fact label="Virtual size">
            <Value>{groupThousands(String(extras.vsize))} vB</Value>
          </Fact>
          <Fact label="Weight">
            <Value>{groupThousands(String(extras.weight_wu))} WU</Value>
          </Fact>
          <Fact label="Version">
            <Value>{extras.version}</Value>
          </Fact>
          <Fact label="Locktime">
            <Value>{extras.locktime > 0 ? groupThousands(String(extras.locktime)) : "none"}</Value>
          </Fact>
          <Fact label="Sigops">
            <Value>{groupThousands(String(extras.sigops))}</Value>
          </Fact>
        </>
      ) : (
        <Fact label="Virtual size">
          <Value>{groupThousands(String(detail.vsize))} vB</Value>
        </Fact>
      )}
      <Fact label="Fee">
        {detail.summary.fee_sats !== null ? (
          <FeeAmount sats={detail.summary.fee_sats} />
        ) : (
          <Value muted>n/a</Value>
        )}
      </Fact>
      <Fact label="Fee rate">
        <Value>
          {detail.fee_rate_sat_vb !== null ? `${detail.fee_rate_sat_vb.toFixed(1)} sat/vB` : "n/a"}
        </Value>
      </Fact>
      {extras && (
        <Fact label="Flags" wide>
          <Flags extras={extras} outputs={detail.outputs} />
        </Fact>
      )}
    </FactsCard>
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
      <dl className="grid gap-x-10 lg:grid-cols-2">{children}</dl>
    </section>
  );
}

/** One label / value line; values keep their own typography. */
function Fact({
  label,
  wide = false,
  children,
}: {
  label: string;
  /** Spans both columns: for a value that is a row of its own. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={clsx(
        "flex items-center justify-between gap-4 border-b border-border/50 py-2 last:border-b-0",
        wide && "lg:col-span-2",
      )}
    >
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

/** The transaction's options as a tidy row of chips inside the facts.
    A flag carries the name the chain gave it: RBF is the word everyone
    uses, the one people search this page for, and the only one they
    will find again in another wallet. */
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
          title="RBF: the sender can still bump the fee (BIP-125)"
        >
          RBF
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

/** Role chips: 32px squares, the same vocabulary as the diagram. */
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
