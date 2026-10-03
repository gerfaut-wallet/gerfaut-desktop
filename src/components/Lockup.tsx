import { clsx } from "clsx";
import { Mark } from "./Mark";

/** The mark and the name together, in Glacier: the app presenting
    itself, which it does in two places only, the first screen of an
    empty vault and the first page of the welcome tour. 160px wide. */
export function Lockup({ className, label }: { className?: string; label?: string }) {
  return (
    <div
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={clsx("flex w-40 items-center justify-center gap-2.5 text-primary", className)}
    >
      <Mark className="h-8 w-auto shrink-0" />
      <span className="font-display text-[22px] font-extrabold tracking-wide">GERFAUT</span>
    </div>
  );
}
