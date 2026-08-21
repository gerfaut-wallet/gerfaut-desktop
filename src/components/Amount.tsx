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

/** Large balance figure: mono, tabular, masked-aware, never animated.
    Primary line follows the unit setting; the second line carries the
    other unit and the fiat value. */
export function Balance({ sats }: { sats: number }) {
  const { masked, unit } = useUi();
  const fiat = useFiatValue(sats);
  const primary = unit === "btc" ? formatBtc(sats) : formatSats(sats);
  const secondary = unit === "btc" ? formatSats(sats) : `${formatBtc(sats)} BTC`;
  return (
    <div className="selectable">
      <div className="font-data text-[32px] font-medium leading-[1.1] tracking-[-0.01em] text-text">
        {masked ? MASKED : primary}
        {unit === "btc" && (
          <span className="ml-2 font-ui text-sm font-normal text-muted">BTC</span>
        )}
      </div>
      <div className="mt-1 font-data text-[13px] text-muted">
        {masked ? MASKED : fiat ? `${secondary} · ${fiat}` : secondary}
      </div>
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
          "font-data text-[13px]",
          sats > 0 && !pending ? "text-confirmed" : "text-text",
        )}
      >
        {masked ? MASKED : formatAmountSigned(sats, unit)}
      </span>
      {fiat && <span className="font-data text-[11px] text-muted">{fiat}</span>}
    </span>
  );
}

/** Inline amount for detail views: primary unit, fiat optional. */
export function InlineAmount({ sats, withFiat = true }: { sats: number; withFiat?: boolean }) {
  const { masked, unit } = useUi();
  const fiat = useFiatValue(sats);
  if (masked) return <span className="font-data text-[13px] text-text">{MASKED}</span>;
  return (
    <span className="selectable font-data text-[13px] text-text">
      {formatAmount(sats, unit)}
      {withFiat && fiat && <span className="text-muted"> · {fiat}</span>}
    </span>
  );
}
