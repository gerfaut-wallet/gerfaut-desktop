import { clsx } from "clsx";
import {
  ArrowLeftRight,
  Blocks,
  Check,
  ChevronsUpDown,
  Coins,
  Eye,
  EyeOff,
  House,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  QrCode,
  RefreshCw,
  Settings,
  Wallet as WalletIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { MASKED, formatAmount, groupThousands } from "../lib/format";
import type { Network, WalletMeta } from "../lib/ipc";
import type { CanvasView } from "../state/store";
import { useUi } from "../state/store";
import mark from "../assets/gerfaut-mark-accent-dark.svg";

const NETWORK_LABEL: Record<Network, string> = {
  mainnet: "Mainnet",
  signet: "Signet",
  testnet4: "Testnet 4",
  regtest: "Regtest",
};

/** The wallet pages of the sidebar: one word, one icon, every wallet. */
const PAGES: { view: CanvasView; label: string; icon: ReactNode }[] = [
  { view: "home", label: "Overview", icon: <House size={18} strokeWidth={1.5} aria-hidden /> },
  {
    view: "transactions",
    label: "Transactions",
    icon: <ArrowLeftRight size={18} strokeWidth={1.5} aria-hidden />,
  },
  { view: "utxos", label: "UTXOs", icon: <Coins size={18} strokeWidth={1.5} aria-hidden /> },
  { view: "receive", label: "Receive", icon: <QrCode size={18} strokeWidth={1.5} aria-hidden /> },
];

/** The dark sidebar: brand, wallet switcher, pages, global actions.
    It sits directly on the shell base and can collapse to an icon
    rail; the canvas floats beside it. */
export function Sidebar({
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
  const { view, setView, sidebarCollapsed, toggleSidebar, masked, toggleMasked } = useUi();
  const collapsed = sidebarCollapsed;
  const hasWallets = wallets.length > 0;
  // Chain tip as last seen by any wallet: the instrument's status line.
  const tipHeight = wallets.reduce(
    (highest, wallet) => Math.max(highest, wallet.last_sync?.tip_height ?? 0),
    0,
  );

  return (
    <nav
      aria-label="Navigation"
      className={clsx(
        "shell-rail flex h-full shrink-0 flex-col text-text",
        "motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-out",
        collapsed ? "w-16" : "w-[248px]",
      )}
    >
      <div
        className={clsx(
          "flex items-center pb-3 pt-5",
          collapsed ? "justify-center px-0" : "gap-2.5 px-5",
        )}
      >
        <img src={mark} alt="" aria-hidden className="h-6 w-6 shrink-0" />
        {!collapsed && (
          <>
            <span className="font-display text-[15px] font-bold tracking-wide text-text">
              GERFAUT
            </span>
            {network !== "mainnet" && (
              <span className="ml-auto rounded-full bg-sunken px-2 py-0.5 font-ui text-[11px] font-medium text-pending">
                {NETWORK_LABEL[network]}
              </span>
            )}
          </>
        )}
      </div>

      <WalletSwitcher
        wallets={wallets}
        activeWalletId={activeWalletId}
        collapsed={collapsed}
      />

      <ul className={clsx("mt-4 flex flex-col gap-0.5", collapsed ? "px-2" : "px-3")}>
        {PAGES.map((page) => (
          <li key={page.view}>
            <NavItem
              label={page.label}
              icon={page.icon}
              collapsed={collapsed}
              active={view === page.view}
              disabled={!hasWallets}
              onClick={() => setView(page.view)}
            />
          </li>
        ))}
      </ul>

      <div className="flex-1" />

      {tipHeight > 0 && !collapsed && (
        <p className="flex items-center gap-1.5 px-5 pb-2 font-ui text-[11px] text-muted">
          <Blocks size={12} strokeWidth={1.5} aria-hidden className="shrink-0" />
          <span className="tabular">block {groupThousands(String(tipHeight))}</span>
        </p>
      )}
      <div
        aria-hidden
        className="mx-3 h-px bg-gradient-to-r from-transparent via-border to-transparent"
      />

      <div className={clsx("flex flex-col gap-0.5 py-2", collapsed ? "px-2" : "px-3")}>
        <NavItem
          label="Settings"
          icon={<Settings size={18} strokeWidth={1.5} aria-hidden />}
          collapsed={collapsed}
          active={view === "settings"}
          onClick={() => setView("settings")}
        />
      </div>

      <div
        className={clsx(
          "flex items-center gap-1 pb-3",
          collapsed ? "flex-col px-2" : "px-3",
        )}
      >
        <button
          type="button"
          onClick={onSyncAll}
          disabled={syncing || !hasWallets}
          title={collapsed ? (syncing ? "Syncing…" : "Sync all") : undefined}
          aria-label={syncing ? "Syncing" : "Sync all wallets"}
          className={clsx(
            "flex cursor-pointer items-center gap-2 rounded-md font-ui text-sm text-muted",
            "transition-colors duration-150 hover:bg-sunken/60 hover:text-text",
            "disabled:cursor-default disabled:opacity-50",
            collapsed ? "size-10 justify-center" : "flex-1 px-3 py-2",
          )}
        >
          <RefreshCw
            size={16}
            strokeWidth={1.5}
            aria-hidden
            className={clsx("shrink-0", syncing && "motion-safe:animate-spin")}
          />
          {!collapsed && (syncing ? "Syncing…" : "Sync all")}
        </button>
        <button
          type="button"
          onClick={toggleMasked}
          aria-pressed={masked}
          title={masked ? "Show amounts" : "Hide amounts"}
          aria-label={masked ? "Show amounts" : "Hide amounts"}
          className={clsx(
            "inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md",
            "transition-colors duration-150 hover:bg-sunken/60 hover:text-text",
            masked ? "text-primary" : "text-muted",
          )}
        >
          {masked ? (
            <EyeOff size={17} strokeWidth={1.5} aria-hidden />
          ) : (
            <Eye size={17} strokeWidth={1.5} aria-hidden />
          )}
        </button>
        <button
          type="button"
          onClick={toggleSidebar}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={clsx(
            "inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md",
            "text-muted transition-colors duration-150 hover:bg-sunken/60 hover:text-text",
          )}
        >
          {collapsed ? (
            <PanelLeftOpen size={17} strokeWidth={1.5} aria-hidden />
          ) : (
            <PanelLeftClose size={17} strokeWidth={1.5} aria-hidden />
          )}
        </button>
      </div>
    </nav>
  );
}

function NavItem({
  label,
  icon,
  collapsed,
  active,
  disabled = false,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  collapsed: boolean;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      className={clsx(
        "group relative flex w-full cursor-pointer items-center rounded-md text-left font-ui text-sm font-medium",
        "transition-colors duration-150 disabled:cursor-default disabled:opacity-40",
        collapsed ? "h-10 justify-center" : "gap-2.5 px-3 py-2",
        active
          ? "bg-sunken text-text"
          : "text-muted enabled:hover:bg-sunken/60 enabled:hover:text-text",
      )}
    >
      {active && (
        <span
          aria-hidden
          className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary"
        />
      )}
      <span className={clsx("shrink-0", active && "text-primary")}>{icon}</span>
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );
}

/** The wallet selector at the top of the sidebar: one generic wallet
    icon for every wallet, whatever its kind; the dropdown switches the
    whole app to another wallet. */
function WalletSwitcher({
  wallets,
  activeWalletId,
  collapsed,
}: {
  wallets: WalletMeta[];
  activeWalletId: string | null;
  collapsed: boolean;
}) {
  const { openWallet, setAddWalletOpen, masked, unit } = useUi();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const active = wallets.find((wallet) => wallet.id === activeWalletId) ?? null;

  // Click outside and Escape both close; focus returns to the trigger.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const items = [
          ...(menuRef.current?.querySelectorAll<HTMLElement>("[role^='menuitem']") ?? []),
        ];
        if (items.length === 0) return;
        const index = items.indexOf(document.activeElement as HTMLElement);
        const next =
          event.key === "ArrowDown"
            ? items[(index + 1) % items.length]
            : items[(index - 1 + items.length) % items.length];
        next.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      menuRef.current?.querySelector<HTMLElement>("[aria-checked='true']")?.focus();
    }
  }, [open]);

  if (wallets.length === 0) {
    return (
      <div className={collapsed ? "px-2" : "px-3"}>
        <button
          type="button"
          onClick={() => setAddWalletOpen(true)}
          title={collapsed ? "Add a wallet" : undefined}
          aria-label="Add a wallet"
          className={clsx(
            "flex w-full cursor-pointer items-center rounded-md border border-dashed border-border",
            "font-ui text-sm text-muted transition-colors duration-150 hover:bg-sunken/60 hover:text-text",
            collapsed ? "h-10 justify-center" : "gap-2 px-3 py-2.5",
          )}
        >
          <Plus size={16} strokeWidth={1.5} aria-hidden className="shrink-0" />
          {!collapsed && "Add a wallet"}
        </button>
      </div>
    );
  }

  return (
    <div ref={rootRef} className={clsx("relative", collapsed ? "px-2" : "px-3")}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={collapsed ? (active ? active.name : "Switch wallet") : undefined}
        aria-label={active ? `Wallet: ${active.name}` : "Switch wallet"}
        className={clsx(
          "flex w-full cursor-pointer items-center rounded-md bg-sunken/70",
          "transition-colors duration-150 hover:bg-sunken",
          collapsed ? "h-10 justify-center" : "gap-2.5 px-3 py-2",
        )}
      >
        <span
          aria-hidden
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface text-primary"
        >
          <WalletIcon size={15} strokeWidth={1.5} />
        </span>
        {!collapsed && (
          <>
            <span className="flex min-w-0 flex-1 flex-col text-left">
              <span className="truncate font-ui text-sm font-medium text-text">
                {active?.name ?? "Select a wallet"}
              </span>
              {active && (
                <span className="tabular truncate text-[11px] text-muted">
                  {masked ? MASKED : formatAmount(active.cached.balance.total, unit)}
                </span>
              )}
            </span>
            <ChevronsUpDown
              size={14}
              strokeWidth={1.5}
              aria-hidden
              className="shrink-0 text-muted"
            />
          </>
        )}
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Wallets"
          className={clsx(
            "absolute z-40 max-h-[50vh] overflow-y-auto rounded-lg bg-surface p-1.5 shadow-overlay",
            collapsed ? "left-full top-0 ml-2 w-64" : "left-3 right-3 top-full mt-1.5",
          )}
        >
          {wallets.map((wallet) => {
            const current = wallet.id === activeWalletId;
            return (
              <button
                key={wallet.id}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                tabIndex={-1}
                onClick={() => {
                  setOpen(false);
                  openWallet(wallet.id);
                }}
                className={clsx(
                  "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left",
                  "transition-colors duration-150 hover:bg-sunken/70",
                  current ? "bg-sunken/50" : undefined,
                )}
              >
                <WalletIcon
                  size={15}
                  strokeWidth={1.5}
                  aria-hidden
                  className="shrink-0 text-muted"
                />
                <span className="min-w-0 flex-1 truncate font-ui text-sm text-text">
                  {wallet.name}
                </span>
                <span className="tabular shrink-0 text-[11px] text-muted">
                  {masked ? MASKED : formatAmount(wallet.cached.balance.total, unit)}
                </span>
                {current && (
                  <Check
                    size={14}
                    strokeWidth={2}
                    aria-hidden
                    className="shrink-0 text-primary"
                  />
                )}
              </button>
            );
          })}
          <div aria-hidden className="mx-1 my-1 h-px bg-border/60" />
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              setOpen(false);
              setAddWalletOpen(true);
            }}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left font-ui text-sm text-muted transition-colors duration-150 hover:bg-sunken/70 hover:text-text"
          >
            <Plus size={15} strokeWidth={1.5} aria-hidden className="shrink-0" />
            Add a wallet
          </button>
        </div>
      )}
    </div>
  );
}
