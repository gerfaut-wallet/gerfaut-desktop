import { FileDown, Gem } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { clsx } from "clsx";
import { Button } from "../components/Button";
import type { ExportDirection, ExportOptions, TxSummary } from "../lib/ipc";
import { isCommandError } from "../lib/ipc";
import { useExportCsv, useSnapshot } from "../state/queries";
import { useUi } from "../state/store";

type DirectionChoice = "all" | ExportDirection;

/** `2026-08-25` -> unix seconds at the UTC start (or end) of that day. */
function dayBound(value: string, end: boolean): number | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const start = Date.UTC(year, month - 1, day) / 1000;
  return end ? start + 86_399 : start;
}

/** Mirror of `gerfaut_core::export::passes`, for the live row count. */
export function matchesExport(tx: TxSummary, options: ExportOptions): boolean {
  if (options.direction === "incoming" && tx.net_sats < 0) return false;
  if (options.direction === "outgoing" && tx.net_sats >= 0) return false;
  const bounded = options.from !== null || options.to !== null;
  if (tx.status.state === "pending") return options.include_pending && !bounded;
  const at = tx.status.timestamp;
  if (at === null) return !bounded;
  if (options.from !== null && at < options.from) return false;
  if (options.to !== null && at > options.to) return false;
  return true;
}

/** Export page: the wallet's transactions as a CSV file, filtered.
    Everything happens locally — nothing leaves the machine. */
export function ExportView({ walletId }: { walletId: string }) {
  const { showToast } = useUi();
  const snapshot = useSnapshot(walletId);
  const exportCsv = useExportCsv();
  const [fromDay, setFromDay] = useState("");
  const [toDay, setToDay] = useState("");
  const [direction, setDirection] = useState<DirectionChoice>("all");
  const [includePending, setIncludePending] = useState(true);

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
  const { meta, txs, truncated } = snapshot.data;
  const options: ExportOptions = {
    from: dayBound(fromDay, false),
    to: dayBound(toDay, true),
    direction: direction === "all" ? null : direction,
    include_pending: includePending,
  };
  const selected = txs.filter((tx) => matchesExport(tx, options)).length;

  // The save dialog opens on the Rust side: the page suggests a name
  // and hears back how many rows were written, never where.
  const run = () => {
    const slug = meta.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    exportCsv.mutate(
      { id: walletId, options, suggestedName: `${slug || "wallet"}-transactions.csv` },
      {
        onSuccess: (rows) => {
          if (rows === null) return;
          showToast(rows === 1 ? "1 transaction exported" : `${rows} transactions exported`);
        },
        onError: (error) =>
          showToast(isCommandError(error) ? error.message : "The export failed"),
      },
    );
  };

  return (
    <div className="pb-8">
      <header className="px-1 pb-5 pt-2">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.01em] text-text">
          Export
        </h1>
        <p className="mt-1 font-ui text-sm text-muted">
          This wallet's transaction history as a CSV file.
        </p>
      </header>

      <div className="rounded-lg border border-border bg-surface p-6">
        <div className="flex flex-col gap-5">
          <Row title="Date range" hint="Leave empty to export the full history.">
            <div className="flex items-center gap-2">
              <DateInput label="From" value={fromDay} onChange={setFromDay} />
              <span aria-hidden className="text-muted">
                –
              </span>
              <DateInput label="To" value={toDay} onChange={setToDay} />
            </div>
          </Row>

          <Row title="Direction">
            <div role="radiogroup" aria-label="Direction" className="inline-flex rounded-md bg-sunken p-0.5">
              {(
                [
                  { value: "all", label: "All" },
                  { value: "incoming", label: "Received" },
                  { value: "outgoing", label: "Sent" },
                ] as { value: DirectionChoice; label: string }[]
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={direction === option.value}
                  onClick={() => setDirection(option.value)}
                  className={clsx(
                    "cursor-pointer rounded-[6px] px-3 py-1.5 font-ui text-sm font-medium transition-colors duration-150",
                    direction === option.value
                      ? "bg-surface text-text shadow-[inset_0_0_0_1px_var(--color-border)]"
                      : "text-muted hover:text-text",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </Row>

          <Row
            title="Include pending"
            hint="Pending transactions have no date yet: they only export without date bounds."
          >
            <button
              type="button"
              role="switch"
              aria-checked={includePending}
              aria-label="Include pending transactions"
              onClick={() => setIncludePending(!includePending)}
              className={clsx(
                "relative h-6 w-11 cursor-pointer rounded-full transition-colors duration-150",
                includePending ? "bg-primary" : "bg-border",
              )}
            >
              <span
                aria-hidden
                className={clsx(
                  "absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-[0_1px_2px_rgba(13,19,23,0.25)] transition-transform duration-150",
                  includePending && "translate-x-5",
                )}
              />
            </button>
          </Row>

          <div aria-hidden className="h-px bg-border/60" />

          <Row
            title={
              <span className="flex items-center gap-2">
                Fiat value at transaction time
                <span className="inline-flex items-center gap-1 rounded-full border border-premium/25 bg-premium-surface px-2 py-0.5 font-ui text-[10px] font-semibold uppercase tracking-[0.06em] text-premium">
                  <Gem size={11} strokeWidth={1.75} aria-hidden />
                  Premium
                </span>
              </span>
            }
            hint="Adds the price at each transaction's date to the file."
          >
            <button
              type="button"
              role="switch"
              aria-checked={false}
              disabled
              aria-label="Fiat value at transaction time (premium)"
              className="relative h-6 w-11 cursor-default rounded-full bg-border opacity-50"
            >
              <span
                aria-hidden
                className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-[0_1px_2px_rgba(13,19,23,0.25)]"
              />
            </button>
          </Row>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
          <div>
            <p className="tabular font-ui text-sm text-text">
              {selected} of {txs.length} transaction{txs.length === 1 ? "" : "s"} selected
            </p>
            {truncated && (
              <p className="mt-0.5 font-ui text-xs text-pending">
                This address has a long history: only the loaded transactions
                export. Load older rounds on the Transactions page first for a
                complete file.
              </p>
            )}
          </div>
          <Button
            variant="primary"
            onClick={run}
            disabled={exportCsv.isPending || selected === 0}
          >
            <FileDown size={16} strokeWidth={1.5} aria-hidden />
            {exportCsv.isPending ? "Exporting…" : "Export CSV…"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({
  title,
  hint,
  children,
}: {
  title: ReactNode;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
      <div className="min-w-0 max-w-xl">
        <p className="font-ui text-sm font-medium text-text">{title}</p>
        {hint && <p className="mt-0.5 font-ui text-xs text-muted">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
        {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="selectable h-10 rounded-sm bg-sunken px-2.5 font-data text-[13px] text-text outline-none"
      />
    </label>
  );
}
