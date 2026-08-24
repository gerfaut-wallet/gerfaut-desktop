import { clsx } from "clsx";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Balance } from "../components/Amount";
import { ListAmount } from "../components/Amount";
import { Button, IconButton } from "../components/Button";
import { PriceChart } from "../components/PriceChart";
import { SyncIndicator } from "../components/SyncIndicator";
import { MASKED, formatAmount, formatTimestamp, groupThousands, relativeTime, truncateMiddle } from "../lib/format";
import { SUPPORTED_RANGES } from "../lib/ipc";
import type { TxSummary } from "../lib/ipc";
import { usePriceHistory, useSnapshot, useSyncing, useUtxos } from "../state/queries";
import type { WidgetId } from "../state/store";
import { DEFAULT_HOME_LAYOUT, useUi } from "../state/store";

/** Fixed footprint of each widget on the 6-column grid. */
const WIDGET_META: Record<WidgetId, { label: string; span: string }> = {
  balance: { label: "Total balance", span: "lg:col-span-2" },
  price: { label: "Bitcoin price", span: "lg:col-span-4" },
  activity: { label: "Latest activity", span: "lg:col-span-4" },
  utxos: { label: "UTXOs", span: "lg:col-span-2" },
  status: { label: "Watch status", span: "lg:col-span-2" },
};

/** Overview of one wallet: a small grid of glanceable widgets, each a
    preview that leads to its full page. The set and order belong to
    the user, per wallet or shared (settings). */
export function HomeView({ walletId }: { walletId: string }) {
  const {
    homeEditing,
    setHomeEditing,
    setHomeLayout,
    sharedHome,
    syncErrors,
  } = useUi();
  const snapshot = useSnapshot(walletId);
  const syncing = useSyncing();
  const layout = useUi((state) => {
    // Subscribe to layout changes; the selector recomputes on write.
    void state.homeLayouts;
    void state.sharedHomeLayout;
    void state.sharedHome;
    return state.homeLayout(walletId);
  });
  const [dragged, setDragged] = useState<WidgetId | null>(null);

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
  const missing = DEFAULT_HOME_LAYOUT.filter((id) => !layout.includes(id));

  const move = (id: WidgetId, direction: -1 | 1) => {
    const index = layout.indexOf(id);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= layout.length) return;
    const next = [...layout];
    next.splice(index, 1);
    next.splice(target, 0, id);
    setHomeLayout(walletId, next);
  };

  const reorderOnto = (target: WidgetId) => {
    if (!dragged || dragged === target) return;
    const next = layout.filter((id) => id !== dragged);
    next.splice(next.indexOf(target), 0, dragged);
    setHomeLayout(walletId, next);
  };

  return (
    <div className="pb-8">
      <header className="flex items-start justify-between gap-4 px-1 pb-5 pt-2">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-[-0.01em] text-text">
            {meta.name}
          </h1>
          <div className="mt-1">
            <SyncIndicator
              stamp={meta.last_sync}
              syncing={syncing}
              error={syncErrors[walletId] ?? null}
            />
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {homeEditing && (
            <>
              {sharedHome && (
                <span className="font-ui text-xs text-muted">Applies to every wallet</span>
              )}
              <Button
                variant="ghost"
                className="h-9"
                onClick={() => setHomeLayout(walletId, DEFAULT_HOME_LAYOUT)}
              >
                <RotateCcw size={14} strokeWidth={1.5} aria-hidden />
                Reset
              </Button>
              <Button variant="primary" className="h-9" onClick={() => setHomeEditing(false)}>
                <Check size={15} strokeWidth={1.75} aria-hidden />
                Done
              </Button>
            </>
          )}
          {!homeEditing && (
            <Button variant="ghost" className="h-9" onClick={() => setHomeEditing(true)}>
              <SlidersHorizontal size={14} strokeWidth={1.5} aria-hidden />
              Customize
            </Button>
          )}
        </div>
      </header>

      {layout.length === 0 && !homeEditing ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-surface px-6 py-10">
          <p className="font-ui text-base text-text">This overview is empty</p>
          <p className="font-ui text-sm text-muted">
            Add widgets to see the wallet at a glance.
          </p>
          <Button variant="secondary" className="mt-2" onClick={() => setHomeEditing(true)}>
            <SlidersHorizontal size={15} strokeWidth={1.5} aria-hidden />
            Customize
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-6">
          {layout.map((id, index) => (
            <WidgetFrame
              key={id}
              id={id}
              editing={homeEditing}
              dragging={dragged === id}
              first={index === 0}
              last={index === layout.length - 1}
              onRemove={() => setHomeLayout(walletId, layout.filter((w) => w !== id))}
              onMove={(direction) => move(id, direction)}
              onDragStart={() => setDragged(id)}
              onDragEnd={() => setDragged(null)}
              onDragOver={() => reorderOnto(id)}
            >
              {id === "balance" && <BalanceWidget walletId={walletId} />}
              {id === "price" && <PriceWidget />}
              {id === "activity" && <ActivityWidget walletId={walletId} />}
              {id === "utxos" && <UtxoWidget walletId={walletId} />}
              {id === "status" && <StatusWidget walletId={walletId} />}
            </WidgetFrame>
          ))}
          {homeEditing && missing.length > 0 && (
            <AddWidgetTile
              missing={missing}
              onAdd={(id) => setHomeLayout(walletId, [...layout, id])}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** Card chrome shared by every widget; in edit mode it grows a drag
    handle, keyboard reordering, and a remove control. */
function WidgetFrame({
  id,
  editing,
  dragging,
  first,
  last,
  children,
  onRemove,
  onMove,
  onDragStart,
  onDragEnd,
  onDragOver,
}: {
  id: WidgetId;
  editing: boolean;
  dragging: boolean;
  first: boolean;
  last: boolean;
  children: ReactNode;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
}) {
  const meta = WIDGET_META[id];
  return (
    <section
      aria-label={meta.label}
      draggable={editing}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        if (!editing) return;
        event.preventDefault();
        onDragOver();
      }}
      className={clsx(
        "flex min-h-[164px] flex-col rounded-lg border bg-surface p-5",
        meta.span,
        editing ? "border-dashed border-primary/50" : "border-border",
        editing && "cursor-grab",
        dragging && "opacity-60",
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
          {meta.label}
        </p>
        {editing && (
          <span className="flex items-center gap-0.5">
            <IconButton
              label={`Move ${meta.label} earlier`}
              className="size-7"
              disabled={first}
              onClick={() => onMove(-1)}
            >
              <ChevronLeft size={14} strokeWidth={1.5} aria-hidden />
            </IconButton>
            <IconButton
              label={`Move ${meta.label} later`}
              className="size-7"
              disabled={last}
              onClick={() => onMove(1)}
            >
              <ChevronRight size={14} strokeWidth={1.5} aria-hidden />
            </IconButton>
            <GripVertical
              size={14}
              strokeWidth={1.5}
              aria-hidden
              className="mx-0.5 text-muted"
            />
            <IconButton
              label={`Remove ${meta.label}`}
              className="size-7"
              onClick={onRemove}
            >
              <X size={14} strokeWidth={1.5} aria-hidden />
            </IconButton>
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

function AddWidgetTile({
  missing,
  onAdd,
}: {
  missing: WidgetId[];
  onAdd: (id: WidgetId) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative lg:col-span-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex min-h-[164px] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border font-ui text-sm text-muted transition-colors duration-150 hover:border-primary/50 hover:text-text"
      >
        <Plus size={18} strokeWidth={1.5} aria-hidden />
        Add a widget
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Available widgets"
          className="absolute left-0 right-0 top-full z-30 mt-1.5 rounded-lg bg-surface p-1.5 shadow-overlay"
        >
          {missing.map((id) => (
            <button
              key={id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onAdd(id);
              }}
              className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left font-ui text-sm text-text transition-colors duration-150 hover:bg-sunken"
            >
              <Plus size={14} strokeWidth={1.5} aria-hidden className="text-muted" />
              {WIDGET_META[id].label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- the widgets --------------------------------------------------------

function BalanceWidget({ walletId }: { walletId: string }) {
  const snapshot = useSnapshot(walletId);
  if (!snapshot.data) return <WidgetPending />;
  const { balance } = snapshot.data;
  return (
    <div className="flex h-full flex-col gap-3">
      <Balance sats={balance.total} />
      <p className="font-ui text-xs text-muted">
        {balance.untrusted_pending + balance.trusted_pending > 0
          ? "Includes pending funds not yet confirmed."
          : "All funds confirmed."}
      </p>
    </div>
  );
}

function PriceWidget() {
  const { fiatSource, fiatCurrency, priceRange, setPriceRange } = useUi();
  const ranges = SUPPORTED_RANGES[fiatSource];
  const range = ranges.includes(priceRange) ? priceRange : "month";
  const history = usePriceHistory(range, true);
  return (
    <div className="flex h-full flex-col">
      <PriceChart
        history={history.data}
        pending={history.isPending}
        failed={history.isError}
        currency={fiatCurrency}
        range={range}
        ranges={ranges}
        onRangeChange={setPriceRange}
      />
      <p className="mt-2 font-ui text-[11px] text-muted">
        via {fiatSource === "mempool_space" ? "mempool.space" : fiatSource === "kraken" ? "Kraken" : "CoinGecko"}
        {" · "}
        {fiatCurrency.toUpperCase()} · set in Settings
      </p>
    </div>
  );
}

function ActivityWidget({ walletId }: { walletId: string }) {
  const snapshot = useSnapshot(walletId);
  const { selectTx, setView } = useUi();
  if (!snapshot.data) return <WidgetPending />;
  const txs = snapshot.data.txs.slice(0, 5);
  if (txs.length === 0) {
    return (
      <p className="font-ui text-sm text-muted">
        No transactions yet. Once this wallet sees activity on the chain, it
        shows up here.
      </p>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <ul className="flex-1">
        {txs.map((tx) => (
          <ActivityRow key={tx.txid} tx={tx} onOpen={() => selectTx(tx.txid)} />
        ))}
      </ul>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={() => setView("transactions")}
          className="cursor-pointer rounded-md px-2 py-1 font-ui text-xs font-medium text-primary transition-colors duration-150 hover:bg-sunken"
        >
          All transactions →
        </button>
      </div>
    </div>
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
        className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-1 py-1.5 text-left transition-colors duration-100 hover:bg-sunken/60"
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
      </button>
    </li>
  );
}

function UtxoWidget({ walletId }: { walletId: string }) {
  const utxos = useUtxos(walletId, true);
  const { setView, masked, unit } = useUi();
  if (!utxos.data) return <WidgetPending />;
  const total = utxos.data.reduce((sum, utxo) => sum + utxo.value_sats, 0);
  const pending = utxos.data.filter((utxo) => utxo.status.state === "pending").length;
  return (
    <div className="flex h-full flex-col justify-between gap-3">
      <div>
        <p className="tabular text-2xl font-semibold leading-tight text-text">
          {utxos.data.length}
        </p>
        <p className="mt-0.5 font-ui text-xs text-muted">
          unspent output{utxos.data.length === 1 ? "" : "s"}
          {pending > 0 && ` · ${pending} pending`}
        </p>
        <p className="tabular mt-2 text-[13px] font-medium text-text">
          {masked ? MASKED : formatAmount(total, unit)}
        </p>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setView("utxos")}
          className="cursor-pointer rounded-md px-2 py-1 font-ui text-xs font-medium text-primary transition-colors duration-150 hover:bg-sunken"
        >
          All UTXOs →
        </button>
      </div>
    </div>
  );
}

function StatusWidget({ walletId }: { walletId: string }) {
  const snapshot = useSnapshot(walletId);
  if (!snapshot.data) return <WidgetPending />;
  const { meta, tip_height } = snapshot.data;
  const rows: { label: string; value: ReactNode }[] = [
    {
      label: "Last sync",
      value: meta.last_sync ? (
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
    <dl className="flex h-full flex-col justify-center gap-2.5">
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-3">
          <dt className="font-ui text-xs text-muted">{row.label}</dt>
          <dd className="min-w-0 truncate text-right font-ui text-[13px] text-text">
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function WidgetPending() {
  return <p className="font-ui text-sm text-muted">Loading…</p>;
}
