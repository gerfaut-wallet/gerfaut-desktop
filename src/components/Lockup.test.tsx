import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Lockup } from "./Lockup";

/** The lockup is the brand kit's: the mark stacked over the wordmark,
    drawn from outlines in the kit's own box, never set in a font that
    may render it differently. */
describe("the lockup", () => {
  it("draws the brand kit's stacked lockup, outlined, in the accent colour", () => {
    const { container } = render(<Lockup label="Gerfaut" />);
    const lockup = screen.getByRole("img", { name: "Gerfaut" });
    expect(lockup.tagName.toLowerCase()).toBe("svg");
    // The box of brand/logo/gerfaut-lockup.svg: taller than a side by
    // side lockup would be, the mark above the word.
    expect(lockup.getAttribute("viewBox")).toBe("0 0 1100 703");
    expect(lockup).toHaveClass("text-primary", "w-40");
    // The mark and the seven letters of GERFAUT.
    expect(container.querySelectorAll("path")).toHaveLength(8);
    expect(lockup.textContent).toBe("");
  });

  it("is left out of the accessibility tree without a name", () => {
    render(<Lockup />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
