import { clsx } from "clsx";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { truncateMiddle } from "../lib/format";
import { useUi } from "../state/store";

/** Inline identifier chip: mono, middle-truncated, click to copy with
    explicit feedback. The full value stays available via `title` and in
    detail views. `emphasis` lifts the chip on accent-tinted surfaces
    (wallet-owned rows), where the muted gray would sink. */
export function AddressChip({
  value,
  head = 6,
  tail = 4,
  emphasis = false,
}: {
  value: string;
  head?: number;
  tail?: number;
  emphasis?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const showToast = useUi((s) => s.showToast);

  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    showToast("Copied");
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={value}
      className={clsx(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1 font-data text-[13px] transition-colors duration-150",
        emphasis
          ? "bg-primary/10 font-medium text-text"
          : "bg-sunken text-muted hover:text-text",
      )}
    >
      {truncateMiddle(value, head, tail)}
      {copied ? (
        <Check size={14} strokeWidth={1.5} aria-hidden className="text-confirmed" />
      ) : (
        <Copy size={14} strokeWidth={1.5} aria-hidden />
      )}
    </button>
  );
}
