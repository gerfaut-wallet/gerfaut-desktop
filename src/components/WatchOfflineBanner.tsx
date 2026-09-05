import { clsx } from "clsx";
import { ShieldAlert } from "lucide-react";
import { Button } from "./Button";
import { offlineSinceLabel } from "../lib/premium";
import { usePulse } from "../state/premium";
import { useAcknowledgeOffline } from "../state/premiumQueries";
import { useSettings } from "../state/queries";

/** The alert banner of B-60: the server's heartbeat has failed twice in
    a row, so whatever the app watches from there is not being watched
    right now. It stays until someone acknowledges it or the heartbeat
    verifies again; it never times out on its own, and it never says
    anything about the app's own sync, which goes on as before. */
export function WatchOfflineBanner({ className }: { className?: string }) {
  const offlineSince = usePulse((state) => state.offlineSince);
  const settings = useSettings();
  const acknowledge = useAcknowledgeOffline();
  if (offlineSince === null) return null;
  const quietUntil = settings.data?.premium.acknowledged_offline_until ?? null;
  if (quietUntil !== null && quietUntil > Date.now() / 1000) return null;

  return (
    <div
      role="alert"
      className={clsx(
        "flex flex-wrap items-center gap-3 rounded-md border border-alert/25 bg-alert-surface px-4 py-3 text-alert",
        className,
      )}
    >
      <ShieldAlert size={18} strokeWidth={1.75} aria-hidden className="shrink-0" />
      <p className="min-w-0 flex-1 font-ui text-sm leading-5">
        Gerfaut's watch is offline since{" "}
        <span className="tabular font-medium">{offlineSinceLabel(offlineSince)}</span>. Your
        wallets are not being monitored.
      </p>
      <Button
        variant="ghost"
        className="h-9 hover:bg-surface hover:shadow-[inset_0_0_0_1px_var(--color-border)] dark:hover:bg-sunken dark:hover:shadow-none"
        disabled={acknowledge.isPending}
        onClick={() => acknowledge.mutate()}
      >
        Acknowledge
      </Button>
    </div>
  );
}
