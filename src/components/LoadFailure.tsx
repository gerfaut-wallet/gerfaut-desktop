import { RefreshCw } from "lucide-react";
import { errorMessage } from "../lib/ipc";
import { Button } from "./Button";

/** A page whose data could not be read: what failed, in the core's
    words, and a way to ask again. The bare line it replaces gave no
    reason and no way out but switching pages, and a failed list of
    UTXOs read as a wallet holding none. */
export function LoadFailure({
  what,
  error,
  onRetry,
  retrying = false,
}: {
  /** The sentence's subject: "This wallet", "The UTXOs". */
  what: string;
  error: unknown;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <div role="alert" className="px-1 py-4">
      <p className="font-ui text-sm text-text">{what} could not be loaded.</p>
      {error !== null && error !== undefined && (
        <p className="mt-1 max-w-xl break-words font-ui text-xs text-muted">
          {errorMessage(error)}
        </p>
      )}
      <Button
        variant="ghost"
        className="-ml-3 mt-2"
        disabled={retrying}
        aria-busy={retrying || undefined}
        onClick={onRetry}
      >
        <RefreshCw
          size={14}
          strokeWidth={1.5}
          aria-hidden
          className={retrying ? "motion-safe:animate-spin" : undefined}
        />
        Try again
      </Button>
    </div>
  );
}
