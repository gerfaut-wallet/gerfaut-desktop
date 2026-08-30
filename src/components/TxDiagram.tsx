import {
  ArrowDownLeft,
  ArrowUpRight,
  Ellipsis,
  Pickaxe,
  ScrollText,
  Undo2,
  Wallet as WalletIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Ref, ReactNode } from "react";
import { clsx } from "clsx";
import { MASKED, formatAmount, truncateMiddle } from "../lib/format";
import { useUi } from "../state/store";

/** What a branch is to the watched wallet. The same vocabulary — and
    the same icons — as the input and output lists below the diagram: a
    diagram and a list that name the same thing two ways have to be
    learned twice. */
export type BranchRole =
  | "wallet-in"
  | "external-in"
  | "coinbase"
  | "change"
  | "received"
  | "external-out"
  | "op-return";

export interface TxBranch {
  role: BranchRole;
  /** Outpoint for an input, address for an output, in full: only the
      diagram knows the width it was given, so it truncates itself. */
  label: string;
  /** Sats, null when nobody could tell us the value — an input whose
      previous output the backend never resolved. */
  amount: number | null;
  /** Touches the watched wallet: the box and its connector take the
      accent. */
  isMine: boolean;
}

type Side = "inputs" | "outputs";

/** Rows per side before the rest folds into one. Past this a diagram
    stops being a diagram; the complete lists sit right below it. The
    phone keeps five — half the height for half the width. */
const MAX_ROWS = 10;
/** Below this width the truncations shorten instead of overflowing. */
const COMPACT_WIDTH = 620;

const ICON = { size: 14, strokeWidth: 1.5, "aria-hidden": true } as const;

const ROLES: Record<BranchRole, { title: string; tone: string; icon: ReactNode }> = {
  "wallet-in": {
    title: "Spent from this wallet",
    tone: "text-primary",
    icon: <WalletIcon {...ICON} />,
  },
  "external-in": { title: "External input", tone: "text-muted", icon: <ArrowUpRight {...ICON} /> },
  coinbase: { title: "Newly minted coins", tone: "text-muted", icon: <Pickaxe {...ICON} /> },
  change: { title: "Change back to this wallet", tone: "text-primary", icon: <Undo2 {...ICON} /> },
  received: {
    title: "Received by this wallet",
    tone: "text-primary",
    icon: <ArrowDownLeft {...ICON} />,
  },
  "external-out": { title: "External output", tone: "text-muted", icon: <ArrowUpRight {...ICON} /> },
  "op-return": { title: "Data output", tone: "text-pending", icon: <ScrollText {...ICON} /> },
};

type Row =
  | { kind: "branch"; branch: TxBranch }
  | { kind: "more"; count: number; amount: number | null; isMine: boolean; side: Side };

/** The rows one side actually draws: everything past the cap collapses
    into a single row carrying the count and the sum it stands for. It
    names its own side — read alone, halfway down a diagram, `+7 more`
    does not say more of what. */
function fold(branches: TxBranch[], side: Side): Row[] {
  if (branches.length <= MAX_ROWS) {
    return branches.map((branch) => ({ kind: "branch", branch }));
  }
  const rest = branches.slice(MAX_ROWS - 1);
  // One unknown value poisons the sum: better no figure than a wrong one.
  const amount = rest.some((branch) => branch.amount === null)
    ? null
    : rest.reduce((total, branch) => total + (branch.amount ?? 0), 0);
  return [
    ...branches.slice(0, MAX_ROWS - 1).map((branch): Row => ({ kind: "branch", branch })),
    { kind: "more", count: rest.length, amount, isMine: rest.some((b) => b.isMine), side },
  ];
}

function rowAmount(row: Row): number | null {
  return row.kind === "branch" ? row.branch.amount : row.amount;
}

function rowIsMine(row: Row): boolean {
  return row.kind === "branch" ? row.branch.isMine : row.isMine;
}

/** An outpoint keeps its index: `a1b2c3d4...9fz:0`. Two inputs can carry
    the same address, never the same outpoint, so the index is the half
    that names it. Anything else is truncated in the middle. */
export function shortenBranchLabel(label: string, head: number, tail: number): string {
  const colon = label.lastIndexOf(":");
  const index = label.slice(colon + 1);
  if (colon > 0 && index.length > 0 && /^\d+$/.test(index)) {
    return `${truncateMiddle(label.slice(0, colon), head, tail)}:${index}`;
  }
  return truncateMiddle(label, head, tail);
}

const f = (value: number) => value.toFixed(1);

/** A connector, box edge to box edge. Both control points sit on the
    midline of the span, so the curve leaves and arrives perfectly
    horizontal and turns in one move. Held closer to the ends it grew a
    long flat middle that read as neither a line nor a curve. */
function curve(x0: number, y0: number, x1: number, y1: number): string {
  const width = x1 - x0;
  return `M${f(x0)},${f(y0)} C${f(x0 + width * 0.5)},${f(y0)} ${f(x1 - width * 0.5)},${f(y1)} ${f(x1)},${f(y1)}`;
}

/** The fee leaving the node downward: the same curve turned a quarter,
    vertical where it leaves and where it arrives. */
function drop(x0: number, y0: number, x1: number, y1: number): string {
  const height = y1 - y0;
  return `M${f(x0)},${f(y0)} C${f(x0)},${f(y0 + height * 0.5)} ${f(x1)},${f(y1 - height * 0.5)} ${f(x1)},${f(y1)}`;
}

interface Link {
  d: string;
  mine: boolean;
}

interface Geometry {
  width: number;
  height: number;
  links: Link[];
  fee: string | null;
}

/** Where the coins come from and where they go, which no list shows.
    Three columns — inputs, the transaction, outputs — every branch a
    box, every box joined to the central square by a cubic curve, the
    fee hanging below. The strokes are decorative: each box is real
    text, and the lists below stay the source. */
export function TxDiagram({
  inputs,
  outputs,
  feeSats,
}: {
  inputs: TxBranch[];
  outputs: TxBranch[];
  feeSats: number | null;
}) {
  const frameRef = useRef<HTMLElement>(null);
  const nodeRef = useRef<HTMLDivElement>(null);
  const feeRef = useRef<HTMLDivElement>(null);
  const inRowsRef = useRef<(HTMLLIElement | null)[]>([]);
  const outRowsRef = useRef<(HTMLLIElement | null)[]>([]);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [width, setWidth] = useState(0);

  const inRows = fold(inputs, "inputs");
  const outRows = fold(outputs, "outputs");
  // A zero fee is no branch: nothing left the node downward.
  const fee = feeSats !== null && feeSats > 0 ? feeSats : null;

  // The boxes own their heights; the curves read them back from the DOM
  // rather than repeating a box height the CSS could change tomorrow.
  // That is also what makes them land on the edges at any text scale.
  const measure = () => {
    const frame = frameRef.current;
    const node = nodeRef.current;
    if (!frame || !node) return;
    const origin = frame.getBoundingClientRect();
    const box = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left - origin.left,
        right: rect.right - origin.left,
        top: rect.top - origin.top,
        bottom: rect.bottom - origin.top,
        cx: rect.left + rect.width / 2 - origin.left,
        cy: rect.top + rect.height / 2 - origin.top,
      };
    };

    const nodeBox = box(node);
    const links: Link[] = [];

    inRows.forEach((row, index) => {
      const element = inRowsRef.current[index];
      if (!element) return;
      const from = box(element);
      links.push({ d: curve(from.right, from.cy, nodeBox.left, nodeBox.cy), mine: rowIsMine(row) });
    });

    outRows.forEach((row, index) => {
      const element = outRowsRef.current[index];
      if (!element) return;
      const to = box(element);
      links.push({ d: curve(nodeBox.right, nodeBox.cy, to.left, to.cy), mine: rowIsMine(row) });
    });

    const feeNode = feeRef.current;
    const feePath = feeNode
      ? drop(nodeBox.cx, nodeBox.bottom, box(feeNode).cx, box(feeNode).top)
      : null;

    const next: Geometry = {
      width: origin.width,
      height: origin.height,
      links,
      fee: feePath,
    };
    // Measuring on every render is cheap here; keeping the same object
    // when nothing moved is what stops it from looping.
    setGeometry((previous) =>
      previous && JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
    );
    setWidth((previous) => (previous === origin.width ? previous : origin.width));
  };

  const latest = useRef(measure);
  latest.current = measure;
  useLayoutEffect(() => {
    latest.current();
  });
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(() => latest.current());
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  // Narrow window, shorter ends — never a diagram wider than its page.
  const compact = width !== 0 && width < COMPACT_WIDTH;
  const head = compact ? 6 : 10;
  const tail = compact ? 4 : 6;

  return (
    <section
      ref={frameRef}
      aria-label="Transaction diagram"
      className="relative overflow-hidden rounded-lg bg-sunken/40 px-4 py-5"
    >
      {geometry && (
        <svg
          aria-hidden
          width={geometry.width}
          height={geometry.height}
          className="pointer-events-none absolute inset-0"
        >
          {geometry.links.map((link, index) => (
            <path
              key={`link-${index}`}
              d={link.d}
              fill="none"
              strokeWidth={1.5}
              strokeLinecap="round"
              className={link.mine ? "stroke-primary/55" : "stroke-border"}
            />
          ))}
          {/* What stays behind is nobody's branch: the drop keeps the
              neutral ink even under a wallet the accent runs through. */}
          {geometry.fee !== null && (
            <path
              d={geometry.fee}
              fill="none"
              strokeWidth={1.5}
              strokeLinecap="round"
              className="stroke-border"
            />
          )}
        </svg>
      )}

      {/* 56px of gutter each side of the square: any tighter and the
          bend has no room to turn, which is the whole reading. */}
      <div className="relative flex items-center gap-14">
        <Column
          side="inputs"
          rows={inRows}
          head={head}
          tail={tail}
          rowRef={(index, element) => {
            inRowsRef.current[index] = element;
          }}
        />
        {/* A junction, not a card of facts: the square says where the
            branches meet and nothing else. */}
        <div
          ref={nodeRef}
          className="flex size-11 shrink-0 items-center justify-center rounded-md border border-border bg-surface font-data text-[13px] leading-none text-muted"
        >
          TX
        </div>
        <Column
          side="outputs"
          rows={outRows}
          head={head}
          tail={tail}
          rowRef={(index, element) => {
            outRowsRef.current[index] = element;
          }}
        />
      </div>

      {/* 18px under the columns, which on a one-branch transaction is
          18px under the square itself; taller sides only lengthen the
          drop, and the fee stays where the eye left the node. */}
      {fee !== null && (
        <div className="relative mt-[18px] flex justify-center">
          <FeeNode ref={feeRef} sats={fee} />
        </div>
      )}
    </section>
  );
}

/** One side of the diagram. The boxes stretch to their column, so every
    connector on a side leaves from the same x and the branches read as
    one bundle instead of a fan. */
function Column({
  side,
  rows,
  head,
  tail,
  rowRef,
}: {
  side: Side;
  rows: Row[];
  head: number;
  tail: number;
  rowRef: (index: number, element: HTMLLIElement | null) => void;
}) {
  return (
    <ul
      aria-label={side === "inputs" ? "Inputs" : "Outputs"}
      className="flex min-w-0 flex-1 flex-col gap-2"
    >
      {rows.map((row, index) => (
        <BranchBox
          key={index}
          row={row}
          head={head}
          tail={tail}
          rowRef={(element) => rowRef(index, element)}
        />
      ))}
    </ul>
  );
}

/** The wash a box takes when it touches the watched wallet — the exact
    one the input and output lists below the diagram use, so a branch is
    recognised the same way whichever of the two the eye lands on. */
const boxTone = (mine: boolean) =>
  mine ? "border-primary/40 bg-primary/[0.04]" : "border-border bg-surface";

/** The fee is not an output, it is what stays behind: its own box below
    the transaction, carrying the amount alone — the sat/vB is a fact,
    and repeating it here blurs the reading. No role icon either: a fee
    has no role to name. */
function FeeNode({ ref, sats }: { ref: Ref<HTMLDivElement>; sats: number }) {
  const { masked, unit } = useUi();
  return (
    <div
      ref={ref}
      className={clsx("flex flex-col rounded-md border px-2.5 py-1.5", boxTone(false))}
    >
      <span className="font-ui text-[11px] font-medium uppercase leading-4 tracking-[0.04em] text-muted">
        Fee
      </span>
      <span className="selectable tabular text-[11px] font-medium leading-4 text-text">
        {masked ? MASKED : formatAmount(sats, unit)}
      </span>
    </div>
  );
}

/** One branch of the diagram, as a box: its role as an icon, what names
    it, and what it carries, stacked. The two lines never collapse into
    one — a label and a figure side by side is the list below, and the
    diagram would then be a second, worse copy of it. */
function BranchBox({
  row,
  head,
  tail,
  rowRef,
}: {
  row: Row;
  head: number;
  tail: number;
  rowRef: (element: HTMLLIElement | null) => void;
}) {
  const { masked, unit } = useUi();
  const role = row.kind === "branch" ? ROLES[row.branch.role] : null;
  const amount = rowAmount(row);
  const name = row.kind === "branch" ? row.branch.label : `+${row.count} more ${row.side}`;
  const figure = amount === null ? "n/a" : masked ? MASKED : formatAmount(amount, unit);
  return (
    // The role is carried by an icon, and an icon is nothing to a
    // screen reader: it goes into the box's own name, or the reading is
    // an address and a number with no say in what they are.
    <li
      ref={rowRef}
      aria-label={`${role ? role.title : "Folded rows"}, ${name}, ${figure}`}
      className={clsx(
        "flex items-start gap-2 rounded-md border px-2.5 py-1.5",
        boxTone(rowIsMine(row)),
      )}
    >
      {/* One line high, so the glyph sits on the optical centre of the
          label rather than of the whole box. */}
      <span
        title={role ? role.title : "Folded rows"}
        className={clsx("flex h-4 shrink-0 items-center", role ? role.tone : "text-muted")}
      >
        {role ? role.icon : <Ellipsis {...ICON} />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          title={row.kind === "branch" ? row.branch.label : undefined}
          className={clsx(
            "truncate text-[11px] leading-4 text-muted",
            row.kind === "branch" ? "selectable font-data" : "font-ui font-medium",
          )}
        >
          {row.kind === "branch" ? shortenBranchLabel(row.branch.label, head, tail) : name}
        </span>
        <span className="selectable tabular text-[11px] font-medium leading-4 text-text">
          {figure}
        </span>
      </span>
    </li>
  );
}
