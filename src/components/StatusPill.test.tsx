import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RowStatus } from "./StatusPill";

const CONFIRMED = { state: "confirmed" as const, height: 200_000, timestamp: 1_700_000_000 };

describe("RowStatus", () => {
  /** Colour is for what still moves: a row six blocks deep keeps its
      check and its word, without the pill. */
  it("marks a settled row with a check and no pill", () => {
    render(<RowStatus status={CONFIRMED} confirmations={6} />);
    const word = screen.getByText("Confirmed");
    expect(word.closest("[data-tone]")).toBe(null);
    expect(word.parentElement?.querySelector("[data-glyph='check']")).not.toBe(null);
    expect(word.parentElement).toHaveAttribute("title", "Confirmed");
  });

  /** The hidden word is placed from its own mark, not from the page:
      below the fold of a card that scrolls, it would stretch the page. */
  it("keeps the hidden word inside its mark", () => {
    render(<RowStatus status={CONFIRMED} confirmations={6} />);
    const word = screen.getByText("Confirmed");
    expect(word).toHaveClass("sr-only");
    expect(word.parentElement).toHaveClass("relative");
  });

  it("counts the confirmations in a pill on the way to six", () => {
    render(<RowStatus status={CONFIRMED} confirmations={3} />);
    expect(screen.getByText("3 conf")).toHaveAttribute("data-tone", "confirmed");
  });

  it("keeps the pill for a row that waits", () => {
    render(<RowStatus status={{ state: "pending" }} confirmations={0} />);
    expect(screen.getByText("Pending")).toHaveAttribute("data-tone", "pending");
  });

  /** A coin carries no count: confirmed, it is settled for the list. */
  it("takes a confirmed row without a count as settled", () => {
    render(<RowStatus status={CONFIRMED} />);
    expect(screen.getByText("Confirmed").closest("[data-tone]")).toBe(null);
  });
});
