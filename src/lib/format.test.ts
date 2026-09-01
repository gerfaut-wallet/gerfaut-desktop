import { describe, expect, it } from "vitest";
import {
  durationWords,
  formatBlocks,
  formatBtc,
  formatBtcSigned,
  formatDate,
  formatDuration,
  formatLocktime,
  formatSats,
  formatTimestamp,
  groupThousands,
  locktimeIsTime,
  relativeTime,
  sumSats,
  truncateMiddle,
} from "./format";

describe("formatDate", () => {
  it("names the day in the voice of the timestamps, without a time", () => {
    const at = Date.UTC(2030, 2, 17, 12, 0) / 1000;
    const local = new Date(at * 1000);
    const dd = String(local.getDate()).padStart(2, "0");
    expect(formatDate(at)).toBe(`Mar ${dd}, 2030`);
    expect(formatDate(at)).not.toMatch(/\d{2}:\d{2}/);
  });
});

describe("formatDuration", () => {
  const DAY = 86_400;

  it("rounds to the unit a person would say", () => {
    expect(formatDuration(1_432 * 600)).toBe("about 10 days");
    expect(formatDuration(3 * 3_600)).toBe("about 3 hours");
    expect(formatDuration(52_560 * 600)).toBe("about 1 year");
    expect(formatDuration(425 * DAY)).toBe("about 1 year 2 months");
  });

  it("floors minutes and says so under a minute", () => {
    expect(formatDuration(5 * 60 + 59)).toBe("about 5 minutes");
    expect(formatDuration(59)).toBe("under a minute");
    expect(durationWords(59)).toBe("under a minute");
  });

  it("never shows a third unit or a rounded-up twelfth month", () => {
    expect(durationWords(2 * 365 * DAY + 3 * 30 * DAY + 5 * 3_600)).toBe("2 years 3 months");
    expect(durationWords(365 * DAY + 360 * DAY)).toBe("2 years");
    expect(durationWords(23.6 * 3_600)).toBe("1 day");
    expect(durationWords(364.6 * DAY)).toBe("1 year");
  });

  it("keeps the singular", () => {
    expect(durationWords(60)).toBe("1 minute");
    expect(durationWords(3_600)).toBe("1 hour");
    expect(durationWords(DAY)).toBe("1 day");
    expect(durationWords(142 * DAY)).toBe("142 days");
  });
});

describe("formatBlocks", () => {
  it("counts blocks with the app's own thousands separator", () => {
    expect(formatBlocks(1)).toBe("1 block");
    expect(formatBlocks(144)).toBe("144 blocks");
    expect(formatBlocks(1_432)).toBe(`${groupThousands("1432")} blocks`);
    expect(formatBlocks(52_560)).toMatch(/^52.560 blocks$/);
  });
});

describe("formatTimestamp", () => {
  it("prints one language, whatever the host speaks", () => {
    // Local time, so the assertion is built the same way rather than
    // pinned to a zone: what is under test is the wording.
    const at = Date.UTC(2026, 7, 28, 18, 56) / 1000;
    const local = new Date(at * 1000);
    const hh = String(local.getHours()).padStart(2, "0");
    const mm = String(local.getMinutes()).padStart(2, "0");
    expect(formatTimestamp(at)).toBe(`Aug 28, 2026, ${hh}:${mm}`);
  });

  it("keeps a 24-hour clock and pads the day", () => {
    expect(formatTimestamp(Date.UTC(2026, 0, 5, 12, 0) / 1000)).toMatch(
      /^Jan 05, 2026, \d{2}:\d{2}$/,
    );
  });
});

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
