import { describe, expect, it } from "vitest";
import {
  coinsWord,
  eventWords,
  formatKeyInput,
  isWellFormedKey,
  offlineSinceLabel,
  premiumFailure,
  renewUrl,
  serverNetwork,
} from "./premium";

describe("the key field", () => {
  it("lays the dashes itself, whatever was typed or pasted", () => {
    expect(formatKeyInput("abcd")).toBe("abcd");
    expect(formatKeyInput("abcde")).toBe("abcd-e");
    expect(formatKeyInput("ABCD-EFGH-IJKM-NPQR")).toBe("abcd-efgh-ijkm-npqr");
    expect(formatKeyInput("abcdefghijkmnpqr")).toBe("abcd-efgh-ijkm-npqr");
    expect(formatKeyInput(" abcd efgh\tijkm npqr ")).toBe("abcd-efgh-ijkm-npqr");
    // Nothing past the sixteenth symbol, and nothing but letters and digits.
    expect(formatKeyInput("abcd-efgh-ijkm-npqr-stuv")).toBe("abcd-efgh-ijkm-npqr");
    expect(formatKeyInput("ab_cd!ef")).toBe("abcd-ef");
    expect(formatKeyInput("")).toBe("");
  });

  it("knows the shape of a key without knowing any key", () => {
    expect(isWellFormedKey("abcd-efgh-ijkm-npqr")).toBe(true);
    expect(isWellFormedKey("2345-6789-abcd-efgh")).toBe(true);
    expect(isWellFormedKey("abcd-efgh-ijkm-npq")).toBe(false);
    // The four symbols the alphabet leaves out because a screen misreads them.
    expect(isWellFormedKey("abcd-efgh-ijkl-npqr")).toBe(false);
    expect(isWellFormedKey("abcd-efgh-ijkm-npqo")).toBe(false);
    expect(isWellFormedKey("abcd-efgh-ijkm-npq0")).toBe(false);
    expect(isWellFormedKey("abcd-efgh-ijkm-npq1")).toBe(false);
    expect(isWellFormedKey("")).toBe(false);
  });

  it("hands the key to the renewal form on the site", () => {
    expect(renewUrl("abcd-efgh-ijkm-npqr")).toBe(
      "https://gerfaut-wallet.com/premium?key=abcd-efgh-ijkm-npqr",
    );
  });
});

describe("what the server says", () => {
  it("names its network in the app's words", () => {
    expect(serverNetwork("bitcoin")).toBe("mainnet");
    expect(serverNetwork("signet")).toBe("signet");
    expect(serverNetwork("testnet4")).toBe("testnet4");
    expect(serverNetwork("liquid")).toBe(null);
  });

  it("reads a failure as one sentence, and offers Retry only where it helps", () => {
    expect(premiumFailure({ kind: "premium_unknown_key", message: "x" })).toEqual({
      message: "Unknown key.",
      retry: false,
    });
    expect(premiumFailure({ kind: "premium_no_paid_time", message: "x" })).toEqual({
      message: "This key has no paid time.",
      retry: false,
    });
    expect(premiumFailure({ kind: "premium_unreachable", message: "timed out" })).toEqual({
      message: "Could not reach the Gerfaut server.",
      retry: true,
    });
    // The server's own words, made a sentence.
    expect(
      premiumFailure({
        kind: "premium_rejected",
        message: "a single address cannot be watched yet; send a descriptor",
      }),
    ).toEqual({
      message: "A single address cannot be watched yet; send a descriptor.",
      retry: false,
    });
    // Something that is not a command error at all: the bridge failed.
    expect(premiumFailure(new Error("boom")).retry).toBe(true);
  });

  it("says what an event is without an amount or an address", () => {
    expect(eventWords("spend_detected")).toBe("coins are moving");
    expect(eventWords("wallet_registered")).toBe("watch started");
    expect(eventWords("other")).toBe("something happened");
    expect(coinsWord(1)).toBe("1 coin");
    expect(coinsWord(3)).toBe("3 coins");
  });

  it("dates the outage by the clock the same day, by the day otherwise", () => {
    const now = new Date(2026, 8, 5, 16, 30).getTime();
    const today = new Date(2026, 8, 5, 14, 2).getTime() / 1000;
    const yesterday = new Date(2026, 8, 4, 23, 58).getTime() / 1000;
    expect(offlineSinceLabel(today, now)).toBe("14:02");
    expect(offlineSinceLabel(yesterday, now)).toBe("Sep 4, 23:58");
  });
});
