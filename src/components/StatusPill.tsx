import { CheckCircle2, Clock3 } from "lucide-react";
import type { TxStatus } from "../lib/ipc";

/** Confirmed / pending pill: always icon + text, never color alone.
    Light theme: tinted surface + dark text + 25% border (measured rule);
    dark theme: colored text on the surface, no tint. */
export function StatusPill({ status, confirmations }: { status: TxStatus; confirmations?: number }) {
  if (status.state === "confirmed") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-confirmed/25 bg-confirmed-surface px-2 py-0.5 font-ui text-xs font-medium tracking-wide text-confirmed"
      >
        <CheckCircle2 size={12} strokeWidth={1.5} aria-hidden />
        {confirmations !== undefined && confirmations < 6
          ? `${confirmations} conf`
          : "Confirmed"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-pending/25 bg-pending-surface px-2 py-0.5 font-ui text-xs font-medium tracking-wide text-pending">
      <Clock3 size={12} strokeWidth={1.5} aria-hidden />
      Pending
    </span>
  );
}
