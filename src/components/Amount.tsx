import { clsx } from "clsx";
import {
  MASKED,
  formatAmount,
  formatAmountSigned,
  formatBtc,
  formatFiat,
  formatSats,
} from "../lib/format";
import { useFiatRate } from "../state/queries";
import { useUi } from "../state/store";

/** Fiat value of an amount, when the display is enabled and a quote is
    available. Degrades to nothing, never to an error. */
export function useFiatValue(sats: number): string | null {
  const { fiatEnabled, fiatCurrency, masked } = useUi();
  const rate = useFiatRate();
  if (!fiatEnabled || masked || !rate.data) return null;
  return formatFiat(sats, rate.data.rate, fiatCurrency);
}

/** Headline balance figure: UI face with tabular figures, masked-aware.
    One line in the chosen unit — never both units — with the fiat value
    below when that display is on. Sized to read, not to shout. */
export function Balance({ sats }: { sats: number }) {
  const { masked, unit } = useUi();
  const fiat = useFiatValue(sats);
  const primary = unit === "btc" ? formatBtc(sats) : formatSats(sats);
  return (
    <div className="selectable">
      <div className="tabular text-2xl font-semibold leading-[1.1] tracking-[-0.02em] text-text">
        {masked ? MASKED : primary}
        {unit === "btc" && (
          <span className="ml-1.5 font-ui text-[13px] font-normal text-muted">BTC</span>
        )}
      </div>
      {fiat && <div className="mt-1.5 tabular text-[13px] text-muted">{fiat}</div>}
    </div>
  );
}

/** Signed list amount with an optional fiat subline. Direction is also
    carried by icon and sign elsewhere in the row. */
export function ListAmount({ sats, pending }: { sats: number; pending?: boolean }) {
  const { masked, unit } = useUi();
  const fiat = useFiatValue(sats);
  return (
    <span className="inline-flex flex-col items-end">
      <span
        className={clsx(
          "tabular text-[13px] font-medium",
          sats > 0 && !pending ? "text-confirmed" : "text-text",
        )}
      >
        {masked ? MASKED : formatAmountSigned(sats, unit)}
      </span>
      {fiat && <span className="tabular text-[11px] text-muted">{fiat}</span>}
    </span>
  );
}

/** Unsigned amount stacked over its fiat value, for table cells: the
    amount never wraps, the fiat line carries the small print. */
export function StackedAmount({ sats }: { sats: number }) {
  const { masked, unit } = useUi();
  const fiat = useFiatValue(sats);
  return (
    <span className="inline-flex flex-col items-end">
      <span className="selectable whitespace-nowrap tabular text-[13px] font-medium text-text">
        {masked ? MASKED : formatAmount(sats, unit)}
      </span>
      {fiat && (
        <span className="whitespace-nowrap tabular text-[11px] text-muted">{fiat}</span>
      )}
    </span>
  );
}

/** Inline amount for detail views: primary unit, fiat optional. */
export function InlineAmount({ sats, withFiat = true }: { sats: number; withFiat?: boolean }) {
  const { masked, unit } = useUi();
  const fiat = useFiatValue(sats);
  if (masked) return <span className="tabular text-[13px] text-text">{MASKED}</span>;
  return (
    <span className="selectable tabular text-[13px] text-text">
      {formatAmount(sats, unit)}
      {withFiat && fiat && <span className="text-muted"> · {fiat}</span>}
    </span>
  );
}
