import { AlertTriangle } from "lucide-react";
import type { SyncStamp } from "../lib/ipc";
import { relativeTime } from "../lib/format";

/** Data freshness, always visible. While syncing, the last known sync
    stays on screen. A failed sync is stated with its reason: silence
    would look like health. */
export function SyncIndicator({
  stamp,
  syncing,
  error,
}: {
  stamp: SyncStamp | null;
  syncing: boolean;
  error?: string | null;
}) {
  if (syncing) {
    return (
      <span className="font-ui text-xs font-medium tracking-wide text-muted" aria-live="polite">
        {stamp ? `Syncing… last sync ${relativeTime(stamp.at)}` : "Syncing…"}
      </span>
    );
  }
  if (error) {
    return (
      <span
        className="inline-flex items-center gap-1.5 font-ui text-xs font-medium tracking-wide text-pending"
        aria-live="polite"
        title={error}
      >
        <AlertTriangle size={13} strokeWidth={1.5} aria-hidden />
        Sync failed · {stamp ? `showing data from ${relativeTime(stamp.at)}` : "no data yet"}
      </span>
    );
  }
  return (
    <span className="font-ui text-xs font-medium tracking-wide text-muted" aria-live="polite">
      {stamp ? `Synced ${relativeTime(stamp.at)} · ${stamp.backend}` : "Never synced"}
    </span>
  );
}
