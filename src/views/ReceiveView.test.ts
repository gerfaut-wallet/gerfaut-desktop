import { describe, expect, it } from "vitest";
import type { AddressEntry } from "../lib/ipc";
import { unusedBefore } from "./ReceiveView";

function at(...indexes: number[]): AddressEntry[] {
  return indexes.map((index) => ({
    index,
    address: `tb1qaddress${index}`,
    used: false,
    derivation: null,
  }));
}

describe("unused addresses before the one shown", () => {
  it("counts from the next unused address when nothing was skipped", () => {
    const entries = at(4, 5, 6, 7);
    expect(unusedBefore(entries, 0)).toBe(0);
    expect(unusedBefore(entries, 3)).toBe(3);
  });

  /** An index the core left out is an address a payment reached: the
      run of unused ones starts again after it, and the gap limit is
      read against that run, not against how far the page skipped. */
  it("starts again after an address the core skipped as used", () => {
    // 6 and 7 were paid by another app.
    const entries = at(4, 5, 8, 9, 10);
    expect(unusedBefore(entries, 1)).toBe(1);
    expect(unusedBefore(entries, 2)).toBe(0);
    expect(unusedBefore(entries, 4)).toBe(2);
  });
});
