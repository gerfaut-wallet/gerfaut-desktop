import { clsx } from "clsx";
import { AlertTriangle, Info } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type Tone = "alert" | "info";

/** A note that says how much what follows matters, before it is read.
 *
 *  **One question picks the tone, and it is not argued case by case.**
 *
 *  - `alert` (red) — **only** when the user can lose funds or lose
 *    privacy. An unexpected outgoing payment, a server certificate that
 *    changed, a link that hands their IP to an explorer's operator, an
 *    unsigned transaction they believe is ready. Red is the most
 *    expensive colour in the system: one use too many and it is
 *    inaudible the day it counts.
 *  - `info` (amber) — everything else worth reading: information, a
 *    convention, a harmless consequence. A key that does not say its
 *    script type, an OP_RETURN in a transaction, a raised gap limit
 *    that only applies on the next sync. Nothing is at risk; something
 *    is simply good to know before going on.
 *
 *  Neither, when the text changes no decision: that is a hint under the
 *  field, and it needs no panel at all.
 *
 *  **A notice never lives inside the card it comments.** A recognition
 *  card says what the instrument understood; a notice says what it does
 *  not know. Stacked in one frame they read as a single block of facts
 *  of equal weight — put the notice below the card.
 *
 *  The tone is never the only carrier: the text always says on its own
 *  what is at stake. */
export function Notice({
  tone,
  children,
  icon,
  action,
  role,
  className,
}: {
  tone: Tone;
  children: ReactNode;
  /** A glyph in place of the tone's own, for a panel that names one
      kind of caution — the broadcast cautions pick one per kind. It
      never changes the tone: the colour still says how much this
      matters, the glyph only says what it is about. */
  icon?: LucideIcon;
  /** Optional control on the right, centred on the panel. */
  action?: ReactNode;
  /** Set it when the note appears in reaction to something the user
      just did, so a screen reader announces it. */
  role?: "alert" | "status";
  className?: string;
}) {
  const alert = tone === "alert";
  const Glyph = icon ?? (alert ? AlertTriangle : Info);
  return (
    <div
      role={role}
      className={clsx(
        // In dark the tinted surfaces collapse onto the card ramp, so
        // the same tokens give coloured text on the surface with no
        // tint, as the system asks.
        "flex items-start gap-2.5 rounded-md border p-3",
        alert
          ? "border-alert/25 bg-alert-surface text-alert"
          : "border-pending/25 bg-pending-surface text-pending",
        className,
      )}
    >
      {/* The icon rides the first line, not the middle of the block: a
          box exactly one line tall centres it there, and it keeps
          holding once the text wraps. No corrective padding. */}
      <span className="flex h-5 shrink-0 items-center">
        <Glyph size={16} strokeWidth={1.75} aria-hidden />
      </span>
      <div className="min-w-0 flex-1 font-ui text-sm leading-5">{children}</div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}
