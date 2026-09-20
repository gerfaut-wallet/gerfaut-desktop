import { describe, expect, it } from "vitest";
import {
  coinsWord,
  eventWords,
  formatKeyInput,
  isWellFormedKey,
  offlineSinceLabel,
  premiumFailure,
  RENEW_URL,
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

  it("sends nobody to the site with the key in the address", () => {
    // A query string is history, omnibox, access log and Referer. The
    // key is the account: it travels through the clipboard instead.
    expect(RENEW_URL).toBe("https://gerfaut-wallet.com/premium#renew");
    expect(RENEW_URL).not.toMatch(/\?/);
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
    expect(
      premiumFailure({
        kind: "premium_unreachable",
        message: "the premium server is unreachable: timed out",
      }),
    ).toEqual({ message: "Could not reach the Gerfaut server.", retry: true });
    // A 5xx that says what went wrong says it, rather than being read
    // as an outage: the server answered, it just could not do the thing.
    expect(
      premiumFailure({
        kind: "premium_unreachable",
        message: "the premium server is unreachable: HTTP 502: the e-mail could not be sent",
      }),
    ).toEqual({ message: "The e-mail could not be sent.", retry: true });
    // Tor, raw, read "tor: no proxy answers on 127.0.0.1:9050".
    expect(premiumFailure({ kind: "tor", message: "tor: no proxy answers" })).toEqual({
      message:
        "Tor is not reachable. While your backend is an onion address, Gerfaut sends these requests through Tor too.",
      retry: true,
    });
    // The server's own words, made a sentence.
    expect(
      premiumFailure({
        kind: "premium_rejected",
        message: "that is not an address Gerfaut can watch: addr() holds one address",
      }),
    ).toEqual({
      message: "That is not an address Gerfaut can watch: addr() holds one address.",
      retry: false,
    });
    // A rate limit is a wait, worded by the Rust side, and worth a retry.
    expect(
      premiumFailure({ kind: "premium_rate_limited", message: "Try again in 42 s." }),
    ).toEqual({ message: "The server asks to wait. Try again in 42 s.", retry: true });
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
