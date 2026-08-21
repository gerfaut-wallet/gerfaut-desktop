import { clsx } from "clsx";
import { Plus, RefreshCw, Settings } from "lucide-react";
import { MASKED, formatBtc } from "../lib/format";
import type { Network, WalletMeta } from "../lib/ipc";
import { useUi } from "../state/store";
import mark from "../assets/gerfaut-mark-accent-dark.svg";

const NETWORK_LABEL: Record<Network, string> = {
  mainnet: "Mainnet",
  signet: "Signet",
  testnet4: "Testnet 4",
  regtest: "Regtest",
};

/** The dark rail: brand, workspace, wallet list, global actions.
    A self-contained dark island in either theme (.shell-rail). */
export function Rail({
  wallets,
  activeWalletId,
  network,
  syncing,
  onSyncAll,
}: {
  wallets: WalletMeta[];
  /** Effective selection, derived by the app (fallback included). */
  activeWalletId: string | null;
  network: Network;
  syncing: boolean;
  onSyncAll: () => void;
}) {
  const { view, openWallet, openSettings, setAddWalletOpen, masked } = useUi();

  return (
    <nav
      aria-label="Wallets"
      className="shell-rail flex h-full w-[260px] shrink-0 flex-col bg-background text-text"
    >
      <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
        <img src={mark} alt="" aria-hidden className="h-6 w-6" />
        <span className="font-display text-[15px] font-bold tracking-wide text-text">
          GERFAUT
        </span>
        {network !== "mainnet" && (
          <span className="ml-auto rounded-full bg-sunken px-2 py-0.5 font-data text-[11px] text-pending">
            {NETWORK_LABEL[network]}
          </span>
        )}
      </div>

      <div className="px-3">
        <p className="px-2 pb-1 font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
          Wallets
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3">
        <ul className="flex flex-col gap-0.5">
          {wallets.map((wallet) => {
            const active = view === "wallet" && wallet.id === activeWalletId;
            return (
              <li key={wallet.id}>
                <button
                  type="button"
                  onClick={() => openWallet(wallet.id)}
                  aria-current={active ? "page" : undefined}
                  className={clsx(
                    "group relative flex w-full cursor-pointer flex-col gap-0.5 rounded-md px-3 py-2 text-left",
                    "transition-colors duration-150",
                    active ? "bg-sunken text-text" : "text-muted hover:bg-sunken/60 hover:text-text",
                  )}
                >
                  {active && (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary"
                    />
                  )}
                  <span className="truncate font-ui text-sm font-medium">{wallet.name}</span>
                  <span className="font-data text-xs text-muted">
                    {masked ? MASKED : `${formatBtc(wallet.cached.balance.total)} BTC`}
                  </span>
                </button>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setAddWalletOpen(true)}
              className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 font-ui text-sm text-muted transition-colors duration-150 hover:bg-sunken/60 hover:text-text"
            >
              <Plus size={16} strokeWidth={1.5} aria-hidden />
              Add a wallet
            </button>
          </li>
        </ul>
      </div>

      <div className="flex items-center gap-1 border-t border-border px-3 py-3">
        <button
          type="button"
          onClick={onSyncAll}
          disabled={syncing || wallets.length === 0}
          className="flex flex-1 cursor-pointer items-center gap-2 rounded-md px-3 py-2 font-ui text-sm text-muted transition-colors duration-150 hover:bg-sunken/60 hover:text-text disabled:cursor-default disabled:opacity-50"
        >
          <RefreshCw
            size={16}
            strokeWidth={1.5}
            aria-hidden
            className={syncing ? "motion-safe:animate-spin" : undefined}
          />
          {syncing ? "Syncing…" : "Sync all"}
        </button>
        <button
          type="button"
          onClick={openSettings}
          aria-label="Settings"
          aria-current={view === "settings" ? "page" : undefined}
          className={clsx(
            "inline-flex size-10 cursor-pointer items-center justify-center rounded-md transition-colors duration-150",
            view === "settings"
              ? "bg-sunken text-primary"
              : "text-muted hover:bg-sunken/60 hover:text-text",
          )}
        >
          <Settings size={18} strokeWidth={1.5} aria-hidden />
        </button>
      </div>
    </nav>
  );
}
