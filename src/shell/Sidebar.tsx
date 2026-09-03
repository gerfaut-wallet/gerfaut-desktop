import { clsx } from "clsx";
import {
  ArrowLeftRight,
  Check,
  FileDown,
  ChevronsUpDown,
  Coins,
  Eye,
  EyeOff,
  GripVertical,
  House,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  QrCode,
  Radio,
  RefreshCw,
  Route,
  Settings,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { DropLine, useDragReorder } from "../components/DragReorder";
import { MASKED, NETWORK_LABEL, formatAmount } from "../lib/format";
import type { Network, WalletMeta } from "../lib/ipc";
import { walletGlyph } from "../lib/walletIcons";
import type { CanvasView } from "../state/store";
import { useUi } from "../state/store";
import { useWalletOrder } from "../state/walletOrder";
import mark from "../assets/gerfaut-mark-accent-dark.svg";

/** The wallet pages of the sidebar: one word, one icon, every wallet. */
const PAGES: { view: CanvasView; label: string; icon: ReactNode }[] = [
  { view: "home", label: "Overview", icon: <House size={18} strokeWidth={1.5} aria-hidden /> },
  {
    view: "transactions",
    label: "Transactions",
    icon: <ArrowLeftRight size={18} strokeWidth={1.5} aria-hidden />,
  },
  { view: "utxos", label: "UTXOs", icon: <Coins size={18} strokeWidth={1.5} aria-hidden /> },
  { view: "policy", label: "Policy", icon: <Route size={18} strokeWidth={1.5} aria-hidden /> },
  { view: "receive", label: "Receive", icon: <QrCode size={18} strokeWidth={1.5} aria-hidden /> },
  {
    view: "broadcast",
    label: "Broadcast",
    icon: <Radio size={18} strokeWidth={1.5} aria-hidden />,
  },
  {
    view: "export",
    label: "Export",
    icon: <FileDown size={18} strokeWidth={1.5} aria-hidden />,
  },
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
  onLock,
}: {
  wallets: WalletMeta[];
  /** Effective selection, derived by the app (fallback included). */
  activeWalletId: string | null;
  network: Network;
  syncing: boolean;
  onSyncAll: () => void;
  /** Locks the app now; absent when no lock is set. */
  onLock?: () => void;
}) {
  const { view, setView, sidebarCollapsed, toggleSidebar, masked, toggleMasked } = useUi();
  const collapsed = sidebarCollapsed;
  const hasWallets = wallets.length > 0;

  const collapseButton = (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-expanded={!collapsed}
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-sunken/60 hover:text-text"
    >
      {collapsed ? (
        <PanelLeftOpen size={17} strokeWidth={1.5} aria-hidden />
      ) : (
        <PanelLeftClose size={17} strokeWidth={1.5} aria-hidden />
      )}
    </button>
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
      {collapsed ? (
        <div className="flex flex-col items-center gap-1 pb-3 pt-5">
          <img src={mark} alt="" aria-hidden className="h-6 w-6" />
          {collapseButton}
        </div>
      ) : (
        <div className="flex items-center gap-2.5 py-4 pl-5 pr-3">
          <img src={mark} alt="" aria-hidden className="h-6 w-6 shrink-0" />
          <span className="font-display text-[15px] font-bold tracking-wide text-text">
            GERFAUT
          </span>
          <span className="ml-auto">{collapseButton}</span>
        </div>
      )}

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

      {network !== "mainnet" && (
        <div className={clsx("flex pb-2", collapsed ? "justify-center px-2" : "px-5")}>
          <span
            title={collapsed ? NETWORK_LABEL[network] : undefined}
            className={clsx(
              "rounded-full bg-sunken font-ui text-[11px] font-medium text-pending",
              collapsed ? "px-1.5 py-0.5" : "px-2 py-0.5",
            )}
          >
            {collapsed ? NETWORK_LABEL[network].charAt(0) : NETWORK_LABEL[network]}
          </span>
        </div>
      )}
      <div
        aria-hidden
        className="mx-3 h-px bg-gradient-to-r from-transparent via-border to-transparent"
      />

      <div className={clsx("flex flex-col gap-0.5 py-2 pb-3", collapsed ? "px-2" : "px-3")}>
        {onLock && (
          <NavItem
            label="Lock"
            icon={<Lock size={18} strokeWidth={1.5} aria-hidden />}
            collapsed={collapsed}
            active={false}
            onClick={onLock}
          />
        )}
        <NavItem
          label="Settings"
          icon={<Settings size={18} strokeWidth={1.5} aria-hidden />}
          collapsed={collapsed}
          active={view === "settings"}
          onClick={() => setView("settings")}
        />
        <NavItem
          label={syncing ? "Syncing…" : "Sync all"}
          icon={
            <RefreshCw
              size={18}
              strokeWidth={1.5}
              aria-hidden
              className={syncing ? "motion-safe:animate-spin" : undefined}
            />
          }
          collapsed={collapsed}
          active={false}
          disabled={syncing || !hasWallets}
          busy={syncing}
          onClick={onSyncAll}
        />
        <NavItem
          label={masked ? "Show amounts" : "Hide amounts"}
          icon={
            masked ? (
              <EyeOff size={18} strokeWidth={1.5} aria-hidden className="text-primary" />
            ) : (
              <Eye size={18} strokeWidth={1.5} aria-hidden />
            )
          }
          collapsed={collapsed}
          active={false}
          pressed={masked}
          onClick={toggleMasked}
        />
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
  busy = false,
  pressed,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  collapsed: boolean;
  active: boolean;
  disabled?: boolean;
  /** Working right now: not clickable, but not dimmed either. Dimmed
      reads as unavailable, and a turning icon at 40 % looks broken. */
  busy?: boolean;
  /** For toggle rows (hide amounts): state without the page accent. */
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={busy || undefined}
      aria-current={active ? "page" : undefined}
      aria-pressed={pressed}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      className={clsx(
        "group relative flex w-full cursor-pointer items-center rounded-md text-left font-ui text-sm font-medium",
        "transition-colors duration-150 disabled:cursor-default",
        !busy && "disabled:opacity-40",
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

/** The wallet selector at the top of the sidebar: each wallet under
    its own icon; the dropdown switches the whole app to another wallet,
    and its rows can be dragged into the order the vault then keeps. */
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
  const ActiveGlyph = walletGlyph(active?.icon ?? "wallet");
  // Moved from here or from the settings, the new order shows at once.
  const { shown, reorder } = useWalletOrder(wallets);
  const drag = useDragReorder(shown, reorder);
  const movable = shown.length > 1;

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
          <ActiveGlyph size={15} strokeWidth={1.5} />
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
          ref={(node) => {
            menuRef.current = node;
            drag.listRef(node);
          }}
          role="menu"
          aria-label="Wallets"
          className={clsx(
            "absolute z-40 max-h-[60vh] overflow-y-auto rounded-lg bg-surface p-1.5 shadow-overlay",
            collapsed ? "left-full top-0 ml-2 w-64" : "left-3 right-3 top-full mt-1.5",
          )}
        >
          {shown.map((wallet, index) => {
            const current = wallet.id === activeWalletId;
            const Glyph = walletGlyph(wallet.icon);
            const dragging = drag.dragging === index;
            return (
              // The grip sits beside the item, not in it: a button holds
              // no second control, and a drag must not switch wallets.
              <div
                key={wallet.id}
                {...drag.rowProps(index)}
                className={clsx(
                  "group relative",
                  dragging && "z-10 rounded-md bg-surface opacity-80",
                )}
              >
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={current}
                  tabIndex={-1}
                  onClick={() => {
                    setOpen(false);
                    openWallet(wallet.id);
                  }}
                  className={clsx(
                    "flex w-full cursor-pointer items-center gap-2.5 rounded-md py-2 pl-2.5 text-left",
                    "transition-colors duration-150 group-hover:bg-sunken/70",
                    movable ? "pr-9" : "pr-2.5",
                    current ? "bg-sunken/50" : undefined,
                  )}
                >
                  <Glyph
                    size={15}
                    strokeWidth={1.5}
                    aria-hidden
                    className="shrink-0 text-muted"
                  />
                  {/* Two lines: the name gets the full width, the balance
                      reads below it — names are the thing being chosen. */}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-ui text-sm font-medium text-text">
                      {wallet.name}
                    </span>
                    <span className="tabular truncate text-[11px] text-muted">
                      {masked ? MASKED : formatAmount(wallet.cached.balance.total, unit)}
                    </span>
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
                {movable && (
                  <span
                    aria-hidden
                    title="Drag to reorder"
                    {...drag.handleProps(index)}
                    className={clsx(
                      "absolute right-1 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-sm text-muted",
                      "transition-opacity duration-150 group-hover:opacity-100",
                      dragging ? "cursor-grabbing opacity-100" : "cursor-grab opacity-0",
                    )}
                  >
                    <GripVertical size={14} strokeWidth={1.5} />
                  </span>
                )}
              </div>
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
          <DropLine y={drag.lineY} />
        </div>
      )}
    </div>
  );
}
