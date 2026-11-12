import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { MASKED, formatAmount } from "../lib/format";
import { useUi } from "../state/store";

/** The face of a page title, for the one title that is also a field
    (the wallet's name on the Overview). */
export const PAGE_TITLE_TEXT = "font-display text-2xl font-semibold tracking-[-0.01em] text-text";

/** The title of a page. Its box is as tall as the Overview's title is
    once it is a button with an edge, so the title sits at the same
    height on every page. */
export function PageTitle({ className, ...rest }: ComponentProps<"h1">) {
  return <h1 className={cn("flex min-h-[38px] items-center", PAGE_TITLE_TEXT, className)} {...rest} />;
}

/** The head of every page: the title on the edge its cards share, one
    line under it at most, and what the page keeps beside it. One
    component, so nothing moves between two pages: a title 3px lower
    or a card 8px further down reads as another application. */
export function PageHeader({
  title,
  count,
  heading,
  sub,
  aside,
}: {
  /** The page's name. */
  title?: string;
  /** How many rows the page lists, beside the title; nothing at zero. */
  count?: number;
  /** In place of `title`, for a page that draws its own `PageTitle`. */
  heading?: ReactNode;
  /** The one line under the title: where the page's data come from. */
  sub?: ReactNode;
  /** Kept at the far end, on the title's last line. */
  aside?: ReactNode;
}) {
  return (
    <header className="flex items-end justify-between gap-4 pb-4 pt-2">
      <div className="min-w-0 flex-1">
        {heading ?? (
          <PageTitle>
            <span className="flex items-baseline gap-2.5">
              {title}
              {count !== undefined && count > 0 && (
                <span className="tabular rounded-full bg-sunken px-2 py-0.5 font-ui text-xs font-medium text-muted">
                  {count}
                </span>
              )}
            </span>
          </PageTitle>
        )}
        {sub && <div className="mt-0.5 font-ui text-sm text-muted">{sub}</div>}
      </div>
      {aside}
    </header>
  );
}

/** The wallet's total, small, beside the title of a page that lists
    what it is made of: the large figure lives on the Overview. */
export function HeaderBalance({ sats }: { sats: number }) {
  const { masked, unit } = useUi();
  return (
    <div className="shrink-0 pb-0.5 text-right">
      <p className="font-ui text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
        Total balance
      </p>
      <p className="tabular text-[15px] font-semibold text-text">
        {masked ? MASKED : formatAmount(sats, unit)}
      </p>
    </div>
  );
}
