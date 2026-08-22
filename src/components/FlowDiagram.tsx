import { useMemo } from "react";
import { clsx } from "clsx";
import type { TxIo } from "../lib/ipc";
import { MASKED, formatAmount } from "../lib/format";
import { useUi } from "../state/store";
import { AddressChip } from "./AddressChip";
import { InlineAmount } from "./Amount";

/** Row height of one input/output lane. */
const ROW = 64;
/** Width of the SVG strip carrying the ribbons and the tx node. */
const MID = 170;
/** Lanes shown per side before aggregation into a "+N more" lane. */
const MAX_LANES = 7;
/** Width of the transaction node capsule. */
const NODE_W = 22;
/** Extra SVG height under the lanes for the fee branch. */
const FEE_DROP = 52;
/** Ribbon thickness bounds; area follows sqrt so small amounts stay visible. */
const MIN_T = 3;
const MAX_T = 24;
/** Vertical gap between ribbon anchors on the node. */
const NODE_GAP = 3;

interface Lane {
  label: string | null;
  valueSats: number | null;
  mine: boolean;
  /** Aggregated remainder lane ("+N more"). */
  more: number;
}

function toLanes(ios: TxIo[]): Lane[] {
  if (ios.length <= MAX_LANES) {
    return ios.map((io) => ({
      label: io.address,
      valueSats: io.value_sats,
      mine: io.is_mine,
      more: 0,
    }));
  }
  const shown = ios.slice(0, MAX_LANES - 1);
  const rest = ios.slice(MAX_LANES - 1);
  const restValue = rest.reduce<number | null>(
    (sum, io) => (sum === null || io.value_sats === null ? null : sum + io.value_sats),
    0,
  );
  return [
    ...shown.map((io) => ({
      label: io.address,
      valueSats: io.value_sats,
      mine: io.is_mine,
      more: 0,
    })),
    {
      label: null,
      valueSats: restValue,
      mine: rest.some((io) => io.is_mine),
      more: rest.length,
    },
  ];
}

function thickness(valueSats: number | null, max: number): number {
  if (valueSats === null || max <= 0) return MIN_T;
  return MIN_T + (MAX_T - MIN_T) * Math.sqrt(valueSats / max);
}

/** A constant-thickness ribbon between two anchor points: two mirrored
    cubic curves closed into one filled shape. */
function ribbonPath(x0: number, y0: number, x1: number, y1: number, t: number): string {
  const c1 = x0 + (x1 - x0) * 0.38;
  const c2 = x0 + (x1 - x0) * 0.62;
  const h = t / 2;
  return [
    `M ${x0} ${y0 - h}`,
    `C ${c1} ${y0 - h}, ${c2} ${y1 - h}, ${x1} ${y1 - h}`,
    `L ${x1} ${y1 + h}`,
    `C ${c2} ${y1 + h}, ${c1} ${y0 + h}, ${x0} ${y0 + h}`,
    "Z",
  ].join(" ");
}

/** Transaction flow in the spirit of Sparrow and mempool.space: filled
    ribbons whose thickness follows the amounts converge into the
    transaction node and fan out again; the fee drips below. Pure
    geometry, nothing measured. */
export function FlowDiagram({
  inputs,
  outputs,
  feeSats,
  feeRate,
}: {
  inputs: TxIo[];
  outputs: TxIo[];
  feeSats: number | null;
  feeRate: number | null;
}) {
  const geometry = useMemo(() => {
    const inLanes = toLanes(inputs);
    const outLanes = toLanes(outputs);
    const laneCount = Math.max(inLanes.length, outLanes.length, 1);
    const height = laneCount * ROW;
    const maxValue = Math.max(
      ...inLanes.map((lane) => lane.valueSats ?? 0),
      ...outLanes.map((lane) => lane.valueSats ?? 0),
      0,
    );
    const tIn = inLanes.map((lane) => thickness(lane.valueSats, maxValue));
    const tOut = outLanes.map((lane) => thickness(lane.valueSats, maxValue));
    const stackIn =
      tIn.reduce((sum, t) => sum + t, 0) + Math.max(0, tIn.length - 1) * NODE_GAP;
    const stackOut =
      tOut.reduce((sum, t) => sum + t, 0) + Math.max(0, tOut.length - 1) * NODE_GAP;
    const nodeH = Math.max(48, Math.max(stackIn, stackOut) + 18);
    const nodeTop = (height - nodeH) / 2;
    // Ribbon anchors stack on the node by cumulative thickness, so
    // ribbons meet the capsule without overlapping: the Sankey look.
    const anchors = (ts: number[], stack: number) => {
      let cursor = nodeTop + (nodeH - stack) / 2;
      return ts.map((t) => {
        const y = cursor + t / 2;
        cursor += t + NODE_GAP;
        return y;
      });
    };
    const laneY = (index: number, count: number) =>
      (height - count * ROW) / 2 + index * ROW + ROW / 2;
    return {
      inLanes,
      outLanes,
      height,
      tIn,
      tOut,
      nodeH,
      nodeTop,
      anchorIn: anchors(tIn, stackIn),
      anchorOut: anchors(tOut, stackOut),
      laneY,
    };
  }, [inputs, outputs]);

  const { inLanes, outLanes, height, tIn, tOut, nodeH, nodeTop, anchorIn, anchorOut, laneY } =
    geometry;
  const showFee = feeSats !== null && feeSats > 0;
  const svgHeight = height + (showFee ? FEE_DROP : 0);
  const nodeX = MID / 2;

  return (
    <div className="rounded-lg border border-border bg-background p-5">
      <div className="flex items-stretch">
        <LaneColumn
          lanes={inLanes}
          side="in"
          laneY={(index) => laneY(index, inLanes.length)}
          height={height}
        />
        <svg
          width={MID}
          height={svgHeight}
          viewBox={`0 0 ${MID} ${svgHeight}`}
          className="shrink-0"
          aria-hidden
        >
          {inLanes.map((lane, index) => (
            <path
              key={`in-${index}`}
              d={ribbonPath(
                0,
                laneY(index, inLanes.length),
                nodeX - NODE_W / 2 + 2,
                anchorIn[index],
                tIn[index],
              )}
              fill={lane.mine ? "var(--color-primary)" : "var(--color-muted)"}
              fillOpacity={lane.mine ? 0.5 : 0.18}
            />
          ))}
          {outLanes.map((lane, index) => (
            <path
              key={`out-${index}`}
              d={ribbonPath(
                nodeX + NODE_W / 2 - 2,
                anchorOut[index],
                MID,
                laneY(index, outLanes.length),
                tOut[index],
              )}
              fill={lane.mine ? "var(--color-primary)" : "var(--color-muted)"}
              fillOpacity={lane.mine ? 0.5 : 0.18}
            />
          ))}
          {showFee && (
            <path
              d={`M ${nodeX} ${nodeTop + nodeH - 1} C ${nodeX} ${height + 14}, ${nodeX} ${height + 18}, ${nodeX} ${height + FEE_DROP - 14}`}
              fill="none"
              stroke="var(--color-pending)"
              strokeOpacity={0.7}
              strokeWidth={2}
              strokeLinecap="round"
              strokeDasharray="1 6"
            />
          )}
          {/* The transaction node capsule. */}
          <rect
            x={nodeX - NODE_W / 2}
            y={nodeTop}
            width={NODE_W}
            height={nodeH}
            rx={NODE_W / 2}
            fill="var(--color-sunken)"
            stroke="var(--color-border)"
            strokeWidth={1}
          />
        </svg>
        <LaneColumn
          lanes={outLanes}
          side="out"
          laneY={(index) => laneY(index, outLanes.length)}
          height={height}
        />
      </div>
      {showFee && (
        <div className="flex">
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

function LaneColumn({
  lanes,
  side,
  laneY,
  height,
}: {
  lanes: Lane[];
  side: "in" | "out";
  laneY: (index: number) => number;
  height: number;
}) {
  return (
    <div className="relative min-w-0 flex-1" style={{ height }}>
      {lanes.map((lane, index) => (
        <div
          key={index}
          className={clsx(
            "absolute flex h-[52px] w-full -translate-y-1/2 flex-col justify-center gap-0.5 rounded-md border px-2.5",
            side === "in" ? "items-end text-right" : "items-start",
            lane.more > 0
              ? "border-dashed border-border bg-transparent"
              : lane.mine
                ? "border-primary/40 bg-primary/[0.05]"
                : "border-border bg-surface",
          )}
          style={{ top: laneY(index) }}
        >
          {lane.more > 0 ? (
            <span className="font-ui text-xs text-muted">
              +{lane.more} more {side === "in" ? "inputs" : "outputs"}
            </span>
          ) : lane.label ? (
            <AddressChip value={lane.label} />
          ) : (
            <span className="font-data text-[13px] text-muted">
              {side === "in" ? "coinbase" : "script output"}
            </span>
          )}
          {lane.valueSats !== null && (
            <span className="whitespace-nowrap">
              <InlineAmount sats={lane.valueSats} withFiat={false} />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
