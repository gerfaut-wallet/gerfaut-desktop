import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RowStatus, StatusPill } from "./StatusPill";

const CONFIRMED = { state: "confirmed" as const, height: 200_000, timestamp: 1_700_000_000 };
const PENDING = { state: "pending" as const };

describe("StatusPill", () => {
  /** The eye reads the short count beside the pie; a screen reader
      hears the sentence once, never the short count on top of it. */
  it("counts the confirmations with a pie on the way to six", () => {
    render(
      <button type="button">
        <StatusPill status={CONFIRMED} confirmations={3} />
      </button>,
    );
    expect(screen.getByRole("button", { name: "3 of 6 confirmations" })).toBeInTheDocument();
    const pill = screen.getByTitle("3 of 6 confirmations");
    expect(pill).toHaveAttribute("data-tone", "confirmed");
    expect(pill.querySelector("[data-glyph='pie']")).toHaveAttribute("data-parts", "3");
    expect(pill.querySelector("[data-glyph='check']")).toBe(null);
    expect(screen.getByText("3 conf")).toHaveAttribute("aria-hidden", "true");
  });

  /** The hidden sentence is placed from its pill, not from the page:
      below the fold of a card that scrolls, it would stretch the page. */
  it("keeps the hidden sentence inside its pill", () => {
    render(<StatusPill status={CONFIRMED} confirmations={1} />);
    const spoken = screen.getByText("1 of 6 confirmations");
    expect(spoken).toHaveClass("sr-only");
    expect(spoken.parentElement).toHaveClass("relative");
  });

  it("writes Confirmed with the check from six on", () => {
    render(<StatusPill status={CONFIRMED} confirmations={6} />);
    const pill = screen.getByText("Confirmed");
    expect(pill).toHaveAttribute("data-tone", "confirmed");
    expect(pill.querySelector("[data-glyph='check']")).not.toBe(null);
    expect(pill.querySelector("[data-glyph='pie']")).toBe(null);
  });

  /** A transaction that waits has no block to count: the clock, not an
      empty pie. */
  it("keeps the clock for a transaction that waits", () => {
    render(<StatusPill status={PENDING} confirmations={0} />);
    const pill = screen.getByText("Pending");
    expect(pill).toHaveAttribute("data-tone", "pending");
    expect(pill.querySelector("[data-glyph='clock']")).not.toBe(null);
    expect(pill.querySelector("[data-glyph='pie']")).toBe(null);
  });
});

describe("RowStatus", () => {
  /** A count the bridge failed to send compares false with any number:
      the row must not fall on the settled side for it. */
  it("never takes a count it cannot read as settled", () => {
    const { container } = render(<RowStatus status={CONFIRMED} confirmations={Number.NaN} />);
    expect(container.querySelector("[data-glyph='check']")).toBe(null);
    expect(container.querySelector("[data-tone='confirmed']")).not.toBe(null);
  });

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
    render(
      <button type="button">
        <RowStatus status={CONFIRMED} confirmations={5} />
      </button>,
    );
    expect(screen.getByRole("button", { name: "5 of 6 confirmations" })).toBeInTheDocument();
    const pill = screen.getByTitle("5 of 6 confirmations");
    expect(pill).toHaveAttribute("data-tone", "confirmed");
    expect(pill.querySelector("[data-glyph='pie']")).toHaveAttribute("data-parts", "5");
    expect(screen.getByText("5 conf")).toBeVisible();
  });

  it("keeps the pill for a row that waits", () => {
    render(<RowStatus status={PENDING} confirmations={0} />);
    const pill = screen.getByText("Pending");
    expect(pill).toHaveAttribute("data-tone", "pending");
    expect(pill.querySelector("[data-glyph='clock']")).not.toBe(null);
  });
});
