import { clsx } from "clsx";
import { ArrowDownLeft, ChevronDown, Eye, EyeOff, RefreshCw } from "lucide-react";
import { Balance } from "../components/Amount";
import { Button, IconButton } from "../components/Button";
import { SyncIndicator } from "../components/SyncIndicator";
import {
  useLoadMoreHistory,
  useSnapshot,
  useSyncWallet,
  useUtxos,
} from "../state/queries";
import { useUi } from "../state/store";
import { TxList } from "./TxList";
import { UtxoTable } from "./UtxoTable";

/** Home of one wallet: balance, freshness, transactions and UTXOs. */
export function WalletHome({ walletId }: { walletId: string }) {
  const { walletTab, setWalletTab, masked, toggleMasked, setReceiveOpen, syncErrors } = useUi();
  const snapshot = useSnapshot(walletId);
  const utxos = useUtxos(walletId, walletTab === "utxos");
  const sync = useSyncWallet();
  const loadMore = useLoadMoreHistory();
  const syncingThis = sync.isPending && sync.variables === walletId;
  const syncError = syncErrors[walletId] ?? null;

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
    <div className="flex h-full flex-col">
      <header className="px-1 pb-5 pt-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-[-0.01em] text-text">
              {meta.name}
            </h1>
            <div className="mt-1">
              <SyncIndicator stamp={meta.last_sync} syncing={syncingThis} error={syncError} />
            </div>
          </div>
          <div className="flex items-center gap-1">
            <IconButton
              label={masked ? "Show balances" : "Hide balances"}
              onClick={toggleMasked}
            >
              {masked ? (
                <EyeOff size={18} strokeWidth={1.5} aria-hidden />
              ) : (
                <Eye size={18} strokeWidth={1.5} aria-hidden />
              )}
            </IconButton>
            <Button
              variant="ghost"
              onClick={() => sync.mutate(walletId)}
              disabled={syncingThis}
            >
              <RefreshCw
                size={16}
                strokeWidth={1.5}
                aria-hidden
                className={syncingThis ? "motion-safe:animate-spin" : undefined}
              />
              Sync
            </Button>
            <Button variant="primary" onClick={() => setReceiveOpen(true)}>
              <ArrowDownLeft size={16} strokeWidth={1.5} aria-hidden />
              Receive
            </Button>
          </div>
        </div>
        <div className="mt-5 rounded-lg border border-border bg-surface px-5 py-4">
          <p className="mb-2 font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
            Total balance
          </p>
          <Balance sats={balance.total} />
          {(balance.untrusted_pending > 0 || balance.trusted_pending > 0) && (
            <p className="mt-2 font-ui text-xs text-muted">
              Includes pending funds not yet confirmed.
            </p>
          )}
        </div>
      </header>

      <div className="flex gap-1 border-b border-border px-1" role="tablist" aria-label="Wallet views">
        {(["transactions", "utxos"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={walletTab === tab}
            onClick={() => setWalletTab(tab)}
            className={clsx(
              "-mb-px cursor-pointer border-b-2 px-3 py-2 font-ui text-sm font-medium transition-colors duration-150",
              walletTab === tab
                ? "border-primary text-text"
                : "border-transparent text-muted hover:text-text",
            )}
          >
            <span className="flex items-center gap-1.5">
              {tab === "transactions" ? "Transactions" : "UTXOs"}
              {tab === "transactions" && txs.length > 0 && (
                <span className="tabular rounded-full bg-sunken px-1.5 py-px text-[11px] font-medium text-muted">
                  {txs.length}
                </span>
              )}
              {tab === "utxos" && (utxos.data?.length ?? 0) > 0 && (
                <span className="tabular rounded-full bg-sunken px-1.5 py-px text-[11px] font-medium text-muted">
                  {utxos.data?.length}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {walletTab === "transactions" ? (
          <>
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
                  This address has a long history: it loads in rounds. The
                  balance above already covers all of it.
                </p>
              </div>
            )}
          </>
        ) : utxos.isPending ? (
          <p className="px-3 py-4 font-ui text-sm text-muted">Loading UTXOs…</p>
        ) : (
          <UtxoTable utxos={utxos.data ?? []} />
        )}
      </div>
    </div>
  );
}
