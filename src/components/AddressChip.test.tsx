import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AddressChip } from "./AddressChip";

// The example address of BIP-173, on testnet.
const ADDRESS = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";

describe("AddressChip", () => {
  it("cuts the value in the middle, to a fixed head and tail", () => {
    render(<AddressChip value={ADDRESS} />);
    expect(screen.getByRole("button")).toHaveTextContent("tb1qw5...jzsx");
    expect(screen.getByRole("button")).toHaveAttribute("title", ADDRESS);
  });

  /** Where the column has the room, the address is read whole; where
      it has not, the head alone gives way: the tail is the value's own
      last characters, never an approximation of them. */
  it("holds the whole value when it fits its room, the tail kept apart", () => {
    render(<AddressChip value={ADDRESS} tail={10} fit />);
    const chip = screen.getByRole("button");
    expect(chip).toHaveTextContent(ADDRESS);
    const [head, tail] = chip.querySelectorAll("span > span");
    expect(head).toHaveTextContent(ADDRESS.slice(0, -10));
    expect(tail).toHaveTextContent("xw7kxpjzsx");
  });

  it("shows a value no longer than its tail whole, once", () => {
    render(<AddressChip value="tb1qshort" tail={10} fit />);
    expect(screen.getByRole("button")).toHaveTextContent(/^tb1qshort$/);
  });

  it("gives the whole value to the part that gives way, with no tail", () => {
    render(<AddressChip value={ADDRESS} tail={0} fit />);
    const chip = screen.getByRole("button");
    expect(chip).toHaveTextContent(ADDRESS);
    expect(chip.querySelector(".truncate")).toHaveTextContent(ADDRESS);
  });
});
