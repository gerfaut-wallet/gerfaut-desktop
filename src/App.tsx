import { useEffect, useRef, useState } from "react";
import { Button } from "./components/Button";
import { EmptyState } from "./components/EmptyState";
import { Toast } from "./components/Toast";
import { Sidebar } from "./shell/Sidebar";
import { useAutoLock, useLock } from "./state/lock";
import { LockScreen } from "./views/LockScreen";
import { WelcomeTour } from "./views/WelcomeTour";
import { useSettings, useSyncAll, useSyncing, useWallets } from "./state/queries";
import { useUi } from "./state/store";
import { AddWalletModal } from "./views/AddWalletModal";
import { BroadcastView } from "./views/BroadcastView";
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
  // Any sync in flight, not only this hook's: the one a fresh wallet
  // starts, or a single wallet's refresh, must turn the sidebar icon.
  const syncing = useSyncing();
  const {
    view,
    activeWalletId,
    hydratePrefs,
    notifyInterval,
    notifyNewTx,
  } = useUi();
  const hydrated = useRef(false);
  const autosynced = useRef(false);
  const lockLoaded = useLock((state) => state.loaded);
  const locked = useLock((state) => state.locked);
  const loadLock = useLock((state) => state.load);
  const [tourOpen, setTourOpen] = useState(false);
  useAutoLock();

  // Asking the vault is what decides whether the app starts locked.
  useEffect(() => {
    if (!lockLoaded) void loadLock();
  }, [lockLoaded, loadLock]);

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

  // And then on the rhythm the user chose, while the window is open.
  // It talks to the configured backend and to nothing else.
  const hasWallets = (wallets.data?.length ?? 0) > 0;
  useEffect(() => {
    if (!notifyNewTx || notifyInterval <= 0 || !network || !hasWallets) return;
    const timer = setInterval(() => {
      if (!syncing) syncAll.mutate(network);
    }, notifyInterval * 1000);
    return () => clearInterval(timer);
  }, [notifyNewTx, notifyInterval, network, hasWallets, syncing, syncAll]);

  // The tour only ever stands in front of an empty vault: someone with
  // wallets already knows what this is. The vault's own preference is
  // what decides, not the hydrated copy, which lands a frame later.
  const emptyVault = (wallets.data?.length ?? 0) === 0;
  const tourSeen = settings.data?.app_prefs["onboarding.seen"] === "1";
  useEffect(() => {
    if (settings.data && emptyVault && !tourSeen && !locked) setTourOpen(true);
  }, [settings.data, emptyVault, tourSeen, locked]);

  if (settings.isPending || wallets.isPending || !lockLoaded) {
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

  // Nothing of a wallet is in the tree behind the lock: it replaces
  // the shell rather than covering it.
  if (locked) return <LockScreen />;

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
        syncing={syncing}
        onSyncAll={() => syncAll.mutate(settings.data.active_network)}
        onLock={settings.data.app_lock ? useLock.getState().lockNow : undefined}
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
                  {view === "receive" && <ReceiveView walletId={activeWallet.id} />}
                  {view === "broadcast" && (
                    <BroadcastView network={settings.data.active_network} />
                  )}
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
      <WelcomeTour open={tourOpen} onClose={() => setTourOpen(false)} />
      <Toast />
    </div>
  );
}
