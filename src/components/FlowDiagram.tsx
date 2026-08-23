import { useMemo } from "react";
import { clsx } from "clsx";
import {
  ArrowDownLeft,
  Pickaxe,
  ScrollText,
  Undo2,
  Wallet,
} from "lucide-react";
import type { TxIo } from "../lib/ipc";
import { MASKED, formatAmount, truncateMiddle } from "../lib/format";
import { useUi } from "../state/store";
import { AddressChip } from "./AddressChip";
import { InlineAmount } from "./Amount";

/** Vertical pitch of one input/output lane. */
const ROW = 52;
/** Height of one lane card. */
const CARD_H = 40;
/** Width of the SVG strip carrying the links and the TX block. */
const MID = 170;
/** Lanes shown per side before aggregation into a "+N more" lane. */
const MAX_LANES = 7;
/** TX block size. */
const NODE_W = 44;
/** Extra SVG height under the lanes for the fee branch. */
const FEE_DROP = 44;

type LaneRole = "mine-in" | "external-in" | "coinbase" | "receive" | "change" | "external-out" | "op-return" | "more";

interface Lane {
  role: LaneRole;
  label: string | null;
  valueSats: number | null;
  /** Aggregated remainder lane ("+N more"). */
  more: number;
  /** OP_RETURN preview: decoded text, or hex. */
  preview: string | null;
}

function toLanes(ios: TxIo[], side: "in" | "out", coinbase: boolean): Lane[] {
  const lane = (io: TxIo): Lane => {
    if (side === "in") {
      return {
        role: coinbase ? "coinbase" : io.is_mine ? "mine-in" : "external-in",
        label: io.address,
        valueSats: io.value_sats,
        more: 0,
        preview: null,
      };
    }
    if (io.op_return) {
      return {
        role: "op-return",
        label: null,
        valueSats: null,
        more: 0,
        preview: io.op_return.text ?? io.op_return.hex,
      };
    }
    return {
      role: io.is_mine ? (io.change ? "change" : "receive") : "external-out",
      label: io.address,
      valueSats: io.value_sats,
      more: 0,
      preview: null,
    };
  };
  if (ios.length <= MAX_LANES) return ios.map(lane);
  const shown = ios.slice(0, MAX_LANES - 1).map(lane);
  const rest = ios.slice(MAX_LANES - 1);
  const restValue = rest.reduce<number | null>(
    (sum, io) => (sum === null || io.value_sats === null ? null : sum + io.value_sats),
    0,
  );
  return [
    ...shown,
    { role: "more", label: null, valueSats: restValue, more: rest.length, preview: null },
  ];
}

function laneStroke(role: LaneRole): { stroke: string; opacity: number } {
  switch (role) {
    case "mine-in":
    case "receive":
    case "change":
      return { stroke: "var(--color-primary)", opacity: 0.9 };
    case "op-return":
      return { stroke: "var(--color-pending)", opacity: 0.6 };
    default:
      return { stroke: "var(--color-muted)", opacity: 0.45 };
  }
}

/** Symmetric cubic between two points: control points at 45% and 55%. */
function link(x0: number, y0: number, x1: number, y1: number): string {
  const c1 = x0 + (x1 - x0) * 0.45;
  const c2 = x0 + (x1 - x0) * 0.55;
  return `M ${x0} ${y0} C ${c1} ${y0}, ${c2} ${y1}, ${x1} ${y1}`;
}

/** Transaction flow: every input line converges on a central TX block
    and every output line leaves it, mirrored and evenly spaced. Wallet
    lanes carry the accent color and a role icon; the fee drips from the
    block down to its pill. Pure geometry, nothing measured. */
export function FlowDiagram({
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
  const geometry = useMemo(() => {
    const inLanes = toLanes(inputs, "in", isCoinbase);
    const outLanes = toLanes(outputs, "out", false);
    const laneCount = Math.max(inLanes.length, outLanes.length, 1);
    const height = laneCount * ROW;
    const nodeH = Math.min(
      Math.max(NODE_W, 12 * Math.max(inLanes.length, outLanes.length) + 16),
      Math.max(NODE_W, height - 8),
    );
    const nodeTop = (height - nodeH) / 2;
    const laneY = (index: number, count: number) =>
      (height - count * ROW) / 2 + index * ROW + ROW / 2;
    // Anchors spread evenly inside the block edge, mirrored per side.
    const anchorY = (index: number, count: number) =>
      nodeTop + (nodeH * (index + 1)) / (count + 1);
    return { inLanes, outLanes, height, nodeH, nodeTop, laneY, anchorY };
  }, [inputs, outputs, isCoinbase]);

  const { inLanes, outLanes, height, nodeH, nodeTop, laneY, anchorY } = geometry;
  const showFee = feeSats !== null && feeSats > 0;
  const svgHeight = height + (showFee ? FEE_DROP : 0);
  const cx = MID / 2;

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-background p-5">
      <div className="flex min-w-[720px] items-stretch">
        <LaneColumn
          lanes={inLanes}
          side="in"
          laneY={(index) => laneY(index, inLanes.length)}
          height={height}
          coinbasePool={coinbasePool}
        />
        <svg
          width={MID}
          height={svgHeight}
          viewBox={`0 0 ${MID} ${svgHeight}`}
          className="shrink-0"
          aria-hidden
        >
          {inLanes.map((lane, index) => {
            const { stroke, opacity } = laneStroke(lane.role);
            return (
              <path
                key={`in-${index}`}
                d={link(
                  0,
                  laneY(index, inLanes.length),
                  cx - NODE_W / 2,
                  anchorY(index, inLanes.length),
                )}
                fill="none"
                stroke={stroke}
                strokeOpacity={opacity}
                strokeWidth={2}
                strokeLinecap="round"
              />
            );
          })}
          {outLanes.map((lane, index) => {
            const { stroke, opacity } = laneStroke(lane.role);
            return (
              <path
                key={`out-${index}`}
                d={link(
                  cx + NODE_W / 2,
                  anchorY(index, outLanes.length),
                  MID,
                  laneY(index, outLanes.length),
                )}
                fill="none"
                stroke={stroke}
                strokeOpacity={opacity}
                strokeWidth={2}
                strokeLinecap="round"
              />
            );
          })}
          {showFee && (
            <line
              x1={cx}
              y1={nodeTop + nodeH}
              x2={cx}
              y2={svgHeight}
              stroke="var(--color-pending)"
              strokeOpacity={0.7}
              strokeWidth={2}
              strokeLinecap="round"
              strokeDasharray="1 6"
            />
          )}
          {/* The TX block: everything meets here. */}
          <rect
            x={cx - NODE_W / 2}
            y={nodeTop}
            width={NODE_W}
            height={nodeH}
            rx={10}
            fill="var(--color-surface)"
            stroke="var(--color-border)"
            strokeWidth={1}
          />
          <text
            x={cx}
            y={nodeTop + nodeH / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--color-muted)"
            style={{
              font: "500 12px var(--font-data)",
              letterSpacing: "0.08em",
            }}
          >
            TX
          </text>
        </svg>
        <LaneColumn
          lanes={outLanes}
          side="out"
          laneY={(index) => laneY(index, outLanes.length)}
          height={height}
          coinbasePool={null}
        />
      </div>
      {showFee && (
        <div className="-mt-0.5 flex">
          <div className="flex-1" />
          <div className="flex w-[170px] justify-center">
            <FeePill feeSats={feeSats} feeRate={feeRate} />
          </div>
          <div className="flex-1" />
        </div>
      )}
    </div>
  );
}

function FeePill({ feeSats, feeRate }: { feeSats: number; feeRate: number | null }) {
  const { masked, unit } = useUi();
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap rounded-full border border-pending/30 bg-pending-surface px-3 py-1">
      <span className="font-ui text-[11px] font-medium uppercase tracking-[0.04em] text-pending">
        fee
      </span>
      <span className="font-data text-xs text-pending">
        {masked ? MASKED : formatAmount(feeSats, unit)}
      </span>
      {feeRate !== null && (
        <span className="font-data text-[11px] text-muted">{feeRate.toFixed(1)} sat/vB</span>
      )}
    </span>
  );
}

const ROLE_ICON: Partial<
  Record<LaneRole, { icon: typeof Wallet; className: string; title: string }>
> = {
  "mine-in": { icon: Wallet, className: "text-primary", title: "Spent from this wallet" },
  receive: { icon: ArrowDownLeft, className: "text-primary", title: "Received by this wallet" },
  change: { icon: Undo2, className: "text-primary", title: "Change back to this wallet" },
  coinbase: { icon: Pickaxe, className: "text-muted", title: "Newly minted coins" },
  "op-return": { icon: ScrollText, className: "text-pending", title: "Data output" },
};

function LaneColumn({
  lanes,
  side,
  laneY,
  height,
  coinbasePool,
}: {
  lanes: Lane[];
  side: "in" | "out";
  laneY: (index: number) => number;
  height: number;
  coinbasePool: string | null;
}) {
  return (
    <div className="relative min-w-0 flex-1" style={{ height }}>
      {lanes.map((lane, index) => {
        const mine = lane.role === "mine-in" || lane.role === "receive" || lane.role === "change";
        const iconSpec = ROLE_ICON[lane.role];
        return (
          <div
            key={index}
            className={clsx(
              "absolute flex w-full -translate-y-1/2 items-center gap-2 rounded-md border px-2.5",
              side === "in" ? "justify-end" : "justify-start",
              lane.role === "more"
                ? "border-dashed border-border bg-transparent"
                : mine
                  ? "border-primary/40 bg-primary/[0.05]"
                  : lane.role === "op-return"
                    ? "border-pending/30 bg-pending-surface"
                    : "border-border bg-surface",
            )}
            style={{ top: laneY(index), height: CARD_H }}
          >
            {iconSpec && (
              <span title={iconSpec.title} className={clsx("shrink-0", iconSpec.className)}>
                <iconSpec.icon size={14} strokeWidth={1.75} aria-hidden />
              </span>
            )}
            {lane.role === "more" ? (
              <span className="font-ui text-xs text-muted">
                +{lane.more} more {side === "in" ? "inputs" : "outputs"}
              </span>
            ) : lane.role === "op-return" ? (
              <>
                <span className="shrink-0 font-data text-xs text-pending">OP_RETURN</span>
                {lane.preview && (
                  <span className="min-w-0 truncate font-data text-[11px] text-muted">
                    {lane.preview}
                  </span>
                )}
              </>
            ) : lane.role === "coinbase" ? (
              <span className="font-data text-[13px] text-muted">
                coinbase{coinbasePool ? ` · ${coinbasePool}` : ""}
              </span>
            ) : lane.label ? (
              <AddressChip value={lane.label} />
            ) : (
              <span className="font-data text-[13px] text-muted">
                {side === "in" ? "unknown input" : "script output"}
              </span>
            )}
            {lane.valueSats !== null && lane.role !== "op-return" && (
              <span className="ml-auto whitespace-nowrap pl-1">
                <InlineAmount sats={lane.valueSats} withFiat={false} />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Preview text used by the outputs table for OP_RETURN rows. */
export function opReturnPreview(data: { hex: string; text: string | null }): string {
  return data.text ?? truncateMiddle(data.hex, 18, 8);
}
