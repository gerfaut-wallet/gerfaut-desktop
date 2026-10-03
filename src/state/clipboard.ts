// Copying, with its confirmation: a check mark on the button for a
// moment and a toast. Two kinds of text go to the clipboard.
//
// What identifies a wallet or opens its alerts — a descriptor, the
// account key, a Telegram link code, an ntfy topic — goes through the
// Rust side, which keeps it out of the clipboard history and the cloud
// clipboard and takes it off the clipboard a minute later, unless the
// person copied something else since. The webview can write the
// clipboard but not read it back without a permission prompt, so it
// could not tell whose copy is there.
//
// An address or a transaction is on the chain for anyone to read: it
// keeps the webview's plain clipboard.

import { useCallback, useEffect, useRef, useState } from "react";
import { ipc } from "../lib/ipc";
import { useUi } from "./store";

/** How long the button shows its check mark, as the address chip does. */
const COPIED_FOR_MS = 1500;

/** What a copy came to: on the clipboard for good, on it until the
    seconds run out, or refused. */
export type Copied = { kept: true } | { kept: false; seconds: number } | null;

async function write(text: string, sensitive: boolean): Promise<Copied> {
  if (sensitive) {
    try {
      return { kept: false, seconds: await ipc.copySensitive(text) };
    } catch {
      // The system clipboard would not open on that side. A plain copy
      // still beats a button that says "Copied" over an empty clipboard;
      // the confirmation then says nothing of a minute.
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return { kept: true };
  } catch {
    return null;
  }
}

/** "1 minute", "90 seconds": how long a sensitive copy stays. */
export function stayWords(seconds: number): string {
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  }
  return `${seconds} seconds`;
}

/** The toast after a copy: "Key copied", or "Key copied for 1 minute"
    when the clipboard lets go of it by itself. */
export function copiedWords(words: string, copied: Exclude<Copied, null>): string {
  return copied.kept ? words : `${words} for ${stayWords(copied.seconds)}`;
}

/** A copy button's state and action. `toast` is what the confirmation
    says, null for none; `sensitive` sends the text through the Rust
    side. `copy` resolves to what happened, null when the clipboard
    refused: the caller says so where the text can be copied by hand. */
export function useClipboard({
  sensitive = false,
  toast = "Copied",
}: { sensitive?: boolean; toast?: string | null } = {}) {
  const showToast = useUi((state) => state.showToast);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(
    async (text: string): Promise<Copied> => {
      const result = await write(text, sensitive);
      setFailed(result === null);
      if (result === null) return null;
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_FOR_MS);
      if (toast !== null) showToast(copiedWords(toast, result));
      return result;
    },
    [sensitive, toast, showToast],
  );

  return { copy, copied, failed };
}
