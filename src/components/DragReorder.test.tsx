import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DropLine, useDragReorder } from "./DragReorder";

const ITEMS = ["a", "b", "c"];

/** Three rows of 40px with an 8px gap, the way the settings list lays
    them out; jsdom measures nothing, so the geometry is declared. */
const SPANS: Record<string, [number, number]> = {
  list: [0, 136],
  "row-a": [0, 40],
  "row-b": [48, 88],
  "row-c": [96, 136],
};

function Harness({ onReorder }: { onReorder: (next: string[]) => void }) {
  const drag = useDragReorder(ITEMS, onReorder);
  return (
    <ul ref={drag.listRef} data-testid="list" className="relative">
      {ITEMS.map((item, index) => (
        <li
          key={item}
          {...drag.rowProps(index)}
          data-testid={`row-${item}`}
          data-dragging={drag.dragging === index || undefined}
        >
          <span data-testid={`grip-${item}`} {...drag.handleProps(index)} />
          {item}
        </li>
      ))}
      <DropLine y={drag.lineY} />
    </ul>
  );
}

function mockGeometry() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const [top, bottom] = SPANS[this.dataset.testid ?? ""] ?? [0, 0];
    return { top, bottom, height: bottom - top, left: 0, right: 0, width: 0, x: 0, y: top } as DOMRect;
  });
}

function line(): HTMLElement | null {
  return screen.getByTestId("list").querySelector("span[aria-hidden]");
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.style.cursor = "";
});

describe("dragging a row", () => {
  it("follows the pointer, shows where the row lands, and hands over the new order", () => {
    mockGeometry();
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    const grip = screen.getByTestId("grip-a");

    fireEvent.pointerDown(grip, { button: 0, clientY: 20 });
    expect(screen.getByTestId("row-a")).toHaveAttribute("data-dragging", "true");
    expect(document.body.style.cursor).toBe("grabbing");
    // Not moved yet: no line, the row would stay.
    expect(line()).toBeNull();

    // 80px down: the row's middle passes b's, not c's.
    fireEvent.pointerMove(grip, { clientY: 100 });
    expect(screen.getByTestId("row-a").style.transform).toBe("translateY(80px)");
    // The line splits the gap between b and c: (88 + 96) / 2, minus
    // half its own height.
    expect(line()?.style.transform).toBe("translateY(91px)");

    fireEvent.pointerUp(grip);
    expect(onReorder).toHaveBeenCalledWith(["b", "a", "c"]);
    expect(screen.getByTestId("row-a")).not.toHaveAttribute("data-dragging");
    expect(document.body.style.cursor).toBe("");
  });

  it("puts a row down where it was without a word", () => {
    mockGeometry();
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    const grip = screen.getByTestId("grip-b");
    fireEvent.pointerDown(grip, { button: 0, clientY: 60 });
    fireEvent.pointerMove(grip, { clientY: 70 });
    expect(line()).toBeNull();
    fireEvent.pointerUp(grip);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("lets go on Escape", () => {
    mockGeometry();
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    const grip = screen.getByTestId("grip-c");
    fireEvent.pointerDown(grip, { button: 0, clientY: 116 });
    fireEvent.pointerMove(grip, { clientY: 10 });
    expect(line()?.style.transform).toBe("translateY(-5px)");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(line()).toBeNull();
    expect(screen.getByTestId("row-c")).not.toHaveAttribute("data-dragging");
    fireEvent.pointerUp(grip);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("ignores any button but the main one", () => {
    mockGeometry();
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    const grip = screen.getByTestId("grip-a");
    fireEvent.pointerDown(grip, { button: 2, clientY: 20 });
    expect(screen.getByTestId("row-a")).not.toHaveAttribute("data-dragging");
    fireEvent.pointerMove(grip, { clientY: 100 });
    fireEvent.pointerUp(grip);
    expect(onReorder).not.toHaveBeenCalled();
  });
});
