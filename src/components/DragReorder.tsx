import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { moveItem } from "../lib/reorder";

/** A drag in progress: the row picked up, how far it has moved, and
    the index it would take if let go now. */
interface Drag {
  from: number;
  to: number;
  dy: number;
}

/** A row's vertical extent, relative to the top of the list. */
interface Span {
  top: number;
  bottom: number;
}

export interface DragReorder {
  /** The row being dragged, null at rest. */
  dragging: number | null;
  /** Where the drop line sits, in px from the top of the list; null
      when the row would land where it already is. */
  lineY: number | null;
  /** Goes on the list element. */
  listRef: (node: HTMLElement | null) => void;
  /** Goes on every row: marks it for measuring and moves the dragged
      one with the pointer. */
  rowProps: (index: number) => { "data-reorder-row": ""; style: CSSProperties | undefined };
  /** Goes on the grip of every row. Pointer only: the keyboard has its
      own controls beside the row. */
  handleProps: (index: number) => {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    style: CSSProperties;
  };
}

/**
 * Reorders a vertical list by dragging a row from its grip: the row
 * follows the pointer, a line shows where it will land, letting go
 * hands the new order to `onReorder`, Escape puts it back. Nothing
 * else moves while dragging; the parent swaps the order afterwards.
 *
 * Row spans are measured once, when the pointer goes down: the list
 * does not change under a drag, and reading layout on every move is
 * what makes a drag stutter.
 */
export function useDragReorder<T>(items: T[], onReorder: (next: T[]) => void): DragReorder {
  const list = useRef<HTMLElement | null>(null);
  const spans = useRef<Span[]>([]);
  const startY = useRef(0);
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  const listRef = useCallback((node: HTMLElement | null) => {
    list.current = node;
  }, []);

  const update = (next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  // Spans are taken in the list's content coordinates, so a list that
  // scrolls (the switcher menu) still places the line beside its rows.
  const measure = (): Span[] => {
    const node = list.current;
    if (!node) return [];
    const origin = node.getBoundingClientRect().top - node.scrollTop;
    return [...node.querySelectorAll<HTMLElement>("[data-reorder-row]")].map((row) => {
      const rect = row.getBoundingClientRect();
      return { top: rect.top - origin, bottom: rect.bottom - origin };
    });
  };

  /** The index the dragged row takes: how many other rows have their
      middle above its own. */
  const landing = (from: number, dy: number): number => {
    const own = spans.current[from];
    if (!own) return from;
    const middle = (own.top + own.bottom) / 2 + dy;
    return spans.current.filter(
      (span, index) => index !== from && (span.top + span.bottom) / 2 < middle,
    ).length;
  };

  const finish = (commit: boolean) => {
    const current = dragRef.current;
    if (!current) return;
    update(null);
    document.body.style.cursor = "";
    if (commit && current.to !== current.from) {
      onReorderRef.current(moveItem(itemsRef.current, current.from, current.to));
    }
  };

  // Escape lets go of the row where it was. Heard on the window, ahead
  // of everything else: a menu holding the list listens for Escape on
  // the document, and while a drag is on, the key is the drag's alone.
  const active = drag !== null;
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        finish(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // `finish` reads refs only, so the one captured here stays right.
  }, [active]);

  const lineY = (() => {
    if (!drag || drag.to === drag.from) return null;
    const others = spans.current.filter((_, index) => index !== drag.from);
    const before = others[drag.to - 1];
    const after = others[drag.to];
    // Between two rows the line splits their gap; past either end it
    // keeps the same distance from the last row.
    const gap = others.length > 1 ? others[1].top - others[0].bottom : 0;
    if (before && after) return (before.bottom + after.top) / 2;
    if (before) return before.bottom + gap / 2;
    if (after) return after.top - gap / 2;
    return null;
  })();

  return {
    dragging: drag?.from ?? null,
    lineY,
    listRef,
    rowProps: (index) => ({
      "data-reorder-row": "",
      style:
        drag && drag.from === index ? { transform: `translateY(${drag.dy}px)` } : undefined,
    }),
    handleProps: (index) => ({
      onPointerDown: (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        spans.current = measure();
        startY.current = event.clientY;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        document.body.style.cursor = "grabbing";
        update({ from: index, to: index, dy: 0 });
      },
      onPointerMove: (event) => {
        const current = dragRef.current;
        if (!current || current.from !== index) return;
        const dy = event.clientY - startY.current;
        update({ ...current, dy, to: landing(current.from, dy) });
      },
      onPointerUp: () => finish(true),
      onPointerCancel: () => finish(false),
      style: { touchAction: "none" },
    }),
  };
}

/** The line a dragged row will land on: two pixels of Glacier across
    the list, sliding between rows. Nothing when the row would stay. */
export function DropLine({ y }: { y: number | null }) {
  if (y === null) return null;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-0.5 rounded-full bg-primary motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out"
      style={{ transform: `translateY(${y - 1}px)` }}
    />
  );
}
