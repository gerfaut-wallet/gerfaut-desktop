// UI state. Server state lives in TanStack Query; this store only holds
// what the interface itself decides: selection, navigation, preferences.

import { create } from "zustand";
import { ALL_CURRENCIES, quotesCurrency } from "../lib/ipc";
import type { FiatCurrency, Network, PriceRange, PriceSource } from "../lib/ipc";
import { ipc } from "../lib/ipc";
import type { Unit } from "../lib/format";

export type ThemePref = "light" | "dark" | "system";

/** The sidebar pages. Settings is global; the rest read one wallet. */
export type CanvasView =
  | "home"
  | "transactions"
  | "utxos"
  | "policy"
  | "receive"
  | "broadcast"
  | "export"
  | "settings";

/** A transaction handed to the network from this app, kept so the
    broadcast page can show where it stands after a restart. */
export interface RecentBroadcast {
  txid: string;
  network: Network;
  hex: string;
  backend: string;
  at: number;
}

/** How many past broadcasts are remembered. */
export const RECENT_BROADCASTS = 10;

interface UiState {
  view: CanvasView;
  activeWalletId: string | null;
  /** Txid opened in the detail modal, null when closed. */
  selectedTxid: string | null;
  addWalletOpen: boolean;
  sidebarCollapsed: boolean;
  masked: boolean;
  theme: ThemePref;
  /** Display unit for every amount. */
  unit: Unit;
  /** Fiat display: off by default, currency and source configurable. */
  fiatEnabled: boolean;
  fiatCurrency: FiatCurrency;
  fiatSource: PriceSource;
  /** Range of the overview price widget, shared by every wallet. */
  priceRange: PriceRange;
  /** External explorer warning acknowledged: skip the dialog when set. */
  explorerAck: boolean;
  /** A notification when a sync finds a transaction; off by default. */
  notifyNewTx: boolean;
  /** Seconds between background syncs while open; 0 leaves it to the
      user's own Sync all. */
  notifyInterval: number;
  /** The system refused notifications the last time we asked. */
  notificationsRefused: boolean;
  /** The welcome tour has been seen. */
  onboardingSeen: boolean;
  /** It was dismissed in this session, whatever the vault says yet. */
  tourDismissed: boolean;
  toast: string | null;
  /** Last sync failure per wallet id, cleared on the next success. */
  syncErrors: Record<string, string>;
  /** Transactions broadcast from this app, newest first. */
  recentBroadcasts: RecentBroadcast[];

  setView: (view: CanvasView) => void;
  openWallet: (id: string) => void;
  selectTx: (txid: string | null) => void;
  setAddWalletOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  toggleMasked: () => void;
  setTheme: (theme: ThemePref) => void;
  setUnit: (unit: Unit) => void;
  setFiatEnabled: (enabled: boolean) => void;
  setFiatCurrency: (currency: FiatCurrency) => void;
  setFiatSource: (source: PriceSource) => void;
  setPriceRange: (range: PriceRange) => void;
  setExplorerAck: (acknowledged: boolean) => void;
  setNotifyNewTx: (enabled: boolean) => void;
  setNotificationsRefused: (refused: boolean) => void;
  setNotifyInterval: (seconds: number) => void;
  setOnboardingSeen: (seen: boolean) => void;
  markTourSeen: () => void;
  showToast: (message: string) => void;
  setSyncError: (walletId: string, message: string | null) => void;
  rememberBroadcast: (entry: RecentBroadcast) => void;
  forgetBroadcast: (txid: string) => void;
  /** Applies preferences loaded from the vault at startup. */
  hydratePrefs: (prefs: Record<string, string>) => void;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

function persist(key: string, value: string) {
  void ipc.setAppPref(key, value).catch(() => {});
}

/** Reads the remembered broadcasts; anything malformed is dropped. */
function parseRecentBroadcasts(raw: string | undefined): RecentBroadcast[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is RecentBroadcast =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as RecentBroadcast).txid === "string" &&
          typeof (entry as RecentBroadcast).hex === "string" &&
          typeof (entry as RecentBroadcast).network === "string",
      )
      .slice(0, RECENT_BROADCASTS);
  } catch {
    return [];
  }
}

export const useUi = create<UiState>((set, get) => ({
  view: "home",
  activeWalletId: null,
  selectedTxid: null,
  addWalletOpen: false,
  sidebarCollapsed: false,
  masked: false,
  theme: "light",
  unit: "btc",
  fiatEnabled: false,
  fiatCurrency: "eur",
  fiatSource: "coingecko",
  priceRange: "month",
  explorerAck: false,
  notifyNewTx: false,
  notifyInterval: 0,
  notificationsRefused: false,
  onboardingSeen: false,
  tourDismissed: false,
  toast: null,
  syncErrors: {},
  recentBroadcasts: [],

  setView: (view) => set({ view, selectedTxid: null }),
  // Switching wallets keeps the current page, so wallets compare on the
  // same view; from settings it lands on the overview.
  openWallet: (id) =>
    set((state) => ({
      activeWalletId: id,
      view: state.view === "settings" ? "home" : state.view,
      selectedTxid: null,
    })),
  selectTx: (selectedTxid) => set({ selectedTxid }),
  setAddWalletOpen: (addWalletOpen) => set({ addWalletOpen }),
  toggleSidebar: () => {
    const sidebarCollapsed = !get().sidebarCollapsed;
    set({ sidebarCollapsed });
    persist("desktop.sidebar", sidebarCollapsed ? "collapsed" : "expanded");
  },
  toggleMasked: () => {
    const masked = !get().masked;
    set({ masked });
    persist("desktop.masked", masked ? "1" : "0");
  },
  setTheme: (theme) => {
    set({ theme });
    applyTheme(theme);
    persist("desktop.theme", theme);
  },
  setUnit: (unit) => {
    set({ unit });
    persist("display.unit", unit);
  },
  setFiatEnabled: (fiatEnabled) => {
    set({ fiatEnabled });
    persist("display.fiat", fiatEnabled ? "1" : "0");
  },
  setFiatCurrency: (fiatCurrency) => {
    set({ fiatCurrency });
    persist("display.fiat_currency", fiatCurrency);
    // Most currencies past the shared seven have one keyless publisher.
    // Moving to one of them moves the source with it rather than
    // leaving a pair no source can quote.
    if (!quotesCurrency(get().fiatSource, fiatCurrency)) {
      set({ fiatSource: "coingecko" });
      persist("display.fiat_source", "coingecko");
    }
  },
  setFiatSource: (fiatSource) => {
    set({ fiatSource });
    persist("display.fiat_source", fiatSource);
  },
  setPriceRange: (priceRange) => {
    set({ priceRange });
    persist("home.price_range", priceRange);
  },
  setExplorerAck: (explorerAck) => {
    set({ explorerAck });
    persist("privacy.explorer_ack", explorerAck ? "1" : "0");
  },
  setNotifyNewTx: (notifyNewTx) => {
    set({ notifyNewTx });
    persist("notify.new_tx", notifyNewTx ? "1" : "0");
  },
  setNotificationsRefused: (notificationsRefused) => set({ notificationsRefused }),
  setNotifyInterval: (notifyInterval) => {
    set({ notifyInterval });
    persist("notify.interval", String(notifyInterval));
  },
  setOnboardingSeen: (onboardingSeen) => {
    set({ onboardingSeen });
    persist("onboarding.seen", onboardingSeen ? "1" : "0");
  },
  // The tour reads the vault's own preference, which the write above
  // does not refresh: remember here that this session has seen it.
  markTourSeen: () => set({ onboardingSeen: true, tourDismissed: true }),
  showToast: (message) => {
    clearTimeout(toastTimer);
    set({ toast: message });
    toastTimer = setTimeout(() => set({ toast: null }), 3000);
  },
  setSyncError: (walletId, message) =>
    set((state) => {
      const syncErrors = { ...state.syncErrors };
      if (message === null) {
        delete syncErrors[walletId];
      } else {
        syncErrors[walletId] = message;
      }
      return { syncErrors };
    }),
  rememberBroadcast: (entry) => {
    const recentBroadcasts = [
      entry,
      ...get().recentBroadcasts.filter((known) => known.txid !== entry.txid),
    ].slice(0, RECENT_BROADCASTS);
    set({ recentBroadcasts });
    persist("broadcast.recent", JSON.stringify(recentBroadcasts));
  },
  forgetBroadcast: (txid) => {
    const recentBroadcasts = get().recentBroadcasts.filter((known) => known.txid !== txid);
    set({ recentBroadcasts });
    persist("broadcast.recent", JSON.stringify(recentBroadcasts));
  },
  hydratePrefs: (prefs) => {
    const theme = (prefs["desktop.theme"] as ThemePref) ?? "light";
    const unit = prefs["display.unit"] === "sats" ? "sats" : "btc";
    const stored = prefs["display.fiat_currency"] as FiatCurrency;
    const currency = ALL_CURRENCIES.includes(stored) ? stored : "eur";
    const storedSource = prefs["display.fiat_source"] as PriceSource;
    const source = ["coingecko", "kraken", "mempool_space"].includes(storedSource)
      ? storedSource
      : "coingecko";
    set({
      recentBroadcasts: parseRecentBroadcasts(prefs["broadcast.recent"]),
      theme: ["light", "dark", "system"].includes(theme) ? theme : "light",
      masked: prefs["desktop.masked"] === "1",
      // Both are opt-in: an explicit "1" is the only yes.
      notifyNewTx: prefs["notify.new_tx"] === "1",
      notifyInterval: Number(prefs["notify.interval"] ?? "0") || 0,
      onboardingSeen: prefs["onboarding.seen"] === "1",
      sidebarCollapsed: prefs["desktop.sidebar"] === "collapsed",
      unit,
      fiatEnabled: prefs["display.fiat"] === "1",
      explorerAck: prefs["privacy.explorer_ack"] === "1",
      fiatCurrency: currency,
      // A pair no source can quote would show a permanent dash: the
      // currency wins, the source follows.
      fiatSource: quotesCurrency(source, currency) ? source : "coingecko",
      priceRange: (["day", "week", "month", "year"] as PriceRange[]).includes(
        prefs["home.price_range"] as PriceRange,
      )
        ? (prefs["home.price_range"] as PriceRange)
        : "month",
    });
    applyTheme(theme);
  },
}));

export function applyTheme(theme: ThemePref) {
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
