import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
