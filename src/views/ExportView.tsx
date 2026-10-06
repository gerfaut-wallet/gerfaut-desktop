import { FileDown } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { Button } from "../components/Button";
import { LoadFailure } from "../components/LoadFailure";
import type { ExportDirection, ExportOptions, TxSummary } from "../lib/ipc";
import { Notice } from "../components/Notice";
import { errorMessage } from "../lib/ipc";
import { useExportCsv, useSnapshot } from "../state/queries";
import { useUi } from "../state/store";
import { Segmented, Toggle } from "./settings/primitives";

type DirectionChoice = "all" | ExportDirection;

const DIRECTIONS: { value: DirectionChoice; label: string }[] = [
  { value: "all", label: "All" },
  { value: "incoming", label: "Received" },
  { value: "outgoing", label: "Sent" },
];

/** `2026-08-25` -> unix seconds at the UTC start (or end) of that day.
    UTC as the file is: its `date_utc` column then holds only days the
    range names, and the page says so beside the fields, since the rest
    of the app shows the computer's time. */
export function dayBound(value: string, end: boolean): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  // Not Date.UTC, which reads the years 0 to 99 as 1900 to 1999.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  // 2026-02-31 is no day: the date would roll into March.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const start = date.getTime() / 1000;
  return end ? start + 86_399 : start;
}

/** What is wrong with the range as typed, or null. */
function rangeProblem(fromDay: string, toDay: string): string | null {
  const from = fromDay.trim() === "" ? undefined : dayBound(fromDay, false);
  const to = toDay.trim() === "" ? undefined : dayBound(toDay, true);
  if (from === null || to === null) return "Write each day as YYYY-MM-DD, for example 2026-01-31.";
  if (from !== undefined && to !== undefined && to < from) return "The range ends before it starts.";
  return null;
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
      <LoadFailure
        what="This wallet"
        error={snapshot.error}
        retrying={snapshot.isFetching}
        onRetry={() => void snapshot.refetch()}
      />
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
  // A day the bounds cannot read is said, and nothing is exported: a
  // bound dropped in silence would write a file of the whole history.
  const problem = rangeProblem(fromDay, toDay);

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
          This wallet's transaction history as a CSV file. Everything stays on this machine.
        </p>
      </header>

      <div className="rounded-lg border border-border bg-surface p-6">
        <div className="flex flex-col gap-5">
          <Row
            title="Date range"
            hint="Days in UTC, as the file dates each transaction. Leave empty to export the full history."
          >
            <div>
              <div className="flex items-center gap-2">
                <DateInput
                  label="From"
                  value={fromDay}
                  onChange={setFromDay}
                  invalid={problem !== null}
                />
                <span aria-hidden className="text-muted">
                  –
                </span>
                <DateInput label="To" value={toDay} onChange={setToDay} invalid={problem !== null} />
              </div>
              {problem && (
                <p
                  id="export-range-problem"
                  role="alert"
                  className="mt-1.5 max-w-xs font-ui text-xs text-muted"
                >
                  {problem}
                </p>
              )}
            </div>
          </Row>

          <Row title="Direction">
            <Segmented
              label="Direction"
              value={direction}
              onChange={setDirection}
              options={DIRECTIONS}
            />
          </Row>

          <Row
            title="Include pending"
            hint="Pending transactions have no date yet: they only export without date bounds."
          >
            <Toggle
              checked={includePending}
              onChange={setIncludePending}
              label="Include pending transactions"
            />
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
            disabled={exportCsv.isPending || selected === 0 || problem !== null}
          >
            <FileDown size={16} strokeWidth={1.5} aria-hidden />
            {exportCsv.isPending ? "Exporting…" : "Export CSV…"}
          </Button>
        </div>
        {/* Under the button that sent it, until the next try: a toast
            would be gone before it is read. */}
        {exportCsv.isError && (
          <Notice tone="info" role="alert" className="mt-4">
            The file was not written: {errorMessage(exportCsv.error)}
          </Notice>
        )}
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
      <div className="min-w-0 max-w-xl flex-[1_1_20rem]">
        <p className="font-ui text-sm font-medium text-text">{title}</p>
        {hint && <p className="mt-0.5 font-ui text-xs text-muted">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** A day as YYYY-MM-DD, typed. Not the browser's date field: it
    writes and reads the day in the language of the system, day first
    on a French machine, and Gerfaut speaks one language. A date is a
    number, not an identifier: tabular figures, not the mono face. */
function DateInput({
  label,
  value,
  onChange,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
        {label}
      </span>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        maxLength={10}
        placeholder="YYYY-MM-DD"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? "export-range-problem" : undefined}
        onChange={(event) => onChange(event.target.value.replace(/[^\d-]/g, ""))}
        className="field-focus selectable tabular h-10 w-32 rounded-sm border border-transparent bg-sunken px-2.5 font-ui text-sm text-text"
      />
    </label>
  );
}
