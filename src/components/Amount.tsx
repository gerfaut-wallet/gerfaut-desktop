import { clsx } from "clsx";
import { MASKED, formatBtc, formatBtcSigned, formatSats } from "../lib/format";
import { useUi } from "../state/store";

/** Large balance figure: mono, tabular, masked-aware, never animated. */
export function Balance({ sats }: { sats: number }) {
  const masked = useUi((s) => s.masked);
  return (
    <div className="selectable">
      <div className="font-data text-[32px] font-medium leading-[1.1] tracking-[-0.01em] text-text">
        {masked ? MASKED : formatBtc(sats)}
        <span className="ml-2 font-ui text-sm font-normal text-muted">BTC</span>
      </div>
      <div className="mt-1 font-data text-[13px] text-muted">
        {masked ? MASKED : formatSats(sats)}
      </div>
    </div>
  );
}

/** Signed list amount. Direction is also carried by icon and sign
    elsewhere in the row — color is never the only signal. */
export function ListAmount({ sats, pending }: { sats: number; pending?: boolean }) {
  const masked = useUi((s) => s.masked);
  return (
    <span
      className={clsx(
        "font-data text-[13px]",
        sats > 0 && !pending ? "text-confirmed" : "text-text",
      )}
    >
      {masked ? MASKED : formatBtcSigned(sats)}
    </span>
  );
}
