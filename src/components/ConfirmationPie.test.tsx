import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConfirmationPie, pieSectorPath } from "./ConfirmationPie";

describe("pieSectorPath", () => {
  /** A part is a sixth of a turn from noon: the arc ends at 60°. */
  it("draws one part as a sixth of the disc", () => {
    expect(pieSectorPath(1)).toBe("M12 12L12 2A10 10 0 0 1 20.66 7Z");
  });

  /** Three parts end straight below the centre. */
  it("draws three parts as a half disc", () => {
    expect(pieSectorPath(3)).toBe("M12 12L12 2A10 10 0 0 1 12 22Z");
  });

  /** Past half a turn the arc takes the long way: without the flag,
      five parts would draw as one. */
  it("takes the large arc for five parts", () => {
    expect(pieSectorPath(5)).toBe("M12 12L12 2A10 10 0 1 1 3.34 7Z");
  });

  it("draws nothing for no part, and nothing below zero", () => {
    expect(pieSectorPath(0)).toBe("");
    expect(pieSectorPath(-2)).toBe("");
  });

  /** One arc cannot close on itself: the whole disc is two half turns. */
  it("draws the whole disc at six, and no more past it", () => {
    const whole = "M12 2A10 10 0 1 1 12 22A10 10 0 1 1 12 2Z";
    expect(pieSectorPath(6)).toBe(whole);
    expect(pieSectorPath(100)).toBe(whole);
  });
});

describe("ConfirmationPie", () => {
  it("rings the disc and fills the parts in the text colour", () => {
    const { container } = render(<ConfirmationPie parts={2} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("data-glyph", "pie");
    expect(svg).toHaveAttribute("data-parts", "2");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("width", "12");
    expect(svg.querySelector("circle")).toHaveAttribute("stroke", "currentColor");
    expect(svg.querySelectorAll("path")).toHaveLength(1);
    expect(svg.querySelector("path")).toHaveAttribute("fill", "currentColor");
  });

  it("bounds the parts it is given", () => {
    const { container, rerender } = render(<ConfirmationPie parts={9} />);
    expect(container.querySelector("svg")).toHaveAttribute("data-parts", "6");
    rerender(<ConfirmationPie parts={0} />);
    expect(container.querySelector("svg")).toHaveAttribute("data-parts", "0");
    // The bare ring: no empty path left behind.
    expect(container.querySelector("path")).toBe(null);
  });
});
