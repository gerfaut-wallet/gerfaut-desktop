// What the four premium cards share: the note a failure leaves under a
// card, the ghost that survives a tinted surface, the date voice.

import { useEffect, useState } from "react";
import type { RefObject } from "react";
import { Button } from "../../../components/Button";
import { Notice } from "../../../components/Notice";
import { LOCALE } from "../../../lib/format";
import { premiumFailure } from "../../../lib/premium";

/** A ghost on a tinted panel: hover in Neige with a hairline rather
    than the Givre that would read dirty there; Givre again in dark. */
export const GHOST_ON_TINT =
  "h-9 hover:bg-surface hover:shadow-[inset_0_0_0_1px_var(--color-border)] dark:hover:bg-sunken dark:hover:shadow-none";

/** The amber note a failed call leaves under its card: one sentence in
    the section's words, and "Retry" when trying again could change the
    answer. Never a toast, never a dialog. */
export function FailureNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const failure = premiumFailure(error);
  return (
    <Notice
      tone="info"
      role="alert"
      action={
        failure.retry && onRetry ? (
          <Button variant="ghost" className={GHOST_ON_TINT} onClick={onRetry}>
            Retry
          </Button>
        ) : undefined
      }
    >
      {failure.message}
    </Notice>
  );
}

/** "March 12, 2027": a date alone, in the app's one language. */
export function longDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(LOCALE, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** The square chip a row's glyph sits in. */
export const GLYPH_CHIP =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-sunken text-text";

/** Moves the focus to `ref` once the next render is on screen. A
    dialog that closes hands the focus back to what opened it on its
    way out; when that was a question now gone, this lands it on the
    card's heading instead of the body. */
export function useFocusAfterRender(ref: RefObject<HTMLElement | null>): () => void {
  const [requests, setRequests] = useState(0);
  useEffect(() => {
    if (requests > 0) ref.current?.focus();
  }, [requests, ref]);
  return () => setRequests((count) => count + 1);
}
