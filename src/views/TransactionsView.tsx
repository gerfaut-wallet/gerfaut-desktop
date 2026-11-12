import { ChevronDown } from "lucide-react";
import { Button } from "../components/Button";
import { LoadFailure } from "../components/LoadFailure";
import { HeaderBalance, PageHeader } from "../components/PageHeader";
import { SyncIndicator } from "../components/SyncIndicator";
import { useLoadMoreHistory, useSnapshot } from "../state/queries";
import { useWalletSync } from "../state/walletSync";
import { isFirstSync } from "../lib/syncState";
import { TxList } from "./TxList";

/** Full transaction history of one wallet, with the compact balance in
    the header — the big figure lives on the overview. */
export function TransactionsView({ walletId }: { walletId: string }) {
  const snapshot = useSnapshot(walletId);
  const sync = useWalletSync(walletId);
  const loadMore = useLoadMoreHistory();

  if (snapshot.isPending) {
    return <p className="py-4 font-ui text-sm text-muted">Loading wallet…</p>;
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
  const { meta, balance, txs } = snapshot.data;
  const firstSync = isFirstSync(sync, meta);

  return (
    <div className="flex h-full flex-col pb-2">
      <PageHeader
        title="Transactions"
        count={txs.length}
        sub={<SyncIndicator stamp={meta.last_sync} sync={sync} />}
        aside={<HeaderBalance sats={firstSync ? null : balance.total} />}
      />

      {/* As tall as its rows, then scrolling: a short list stays short,
          not a white box down to the bottom of the window. */}
      <div className="min-h-0 overflow-y-auto rounded-lg border border-border bg-surface">
        {firstSync && txs.length === 0 ? (
          // Not the empty list: it says the wallet has no history.
          <p className="px-3 py-4 font-ui text-sm text-muted">Syncing…</p>
        ) : (
          <TxList txs={txs} />
        )}
        {snapshot.data.truncated && (
          <div className="flex flex-col items-center gap-1.5 px-3 py-4">
            <Button
              variant="secondary"
              icon={ChevronDown}
              busy={loadMore.isPending}
              onClick={() => loadMore.mutate(walletId)}
            >
              {loadMore.isPending ? "Fetching…" : "Load older transactions"}
            </Button>
            <p className="font-ui text-xs text-muted">
              The balance above already covers the full history.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
