import { useMemo } from "react";
import type { TxIo } from "../lib/ipc";
import { AddressChip } from "./AddressChip";
import { InlineAmount } from "./Amount";

/** Row height of one input/output lane. */
const ROW = 56;
/** Width of the SVG strip carrying the curves and the tx node. */
const MID = 150;
/** Extra height under the lanes for the fee branch. */
const FEE_DROP = 44;
/** Lanes shown per side before aggregation into a "+N more" lane. */
const MAX_LANES = 8;

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

/** Stroke width proportional to the lane's share of the largest value. */
function strokeWidth(valueSats: number | null, max: number): number {
  if (valueSats === null || max <= 0) return 1.5;
  return 1.5 + (valueSats / max) * 7.5;
}

/** Transaction flow: inputs converge into the transaction node, outputs
    fan out, the fee drops below. Curve thickness follows the amounts,
    in the spirit of Sparrow and mempool.space. Pure geometry: the lane
    grid is fixed, so positions are computed, never measured. */
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
    // The node spans the middle of the lane area.
    const nodeHeight = Math.max(40, Math.min(height * 0.6, 160));
    const nodeTop = (height - nodeHeight) / 2;
    const inY = (index: number) =>
      inLanes.length === laneCount
        ? index * ROW + ROW / 2
        : (height - inLanes.length * ROW) / 2 + index * ROW + ROW / 2;
    const outY = (index: number) =>
      outLanes.length === laneCount
        ? index * ROW + ROW / 2
        : (height - outLanes.length * ROW) / 2 + index * ROW + ROW / 2;
    const nodeY = (index: number, count: number) =>
      nodeTop + ((index + 0.5) / count) * nodeHeight;
    return { inLanes, outLanes, height, maxValue, nodeHeight, nodeTop, inY, outY, nodeY };
  }, [inputs, outputs]);

  const { inLanes, outLanes, height, maxValue, nodeHeight, nodeTop, inY, outY, nodeY } =
    geometry;
  const showFee = feeSats !== null && feeSats > 0;
  const svgHeight = height + (showFee ? FEE_DROP : 0);
  const nodeX = MID / 2;

  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="flex">
        <LaneColumn lanes={inLanes} side="in" laneY={inY} height={height} />
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
              d={`M 0 ${inY(index)} C ${MID * 0.3} ${inY(index)}, ${nodeX - 40} ${nodeY(index, inLanes.length)}, ${nodeX - 9} ${nodeY(index, inLanes.length)}`}
              fill="none"
              stroke={lane.mine ? "var(--color-primary)" : "var(--color-border)"}
              strokeOpacity={lane.mine ? 0.75 : 1}
              strokeWidth={strokeWidth(lane.valueSats, maxValue)}
              strokeLinecap="round"
            />
          ))}
          {outLanes.map((lane, index) => (
            <path
              key={`out-${index}`}
              d={`M ${nodeX + 9} ${nodeY(index, outLanes.length)} C ${nodeX + 40} ${nodeY(index, outLanes.length)}, ${MID * 0.7} ${outY(index)}, ${MID} ${outY(index)}`}
              fill="none"
              stroke={lane.mine ? "var(--color-primary)" : "var(--color-border)"}
              strokeOpacity={lane.mine ? 0.75 : 1}
              strokeWidth={strokeWidth(lane.valueSats, maxValue)}
              strokeLinecap="round"
            />
          ))}
          {showFee && (
            <path
              d={`M ${nodeX} ${nodeTop + nodeHeight - 2} C ${nodeX} ${height + 10}, ${nodeX} ${height + 14}, ${nodeX} ${height + FEE_DROP - 18}`}
              fill="none"
              stroke="var(--color-pending)"
              strokeOpacity={0.8}
              strokeWidth={Math.max(1.5, strokeWidth(feeSats, maxValue))}
              strokeLinecap="round"
              strokeDasharray="1 6"
            />
          )}
          {/* The transaction node itself. */}
          <rect
            x={nodeX - 9}
            y={nodeTop}
            width={18}
            height={nodeHeight}
            rx={9}
            fill="var(--color-surface)"
            stroke="var(--color-border)"
            strokeWidth={1}
          />
        </svg>
        <LaneColumn lanes={outLanes} side="out" laneY={outY} height={height} />
      </div>
      {showFee && (
        <p className="mt-1 text-center font-ui text-xs font-medium tracking-wide text-pending">
          Network fee · <InlineAmount sats={feeSats} />
          {feeRate !== null && (
            <span className="text-muted"> ({feeRate.toFixed(1)} sat/vB)</span>
          )}
        </p>
      )}
    </div>
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
          className={`absolute flex w-full -translate-y-1/2 flex-col gap-0.5 ${
            side === "in" ? "items-end pr-2 text-right" : "items-start pl-2"
          }`}
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
          {lane.valueSats !== null && <InlineAmount sats={lane.valueSats} />}
        </div>
      ))}
    </div>
  );
}
