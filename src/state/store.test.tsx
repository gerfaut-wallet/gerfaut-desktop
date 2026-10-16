import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreferencesChange, Settings } from "../lib/ipc";
import { PREFERENCES } from "../test/fixtures";
import { applyTheme, useFollowSystemTheme, useUi } from "./store";

/** A system colour scheme the test can flip, as the machine does at
    sunset. */
function fakeScheme(dark: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    get matches() {
      return dark;
    },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal("matchMedia", () => query);
  return {
    flip(next: boolean) {
      dark = next;
      listeners.forEach((listener) => listener());
    },
    listening: () => listeners.size,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  useUi.setState({ theme: "light" });
  document.documentElement.removeAttribute("data-theme");
});

describe("the System theme", () => {
  it("follows the system when it changes, without a restart", () => {
    const scheme = fakeScheme(false);
    useUi.setState({ theme: "system" });
    applyTheme("system");
    renderHook(() => useFollowSystemTheme());
    expect(document.documentElement.dataset.theme).toBe("light");

    act(() => scheme.flip(true));
    expect(document.documentElement.dataset.theme).toBe("dark");
    act(() => scheme.flip(false));
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("stops listening once a theme is picked by hand", () => {
    const scheme = fakeScheme(false);
    useUi.setState({ theme: "system" });
    renderHook(() => useFollowSystemTheme());
    expect(scheme.listening()).toBe(1);

    act(() => useUi.setState({ theme: "light" }));
    expect(scheme.listening()).toBe(0);
  });
});

describe("the shared preferences", () => {
  const SETTINGS: Settings = {
    active_network: "signet",
    backends: {},
    gap_limit: 20,
    app_prefs: { "desktop.theme": "dark", "desktop.sidebar": "collapsed" },
    electrum_certs: {},
    app_lock: null,
    tor: { mode: "auto", socks_proxy: null },
    preferences: {
      ...PREFERENCES,
      unit: "sats",
      masked: true,
      fiat: true,
      fiat_currency: "usd",
      price_source: "kraken",
    },
  };

  /** The core's answer to each change, and the changes asked of it. */
  function mockCore(answer: (change: PreferencesChange) => unknown) {
    const changes: PreferencesChange[] = [];
    mockIPC((cmd, args) => {
      if (cmd !== "set_preferences") throw new Error(`unexpected command ${cmd}`);
      const change = (args as { change: PreferencesChange }).change;
      changes.push(change);
      return answer(change);
    });
    return changes;
  }

  beforeEach(() => {
    useUi.getState().hydratePrefs({ ...SETTINGS, preferences: PREFERENCES, app_prefs: {} });
  });
  afterEach(() => clearMocks());

  it("takes them from the vault's record, the app's own from its preferences", () => {
    useUi.getState().hydratePrefs(SETTINGS);
    const state = useUi.getState();
    expect(state.unit).toBe("sats");
    expect(state.masked).toBe(true);
    expect(state.fiatEnabled).toBe(true);
    expect(state.fiatCurrency).toBe("usd");
    expect(state.fiatSource).toBe("kraken");
    expect(state.theme).toBe("dark");
    expect(state.sidebarCollapsed).toBe(true);
  });

  it("shows the pair the price is asked by as the core stored it", async () => {
    // A currency only CoinGecko quotes, picked over Kraken: the core
    // keeps the currency and moves the source.
    useUi.setState({ fiatSource: "kraken" });
    const changes = mockCore((change) => ({
      ...PREFERENCES,
      ...change,
      price_source: "coingecko",
    }));
    useUi.getState().setFiatCurrency("inr");
    // Not before the vault answered.
    expect(useUi.getState().fiatCurrency).toBe("eur");
    await waitFor(() => expect(useUi.getState().fiatCurrency).toBe("inr"));
    expect(useUi.getState().fiatSource).toBe("coingecko");
    expect(changes).toEqual([{ fiat_currency: "inr" }]);
  });

  it("leaves the pair as it was when the vault refuses", async () => {
    const changes = mockCore(() => Promise.reject({ kind: "vault", message: "disk full" }));
    useUi.getState().setFiatSource("kraken");
    await waitFor(() => expect(changes).toEqual([{ price_source: "kraken" }]));
    await Promise.resolve();
    expect(useUi.getState().fiatSource).toBe("coingecko");
  });

  it("hides the amounts at once, and keeps them hidden when the vault refuses", async () => {
    const changes = mockCore(() => Promise.reject({ kind: "vault", message: "disk full" }));
    useUi.getState().toggleMasked();
    expect(useUi.getState().masked).toBe(true);
    await waitFor(() => expect(changes).toEqual([{ masked: true }]));
    expect(useUi.getState().masked).toBe(true);
  });

  it("turns the fiat value on at once", () => {
    const changes = mockCore((change) => ({ ...PREFERENCES, ...change }));
    useUi.getState().setFiatEnabled(true);
    expect(useUi.getState().fiatEnabled).toBe(true);
    return waitFor(() => expect(changes).toEqual([{ fiat: true }]));
  });

  it("writes one change after the other, in the order they were made", async () => {
    const pending: (() => void)[] = [];
    const changes = mockCore(
      (change) =>
        new Promise((resolve) => pending.push(() => resolve({ ...PREFERENCES, ...change }))),
    );
    useUi.getState().setUnit("sats");
    useUi.getState().setFiatSource("kraken");
    await waitFor(() => expect(changes).toEqual([{ unit: "sats" }]));
    pending.shift()!();
    await waitFor(() => expect(changes).toHaveLength(2));
    expect(changes[1]).toEqual({ price_source: "kraken" });
    pending.shift()!();
    await waitFor(() => expect(useUi.getState().fiatSource).toBe("kraken"));
  });
});
