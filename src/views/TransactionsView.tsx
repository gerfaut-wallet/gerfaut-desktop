import { ChevronDown } from "lucide-react";
import { Button } from "../components/Button";
import { SyncIndicator } from "../components/SyncIndicator";
import { MASKED, formatAmount } from "../lib/format";
import { useLoadMoreHistory, useSnapshot, useSyncing } from "../state/queries";
import { useUi } from "../state/store";
import { TxList } from "./TxList";

/** Full transaction history of one wallet, with the compact balance in
    the header — the big figure lives on the overview. */
export function TransactionsView({ walletId }: { walletId: string }) {
  const { masked, unit, syncErrors } = useUi();
  const snapshot = useSnapshot(walletId);
  const syncing = useSyncing();
  const loadMore = useLoadMoreHistory();

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
  const { meta, balance, txs } = snapshot.data;

  return (
    <div className="flex h-full flex-col pb-2">
      <header className="flex items-end justify-between gap-4 px-1 pb-4 pt-2">
        <div>
          <h1 className="flex items-baseline gap-2.5 font-display text-2xl font-semibold tracking-[-0.01em] text-text">
            Transactions
            {txs.length > 0 && (
              <span className="tabular rounded-full bg-sunken px-2 py-0.5 font-ui text-xs font-medium text-muted">
                {txs.length}
              </span>
            )}
          </h1>
          <div className="mt-1">
            <SyncIndicator
              stamp={meta.last_sync}
              syncing={syncing}
              error={syncErrors[walletId] ?? null}
            />
          </div>
        </div>
        <div className="pb-0.5 text-right">
          <p className="font-ui text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
            Total balance
          </p>
          <p className="tabular text-[15px] font-semibold text-text">
            {masked ? MASKED : formatAmount(balance.total, unit)}
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-surface">
        <TxList txs={txs} />
        {snapshot.data.truncated && (
          <div className="flex flex-col items-center gap-1.5 px-3 py-4">
            <Button
              variant="secondary"
              onClick={() => loadMore.mutate(walletId)}
              disabled={loadMore.isPending}
            >
              <ChevronDown
                size={16}
                strokeWidth={1.5}
                aria-hidden
                className={loadMore.isPending ? "motion-safe:animate-bounce" : undefined}
              />
              {loadMore.isPending ? "Fetching…" : "Load older transactions"}
            </Button>
            <p className="font-ui text-xs text-muted">
              This address has a long history: it loads in rounds. The balance
              above already covers all of it.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
