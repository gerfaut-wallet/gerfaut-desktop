import type { TxStatus } from "../lib/ipc";

/** Confirmed / pending pill: a leading dot plus the label, never colour
    alone. Light theme: tinted surface + dark text + 25% border (measured
    rule); dark theme: coloured text on the surface, no tint. */
export function StatusPill({ status, confirmations }: { status: TxStatus; confirmations?: number }) {
  const confirmed = status.state === "confirmed";
  const label = confirmed
    ? confirmations !== undefined && confirmations < 6
      ? `${confirmations} conf`
      : "Confirmed"
    : "Pending";
  return (
    <span
      className={
        confirmed
          ? "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-confirmed/25 bg-confirmed-surface py-0.5 pl-2 pr-2.5 font-ui text-xs font-medium text-confirmed"
          : "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-pending/25 bg-pending-surface py-0.5 pl-2 pr-2.5 font-ui text-xs font-medium text-pending"
      }
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      {label}
    </span>
  );
}
