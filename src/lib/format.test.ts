import { describe, expect, it } from "vitest";
import {
  formatBtc,
  formatBtcSigned,
  formatSats,
  groupThousands,
  relativeTime,
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
    expect(formatBtc(2_100_000_000_000_000)).toBe("21 000 000.00000000");
  });

  it("signs explicitly", () => {
    expect(formatBtcSigned(123_456)).toBe("+0.00123456");
    expect(formatBtcSigned(-123_456)).toBe("-0.00123456");
  });
});

describe("formatSats", () => {
  it("groups thousands with a narrow space", () => {
    expect(formatSats(1_234_567)).toBe("1 234 567 sats");
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

describe("relativeTime", () => {
  const now = 1_755_000_000_000;
  it("reads naturally", () => {
    expect(relativeTime(now / 1000 - 10, now)).toBe("just now");
    expect(relativeTime(now / 1000 - 120, now)).toBe("2 min ago");
    expect(relativeTime(now / 1000 - 7200, now)).toBe("2 h ago");
    expect(relativeTime(now / 1000 - 172_800, now)).toBe("2 d ago");
  });
});
