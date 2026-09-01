import { clsx } from "clsx";
import { Check, Clock } from "lucide-react";
import type { ReactNode } from "react";
import type { TxStatus } from "../lib/ipc";

export type PillTone = "confirmed" | "pending" | "neutral" | "alert";

/** A state as a pill: a leading glyph plus the words, never colour
    alone. The glyphs differ in shape, so the state survives colour
    blindness and monochrome screenshots. Light theme: tinted surface +
    dark text + 25% border (measured rule); dark theme: coloured text on
    the surface, no tint; neutral: the sunken ground inside a hairline.
    `data-tone` names the tone for a test, which should not read a
    class. */
export function Pill({
  tone,
  icon,
  children,
}: {
  tone: PillTone;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      data-tone={tone}
      className={clsx(
        "tabular inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border py-0.5 font-ui text-xs font-medium",
        icon ? "pl-2 pr-2.5" : "px-2.5",
        tone === "confirmed" && "border-confirmed/25 bg-confirmed-surface text-confirmed",
        tone === "pending" && "border-pending/25 bg-pending-surface text-pending",
        tone === "neutral" && "border-border bg-sunken text-muted",
        tone === "alert" && "border-alert/25 bg-alert-surface text-alert",
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/** A transaction's standing: the check once it is in a block, the
    clock while it waits, and the count of confirmations under six. */
export function StatusPill({ status, confirmations }: { status: TxStatus; confirmations?: number }) {
  const confirmed = status.state === "confirmed";
  const label = confirmed
    ? confirmations !== undefined && confirmations < 6
      ? `${confirmations} conf`
      : "Confirmed"
    : "Pending";
  return (
    <Pill
      tone={confirmed ? "confirmed" : "pending"}
      icon={
        confirmed ? (
          <Check size={12} strokeWidth={2} aria-hidden className="shrink-0" />
        ) : (
          <Clock size={12} strokeWidth={2} aria-hidden className="shrink-0" />
        )
      }
    >
      {label}
    </Pill>
  );
}
