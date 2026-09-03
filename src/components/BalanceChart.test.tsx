import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BalancePoint } from "../lib/series";
import { BalanceChart } from "./BalanceChart";

/** A short life: three readings a day apart. */
const POINTS: BalancePoint[] = [
  { t: 1_755_000_000, sats: 50_000 },
  { t: 1_755_086_400, sats: 150_000 },
  { t: 1_755_172_800, sats: 100_000 },
];

describe("BalanceChart", () => {
  it("tells the keyboard how to read it", () => {
    render(<BalanceChart points={POINTS} unit="btc" />);
    expect(screen.getByRole("group", { name: "Balance history chart" })).toHaveAccessibleDescription(
      "Use the arrow keys to read each point.",
    );
  });

  it("announces a reading the keyboard asked for, not one the pointer swept", () => {
    render(<BalanceChart points={POINTS} unit="btc" />);
    const chart = screen.getByRole("group", { name: "Balance history chart" });
    const reading = screen.getByRole("status");

    fireEvent.pointerMove(chart, { clientX: 10 });
    expect(reading).toHaveTextContent("0.00050000");
    expect(reading).toHaveAttribute("aria-live", "off");

    act(() => chart.focus());
    expect(reading).toHaveAttribute("aria-live", "polite");
    fireEvent.keyDown(chart, { key: "Home" });
    expect(reading).toHaveTextContent("0.00050000");
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(reading).toHaveTextContent("0.00150000");
    expect(reading).toHaveAttribute("aria-live", "polite");

    fireEvent.pointerMove(chart, { clientX: 10 });
    expect(reading).toHaveAttribute("aria-live", "off");
  });
});
