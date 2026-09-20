import { clsx } from "clsx";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  ChevronRight,
  CircleAlert,
  Clock,
  Eye,
  EyeOff,
  History,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { EventKind, PremiumEvent, WalletMeta } from "../../../lib/ipc";
import { relativeTime } from "../../../lib/format";
import { eventWords } from "../../../lib/premium";
import { useUi } from "../../../state/store";
import { SectionCard } from "../primitives";
import { FailureNote } from "./shared";

/** The glyph of each kind of event: a shape for what happened, so two
    events never differ by colour alone. */
const GLYPH: Record<EventKind, LucideIcon> = {
  spend_detected: ArrowUpRight,
  spend_confirmed: ArrowUpRight,
  coins_gone: CircleAlert,
  receive_detected: ArrowDownLeft,
  receive_confirmed: ArrowDownLeft,
  timelock_due: Clock,
  wallet_registered: Eye,
  wallet_refused: EyeOff,
  other: Bell,
};

/** Coins leaving without the app's owner deciding it is what the whole
    service exists for: those rows wear the alert surface. */
function tone(kind: EventKind): string {
  switch (kind) {
    case "spend_detected":
    case "spend_confirmed":
    case "coins_gone":
      return "bg-alert-surface text-alert";
    case "receive_confirmed":
      return "bg-confirmed-surface text-confirmed";
    case "timelock_due":
    case "receive_detected":
    // A wallet the server stopped watching is worth reading, and no
    // coin moved: amber.
    case "wallet_refused":
      return "bg-pending-surface text-pending";
    default:
      return "bg-sunken text-muted";
  }
}

/** The server's sentence in a `wallet_refused` event, shown as it is;
    null when the data is not what this build reads. */
function refusalWords(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const message = (data as { message?: unknown }).message;
  return typeof message === "string" && message.trim() !== "" ? message : null;
}

/** The last twenty things the server said, newest first. A row opens
    its wallet when this device has it; otherwise it is only read. */
export function RecentAlertsCard({
  events,
  wallets,
  loading,
  unreachable = false,
  error,
  onRetry,
}: {
  events: PremiumEvent[] | undefined;
  /** Every wallet this device knows, to open one from a row. */
  wallets: WalletMeta[];
  loading: boolean;
  /** The server could not be reached at all; the licence card says so. */
  unreachable?: boolean;
  error?: unknown;
  onRetry?: () => void;
}) {
  const { openWallet } = useUi();
  const known = new Set(wallets.map((wallet) => wallet.id));
  // The server may say a thing twice across its two machines: one id,
  // one row.
  const seen = new Set<number>();
  const rows = (events ?? []).filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });

  return (
    <>
      <SectionCard icon={<History size={18} strokeWidth={1.5} />} title="Recent alerts" premium>
        {unreachable && events === undefined ? (
          <p className="font-ui text-sm text-muted">Waiting for the server.</p>
        ) : loading && events === undefined ? (
          <p className="font-ui text-sm text-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="font-ui text-sm text-muted">
            No alerts yet. Gerfaut will tell you here and on your channels.
          </p>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {rows.map((event) => {
              const Glyph = GLYPH[event.kind] ?? Bell;
              const opens = known.has(event.wallet);
              const body = (
                <>
                  <span
                    aria-hidden
                    className={clsx(
                      "inline-flex size-8 shrink-0 items-center justify-center rounded-[10px]",
                      tone(event.kind),
                    )}
                  >
                    <Glyph size={15} strokeWidth={1.5} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-ui text-sm text-text">
                      <span className="font-medium">{event.wallet_name}</span>
                      <span className="text-muted"> · </span>
                      {eventWords(event.kind)}
                    </span>
                    {event.kind === "wallet_refused" && refusalWords(event.data) !== null && (
                      <span className="font-ui text-xs text-text">{refusalWords(event.data)}</span>
                    )}
                    <span className="tabular font-ui text-xs text-muted">
                      {relativeTime(event.at)}
                    </span>
                  </span>
                  {opens && (
                    <ChevronRight
                      size={14}
                      strokeWidth={1.5}
                      aria-hidden
                      className="shrink-0 text-muted opacity-60 transition-opacity duration-150 group-hover:opacity-100"
                    />
                  )}
                </>
              );
              return (
                <li key={event.id} className="border-b border-border/60 last:border-b-0">
                  {opens ? (
                    <button
                      type="button"
                      onClick={() => openWallet(event.wallet)}
                      className="group flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-left transition-colors duration-100 hover:bg-sunken/60"
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="flex min-h-12 items-center gap-3 px-2 py-2">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
      {error !== undefined && <FailureNote error={error} onRetry={onRetry} />}
    </>
  );
}
