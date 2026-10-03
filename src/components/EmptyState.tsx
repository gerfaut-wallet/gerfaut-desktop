import type { ReactNode } from "react";
import { Mark } from "./Mark";

/** What, why, and exactly one action. The brand mark as a discreet
    watermark, 48px high, is the single decoration the system allows —
    except on the very first screen, `lockup`, where the vault is still
    empty and the app presents itself by name, once. */
export function EmptyState({
  title,
  hint,
  action,
  lockup = false,
}: {
  title: string;
  hint: string;
  action?: ReactNode;
  lockup?: boolean;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 py-10 text-center">
      {lockup ? (
        <div aria-hidden className="mb-3 flex w-40 items-center justify-center gap-2.5 text-primary">
          <Mark className="h-8 w-auto shrink-0" />
          <span className="font-display text-[22px] font-extrabold tracking-wide">GERFAUT</span>
        </div>
      ) : (
        <Mark className="mb-2 h-12 w-auto text-text opacity-[0.08]" />
      )}
      <p className="text-balance font-ui text-base text-text">{title}</p>
      <p className="max-w-sm text-pretty font-ui text-sm text-muted">{hint}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
