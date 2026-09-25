import { useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/Button";
import { Mark } from "../components/Mark";
import type { CommandError } from "../lib/ipc";
import { ipc, isCommandError } from "../lib/ipc";

/** The core writes in lower case; a line on its own starts with a
    capital and ends with a full stop. */
function sentence(words: string): string {
  const trimmed = words.trim();
  if (trimmed.length === 0) return "No reason was given.";
  const capital = trimmed[0].toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}

/** What the vault said at startup, in the words the screen uses. */
function wordsFor(failure: CommandError): { title: string; body: string; hint: string } {
  if (failure.kind === "vault_in_use") {
    return {
      title: "Gerfaut is already open",
      body: "Another Gerfaut window is using this vault, and a vault opens in one place at a time. Switch to that window, or close it and try again.",
      hint: "No other window in sight? Another copy of Gerfaut installed on this machine may be holding the same vault.",
    };
  }
  return {
    title: "The vault could not be opened",
    body: sentence(failure.message),
    hint: "If this keeps happening, check that the system's credential store lets Gerfaut read its vault key.",
  };
}

/** The whole window when the vault did not open: what happened, and
    the one thing to do about it. The theme lives in the vault, so this
    stays on the dark island the splash is drawn on. */
export function StartupFailure({ failure }: { failure: CommandError }) {
  const client = useQueryClient();
  const [shown, setShown] = useState(failure);
  const [trying, setTrying] = useState(false);
  const words = wordsFor(shown);

  const retry = async () => {
    setTrying(true);
    try {
      await ipc.retryOpen();
      // Every answer so far was given without a vault: start over.
      await client.resetQueries();
    } catch (error) {
      if (isCommandError(error)) setShown(error);
      setTrying(false);
    }
  };

  return (
    <div className="shell-rail flex h-full items-center justify-center bg-shell px-6">
      <div role="alert" className="flex max-w-md flex-col items-center text-center">
        <Mark className="h-10 w-auto text-primary" />
        <h1 className="mt-4 text-balance font-display text-lg font-semibold text-text">
          {words.title}
        </h1>
        <p className="mt-2 text-pretty font-ui text-sm text-text">{words.body}</p>
        <p className="mt-2 text-pretty font-ui text-xs text-muted">{words.hint}</p>
        <Button
          variant="primary"
          className="mt-6"
          disabled={trying}
          aria-busy={trying || undefined}
          onClick={() => void retry()}
        >
          <RotateCcw size={15} strokeWidth={1.5} aria-hidden />
          {trying ? "Trying…" : "Try again"}
        </Button>
      </div>
    </div>
  );
}
