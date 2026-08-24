import { SyncIndicator } from "../components/SyncIndicator";
import { useSnapshot, useSyncing, useUtxos } from "../state/queries";
import { useUi } from "../state/store";
import { UtxoTable } from "./UtxoTable";

/** Unspent outputs of one wallet, as a table. No headline figure: the
    overview already carries the balance. */
export function UtxosView({ walletId }: { walletId: string }) {
  const { syncErrors } = useUi();
  const snapshot = useSnapshot(walletId);
  const utxos = useUtxos(walletId, true);
  const syncing = useSyncing();

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

  return (
    <div className="flex h-full flex-col pb-2">
      <header className="px-1 pb-4 pt-2">
        <h1 className="flex items-baseline gap-2.5 font-display text-2xl font-semibold tracking-[-0.01em] text-text">
          UTXOs
          {(utxos.data?.length ?? 0) > 0 && (
            <span className="tabular rounded-full bg-sunken px-2 py-0.5 font-ui text-xs font-medium text-muted">
              {utxos.data?.length}
            </span>
          )}
        </h1>
        <div className="mt-1">
          <SyncIndicator
            stamp={snapshot.data.meta.last_sync}
            syncing={syncing}
            error={syncErrors[walletId] ?? null}
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-surface">
        {utxos.isPending ? (
          <p className="px-3 py-4 font-ui text-sm text-muted">Loading UTXOs…</p>
        ) : (
          <UtxoTable utxos={utxos.data ?? []} />
        )}
      </div>
    </div>
  );
}
