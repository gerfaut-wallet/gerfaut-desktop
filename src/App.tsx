import { useEffect, useRef } from "react";
import { Button } from "./components/Button";
import { EmptyState } from "./components/EmptyState";
import { Toast } from "./components/Toast";
import { Sidebar } from "./shell/Sidebar";
import { useSettings, useSyncAll, useWallets } from "./state/queries";
import { useUi } from "./state/store";
import { AddWalletModal } from "./views/AddWalletModal";
import { AddressesView } from "./views/AddressesView";
import { ExportView } from "./views/ExportView";
import { HomeView } from "./views/HomeView";
import { ReceiveView } from "./views/ReceiveView";
import { SettingsView } from "./views/SettingsView";
import { TransactionsView } from "./views/TransactionsView";
import { TxDetailModal } from "./views/TxDetailModal";
import { UtxosView } from "./views/UtxosView";

export default function App() {
  const settings = useSettings();
  const network = settings.data?.active_network;
  const wallets = useWallets(network);
  const syncAll = useSyncAll();
  const { view, activeWalletId, hydratePrefs } = useUi();
  const hydrated = useRef(false);
  const autosynced = useRef(false);

  // Hydrate UI prefs from the vault once.
  useEffect(() => {
    if (settings.data && !hydrated.current) {
      hydrated.current = true;
      hydratePrefs(settings.data.app_prefs);
    }
  }, [settings.data, hydratePrefs]);

  // One background refresh at startup; data stays visibly stamped.
  useEffect(() => {
    if (wallets.data && wallets.data.length > 0 && !autosynced.current && network) {
      autosynced.current = true;
      syncAll.mutate(network);
    }
  }, [wallets.data, network, syncAll]);

  if (settings.isPending || wallets.isPending) {
    return (
      <div className="shell-rail flex h-full items-center justify-center bg-shell">
        <p className="font-ui text-sm text-muted">Opening vault…</p>
      </div>
    );
  }
  if (settings.isError || wallets.isError || !settings.data) {
    return (
      <div className="shell-rail flex h-full items-center justify-center bg-shell">
        <p className="max-w-sm text-center font-ui text-sm text-muted">
          The vault could not be opened. Restart Gerfaut; if this persists, the
          OS credential store refused access to the vault key.
        </p>
      </div>
    );
  }

  const walletList = wallets.data ?? [];
  // Selection is derived, never reset by effects: a stale list between
  // an add and its refetch must not steal the selection.
  const activeWallet =
    walletList.find((wallet) => wallet.id === activeWalletId) ?? walletList[0] ?? null;

  return (
    // The shell: everything floats on the invariant dark base — the
    // sidebar sits straight on it, the canvas is a rounded sheet.
    <div className="flex h-full bg-shell">
      <Sidebar
        wallets={walletList}
        activeWalletId={activeWallet?.id ?? null}
        network={settings.data.active_network}
        syncing={syncAll.isPending}
        onSyncAll={() => syncAll.mutate(settings.data.active_network)}
      />

      <main className="min-w-0 flex-1 p-2 pl-0">
        <div className="h-full overflow-hidden rounded-[var(--radius-canvas)] bg-background shadow-canvas">
          <div className="h-full overflow-y-auto">
            <div className="mx-auto h-full max-w-[1280px] px-6 py-4">
              {view === "settings" ? (
                <SettingsView settings={settings.data} wallets={walletList} />
              ) : walletList.length === 0 ? (
                <EmptyState
                  title="No wallets watched yet"
                  hint="Add a descriptor, an extended public key, or an address. Gerfaut watches it and never touches a key."
                  action={
                    <Button
                      variant="primary"
                      onClick={() => useUi.getState().setAddWalletOpen(true)}
                    >
                      Add a wallet
                    </Button>
                  }
                />
              ) : activeWallet ? (
                <>
                  {view === "home" && <HomeView walletId={activeWallet.id} />}
                  {view === "transactions" && (
                    <TransactionsView walletId={activeWallet.id} />
                  )}
                  {view === "utxos" && <UtxosView walletId={activeWallet.id} />}
                  {view === "addresses" && <AddressesView walletId={activeWallet.id} />}
                  {view === "receive" && <ReceiveView walletId={activeWallet.id} />}
                  {view === "export" && <ExportView walletId={activeWallet.id} />}
                </>
              ) : null}
            </div>
          </div>
        </div>
      </main>

      {view !== "settings" && activeWallet && (
        <TxDetailModal walletId={activeWallet.id} network={activeWallet.network} />
      )}
      <AddWalletModal activeNetwork={settings.data.active_network} />
      <Toast />
    </div>
  );
}
