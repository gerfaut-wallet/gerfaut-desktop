import { clsx } from "clsx";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";

/** Which way a transaction went, as a glyph in a rounded square: the
    arrow says it, the tint only repeats it. Lichen once an incoming
    payment is in a block, neutral for the rest. In dark the tinted
    surface is the card's own, where a pill is coloured text and
    nothing else: a square needs its ground, so it takes the signal at
    10%, as the address pills do. */
export function DirectionChip({
  incoming,
  pending,
  size = "md",
}: {
  incoming: boolean;
  pending: boolean;
  /** `md` in a list of transactions, `sm` in a card's short list. */
  size?: "md" | "sm";
}) {
  const Arrow = incoming ? ArrowDownLeft : ArrowUpRight;
  return (
    <span
      aria-hidden
      className={clsx(
        "inline-flex shrink-0 items-center justify-center",
        size === "md" ? "size-8 rounded-lg" : "size-6 rounded-md",
        incoming && !pending
          ? "bg-confirmed-surface text-confirmed dark:bg-confirmed/10"
          : "bg-sunken text-muted",
      )}
    >
      <Arrow size={size === "md" ? 15 : 13} strokeWidth={1.5} />
    </span>
  );
}
