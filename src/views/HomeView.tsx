import { clsx } from "clsx";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  ChevronRight,
  Coins,
} from "lucide-react";
import type { ReactNode } from "react";
import { Balance, ListAmount } from "../components/Amount";
import { BalanceChart } from "../components/BalanceChart";
import {
  MASKED,
  formatTimestamp,
  groupThousands,
  relativeTime,
  truncateMiddle,
} from "../lib/format";
import { SUPPORTED_RANGES } from "../lib/ipc";
import type { Network, PriceRange, TxSummary, WalletMeta, WalletSnapshot } from "../lib/ipc";
import { balanceSeries } from "../lib/series";
import { useFees, usePriceHistory, useSnapshot, useUtxos } from "../state/queries";
import { useUi } from "../state/store";

const RANGE_LABEL: Record<PriceRange, string> = {
  day: "1D",
  week: "1W",
  month: "1M",
  year: "1Y",
  max: "Max",
};

/** Overview of one wallet: one fixed, glanceable dashboard — balance
    and counts, the BTC price, watch status, the wallet's balance curve,
    and its latest activity. Sized to the window, nothing to arrange. */
export function HomeView({ walletId }: { walletId: string }) {
  const snapshot = useSnapshot(walletId);
  const { syncErrors } = useUi();

  if (snapshot.isPending) {
    return <p className="px-1 py-4 font-ui text-sm text-muted">Loading wallet…</p>;
  }
  if (snapshot.isError || !snapshot.data) {
    return (
      <p className="px-1 py-4 font-ui text-sm text-muted">
        This wallet could not be loaded.
      </p>
    );
  }
  const { meta } = snapshot.data;

  return (
    <div className="flex h-full min-h-[560px] flex-col pb-2">
      {/* No freshness line here: Watch status carries it below. */}
      <header className="px-1 pb-4 pt-2">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.01em] text-text">
          {meta.name}
        </h1>
      </header>

      <div className="flex min-h-0 flex-1 gap-4 max-lg:flex-col">
        <div className="flex w-[320px] shrink-0 flex-col gap-4 max-lg:w-full">
          <BalanceCard
            snapshot={snapshot.data}
            walletId={walletId}
            error={syncErrors[walletId] ?? null}
          />
          <PriceCard />
          {meta.network !== "regtest" && <FeesCard network={meta.network} />}
          <StatusCard snapshot={snapshot.data} error={syncErrors[walletId] ?? null} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <HistoryCard snapshot={snapshot.data} />
          <ActivityCard snapshot={snapshot.data} />
        </div>
      </div>
    </div>
  );
}

function Card({
  label,
  children,
  className,
  action,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className={clsx("flex flex-col rounded-lg border border-border bg-surface p-5", className)}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
          {label}
        </p>
        {action}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

// --- left column --------------------------------------------------------

/** The figure alone can lie: a wallet that never reached a backend shows
    zero. The note says where the number comes from. */
function balanceNote(meta: WalletMeta, pending: number, error: string | null): string {
  if (error && !meta.last_sync) return "Sync failed: nothing fetched yet.";
  if (error) return "Sync failed: showing the last known balance.";
  if (!meta.last_sync) return "Not synced yet.";
  return pending > 0 ? "Includes pending funds not yet confirmed." : "All funds confirmed.";
}

function BalanceCard({
  snapshot,
  walletId,
  error,
}: {
  snapshot: WalletSnapshot;
  walletId: string;
  error: string | null;
}) {
  const utxos = useUtxos(walletId, true);
  const { setView } = useUi();
  const { balance, meta } = snapshot;
  const pending = balance.untrusted_pending + balance.trusted_pending;
  return (
    <Card label="Total balance" className="flex-1">
      <div className="flex h-full flex-col">
        <Balance sats={balance.total} />
        <p className="mt-2 font-ui text-xs text-muted">{balanceNote(meta, pending, error)}</p>
        <div className="flex-1" />
        <div className="-mx-2 mt-3 border-t border-border/60 pt-2">
          <CountRow
            icon={<Coins size={15} strokeWidth={1.5} aria-hidden />}
            count={utxos.data?.length ?? null}
            label={`UTXO${(utxos.data?.length ?? 0) === 1 ? "" : "s"}`}
            onClick={() => setView("utxos")}
          />
          <CountRow
            icon={<ArrowLeftRight size={15} strokeWidth={1.5} aria-hidden />}
            count={meta.cached.tx_count}
            label={`transaction${meta.cached.tx_count === 1 ? "" : "s"}`}
            onClick={() => setView("transactions")}
          />
        </div>
      </div>
    </Card>
  );
}

/** One glanceable count that leads to its page. Counts are structure,
    not amounts: they stay visible in masked mode. */
function CountRow({
  icon,
  count,
  label,
  onClick,
}: {
  icon: ReactNode;
  count: number | null;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-150 hover:bg-sunken/60"
    >
      <span className="text-muted">{icon}</span>
      <span className="font-ui text-[13px] text-text">
        <span className="tabular font-medium">
          {count === null ? "…" : groupThousands(String(count))}
        </span>{" "}
        <span className="text-muted">{label}</span>
      </span>
      <ChevronRight
        size={14}
        strokeWidth={1.5}
        aria-hidden
        className="ml-auto text-muted opacity-60 transition-opacity duration-150 group-hover:opacity-100"
      />
    </button>
  );
}

function PriceCard() {
  const { fiatSource, fiatCurrency, priceRange, setPriceRange } = useUi();
  // The compact widget offers no "max": a lifetime of price says
  // nothing at a glance.
  const ranges: PriceRange[] = SUPPORTED_RANGES[fiatSource].filter(
    (range) => range !== "max",
  );
  const range = ranges.includes(priceRange) ? priceRange : (ranges[0] ?? "month");
  const history = usePriceHistory(range, true);
  const points = history.data?.points ?? [];
  const first = points[0];
  const last = points[points.length - 1];
  const change = first && last ? ((last.rate - first.rate) / first.rate) * 100 : null;

  return (
    <Card
      label="Bitcoin price"
      action={
        <div role="radiogroup" aria-label="Price range" className="inline-flex rounded-md bg-sunken p-0.5">
          {ranges.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={range === option}
              onClick={() => setPriceRange(option)}
              className={clsx(
                "cursor-pointer rounded-[6px] px-2 py-0.5 font-ui text-[11px] font-medium transition-colors duration-150",
                range === option
                  ? "bg-surface text-text shadow-[inset_0_0_0_1px_var(--color-border)]"
                  : "text-muted hover:text-text",
              )}
            >
              {RANGE_LABEL[option]}
            </button>
          ))}
        </div>
      }
    >
      {last ? (
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="tabular text-[22px] font-semibold leading-tight text-text">
            {new Intl.NumberFormat(undefined, {
              style: "currency",
              currency: fiatCurrency.toUpperCase(),
              maximumFractionDigits: 0,
            }).format(last.rate)}
          </span>
          {change !== null && (
            <span
              className={clsx(
                "tabular inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                change >= 0
                  ? "border-confirmed/25 bg-confirmed-surface text-confirmed"
                  : "border-alert/25 bg-alert-surface text-alert",
              )}
            >
              {change >= 0 ? "+" : "−"}
              {Math.abs(change).toFixed(1)}%
            </span>
          )}
        </div>
      ) : (
        <p className="font-ui text-sm text-muted">
          {history.isPending ? "Loading…" : "The price source did not answer."}
        </p>
      )}
    </Card>
  );
}

/** Recommended fee rates: when to hurry, when to consolidate. Three
    tiles, each a target in blocks, the unit the estimates are made in.
    Regtest has no fee market and hides the card entirely. */
function FeesCard({ network }: { network: Network }) {
  const fees = useFees(network, true);
  const stats: { label: string; value: number | undefined }[] = [
    { label: "Next block", value: fees.data?.fastest },
    { label: "~3 blocks", value: fees.data?.half_hour },
    { label: "~6 blocks", value: fees.data?.hour },
  ];
  return (
    <Card label="Network fees">
      {fees.data ? (
        <div className="grid grid-cols-3 gap-2">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="flex flex-col items-center rounded-md bg-sunken/70 px-2 py-2.5 text-center"
            >
              <p className="tabular text-base font-semibold leading-tight text-text">
                {formatRate(stat.value ?? 0)}
                <span className="ml-1 font-ui text-[11px] font-normal text-muted">sat/vB</span>
              </p>
              <p className="mt-1 font-ui text-[11px] text-muted">{stat.label}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="font-ui text-sm text-muted">
          {fees.isPending ? "Loading…" : "The fee source did not answer."}
        </p>
      )}
    </Card>
  );
}

/** `2` -> "2", `8.5` -> "8.5": rates read clean, never "2.0". */
function formatRate(rate: number): string {
  return Number.isInteger(rate) ? String(rate) : rate.toFixed(1);
}

function StatusCard({ snapshot, error }: { snapshot: WalletSnapshot; error: string | null }) {
  const { meta, tip_height } = snapshot;
  const rows: { label: string; value: ReactNode }[] = [
    {
      label: "Last sync",
      value: error ? (
        <span
          className="inline-flex items-center gap-1 text-pending"
          title={error}
          aria-label={`Sync failed: ${error}`}
        >
          <AlertTriangle size={13} strokeWidth={1.5} aria-hidden />
          Sync failed
        </span>
      ) : meta.last_sync ? (
        <span className="tabular">{relativeTime(meta.last_sync.at)}</span>
      ) : (
        "never"
      ),
    },
    {
      label: "Backend",
      value: meta.last_sync ? (
        <span className="font-data text-[12px]">{meta.last_sync.backend}</span>
      ) : (
        "—"
      ),
    },
    {
      label: "Block",
      value:
        tip_height > 0 ? (
          <span className="tabular">{groupThousands(String(tip_height))}</span>
        ) : (
          "—"
        ),
    },
  ];
  return (
    <Card label="Watch status">
      <dl className="flex flex-col gap-2.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3">
            <dt className="font-ui text-xs text-muted">{row.label}</dt>
            <dd className="min-w-0 truncate text-right font-ui text-[13px] text-text">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

// --- right column -------------------------------------------------------

function HistoryCard({ snapshot }: { snapshot: WalletSnapshot }) {
  const { masked, unit } = useUi();
  const points = balanceSeries(snapshot.txs, snapshot.balance.total);
  return (
    <Card label="Balance history" className="min-h-[220px] flex-1">
      {masked ? (
        <p className="flex h-full items-center justify-center font-ui text-sm text-muted">
          {MASKED} · amounts are hidden
        </p>
      ) : points.length < 2 ? (
        <p className="flex h-full items-center justify-center font-ui text-sm text-muted">
          Not enough history to chart yet.
        </p>
      ) : (
        <BalanceChart points={points} unit={unit} />
      )}
    </Card>
  );
}

function ActivityCard({ snapshot }: { snapshot: WalletSnapshot }) {
  const { selectTx, setView } = useUi();
  const txs = snapshot.txs.slice(0, 5);
  return (
    <Card
      label="Latest activity"
      className="shrink-0"
      action={
        txs.length > 0 ? (
          <button
            type="button"
            onClick={() => setView("transactions")}
            className="cursor-pointer rounded-md px-2 py-1 font-ui text-xs font-medium text-primary transition-colors duration-150 hover:bg-sunken"
          >
            All transactions →
          </button>
        ) : undefined
      }
    >
      {txs.length === 0 ? (
        <p className="font-ui text-sm text-muted">
          No transactions yet. Once this wallet sees activity on the chain, it
          shows up here.
        </p>
      ) : (
        <ul>
          {txs.map((tx) => (
            <ActivityRow key={tx.txid} tx={tx} onOpen={() => selectTx(tx.txid)} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ActivityRow({ tx, onOpen }: { tx: TxSummary; onOpen: () => void }) {
  const incoming = tx.net_sats >= 0;
  const pending = tx.status.state === "pending";
  return (
    <li className="border-b border-border/60 last:border-b-0">
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full cursor-pointer items-center gap-2.5 rounded-md px-1 py-1.5 text-left transition-colors duration-100 hover:bg-sunken/60"
      >
        <span
          aria-hidden
          className={clsx(
            "inline-flex size-6 shrink-0 items-center justify-center rounded-md",
            incoming && !pending
              ? "bg-confirmed-surface text-confirmed"
              : "bg-sunken text-muted",
          )}
        >
          {incoming ? (
            <ArrowDownLeft size={13} strokeWidth={1.5} />
          ) : (
            <ArrowUpRight size={13} strokeWidth={1.5} />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-ui text-[13px] text-text">
            {incoming ? "Received" : "Sent"}
          </span>
          <span className="truncate text-[11px] text-muted">
            {tx.status.state === "confirmed" && tx.status.timestamp ? (
              <span className="tabular">{formatTimestamp(tx.status.timestamp)}</span>
            ) : (
              <span className="font-data">{truncateMiddle(tx.txid, 8, 8)}</span>
            )}
          </span>
        </span>
        <ListAmount sats={tx.net_sats} pending={pending} />
        <ChevronRight
          size={14}
          strokeWidth={1.5}
          aria-hidden
          className="shrink-0 text-muted opacity-60 transition-opacity duration-150 group-hover:opacity-100"
        />
      </button>
    </li>
  );
}
