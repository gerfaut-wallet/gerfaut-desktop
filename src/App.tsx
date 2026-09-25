import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "./components/Button";
import { EmptyState } from "./components/EmptyState";
import { NewDeviceBanner } from "./components/NewDeviceBanner";
import { Toast } from "./components/Toast";
import { UpdateNotice } from "./components/UpdateNotice";
import { Sidebar } from "./shell/Sidebar";
import { useLiveEvents } from "./state/live";
import { isLockedError, lockedSettings, useLock, useLockShortcut } from "./state/lock";
import { useDeviceWatch, usePremiumWatch } from "./state/premium";
import { useUpdateCheck } from "./state/update";
import { LockScreen } from "./views/LockScreen";
import { WelcomeTour } from "./views/WelcomeTour";
import type { Settings } from "./lib/ipc";
import {
  keys,
  useSettings,
  useStartupFailure,
  useSyncAll,
  useSyncing,
  useWallets,
} from "./state/queries";
import { useUi } from "./state/store";
import { AddWalletModal } from "./views/AddWalletModal";
import { BroadcastView } from "./views/BroadcastView";
import { ExportView } from "./views/ExportView";
import { HomeView } from "./views/HomeView";
import { PolicyView } from "./views/PolicyView";
import { ReceiveView } from "./views/ReceiveView";
import { StartupFailure } from "./views/StartupFailure";
import { SettingsView } from "./views/SettingsView";
import { TransactionsView } from "./views/TransactionsView";
import { TxDetailModal } from "./views/TxDetailModal";
import { UtxosView } from "./views/UtxosView";

/** Keeps the server's heartbeat coming while there is something to
    watch: a key is set and at least one wallet was agreed to; and the
    account's devices current while a key is set, or while a connection
    whose answer was lost waits to go again. Its own component, so it
    can sit behind the lock check without a hook running
    conditionally. */
function PremiumWatch({ settings }: { settings: Settings }) {
  const { premium } = settings;
  usePremiumWatch(premium.key !== null && premium.watched.length > 0);
  useDeviceWatch(premium.key !== null || premium.pending_connect != null);
  return null;
}

export default function App() {
  const startup = useStartupFailure();
  const settings = useSettings();
  const locked = useLock((state) => state.locked);
  const lockSeen = useLock((state) => state.seen);
  const network = settings.data?.active_network;
  // Nothing of a wallet is asked for before the vault has said whether
  // it is locked, and nothing while it is: the lock screen used to be
  // a curtain over a cache full of descriptors and balances.
  const wallets = useWallets(network, lockSeen && !locked);
  const syncAll = useSyncAll();
  // Any sync in flight, not only this hook's: the one a fresh wallet
  // starts, or a single wallet's refresh, must turn the sidebar icon.
  const syncing = useSyncing();
  const {
    view,
    activeWalletId,
    hydratePrefs,
    tourDismissed,
  } = useUi();
  const hydrated = useRef(false);
  const autosynced = useRef(false);
  const wasLocked = useRef(false);
  const client = useQueryClient();
  const syncLock = useLock((state) => state.syncFromSettings);
  const [tourOpen, setTourOpen] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  useLockShortcut();

  // Both of these read the vault, and both have to land before the
  // browser paints, so they run in layout effects rather than ordinary
  // ones: the theme decides what the very first frame looks like, and
  // the lock decides whether that frame may show a wallet at all. An
  // effect running after the commit drew the sidebar and the wallet
  // names once before the lock screen took their place, which is the
  // one thing a lock exists to prevent. The render below waits on
  // `lockSeen` so the shell is never even built in that frame.
  //
  // The lock goes first, and the order matters: behind it the vault
  // answers the theme and nothing else, so the preferences below are
  // taken as the whole set only once it has said the app is open.
  useLayoutEffect(() => {
    if (settings.data) syncLock(settings.data.app_lock);
  }, [settings.data, syncLock]);

  useLayoutEffect(() => {
    if (!settings.data || hydrated.current) return;
    hydratePrefs(settings.data.app_prefs);
    hydrated.current = !useLock.getState().locked;
  }, [settings.data, hydratePrefs]);

  // Every page opens at its top. The canvas is one scrolling box for all
  // of them, and it used to keep the offset of the page left behind: the
  // Overview came back from a long Settings section scrolled past its
  // first card, and the red banner of a device asking into the account
  // stood out of view. Another wallet's page is another page too. Done
  // before the paint, and before any page's own effects, so a section
  // that brings a card into view on arrival still has the last word.
  useLayoutEffect(() => {
    if (canvas.current) canvas.current.scrollTop = 0;
  }, [view, activeWalletId]);

  // What the cache is allowed to hold is decided by the lock, in one
  // place. The curtain falling empties it of everything the vault
  // answered — descriptors, balances, addresses, the account key —
  // and cuts the settings entry down to the theme rather than dropping
  // it, which would lose the ramp the lock screen is painted in.
  useEffect(() => {
    if (locked) {
      wasLocked.current = true;
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== "settings" });
      client.setQueryData<Settings>(keys.settings, (cached) =>
        cached === undefined ? cached : lockedSettings(cached),
      );
    } else if (wasLocked.current) {
      wasLocked.current = false;
      void client.invalidateQueries({ queryKey: keys.settings });
    }
  }, [locked, client]);

  // One background refresh at startup; data stays visibly stamped. It
  // waits for the unlock because the vault answers nothing before it,
  // and it is not lost: unlocking runs this effect again with
  // `autosynced` still false.
  useEffect(() => {
    if (locked) return;
    if (wallets.data && wallets.data.length > 0 && !autosynced.current && network) {
      autosynced.current = true;
      syncAll.mutate(network);
    }
  }, [wallets.data, network, syncAll, locked]);

  // After that, nothing here keeps time. With the alerts on, the Rust
  // side holds a connection to the backend, syncs the wallet that moved
  // and posts the notification, window minimised or locked included;
  // this side reads again what it is told has changed.
  useLiveEvents(lockSeen && !locked);

  // A look at the latest release, at most once a day and never behind
  // the lock: see `state/update`.
  useUpdateCheck(lockSeen && !locked);

  // The tour only ever stands in front of an empty vault: someone with
  // wallets already knows what this is. The vault's own preference is
  // what decides, not the hydrated copy, which lands a frame later.
  //
  // Empty means answered and empty. A list not read yet is not one:
  // the curtain going up throws the cache away, so every unlock passes
  // through that moment, and a vault that holds wallets but never
  // wrote the flag would greet its owner again each time.
  const emptyVault = wallets.data !== undefined && wallets.data.length === 0;
  const tourSeen =
    settings.data?.app_prefs["onboarding.seen"] === "1" || tourDismissed;
  useEffect(() => {
    if (settings.data && emptyVault && !tourSeen && !locked) setTourOpen(true);
  }, [settings.data, emptyVault, tourSeen, locked]);

  // A command refused because the curtain came down is the lock doing
  // its work, not a vault that failed to open: the screen behind it is
  // the lock screen, and it is already on its way.
  // A vault that did not open at startup is the whole screen, before
  // any other answer is read: without it, every one of them fails.
  if (startup.data) return <StartupFailure failure={startup.data} />;
  const shut = isLockedError(settings.error) || isLockedError(wallets.error);
  if (!startup.isPending && !shut && (settings.isError || wallets.isError)) {
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
  if (startup.isPending || settings.isPending || !settings.data || !lockSeen) {
    return (
      <div className="shell-rail flex h-full items-center justify-center bg-shell">
        <p className="font-ui text-sm text-muted">Opening vault…</p>
      </div>
    );
  }

  // Nothing of a wallet is in the tree behind the lock: it replaces
  // the shell rather than covering it. It comes before the wallet list
  // is waited on, which behind the lock is never asked for at all.
  if (locked) return <LockScreen />;

  if (wallets.isPending) {
    return (
      <div className="shell-rail flex h-full items-center justify-center bg-shell">
        <p className="font-ui text-sm text-muted">Opening vault…</p>
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
        syncing={syncing}
        onSyncAll={() => syncAll.mutate(settings.data.active_network)}
        onLock={settings.data.app_lock ? useLock.getState().lockNow : undefined}
      />

      <main className="min-w-0 flex-1 p-2 pl-0">
        <div className="flex h-full flex-col overflow-hidden rounded-[var(--radius-canvas)] bg-background shadow-canvas">
          {/* In the layout, above the page: it pushes the page down and
              never covers what the page shows. */}
          <UpdateNotice />
          <div ref={canvas} data-canvas-scroll className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto h-full max-w-[1280px] px-6 py-4">
              {view === "settings" ? (
                <SettingsView settings={settings.data} wallets={walletList} />
              ) : walletList.length === 0 ? (
                // With no wallet there is no Overview, and a stranger's
                // device asking into the account is still said first.
                <div className="flex h-full flex-col">
                  <NewDeviceBanner className="mb-4 mt-2" />
                  <div className="min-h-0 flex-1">
                    <EmptyState
                      title="No wallets watched yet"
                      hint="Add a descriptor, an extended public key, or an address. Gerfaut watches it and never touches a private key."
                      action={
                        <Button
                          variant="primary"
                          onClick={() => useUi.getState().setAddWalletOpen(true)}
                        >
                          Add a wallet
                        </Button>
                      }
                    />
                  </div>
                </div>
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
