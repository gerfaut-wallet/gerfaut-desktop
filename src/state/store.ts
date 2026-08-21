// UI state. Server state lives in TanStack Query; this store only holds
// what the interface itself decides: selection, panels, preferences.

import { create } from "zustand";
import type { FiatCurrency, PriceSource } from "../lib/ipc";
import { ipc } from "../lib/ipc";
import type { Unit } from "../lib/format";

export type ThemePref = "light" | "dark" | "system";
export type CanvasView = "wallet" | "settings";
export type WalletTab = "transactions" | "utxos";

interface UiState {
  view: CanvasView;
  activeWalletId: string | null;
  walletTab: WalletTab;
  /** Txid opened in the detail modal, null when closed. */
  selectedTxid: string | null;
  addWalletOpen: boolean;
  receiveOpen: boolean;
  paletteOpen: boolean;
  masked: boolean;
  theme: ThemePref;
  /** Display unit for every amount. */
  unit: Unit;
  /** Fiat display: on by default, currency and source configurable. */
  fiatEnabled: boolean;
  fiatCurrency: FiatCurrency;
  fiatSource: PriceSource;
  toast: string | null;
  /** Last sync failure per wallet id, cleared on the next success. */
  syncErrors: Record<string, string>;

  openWallet: (id: string) => void;
  openSettings: () => void;
  setWalletTab: (tab: WalletTab) => void;
  selectTx: (txid: string | null) => void;
  setAddWalletOpen: (open: boolean) => void;
  setReceiveOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  toggleMasked: () => void;
  setTheme: (theme: ThemePref) => void;
  setUnit: (unit: Unit) => void;
  setFiatEnabled: (enabled: boolean) => void;
  setFiatCurrency: (currency: FiatCurrency) => void;
  setFiatSource: (source: PriceSource) => void;
  showToast: (message: string) => void;
  setSyncError: (walletId: string, message: string | null) => void;
  /** Applies preferences loaded from the vault at startup. */
  hydratePrefs: (prefs: Record<string, string>) => void;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

function persist(key: string, value: string) {
  void ipc.setAppPref(key, value).catch(() => {});
}

export const useUi = create<UiState>((set, get) => ({
  view: "wallet",
  activeWalletId: null,
  walletTab: "transactions",
  selectedTxid: null,
  addWalletOpen: false,
  receiveOpen: false,
  paletteOpen: false,
  masked: false,
  theme: "light",
  unit: "btc",
  fiatEnabled: true,
  fiatCurrency: "eur",
  fiatSource: "coingecko",
  toast: null,
  syncErrors: {},

  openWallet: (id) =>
    set({ view: "wallet", activeWalletId: id, selectedTxid: null, walletTab: "transactions" }),
  openSettings: () => set({ view: "settings", selectedTxid: null }),
  setWalletTab: (walletTab) => set({ walletTab, selectedTxid: null }),
  selectTx: (selectedTxid) => set({ selectedTxid }),
  setAddWalletOpen: (addWalletOpen) => set({ addWalletOpen }),
  setReceiveOpen: (receiveOpen) => set({ receiveOpen }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
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
    set({
      theme: ["light", "dark", "system"].includes(theme) ? theme : "light",
      masked: prefs["desktop.masked"] === "1",
      unit,
      fiatEnabled: prefs["display.fiat"] !== "0",
      fiatCurrency: ["eur", "usd", "gbp", "chf"].includes(currency) ? currency : "eur",
      fiatSource: ["coingecko", "kraken", "mempool_space"].includes(source)
        ? source
        : "coingecko",
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
