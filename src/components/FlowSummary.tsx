import { ArrowRight, Pickaxe } from "lucide-react";
import type { TxIo } from "../lib/ipc";
import { MASKED, formatAmount, truncateMiddle } from "../lib/format";
import { useUi } from "../state/store";

/** Preview text for an OP_RETURN payload: the recognized protocol name
    when there is one, then decoded text, then a short hex excerpt. */
export function opReturnPreview(data: {
  hex: string;
  text: string | null;
  label: string | null;
}): string {
  if (data.label) return data.label;
  if (data.text) return truncateMiddle(data.text, 22, 6);
  return truncateMiddle(data.hex, 12, 6);
}

function sum(ios: TxIo[]): number | null {
  let total = 0;
  for (const io of ios) {
    if (io.value_sats === null) return null;
    total += io.value_sats;
  }
  return total;
}

/** The transaction in one line: what went in, what came out, and the
    fee between the two. Counts and totals only — the input and output
    lists below carry the detail. */
export function FlowSummary({
  inputs,
  outputs,
  feeSats,
  feeRate,
  isCoinbase = false,
  coinbasePool = null,
}: {
  inputs: TxIo[];
  outputs: TxIo[];
  feeSats: number | null;
  feeRate: number | null;
  isCoinbase?: boolean;
  coinbasePool?: string | null;
}) {
  const { masked, unit } = useUi();
  const outTotal = sum(outputs);
  // A coinbase input spends nothing: what it creates is the reward.
  const inTotal = isCoinbase ? outTotal : sum(inputs);
  const amount = (sats: number | null) =>
    sats === null ? "n/a" : masked ? MASKED : formatAmount(sats, unit);

  return (
    <div className="flex items-stretch gap-3 rounded-lg bg-sunken/40 p-4 max-lg:flex-col">
      <Side
        title={isCoinbase ? "Coinbase" : `${inputs.length} input${inputs.length === 1 ? "" : "s"}`}
        subtitle={isCoinbase ? (coinbasePool ? `Newly minted · ${coinbasePool}` : "Newly minted coins") : "spent"}
        amount={amount(inTotal)}
        icon={isCoinbase ? <Pickaxe size={14} strokeWidth={1.75} aria-hidden /> : undefined}
      />
      <div className="flex shrink-0 flex-col items-center justify-center gap-1 px-2 max-lg:rotate-90 max-lg:py-1">
        <ArrowRight size={20} strokeWidth={1.5} aria-hidden className="text-muted" />
        {feeSats !== null && feeSats > 0 && (
          <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap rounded-full border border-pending/30 bg-pending-surface px-2.5 py-0.5 max-lg:hidden">
            <span className="font-ui text-[10px] font-medium uppercase tracking-[0.04em] text-pending">
              fee
            </span>
            <span className="tabular text-[11px] font-medium text-pending">
              {masked ? MASKED : formatAmount(feeSats, unit)}
            </span>
            {feeRate !== null && (
              <span className="tabular text-[11px] text-muted">{feeRate.toFixed(1)} sat/vB</span>
            )}
          </span>
        )}
      </div>
      <Side
        title={`${outputs.length} output${outputs.length === 1 ? "" : "s"}`}
        subtitle="created"
        amount={amount(outTotal)}
      />
    </div>
  );
}

function Side({
  title,
  subtitle,
  amount,
  icon,
}: {
  title: string;
  subtitle: string;
  amount: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center rounded-md border border-border bg-surface px-4 py-3">
      <p className="flex items-center gap-1.5 font-ui text-sm font-medium text-text">
        {icon && <span className="text-muted">{icon}</span>}
        {title}
        <span className="font-normal text-muted">{subtitle}</span>
      </p>
      <p className="selectable tabular mt-1 text-[15px] font-semibold text-text">{amount}</p>
    </div>
  );
}
