import type { SyncStamp } from "../lib/ipc";
import { relativeTime } from "../lib/format";

/** Data freshness, always visible. While syncing, the last known sync
    stays on screen — never a spinner alone, never a shimmer. */
export function SyncIndicator({
  stamp,
  syncing,
}: {
  stamp: SyncStamp | null;
  syncing: boolean;
}) {
  return (
    <span className="font-ui text-xs font-medium tracking-wide text-muted" aria-live="polite">
      {syncing
        ? stamp
          ? `Syncing… · last sync ${relativeTime(stamp.at)}`
          : "Syncing…"
        : stamp
          ? `Synced ${relativeTime(stamp.at)} · ${stamp.backend}`
          : "Never synced"}
    </span>
  );
}
