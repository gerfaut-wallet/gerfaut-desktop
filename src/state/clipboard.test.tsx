import { mockIPC } from "@tauri-apps/api/mocks";
import { act, renderHook } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOT_COPIED, UNGUARDED, copiedWords, stayWords, useClipboard } from "./clipboard";
import { useUi } from "./store";

/** The commands the copies sent, with what they carried. */
function rust(answer: () => unknown) {
  const sent: unknown[] = [];
  mockIPC((cmd, args) => {
    if (cmd !== "copy_sensitive") throw new Error(`unexpected command ${cmd}`);
    sent.push((args as { text: string }).text);
    return answer();
  });
  return sent;
}

beforeEach(() => {
  // user-event's stand-in for the webview's clipboard.
  userEvent.setup();
  useUi.setState({ toast: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("copying", () => {
  it("sends a secret to the Rust side and says how long it stays", async () => {
    const sent = rust(() => 60);
    const write = vi.spyOn(navigator.clipboard, "writeText");
    const { result } = renderHook(() => useClipboard({ sensitive: true, toast: "Descriptor copied" }));

    let copied: unknown;
    await act(async () => {
      copied = await result.current.copy("wpkh([d34db33f/84h/0h/0h]xpub/0/*)");
    });
    expect(copied).toEqual({ kept: false, seconds: 60 });
    expect(sent).toEqual(["wpkh([d34db33f/84h/0h/0h]xpub/0/*)"]);
    // Never the webview's clipboard as well: it would keep the secret.
    expect(write).not.toHaveBeenCalled();
    expect(result.current.copied).toBe(true);
    expect(useUi.getState().toast).toBe("Descriptor copied for 1 minute");
  });

  /** The Rust side could not open the clipboard: the plain clipboard
      takes the secret, and the toast says plainly that nothing will
      clear it, for longer than a toast usually stays. */
  it("copies a secret the Rust side refuses, and says nothing will clear it", async () => {
    rust(() => Promise.reject({ kind: "internal", message: "no clipboard" }));
    const { result } = renderHook(() => useClipboard({ sensitive: true, toast: null }));

    let copied: unknown;
    await act(async () => {
      copied = await result.current.copy("wpkh([d34db33f/84h/0h/0h]xpub/1/*)");
    });
    expect(copied).toEqual({ kept: true, unguarded: true });
    expect(await navigator.clipboard.readText()).toBe("wpkh([d34db33f/84h/0h/0h]xpub/1/*)");
    expect(result.current.copied).toBe(true);
    // Said even to a caller that keeps its own toast.
    expect(useUi.getState().toast).toBe(UNGUARDED);
  });

  it("says a secret no clipboard took was not copied", async () => {
    rust(() => Promise.reject({ kind: "internal", message: "no clipboard" }));
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    const { result } = renderHook(() => useClipboard({ sensitive: true }));

    let copied: unknown;
    await act(async () => {
      copied = await result.current.copy("wpkh([d34db33f/84h/0h/0h]xpub/1/*)");
    });
    expect(copied).toBeNull();
    expect(result.current.failed).toBe(true);
    expect(useUi.getState().toast).toBe(NOT_COPIED);
  });

  it("keeps what is on the chain on the plain clipboard", async () => {
    const sent = rust(() => 60);
    const { result } = renderHook(() => useClipboard());

    await act(async () => {
      await result.current.copy("tb1qexampleaddress0");
    });
    expect(sent).toEqual([]);
    expect(await navigator.clipboard.readText()).toBe("tb1qexampleaddress0");
    expect(useUi.getState().toast).toBe("Copied");
  });

  it("says nothing in a toast when the plain clipboard refuses", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    const { result } = renderHook(() => useClipboard());

    let copied: unknown;
    await act(async () => {
      copied = await result.current.copy("abcd");
    });
    expect(copied).toBeNull();
    expect(result.current.failed).toBe(true);
    expect(result.current.copied).toBe(false);
    expect(useUi.getState().toast).toBeNull();
  });

  it("can leave the toast to the caller", async () => {
    rust(() => 60);
    const { result } = renderHook(() => useClipboard({ sensitive: true, toast: null }));
    await act(async () => {
      await result.current.copy("abcd");
    });
    expect(useUi.getState().toast).toBeNull();
  });
});

describe("the words", () => {
  it("says the stay in minutes when it is whole minutes", () => {
    expect(stayWords(60)).toBe("1 minute");
    expect(stayWords(120)).toBe("2 minutes");
    expect(stayWords(45)).toBe("45 seconds");
  });

  it("adds the stay only to a copy that will be cleared", () => {
    expect(copiedWords("Copied", { kept: true })).toBe("Copied");
    expect(copiedWords("Copied", { kept: true, unguarded: true })).toBe(UNGUARDED);
    expect(copiedWords("Descriptor copied", { kept: false, seconds: 60 })).toBe(
      "Descriptor copied for 1 minute",
    );
  });
});
