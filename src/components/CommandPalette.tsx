import { Command } from "cmdk";
import {
  Eye,
  Moon,
  Plus,
  QrCode,
  RefreshCw,
  Settings,
  Sun,
  Wallet,
} from "lucide-react";
import { useEffect } from "react";
import type { WalletMeta } from "../lib/ipc";
import { useUi } from "../state/store";

/** Ctrl/Cmd+K: the fastest path to everything. */
export function CommandPalette({
  wallets,
  onSyncAll,
}: {
  wallets: WalletMeta[];
  onSyncAll: () => void;
}) {
  const {
    paletteOpen,
    setPaletteOpen,
    openWallet,
    openSettings,
    setAddWalletOpen,
    setReceiveOpen,
    toggleMasked,
    theme,
    setTheme,
    activeWalletId,
  } = useUi();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(!useUi.getState().paletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPaletteOpen]);

  const run = (action: () => void) => {
    setPaletteOpen(false);
    action();
  };

  return (
    <Command.Dialog
      open={paletteOpen}
      onOpenChange={setPaletteOpen}
      label="Command palette"
      className="fixed left-1/2 top-[18vh] z-50 w-[560px] max-w-[calc(100vw-48px)] -translate-x-1/2 overflow-hidden rounded-lg bg-surface shadow-overlay"
    >
      <Command.Input
        placeholder="Search wallets and actions…"
        className="h-12 w-full border-b border-border bg-transparent px-4 font-ui text-base text-text outline-none placeholder:text-muted/60"
      />
      <Command.List className="max-h-[320px] overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center font-ui text-sm text-muted">
          Nothing matches.
        </Command.Empty>

        {wallets.length > 0 && (
          <Command.Group
            heading="Wallets"
            className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-ui [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.04em] [&_[cmdk-group-heading]]:text-muted"
          >
            {wallets.map((wallet) => (
              <PaletteItem
                key={wallet.id}
                onSelect={() => run(() => openWallet(wallet.id))}
              >
                <Wallet size={16} strokeWidth={1.5} aria-hidden />
                {wallet.name}
              </PaletteItem>
            ))}
          </Command.Group>
        )}

        <Command.Group
          heading="Actions"
          className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-ui [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.04em] [&_[cmdk-group-heading]]:text-muted"
        >
          <PaletteItem onSelect={() => run(() => setAddWalletOpen(true))}>
            <Plus size={16} strokeWidth={1.5} aria-hidden />
            Add a wallet
          </PaletteItem>
          {activeWalletId && (
            <PaletteItem onSelect={() => run(() => setReceiveOpen(true))}>
              <QrCode size={16} strokeWidth={1.5} aria-hidden />
              Receive
            </PaletteItem>
          )}
          {wallets.length > 0 && (
            <PaletteItem onSelect={() => run(onSyncAll)}>
              <RefreshCw size={16} strokeWidth={1.5} aria-hidden />
              Sync all wallets
            </PaletteItem>
          )}
          <PaletteItem onSelect={() => run(toggleMasked)}>
            <Eye size={16} strokeWidth={1.5} aria-hidden />
            Toggle hidden balances
          </PaletteItem>
          <PaletteItem
            onSelect={() => run(() => setTheme(theme === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? (
              <Sun size={16} strokeWidth={1.5} aria-hidden />
            ) : (
              <Moon size={16} strokeWidth={1.5} aria-hidden />
            )}
            Switch to {theme === "dark" ? "light" : "dark"} theme
          </PaletteItem>
          <PaletteItem onSelect={() => run(openSettings)}>
            <Settings size={16} strokeWidth={1.5} aria-hidden />
            Open settings
          </PaletteItem>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}

function PaletteItem({
  children,
  onSelect,
}: {
  children: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-3 font-ui text-sm text-text data-[selected=true]:bg-sunken"
    >
      {children}
    </Command.Item>
  );
}
