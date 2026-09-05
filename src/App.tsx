import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "./components/Button";
import { EmptyState } from "./components/EmptyState";
import { Toast } from "./components/Toast";
import { Sidebar } from "./shell/Sidebar";
import { useLock, useLockShortcut } from "./state/lock";
import { usePremiumWatch } from "./state/premium";
import { LockScreen } from "./views/LockScreen";
import { WelcomeTour } from "./views/WelcomeTour";
import type { Settings } from "./lib/ipc";
import { useSettings, useSyncAll, useSyncing, useWallets } from "./state/queries";
import { useUi } from "./state/store";
import { AddWalletModal } from "./views/AddWalletModal";
import { BroadcastView } from "./views/BroadcastView";
import { ExportView } from "./views/ExportView";
import { HomeView } from "./views/HomeView";
import { PolicyView } from "./views/PolicyView";
import { ReceiveView } from "./views/ReceiveView";
import { SettingsView } from "./views/SettingsView";
import { TransactionsView } from "./views/TransactionsView";
import { TxDetailModal } from "./views/TxDetailModal";
import { UtxosView } from "./views/UtxosView";

/** Keeps the server's heartbeat coming while there is something to
    watch: a key is set and at least one wallet was agreed to. Its own
    component, so it can sit behind the lock check without a hook
    running conditionally. */
function PremiumWatch({ settings }: { settings: Settings }) {
  const { premium } = settings;
  usePremiumWatch(premium.key !== null && premium.watched.length > 0);
  return null;
}

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
    tourDismissed,
  } = useUi();
  const hydrated = useRef(false);
  const autosynced = useRef(false);
  const locked = useLock((state) => state.locked);
  const lockSeen = useLock((state) => state.seen);
  const syncLock = useLock((state) => state.syncFromSettings);
  const [tourOpen, setTourOpen] = useState(false);
  useLockShortcut();

  // Both of these read the vault, and both have to land before the
  // browser paints, so they run in layout effects rather than ordinary
  // ones: the theme decides what the very first frame looks like, and
  // the lock decides whether that frame may show a wallet at all. An
  // effect running after the commit drew the sidebar and the wallet
  // names once before the lock screen took their place, which is the
  // one thing a lock exists to prevent. The render below waits on
  // `lockSeen` so the shell is never even built in that frame.
  useLayoutEffect(() => {
    if (settings.data && !hydrated.current) {
      hydrated.current = true;
      hydratePrefs(settings.data.app_prefs);
    }
  }, [settings.data, hydratePrefs]);

  // The vault says whether a lock exists; the first read with one in it
  // is what puts the lock screen up.
  useLayoutEffect(() => {
    if (settings.data) syncLock(settings.data.app_lock);
  }, [settings.data, syncLock]);

  // One background refresh at startup; data stays visibly stamped. It
  // waits for the lock, like the rhythm below: a sync that lands behind
  // the lock screen posts a notification naming a wallet and an amount
  // over it, which is the one thing the screen is there to stop. The
  // refresh is not lost, it is deferred — unlocking runs this effect
  // again with `autosynced` still false.
  useEffect(() => {
    if (locked) return;
    if (wallets.data && wallets.data.length > 0 && !autosynced.current && network) {
      autosynced.current = true;
      syncAll.mutate(network);
    }
  }, [wallets.data, network, syncAll, locked]);

  // And then on the rhythm the user chose, while the window is open and
  // unlocked. It talks to the configured backend and to nothing else.
  //
  // The mutation object is read through a ref: TanStack returns a fresh
  // one on every render, and this component re-renders on every toast,
  // so keeping it in the dependencies would restart the timer before it
  // ever fired.
  const hasWallets = (wallets.data?.length ?? 0) > 0;
  const syncAllRef = useRef(syncAll);
  syncAllRef.current = syncAll;
  useEffect(() => {
    if (!notifyNewTx || notifyInterval <= 0 || !network || !hasWallets) return;
    const timer = setInterval(() => {
      // Nothing runs behind the lock screen: a sync there would post a
      // notification naming a wallet and an amount over it.
      if (useLock.getState().locked) return;
      syncAllRef.current.mutate(network);
    }, notifyInterval * 1000);
    return () => clearInterval(timer);
  }, [notifyNewTx, notifyInterval, network, hasWallets]);

  // The tour only ever stands in front of an empty vault: someone with
  // wallets already knows what this is. The vault's own preference is
  // what decides, not the hydrated copy, which lands a frame later.
  const emptyVault = (wallets.data?.length ?? 0) === 0;
  const tourSeen =
    settings.data?.app_prefs["onboarding.seen"] === "1" || tourDismissed;
  useEffect(() => {
    if (settings.data && emptyVault && !tourSeen && !locked) setTourOpen(true);
  }, [settings.data, emptyVault, tourSeen, locked]);

  if (settings.isError || wallets.isError) {
    return (
      <div className="shell-rail flex h-full items-center justify-center bg-shell">
        <p className="max-w-sm text-center font-ui text-sm text-muted">
          The vault could not be opened. Restart Gerfaut; if this persists, the
          OS credential store refused access to the vault key.
        </p>
      </div>
    );
  }
  // Still opening — and until the lock has been read the vault is, as
  // far as this screen is concerned, still opening. The splash stays a
  // self-contained dark island: the theme lives in the vault too, so
  // there is nothing to follow yet and a light sheet here would flash
  // white on the way to a dark one.
  if (settings.isPending || wallets.isPending || !settings.data || !lockSeen) {
    return (
      <div className="shell-rail flex h-full items-center justify-center bg-shell">
        <p className="font-ui text-sm text-muted">Opening vault…</p>
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
                  {view === "policy" && <PolicyView walletId={activeWallet.id} />}
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

      <PremiumWatch settings={settings.data} />
      {view !== "settings" && activeWallet && (
        <TxDetailModal walletId={activeWallet.id} network={activeWallet.network} />
      )}
      <AddWalletModal activeNetwork={settings.data.active_network} />
      <WelcomeTour open={tourOpen} onClose={() => setTourOpen(false)} />
      <Toast />
    </div>
  );
}
