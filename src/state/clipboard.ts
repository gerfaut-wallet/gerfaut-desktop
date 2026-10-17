// Copying, with its confirmation: a check mark on the button for a
// moment and a toast. Two kinds of text go to the clipboard.
//
// What identifies a wallet — a descriptor — goes through the Rust
// side, which keeps it out of the clipboard history and the cloud
// clipboard and takes it off the clipboard a minute later, unless the
// person copied something else since. The webview can write the
// clipboard but not read it back without a permission prompt, so it
// could not tell whose copy is there. When the Rust side cannot copy
// it, the webview's clipboard does, and the toast says plainly that
// nothing will take it off: a copy is never refused, and never left
// there without a word.
//
// An address or a transaction is on the chain for anyone to read: it
// keeps the webview's plain clipboard.

import { useCallback, useEffect, useRef, useState } from "react";
import { ipc } from "../lib/ipc";
import { useUi } from "./store";

/** How long the button shows its check mark, as the address chip does. */
const COPIED_FOR_MS = 1500;

/** What a copy came to: on the clipboard for good, on it until the
    seconds run out, or refused. `unguarded` is a secret that went to
    the plain clipboard, which nothing will clear. */
export type Copied =
  | { kept: true; unguarded?: true }
  | { kept: false; seconds: number }
  | null;

/** What the toast says of a secret on the plain clipboard. */
export const UNGUARDED =
  "Copied, but Gerfaut could not clear it after a minute. Clear your clipboard once you have pasted it.";
/** How long that toast stays: long enough to read twice. */
export const UNGUARDED_FOR_MS = 7000;
/** What the toast says of a secret no clipboard took. */
export const NOT_COPIED = "Not copied: the clipboard did not answer.";

async function write(text: string, sensitive: boolean): Promise<Copied> {
  if (sensitive) {
    try {
      return { kept: false, seconds: await ipc.copySensitive(text) };
    } catch {
      // The system clipboard would not open on that side: the plain one
      // takes it, and the toast says nothing will clear it.
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return sensitive ? { kept: true, unguarded: true } : { kept: true };
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

/** The toast after a copy: "Copied", or "Copied for 1 minute" when the
    clipboard lets go of it by itself. */
export function copiedWords(words: string, copied: Exclude<Copied, null>): string {
  if (!copied.kept) return `${words} for ${stayWords(copied.seconds)}`;
  return copied.unguarded ? UNGUARDED : words;
}

/** A copy button's state and action. `toast` is what the confirmation
    says, null for none; `sensitive` sends the text through the Rust
    side. `copy` resolves to what happened, null when the clipboard
    refused: the caller says so where the text can be copied by hand,
    except for a secret, which the toast tells of when there is one. A
    secret on the plain clipboard is always told of, whatever `toast`
    says: it is the one thing the person has to act on. */
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
      if (result === null) {
        if (sensitive && toast !== null) showToast(NOT_COPIED);
        return null;
      }
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_FOR_MS);
      if (result.kept && result.unguarded) showToast(UNGUARDED, UNGUARDED_FOR_MS);
      else if (toast !== null) showToast(copiedWords(toast, result));
      return result;
    },
    [sensitive, toast, showToast],
  );

  return { copy, copied, failed };
}
