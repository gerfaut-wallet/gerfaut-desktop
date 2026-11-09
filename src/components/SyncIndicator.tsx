import { AlertTriangle } from "lucide-react";
import type { SyncStamp } from "../lib/ipc";
import { relativeTime } from "../lib/format";
import type { WalletSyncStatus } from "../lib/syncState";

/** Data freshness, always visible. While syncing, the last known sync
    stays on screen. A failed sync is stated with its reason: silence
    would look like health. */
export function SyncIndicator({
  stamp,
  sync,
}: {
  stamp: SyncStamp | null;
  /** The sync of the wallet shown, never another wallet's. */
  sync: WalletSyncStatus;
}) {
  if (sync.state === "syncing") {
    return (
      <span className="font-ui text-xs font-medium tracking-wide text-muted" aria-live="polite">
        {stamp ? `Syncing… last sync ${relativeTime(stamp.at)}` : "Syncing…"}
      </span>
    );
  }
  if (sync.state === "failed") {
    return (
      <span
        className="inline-flex items-center gap-1.5 font-ui text-xs font-medium tracking-wide text-pending"
        aria-live="polite"
        title={sync.message}
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
