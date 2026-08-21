import type { ReactNode } from "react";
import { Mark } from "./Mark";

/** What, why, and exactly one action. The brand mark as a discreet
    watermark is the single decoration the system allows. */
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
      <Mark className="mb-2 h-16 w-auto text-text opacity-[0.08]" />
      <p className="font-ui text-base text-text">{title}</p>
      <p className="max-w-sm font-ui text-sm text-muted">{hint}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
