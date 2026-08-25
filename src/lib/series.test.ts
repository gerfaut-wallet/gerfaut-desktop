import { describe, expect, it } from "vitest";
import type { TxSummary } from "./ipc";
import { balanceSeries } from "./series";

function tx(net: number, timestamp: number | null): TxSummary {
  return {
    txid: `${net}-${timestamp}`,
    net_sats: net,
    fee_sats: null,
    status:
      timestamp === null
        ? { state: "pending" }
        : { state: "confirmed", height: 100, timestamp },
    confirmations: timestamp === null ? 0 : 3,
  };
}

describe("balanceSeries", () => {
  it("cumulates a complete history from zero", () => {
    const points = balanceSeries(
      [tx(100_000, 1_000), tx(-30_000, 2_000), tx(50_000, 3_000)],
      120_000,
      9_000,
    );
    expect(points.map((p) => p.sats)).toEqual([100_000, 70_000, 120_000, 120_000]);
    expect(points.map((p) => p.t)).toEqual([1_000, 2_000, 3_000, 9_000]);
  });

  it("anchors a truncated history on the current total", () => {
    // Only the last two transactions are loaded; the wallet held
    // 500 000 sats before the window.
    const points = balanceSeries([tx(100_000, 5_000), tx(-50_000, 6_000)], 550_000, 9_000);
    expect(points.map((p) => p.sats)).toEqual([600_000, 550_000, 550_000]);
  });

  it("keeps pending amounts out of the curve until the final point", () => {
    const points = balanceSeries([tx(100_000, 1_000), tx(40_000, null)], 140_000, 9_000);
    // Confirmed level is 100 000; the now point carries the total.
    expect(points.map((p) => p.sats)).toEqual([100_000, 140_000]);
  });

  it("returns nothing without a confirmed, dated transaction", () => {
    expect(balanceSeries([], 0)).toEqual([]);
    expect(balanceSeries([tx(10_000, null)], 10_000)).toEqual([]);
  });

  it("sorts out-of-order timestamps", () => {
    const points = balanceSeries([tx(-20_000, 3_000), tx(100_000, 1_000)], 80_000, 9_000);
    expect(points.map((p) => p.sats)).toEqual([100_000, 80_000, 80_000]);
  });
});
