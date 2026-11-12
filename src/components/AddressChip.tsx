import { clsx } from "clsx";
import { Check, Copy } from "lucide-react";
import { truncateMiddle } from "../lib/format";
import { useClipboard } from "../state/clipboard";

/** Inline identifier chip: mono, middle-truncated, click to copy with
    explicit feedback. The full value stays available via `title` and in
    detail views. `emphasis` lifts the chip on accent-tinted surfaces
    (wallet-owned rows), where the muted gray would sink.

    `fit` shows the value whole where the chip has the room, and cuts
    it in the middle where it has not: the tail is always the value's
    own last characters, and the head gives up whole characters from
    its end. For a column read to compare identifiers, where a fixed
    cut hid most of each one beside an empty space. */
export function AddressChip({
  value,
  head = 6,
  tail = 4,
  emphasis = false,
  fit = false,
  label,
}: {
  value: string;
  head?: number;
  tail?: number;
  emphasis?: boolean;
  /** Cut to the room there is, not to `head`; `tail` still holds. */
  fit?: boolean;
  /** What the value identifies, where a run of hex on its own says
      nothing — "Transaction ID". Read out in place of the digits, which
      no one wants spelled letter by letter. */
  label?: string;
}) {
  const clipboard = useClipboard();
  const copied = clipboard.copied;
  const copy = () => void clipboard.copy(value);
  // Where the tail starts, for `fit`: counted from the length, so a
  // value no longer than its tail is the tail alone, whole.
  const cut = Math.max(0, value.length - tail);

  return (
    <button
      type="button"
      onClick={copy}
      title={value}
      aria-label={label ? `Copy ${label}` : undefined}
      className={clsx(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1 font-data text-[13px] transition-colors duration-150",
        fit && "max-w-full",
        emphasis
          ? "bg-primary/10 font-medium text-text"
          : "bg-sunken text-muted hover:text-text",
      )}
    >
      {fit ? (
        <span className="flex min-w-0">
          {cut > 0 && <span className="min-w-[6ch] truncate">{value.slice(0, cut)}</span>}
          <span className="shrink-0">{value.slice(cut)}</span>
        </span>
      ) : (
        truncateMiddle(value, head, tail)
      )}
      {copied ? (
        <Check size={14} strokeWidth={1.5} aria-hidden className="shrink-0 text-confirmed" />
      ) : (
        <Copy size={14} strokeWidth={1.5} aria-hidden className="shrink-0" />
      )}
    </button>
  );
}
