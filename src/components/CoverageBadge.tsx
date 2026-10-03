import { CircleDotDashed, Clock, Radio } from "lucide-react";
import type { ReactNode } from "react";
import type { Coverage, WalletCoverage } from "../lib/ipc";
import { COVERAGE_WORDS, waitingWords } from "../state/live";
import { Pill } from "./StatusPill";

/** One glyph per coverage, each a different shape, so the state reads
    without its colour: the watch's own antenna for a wallet heard whole,
    a broken ring for one heard in part, the clock for one that waits. */
const GLYPH: Record<Coverage, ReactNode> = {
  live: <Radio size={12} strokeWidth={2} aria-hidden className="shrink-0" />,
  partial: <CircleDotDashed size={12} strokeWidth={2} aria-hidden className="shrink-0" />,
  sync_only: <Clock size={12} strokeWidth={2} aria-hidden className="shrink-0" />,
};

/** How much of a wallet the live watch hears, shown only when it is
    short of room: "Live" in the neutral tone, "Partly live" and "At
    next sync" in amber, the colour of what waits. How many addresses
    wait rides along for a pointer and for a screen reader, unless the
    line beside the badge already says it. */
export function CoverageBadge({
  coverage,
  said = false,
}: {
  coverage: WalletCoverage;
  /** The count of waiting addresses is written next to the badge. */
  said?: boolean;
}) {
  const waiting = waitingWords(coverage);
  return (
    <span title={waiting} data-coverage={coverage.coverage} className="inline-flex">
      <Pill tone={coverage.coverage === "live" ? "neutral" : "pending"} icon={GLYPH[coverage.coverage]}>
        {COVERAGE_WORDS[coverage.coverage]}
        {!said && <span className="sr-only">. {waiting}</span>}
      </Pill>
    </span>
  );
}
