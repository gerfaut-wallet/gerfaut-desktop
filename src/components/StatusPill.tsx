import { clsx } from "clsx";
import { Check, Clock } from "lucide-react";
import type { ReactNode } from "react";
import type { TxStatus } from "../lib/ipc";
import { ConfirmationPie, SETTLED } from "./ConfirmationPie";

export type PillTone = "confirmed" | "pending" | "neutral" | "alert";

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
  title,
  children,
}: {
  tone: PillTone;
  icon?: ReactNode;
  wrap?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      data-tone={tone}
      title={title}
      className={clsx(
        "tabular inline-flex gap-1.5 rounded-full border py-0.5 font-ui text-xs font-medium",
        wrap ? "items-start" : "items-center whitespace-nowrap",
        icon ? "pl-2 pr-2.5" : "px-2.5",
        tone === "confirmed" && "border-confirmed/25 bg-confirmed-surface text-confirmed",
        tone === "pending" && "border-pending/25 bg-pending-surface text-pending",
        tone === "neutral" && "border-border bg-sunken text-muted",
        tone === "alert" && "border-alert/25 bg-alert-surface text-alert",
      )}
    >
      {icon && wrap ? <span className="flex h-4 shrink-0 items-center">{icon}</span> : icon}
      {children}
    </span>
  );
}

/** Where a transaction stands, read once from its status and its depth,
    so the pill and the row ask the same question the same way. */
type Standing =
  | { kind: "pending" }
  | { kind: "counting"; confirmations: number }
  | { kind: "settled" };

function standing(status: TxStatus, confirmations: number): Standing {
  if (status.state === "pending") return { kind: "pending" };
  // Settled has to be earned: a count that is not a number at run time
  // compares false both ways, and must not read as six blocks deep.
  return confirmations >= SETTLED ? { kind: "settled" } : { kind: "counting", confirmations };
}

/** A transaction's standing: the clock while it waits, a pie filling a
    sixth per block on the way to six, then the check. The short count
    is what the eye reads; a screen reader hears the whole sentence,
    which the pointer finds in the title too. `data-glyph` names the
    shape for a test, which should not read a class. */
export function StatusPill({ status, confirmations }: { status: TxStatus; confirmations: number }) {
  const state = standing(status, confirmations);
  switch (state.kind) {
    case "pending":
      return (
        <Pill
          tone="pending"
          icon={<Clock size={12} strokeWidth={2} aria-hidden data-glyph="clock" className="shrink-0" />}
        >
          Pending
        </Pill>
      );
    case "counting": {
      const spoken = `${state.confirmations} of ${SETTLED} confirmations`;
      return (
        <Pill tone="confirmed" title={spoken} icon={<ConfirmationPie parts={state.confirmations} />}>
          {/* Positioned, so the hidden sentence stays in its pill: placed
              from the page instead, below the fold of a list that
              scrolls in its card, it made the page scroll too. */}
          <span className="relative">
            <span aria-hidden>{`${state.confirmations} conf`}</span>
            <span className="sr-only">{spoken}</span>
          </span>
        </Pill>
      );
    }
    case "settled":
      return (
        <Pill
          tone="confirmed"
          icon={<Check size={12} strokeWidth={2} aria-hidden data-glyph="check" className="shrink-0" />}
        >
          Confirmed
        </Pill>
      );
  }
}

/** The standing of a row in a list. A transaction six blocks deep has
    nothing left to say: a check in the muted colour, its word kept for
    a screen reader and for the pointer. The pill, and its colour, are
    for what still moves: "Pending", then the count of confirmations
    on the way to six. A list of three hundred settled rows was three
    hundred green pills, and the one amber one did not stand out. */
export function RowStatus({ status, confirmations }: { status: TxStatus; confirmations: number }) {
  if (standing(status, confirmations).kind !== "settled") {
    return <StatusPill status={status} confirmations={confirmations} />;
  }
  return (
    // Positioned, so the hidden word stays in its row: placed from the
    // page instead, the words of the rows below the fold of a list that
    // scrolls in its card made the page scroll too. A box of its own
    // rather than a word in a line, so a table cell centres it too.
    <span title="Confirmed" className="relative flex w-fit shrink-0 items-center text-muted">
      <Check size={14} strokeWidth={2} aria-hidden data-glyph="check" />
      <span className="sr-only">Confirmed</span>
    </span>
  );
}
