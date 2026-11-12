import { SyncIndicator } from "../components/SyncIndicator";
import { LoadFailure } from "../components/LoadFailure";
import { HeaderBalance, PageHeader } from "../components/PageHeader";
import { useSnapshot, useUtxos } from "../state/queries";
import { useWalletSync } from "../state/walletSync";
import { UtxoTable } from "./UtxoTable";

/** Unspent outputs of one wallet, as a table with a pinned header and
    the compact balance beside the title. */
export function UtxosView({ walletId }: { walletId: string }) {
  const snapshot = useSnapshot(walletId);
  const utxos = useUtxos(walletId, true);
  const sync = useWalletSync(walletId);

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

  return (
    <div className="flex h-full flex-col pb-2">
      <PageHeader
        title="UTXOs"
        count={utxos.data?.length}
        sub={<SyncIndicator stamp={snapshot.data.meta.last_sync} sync={sync} />}
        aside={<HeaderBalance sats={snapshot.data.balance.total} />}
      />

      {/* As tall as its rows, then scrolling: a short list stays short. */}
      <div className="min-h-0 overflow-y-auto rounded-lg border border-border bg-surface">
        {utxos.isPending ? (
          <p className="px-3 py-4 font-ui text-sm text-muted">Loading UTXOs…</p>
        ) : utxos.isError ? (
          // Never the empty table: it says the wallet holds no coins.
          <div className="px-2">
            <LoadFailure
              what="The UTXOs"
              error={utxos.error}
              retrying={utxos.isFetching}
              onRetry={() => void utxos.refetch()}
            />
          </div>
        ) : (
          <UtxoTable utxos={utxos.data ?? []} />
        )}
      </div>
    </div>
  );
}
