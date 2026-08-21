import type { ReactNode } from "react";
import mark from "../assets/gerfaut-mark.svg";

/** What, why, and exactly one action. The brand mark as a discreet
    watermark is the single decoration the system allows. Rendered via a
    CSS mask so it follows the theme's text color. */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <div
        aria-hidden
        className="mb-2 h-16 w-[78px] bg-text opacity-[0.08]"
        style={{
          maskImage: `url(${mark})`,
          maskRepeat: "no-repeat",
          maskSize: "contain",
          maskPosition: "center",
        }}
      />
      <p className="font-ui text-base text-text">{title}</p>
      <p className="max-w-sm font-ui text-sm text-muted">{hint}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
