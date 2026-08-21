// UI state. Server state lives in TanStack Query; this store only holds
// what the interface itself decides: selection, panels, preferences.

import { create } from "zustand";
import { ipc } from "../lib/ipc";

export type ThemePref = "light" | "dark" | "system";
export type CanvasView = "wallet" | "settings";
export type WalletTab = "transactions" | "utxos";

interface UiState {
  view: CanvasView;
  activeWalletId: string | null;
  walletTab: WalletTab;
  /** Txid opened in the context rail, null when the rail is closed. */
  selectedTxid: string | null;
  addWalletOpen: boolean;
  receiveOpen: boolean;
  paletteOpen: boolean;
  masked: boolean;
  theme: ThemePref;
  toast: string | null;

  openWallet: (id: string) => void;
  openSettings: () => void;
  setWalletTab: (tab: WalletTab) => void;
  selectTx: (txid: string | null) => void;
  setAddWalletOpen: (open: boolean) => void;
  setReceiveOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  toggleMasked: () => void;
  setTheme: (theme: ThemePref) => void;
  showToast: (message: string) => void;
  /** Applies preferences loaded from the vault at startup. */
  hydratePrefs: (prefs: Record<string, string>) => void;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

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
  toast: null,

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
    void ipc.setAppPref("desktop.masked", masked ? "1" : "0").catch(() => {});
  },
  setTheme: (theme) => {
    set({ theme });
    applyTheme(theme);
    void ipc.setAppPref("desktop.theme", theme).catch(() => {});
  },
  showToast: (message) => {
    clearTimeout(toastTimer);
    set({ toast: message });
    toastTimer = setTimeout(() => set({ toast: null }), 3000);
  },
  hydratePrefs: (prefs) => {
    const theme = (prefs["desktop.theme"] as ThemePref) ?? "light";
    set({
      theme: ["light", "dark", "system"].includes(theme) ? theme : "light",
      masked: prefs["desktop.masked"] === "1",
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
