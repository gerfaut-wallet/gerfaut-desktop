// UI state. Server state lives in TanStack Query; this store only holds
// what the interface itself decides: selection, navigation, preferences.

import { create } from "zustand";
import type { FiatCurrency, PriceRange, PriceSource } from "../lib/ipc";
import { ipc } from "../lib/ipc";
import type { Unit } from "../lib/format";

export type ThemePref = "light" | "dark" | "system";

/** The sidebar pages. Settings is global; the rest read one wallet. */
export type CanvasView = "home" | "transactions" | "utxos" | "receive" | "settings";

/** The overview widgets, in their default order. */
export const WIDGET_IDS = ["balance", "price", "activity", "utxos", "status"] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];
export const DEFAULT_HOME_LAYOUT: WidgetId[] = [...WIDGET_IDS];

/** Drops unknown ids and duplicates from a stored layout. */
export function sanitizeLayout(raw: unknown): WidgetId[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const layout: WidgetId[] = [];
  for (const id of raw) {
    if (
      typeof id === "string" &&
      (WIDGET_IDS as readonly string[]).includes(id) &&
      !seen.has(id)
    ) {
      seen.add(id);
      layout.push(id as WidgetId);
    }
  }
  return layout;
}

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
  /** External explorer warning acknowledged: skip the dialog when set. */
  explorerAck: boolean;
  /** Overview widget order per wallet id; falls back to the default. */
  homeLayouts: Record<string, WidgetId[]>;
  /** One shared overview layout for every wallet, when enabled. */
  sharedHome: boolean;
  sharedHomeLayout: WidgetId[] | null;
  homeEditing: boolean;
  /** Selected span of the price chart, shared across wallets. */
  priceRange: PriceRange;
  toast: string | null;
  /** Last sync failure per wallet id, cleared on the next success. */
  syncErrors: Record<string, string>;

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
  setExplorerAck: (acknowledged: boolean) => void;
  /** Reads the effective overview layout for a wallet. */
  homeLayout: (walletId: string) => WidgetId[];
  /** Writes the overview layout where it belongs (wallet or shared). */
  setHomeLayout: (walletId: string, layout: WidgetId[]) => void;
  setSharedHome: (enabled: boolean) => void;
  setHomeEditing: (editing: boolean) => void;
  setPriceRange: (range: PriceRange) => void;
  showToast: (message: string) => void;
  setSyncError: (walletId: string, message: string | null) => void;
  /** Applies preferences loaded from the vault at startup. */
  hydratePrefs: (prefs: Record<string, string>) => void;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

function persist(key: string, value: string) {
  void ipc.setAppPref(key, value).catch(() => {});
}

function parseLayoutPref(value: string | undefined): WidgetId[] | null {
  if (!value) return null;
  try {
    return sanitizeLayout(JSON.parse(value));
  } catch {
    return null;
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
  explorerAck: false,
  homeLayouts: {},
  sharedHome: false,
  sharedHomeLayout: null,
  homeEditing: false,
  priceRange: "month",
  toast: null,
  syncErrors: {},

  setView: (view) => set({ view, selectedTxid: null, homeEditing: false }),
  // Switching wallets keeps the current page, so wallets compare on the
  // same view; from settings it lands on the overview.
  openWallet: (id) =>
    set((state) => ({
      activeWalletId: id,
      view: state.view === "settings" ? "home" : state.view,
      selectedTxid: null,
      homeEditing: false,
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
  },
  setFiatSource: (fiatSource) => {
    set({ fiatSource });
    persist("display.fiat_source", fiatSource);
  },
  setExplorerAck: (explorerAck) => {
    set({ explorerAck });
    persist("privacy.explorer_ack", explorerAck ? "1" : "0");
  },
  homeLayout: (walletId) => {
    const state = get();
    if (state.sharedHome) return state.sharedHomeLayout ?? DEFAULT_HOME_LAYOUT;
    return state.homeLayouts[walletId] ?? DEFAULT_HOME_LAYOUT;
  },
  setHomeLayout: (walletId, layout) => {
    if (get().sharedHome) {
      set({ sharedHomeLayout: layout });
      persist("home.widgets.shared_layout", JSON.stringify(layout));
    } else {
      set((state) => ({ homeLayouts: { ...state.homeLayouts, [walletId]: layout } }));
      persist(`home.widgets.${walletId}`, JSON.stringify(layout));
    }
  },
  setSharedHome: (sharedHome) => {
    set({ sharedHome });
    persist("home.widgets.shared", sharedHome ? "1" : "0");
  },
  setHomeEditing: (homeEditing) => set({ homeEditing }),
  setPriceRange: (priceRange) => {
    set({ priceRange });
    persist("home.price_range", priceRange);
  },
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
  hydratePrefs: (prefs) => {
    const theme = (prefs["desktop.theme"] as ThemePref) ?? "light";
    const unit = prefs["display.unit"] === "sats" ? "sats" : "btc";
    const currency = prefs["display.fiat_currency"] as FiatCurrency;
    const source = prefs["display.fiat_source"] as PriceSource;
    const homeLayouts: Record<string, WidgetId[]> = {};
    for (const [key, value] of Object.entries(prefs)) {
      if (key.startsWith("home.widgets.") && !key.startsWith("home.widgets.shared")) {
        const layout = parseLayoutPref(value);
        if (layout) homeLayouts[key.slice("home.widgets.".length)] = layout;
      }
    }
    set({
      theme: ["light", "dark", "system"].includes(theme) ? theme : "light",
      masked: prefs["desktop.masked"] === "1",
      sidebarCollapsed: prefs["desktop.sidebar"] === "collapsed",
      unit,
      fiatEnabled: prefs["display.fiat"] === "1",
      explorerAck: prefs["privacy.explorer_ack"] === "1",
      fiatCurrency: ["eur", "usd", "gbp", "chf"].includes(currency) ? currency : "eur",
      fiatSource: ["coingecko", "kraken", "mempool_space"].includes(source)
        ? source
        : "coingecko",
      homeLayouts,
      sharedHome: prefs["home.widgets.shared"] === "1",
      sharedHomeLayout: parseLayoutPref(prefs["home.widgets.shared_layout"]),
      priceRange: (["day", "week", "month", "year", "max"] as PriceRange[]).includes(
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
