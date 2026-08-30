import { describe, expect, it } from "vitest";
import {
  formatBtc,
  formatBtcSigned,
  formatLocktime,
  formatSats,
  formatTimestamp,
  groupThousands,
  locktimeIsTime,
  relativeTime,
  sumSats,
  truncateMiddle,
} from "./format";

describe("formatBtc", () => {
  it("keeps all 8 decimals", () => {
    expect(formatBtc(0)).toBe("0.00000000");
    expect(formatBtc(1)).toBe("0.00000001");
    expect(formatBtc(123_456)).toBe("0.00123456");
    expect(formatBtc(100_000_000)).toBe("1.00000000");
  });

  it("groups whole bitcoins", () => {
    expect(formatBtc(2_100_000_000_000_000)).toBe("21 000 000.00000000");
  });

  it("signs explicitly", () => {
    expect(formatBtcSigned(123_456)).toBe("+0.00123456");
    expect(formatBtcSigned(-123_456)).toBe("-0.00123456");
  });
});

describe("formatSats", () => {
  it("groups thousands with a no-break space", () => {
    expect(formatSats(1_234_567)).toBe("1 234 567 sats");
    expect(formatSats(-500)).toBe("-500 sats");
  });
});

describe("groupThousands", () => {
  it("leaves short numbers alone", () => {
    expect(groupThousands("999")).toBe("999");
  });
});

describe("truncateMiddle", () => {
  it("keeps both ends", () => {
    expect(truncateMiddle("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")).toBe(
      "bc1qw5...f3t4",
    );
  });
  it("never lengthens", () => {
    expect(truncateMiddle("short")).toBe("short");
  });
});

describe("formatLocktime", () => {
  it("says none when nothing locks the transaction", () => {
    expect(formatLocktime(0)).toBe("none");
  });

  it("reads a small value as the block height it is", () => {
    expect(formatLocktime(840_000)).toBe(`block ${groupThousands("840000")}`);
    expect(formatLocktime(840_000)).toMatch(/^block 840.000$/);
    expect(formatLocktime(499_999_999)).toMatch(/^block 499.999.999$/);
  });

  it("reads a large value as the moment it is, never as a block", () => {
    // 1735689600 is 2025-01-01T00:00:00Z: printed raw it would read as
    // a block height a thousand centuries out of reach.
    expect(formatLocktime(1_735_689_600)).toBe(formatTimestamp(1_735_689_600));
    expect(formatLocktime(1_735_689_600)).not.toMatch(/block/);
  });

  it("names which side of the threshold a value falls on", () => {
    expect(locktimeIsTime(499_999_999)).toBe(false);
    expect(locktimeIsTime(500_000_000)).toBe(true);
  });
});

describe("sumSats", () => {
  it("adds what is known", () => {
    expect(sumSats([1, 2, 3])).toBe(6);
    expect(sumSats([])).toBe(0);
  });

  it("refuses a total one unknown value would make wrong", () => {
    expect(sumSats([1, null, 3])).toBeNull();
  });
});

describe("relativeTime", () => {
  const now = 1_755_000_000_000;
  it("reads naturally", () => {
    expect(relativeTime(now / 1000 - 10, now)).toBe("just now");
    expect(relativeTime(now / 1000 - 120, now)).toBe("2 min ago");
    expect(relativeTime(now / 1000 - 7200, now)).toBe("2 h ago");
    expect(relativeTime(now / 1000 - 172_800, now)).toBe("2 d ago");
  });
});
