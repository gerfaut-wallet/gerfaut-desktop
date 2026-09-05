import { clsx } from "clsx";
import { Check, Clock } from "lucide-react";
import type { ReactNode } from "react";
import type { TxStatus } from "../lib/ipc";

export type PillTone = "confirmed" | "pending" | "neutral" | "alert" | "premium";

/** A state as a pill: a leading glyph plus the words, never colour
    alone. The glyphs differ in shape, so the state survives colour
    blindness and monochrome screenshots. Light theme: tinted surface +
    dark text + 25% border (measured rule); dark theme: coloured text on
    the surface, no tint; neutral: the sunken ground inside a hairline.
    `data-tone` names the tone for a test, which should not read a
    class. A pill keeps to one line unless asked to `wrap`: a table
    cell has the room, a narrow card with a long state does not, and
    there the glyph stays on the first line of the words. */
export function Pill({
  tone,
  icon,
  wrap = false,
  children,
}: {
  tone: PillTone;
  icon?: ReactNode;
  wrap?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      data-tone={tone}
      className={clsx(
        "tabular inline-flex gap-1.5 rounded-full border py-0.5 font-ui text-xs font-medium",
        wrap ? "items-start" : "items-center whitespace-nowrap",
        icon ? "pl-2 pr-2.5" : "px-2.5",
        tone === "confirmed" && "border-confirmed/25 bg-confirmed-surface text-confirmed",
        tone === "pending" && "border-pending/25 bg-pending-surface text-pending",
        tone === "neutral" && "border-border bg-sunken text-muted",
        tone === "alert" && "border-alert/25 bg-alert-surface text-alert",
        // Bruyere: premium mentions only, never a chain state.
        tone === "premium" && "border-premium/25 bg-premium-surface text-premium",
      )}
    >
      {icon && wrap ? <span className="flex h-4 shrink-0 items-center">{icon}</span> : icon}
      {children}
    </span>
  );
}

/** A transaction's standing: the check once it is in a block, the
    clock while it waits, and the count of confirmations under six.
    `data-glyph` names the shape for a test, which should not read a
    class. */
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
          <Check size={12} strokeWidth={2} aria-hidden data-glyph="check" className="shrink-0" />
        ) : (
          <Clock size={12} strokeWidth={2} aria-hidden data-glyph="clock" className="shrink-0" />
        )
      }
    >
      {label}
    </Pill>
  );
}
