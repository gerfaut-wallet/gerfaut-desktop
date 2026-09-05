import { Gem } from "lucide-react";
import { Pill } from "./StatusPill";

/** The one marker of the paid service: the gem and the word, in the
    premium colour, on its own surface. It says that an option exists
    or applies; it never sells. */
export function PremiumPill() {
  return (
    <Pill tone="premium" icon={<Gem size={11} strokeWidth={2} aria-hidden className="shrink-0" />}>
      <span className="text-[10px] font-semibold uppercase tracking-[0.06em]">Premium</span>
    </Pill>
  );
}

/** A wallet the server watches: the same gem, the plain word. */
export function WatchedPill() {
  return (
    <Pill tone="premium" icon={<Gem size={12} strokeWidth={2} aria-hidden className="shrink-0" />}>
      Watched
    </Pill>
  );
}
