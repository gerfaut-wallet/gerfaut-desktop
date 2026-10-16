// UI state. Server state lives in TanStack Query; this store only holds
// what the interface itself decides: selection, navigation, preferences.

import { useEffect } from "react";
import { create } from "zustand";
import type {
  FiatCurrency,
  Preferences,
  PreferencesChange,
  PriceRange,
  PriceSource,
  Settings,
} from "../lib/ipc";
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

/** The pages of Settings; one is shown at a time. */
export type SettingsSection =
  | "general"
  | "network"
  | "wallets"
  | "security"
  | "notifications"
  | "backup"
  | "about";

interface UiState {
  view: CanvasView;
  settingsSection: SettingsSection;
  activeWalletId: string | null;
  /** Txid opened in the detail modal, null when closed. */
  selectedTxid: string | null;
  addWalletOpen: boolean;
  sidebarCollapsed: boolean;
  masked: boolean;
  theme: ThemePref;
  /** Display unit for every amount. */
  unit: Unit;
  /** Fiat display, its currency and its source. The pair is always one
      a source quotes, as the vault stored it. */
  fiatEnabled: boolean;
  fiatCurrency: FiatCurrency;
  fiatSource: PriceSource;
  /** Range of the overview price widget, shared by every wallet. */
  priceRange: PriceRange;
  /** External explorer warning acknowledged: skip the dialog when set. */
  explorerAck: boolean;
  /** Live alerts: a notification when a transaction shows up and when
      it confirms. The Rust side starts and stops the watch on this
      preference as it is written. */
  notifyNewTx: boolean;
  /** The welcome tour has been seen. */
  onboardingSeen: boolean;
  /** It was dismissed in this session, whatever the vault says yet. */
  tourDismissed: boolean;
  toast: string | null;
  /** Last sync failure per wallet id, cleared on the next success. */
  syncErrors: Record<string, string>;

  setView: (view: CanvasView) => void;
  setSettingsSection: (section: SettingsSection) => void;
  /** Opens Settings on one of its sections, from anywhere. */
  openSettings: (section: SettingsSection) => void;
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
  /** Rejects, and puts the switch back, when the vault refuses: the
      Rust side starts the watch on what the vault holds, so a switch
      left on over a refused write would promise alerts nobody sends. */
  setNotifyNewTx: (enabled: boolean) => Promise<void>;
  setOnboardingSeen: (seen: boolean) => void;
  markTourSeen: () => void;
  showToast: (message: string) => void;
  setSyncError: (walletId: string, message: string | null) => void;
  /** Applies the preferences the vault answered at startup. */
  hydratePrefs: (settings: Settings) => void;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** What the screens hold before the vault answers. Never a default
    anyone sees: the shell waits for the vault (`prefsReady`), which
    always answers every preference, the ones it never stored at the
    core's defaults. */
const UNTIL_THE_VAULT_ANSWERS: Preferences = {
  unit: "btc",
  masked: false,
  fiat: false,
  fiat_currency: "eur",
  price_source: "coingecko",
  notify_new_tx: false,
  explorer_ack: false,
};

/** The store's names for the preferences both apps keep. */
function fromPreferences(preferences: Preferences) {
  return {
    unit: preferences.unit,
    masked: preferences.masked,
    fiatEnabled: preferences.fiat,
    fiatCurrency: preferences.fiat_currency,
    fiatSource: preferences.price_source,
    notifyNewTx: preferences.notify_new_tx,
    explorerAck: preferences.explorer_ack,
  };
}

/** The two the price is asked by, as the vault stored them. */
function pairOf(preferences: Preferences) {
  return {
    fiatCurrency: preferences.fiat_currency,
    fiatSource: preferences.price_source,
  };
}

/** The preferences writes in flight, one after the other in the order
    they were made, so that each answer is the vault after the change
    before it. */
let written: Promise<unknown> = Promise.resolve();

/** Writes a change to the preferences both apps keep, after the ones
    already on their way, and answers what the vault holds then. */
function writePreferences(change: PreferencesChange): Promise<Preferences> {
  const next = written.then(
    () => ipc.setPreferences(change),
    () => ipc.setPreferences(change),
  );
  written = next.catch(() => {});
  return next;
}

/** Changes what the price is asked by, the currency or the source. The
    screen takes the pair from the vault's answer and not before. The
    core asks the price by what it stored, and stores a currency with a
    source that quotes it: shown before, a currency would sit for a
    moment beside a source the core has already moved, and the price be
    asked by a pair the core never had. A refusal leaves the screen as
    it was, which is what the vault still holds. */
function setPair(change: PreferencesChange, set: (state: Partial<UiState>) => void) {
  void writePreferences(change).then(
    (stored) => set(pairOf(stored)),
    () => {},
  );
}

/** Writes a preference of this app alone, and lets a refusal go: what
    it changes is already on screen for this session. Only the next
    launch misses it. */
function persist(key: string, value: string) {
  void ipc.setAppPref(key, value).catch(() => {});
}

/** Writes a preference the window alone reads, shown at once, and lets
    a refusal go the same way: putting it back would undo what was
    asked — amounts shown again under "Hide amounts". The one the Rust
    side acts on, the alerts, is written by `setNotifyNewTx`, which says
    a refusal; the two the price is asked by, by `setPair`. */
function persistShared(change: PreferencesChange) {
  void writePreferences(change).catch(() => {});
}

export const useUi = create<UiState>((set, get) => ({
  view: "home",
  settingsSection: "general",
  activeWalletId: null,
  selectedTxid: null,
  addWalletOpen: false,
  sidebarCollapsed: false,
  ...fromPreferences(UNTIL_THE_VAULT_ANSWERS),
  theme: "light",
  priceRange: "month",
  onboardingSeen: false,
  tourDismissed: false,
  toast: null,
  syncErrors: {},

  setView: (view) => set({ view, selectedTxid: null }),
  setSettingsSection: (settingsSection) => set({ settingsSection }),
  openSettings: (settingsSection) =>
    set({ view: "settings", settingsSection, selectedTxid: null }),
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
    persistShared({ masked });
  },
  setTheme: (theme) => {
    set({ theme });
    applyTheme(theme);
    persist("desktop.theme", theme);
  },
  setUnit: (unit) => {
    set({ unit });
    persistShared({ unit });
  },
  setFiatEnabled: (fiatEnabled) => {
    set({ fiatEnabled });
    persistShared({ fiat: fiatEnabled });
  },
  setFiatCurrency: (fiatCurrency) => setPair({ fiat_currency: fiatCurrency }, set),
  setFiatSource: (fiatSource) => setPair({ price_source: fiatSource }, set),
  setPriceRange: (priceRange) => {
    set({ priceRange });
    persist("home.price_range", priceRange);
  },
  setExplorerAck: (explorerAck) => {
    set({ explorerAck });
    persistShared({ explorer_ack: explorerAck });
  },
  setNotifyNewTx: async (notifyNewTx) => {
    const before = get().notifyNewTx;
    set({ notifyNewTx });
    try {
      await writePreferences({ notify_new_tx: notifyNewTx });
    } catch (error) {
      set({ notifyNewTx: before });
      throw error;
    }
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
  hydratePrefs: (settings) => {
    const prefs = settings.app_prefs;
    const theme = (prefs["desktop.theme"] as ThemePref) ?? "light";
    set({
      ...fromPreferences(settings.preferences),
      theme: ["light", "dark", "system"].includes(theme) ? theme : "light",
      onboardingSeen: prefs["onboarding.seen"] === "1",
      sidebarCollapsed: prefs["desktop.sidebar"] === "collapsed",
      priceRange: (["day", "week", "month", "year"] as PriceRange[]).includes(
        prefs["home.price_range"] as PriceRange,
      )
        ? (prefs["home.price_range"] as PriceRange)
        : "month",
    });
    applyTheme(theme);
  },
}));

/** Keeps "System" on the system's side: the machine going dark at
    sunset takes Gerfaut with it, not at the next launch. Listens only
    while the preference is "System". */
export function useFollowSystemTheme() {
  const theme = useUi((state) => state.theme);
  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => applyTheme("system");
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, [theme]);
}

export function applyTheme(theme: ThemePref) {
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
