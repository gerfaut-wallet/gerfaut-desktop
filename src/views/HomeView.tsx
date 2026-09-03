import { clsx } from "clsx";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  ChevronRight,
  Clock,
  Coins,
  Route,
} from "lucide-react";
import type { ReactNode } from "react";
import { Balance, ListAmount } from "../components/Amount";
import { BalanceChart } from "../components/BalanceChart";
import {
  LOCALE,
  MASKED,
  formatAmountSigned,
  formatTimestamp,
  groupThousands,
  relativeTime,
  truncateMiddle,
} from "../lib/format";
import { SUPPORTED_RANGES } from "../lib/ipc";
import type { PriceRange, TxSummary, WalletMeta, WalletSnapshot } from "../lib/ipc";
import { policyDigest } from "../lib/policy";
import { balanceSeries } from "../lib/series";
import { usePriceHistory, useSnapshot, useUtxos, useWalletPolicy } from "../state/queries";
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
    zero. The note says where the number comes from, and only then: a
    balance with nothing to explain explains nothing. "All funds
    confirmed" was the normal state announcing itself. */
function balanceNote(meta: WalletMeta, error: string | null): string | null {
  if (error && !meta.last_sync) return "Sync failed: nothing fetched yet.";
  if (error) return "Sync failed: showing the last known balance.";
  if (!meta.last_sync) return "Not synced yet.";
  return null;
}

/** What of the total is still moving: the signed sum of the
    transactions not yet in a block, behind a clock. The total above
    already counts it; this line says how much of it the chain has not
    taken yet, and which way it is going. Amber is the colour of
    waiting, and the sign and the glyph say it without the colour. */
function PendingLine({ sats }: { sats: number }) {
  const { masked, unit } = useUi();
  const figure = masked ? MASKED : formatAmountSigned(sats, unit);
  return (
    <p className="mt-2 flex items-center gap-1.5 tabular text-[13px] font-medium text-pending">
      <Clock size={13} strokeWidth={1.5} aria-hidden />
      <span>{figure}</span>
      <span className="sr-only">pending</span>
    </p>
  );
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
  const policy = useWalletPolicy(walletId);
  const { setView } = useUi();
  const { balance, meta } = snapshot;
  const note = balanceNote(meta, error);
  // The policy in the grammar of the counts: "1 key", "2 of 3 keys",
  // "Recovery in 142 days". Until it is in, the row is only its name.
  const digest = policy.data ? policyDigest(policy.data) : { figure: "Policy", label: "" };
  return (
    <Card label="Total balance" className="flex-1">
      <div className="flex h-full flex-col">
        <Balance sats={balance.total} />
        {note ? (
          <p className="mt-2 font-ui text-xs text-muted">{note}</p>
        ) : (
          balance.pending_net_sats !== null && <PendingLine sats={balance.pending_net_sats} />
        )}
        <div className="flex-1" />
        <div className="-mx-2 mt-3 border-t border-border/60 pt-2">
          <LinkRow
            icon={<Coins size={15} strokeWidth={1.5} aria-hidden />}
            figure={utxos.data ? groupThousands(String(utxos.data.length)) : "…"}
            label={`UTXO${(utxos.data?.length ?? 0) === 1 ? "" : "s"}`}
            onClick={() => setView("utxos")}
          />
          <LinkRow
            icon={<ArrowLeftRight size={15} strokeWidth={1.5} aria-hidden />}
            figure={groupThousands(String(meta.cached.tx_count))}
            label={`transaction${meta.cached.tx_count === 1 ? "" : "s"}`}
            onClick={() => setView("transactions")}
          />
          <LinkRow
            icon={<Route size={15} strokeWidth={1.5} aria-hidden />}
            figure={digest.figure}
            label={digest.label}
            hint={policy.data ? "policy" : undefined}
            onClick={() => setView("policy")}
          />
        </div>
      </div>
    </Card>
  );
}

/** One glanceable line that leads to its page: a lead figure, a muted
    tail, a chevron. Counts and the policy digest share it — both are
    structure, not amounts, and stay visible in masked mode. */
function LinkRow({
  icon,
  figure,
  label,
  hint,
  onClick,
}: {
  icon: ReactNode;
  figure: string;
  label: string;
  /** Where the row leads, for a reader who cannot see the icon. */
  hint?: string;
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
        <span className="tabular font-medium">{figure}</span>
        {label && (
          <>
            {" "}
            <span className="text-muted">{label}</span>
          </>
        )}
        {hint && <span className="sr-only">, {hint}</span>}
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
            {new Intl.NumberFormat(LOCALE, {
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
function StatusCard({ snapshot, error }: { snapshot: WalletSnapshot; error: string | null }) {
  const { meta, tip_height } = snapshot;
  const rows: { label: string; value: ReactNode; detail?: string }[] = [
    {
      label: "Last sync",
      value: error ? (
        <span className="inline-flex items-center gap-1 text-pending">
          <AlertTriangle size={13} strokeWidth={1.5} aria-hidden />
          Sync failed
        </span>
      ) : meta.last_sync ? (
        <span className="tabular">{relativeTime(meta.last_sync.at)}</span>
      ) : (
        "never"
      ),
      // Why, under the row rather than behind a hover: the core states
      // it in a sentence, and a sentence is read where it lands.
      detail: error ?? undefined,
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
          <div
            key={row.label}
            className={clsx(
              "flex items-baseline justify-between",
              row.detail ? "flex-wrap gap-x-3 gap-y-1" : "gap-3",
            )}
          >
            <dt className="font-ui text-xs text-muted">{row.label}</dt>
            <dd className="min-w-0 truncate text-right font-ui text-[13px] text-text">
              {row.value}
            </dd>
            {row.detail && (
              <dd className="line-clamp-2 basis-full font-ui text-xs text-muted" title={row.detail}>
                {row.detail}
              </dd>
            )}
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
