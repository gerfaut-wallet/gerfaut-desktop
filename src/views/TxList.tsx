import { clsx } from "clsx";
import { ArrowDownLeft, ArrowUpRight, ChevronRight } from "lucide-react";
import type { TxSummary } from "../lib/ipc";
import { formatTimestamp, truncateMiddle } from "../lib/format";
import { ListAmount } from "../components/Amount";
import { StatusPill } from "../components/StatusPill";
import { EmptyState } from "../components/EmptyState";
import { useUi } from "../state/store";

/** Transactions are list rows, never cards: they scan vertically.
    44px rows, hairline separators, amounts right-aligned in mono. */
export function TxList({ txs }: { txs: TxSummary[] }) {
  const { selectedTxid, selectTx } = useUi();

  if (txs.length === 0) {
    return (
      <EmptyState
        title="No transactions yet"
        hint="Once this wallet sees activity on the chain, it shows up here."
      />
    );
  }

  return (
    <ul aria-label="Transactions" className="flex flex-col">
      {txs.map((tx) => {
        const incoming = tx.net_sats >= 0;
        const pending = tx.status.state === "pending";
        const selected = tx.txid === selectedTxid;
        return (
          <li key={tx.txid} className="border-b border-border last:border-b-0">
            <button
              type="button"
              onClick={() => selectTx(selected ? null : tx.txid)}
              aria-expanded={selected}
              className={clsx(
                "group flex min-h-12 w-full cursor-pointer items-center gap-3 px-3 py-1.5 text-left transition-colors duration-100",
                selected ? "bg-sunken" : "hover:bg-sunken/60",
              )}
            >
              <span
                aria-hidden
                className={clsx(
                  "inline-flex size-8 shrink-0 items-center justify-center rounded-lg",
                  incoming && !pending
                    ? "bg-confirmed-surface text-confirmed"
                    : "bg-sunken text-muted",
                )}
              >
                {incoming ? (
                  <ArrowDownLeft size={15} strokeWidth={1.5} />
                ) : (
                  <ArrowUpRight size={15} strokeWidth={1.5} />
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-ui text-sm text-text">
                  {incoming ? "Received" : "Sent"}
                </span>
                <span className="truncate text-xs text-muted">
                  {tx.status.state === "confirmed" && tx.status.timestamp ? (
                    <span className="tabular">{formatTimestamp(tx.status.timestamp)}</span>
                  ) : (
                    <span className="font-data">{truncateMiddle(tx.txid, 8, 8)}</span>
                  )}
                </span>
              </span>
              <StatusPill status={tx.status} confirmations={tx.confirmations} />
              <span className="w-36 text-right">
                <ListAmount sats={tx.net_sats} pending={pending} />
              </span>
              {/* The chevron stays visible: rows must read as openable
                  at rest, not only under the pointer. Hover adds the
                  word for anyone unsure what the chevron means. */}
              <span className="flex shrink-0 items-center gap-1 text-muted">
                <span
                  aria-hidden
                  className="hidden font-ui text-[11px] font-medium opacity-0 transition-opacity duration-150 group-hover:opacity-100 lg:block"
                >
                  Details
                </span>
                <ChevronRight
                  size={16}
                  strokeWidth={1.5}
                  aria-hidden
                  className={clsx(
                    "transition-opacity duration-150",
                    selected ? "opacity-100" : "opacity-60 group-hover:opacity-100",
                  )}
                />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
