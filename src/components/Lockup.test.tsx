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
    expect(lockup).toHaveClass("text-primary");
    // 160px wide by default, the height following the kit's proportions.
    expect(lockup).toHaveAttribute("width", "160");
    expect(lockup).toHaveAttribute("height", "102");
    // The mark and the seven letters of GERFAUT.
    expect(container.querySelectorAll("path")).toHaveLength(8);
    expect(lockup.textContent).toBe("");
  });

  /** The welcome tour gives it the 64px slot of the disc it replaces:
      a size class passed in once lost to the default and drew it four
      times too large. */
  it("takes the width it is given, and the height that goes with it", () => {
    render(<Lockup label="Gerfaut" width={100} />);
    const lockup = screen.getByRole("img", { name: "Gerfaut" });
    expect(lockup).toHaveAttribute("width", "100");
    expect(lockup).toHaveAttribute("height", "64");
  });

  it("is left out of the accessibility tree without a name", () => {
    render(<Lockup />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
