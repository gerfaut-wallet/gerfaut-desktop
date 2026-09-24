import { describe, expect, it } from "vitest";
import type { Device } from "./ipc";
import {
  coinsWord,
  dayMonthYear,
  daysLeft,
  disconnectedWords,
  eventWords,
  formatKeyInput,
  isDeviceDisconnected,
  isDevicePending,
  isWellFormedKey,
  offlineSinceLabel,
  pendingDevices,
  platformLabel,
  premiumFailure,
  RENEW_URL,
  serverNetwork,
  waitingWords,
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
    // What was asked would lose the new key of an unfinished change.
    expect(
      premiumFailure({
        kind: "premium_key_change_pending",
        message: "the key change did not finish; try again to complete it",
      }),
    ).toEqual({
      message: "The key change did not finish. Try again to complete it.",
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

describe("the devices of the account", () => {
  it("names each platform the way the alerts do, and nothing the server made up", () => {
    expect(platformLabel("android")).toBe("Android phone");
    expect(platformLabel("ios")).toBe("iPhone");
    expect(platformLabel("windows")).toBe("Windows computer");
    expect(platformLabel("macos")).toBe("Mac");
    expect(platformLabel("linux")).toBe("Linux computer");
    // A platform this build does not know gets a plain word, never the
    // server's string.
    expect(platformLabel("other")).toBe("device");
    expect(platformLabel("<b>Free Bitcoin</b>")).toBe("device");
  });

  it("writes a day as D Mon YYYY", () => {
    const day = Math.floor(new Date(2026, 8, 24, 13, 5).getTime() / 1000);
    expect(dayMonthYear(day)).toBe("24 Sep 2026");
    const first = Math.floor(new Date(2027, 0, 1, 0, 30).getTime() / 1000);
    expect(dayMonthYear(first)).toBe("1 Jan 2027");
  });

  it("counts the days left of a wait, a day begun counting as one", () => {
    const now = Date.UTC(2026, 8, 24, 12, 0);
    const at = (hours: number) => Math.floor(now / 1000) + hours * 3600;
    expect(daysLeft(at(24 * 10), now)).toBe(10);
    expect(daysLeft(at(24 * 9 + 1), now)).toBe(10);
    expect(daysLeft(at(3), now)).toBe(1);
    // Past its end and not yet refreshed: never zero, never negative.
    expect(daysLeft(at(-5), now)).toBe(1);
    expect(waitingWords(at(24 * 3), now)).toBe("Waiting · 3 days left");
    expect(waitingWords(at(2), now)).toBe("Waiting · 1 day left");
  });

  it("picks the devices that wait", () => {
    const device = (id: string, access: Device["access"]): Device => ({
      id,
      platform: "linux",
      connected_at: 1,
      access,
      pending_until: access === "pending" ? 2 : null,
      approved_at: null,
      this_device: false,
    });
    expect(
      pendingDevices([device("a", "full"), device("b", "pending"), device("c", "pending")]).map(
        (d) => d.id,
      ),
    ).toEqual(["b", "c"]);
    expect(pendingDevices(undefined)).toEqual([]);
  });

  it("tells a waiting or disconnected device from a failure", () => {
    expect(isDevicePending({ kind: "premium_device_pending", message: "x" })).toBe(true);
    expect(isDevicePending({ kind: "premium_unreachable", message: "x" })).toBe(false);
    expect(isDeviceDisconnected({ kind: "premium_device_disconnected", message: "x" })).toBe(true);
    expect(isDeviceDisconnected(new Error("x"))).toBe(false);
  });

  it("says the device failures in the section's words", () => {
    expect(premiumFailure({ kind: "premium_device_disconnected", message: "x" })).toEqual({
      message: "This device was disconnected from your Premium account.",
      retry: false,
    });
    expect(premiumFailure({ kind: "premium_no_device", message: "x" })).toEqual({
      message: "Connect this device with the Premium key first.",
      retry: false,
    });
    expect(
      premiumFailure({
        kind: "premium_too_many_devices",
        message: "this key already has 10 devices; disconnect one from a device with full access",
      }),
    ).toEqual({
      message:
        "This key already has 10 devices; disconnect one from a device with full access.",
      retry: false,
    });
    expect(premiumFailure({ kind: "app_lock_required", message: "x" }).message).toBe(
      "Changing who can use your Premium account needs an app lock on this device, so that nobody holding it unlocked can do it.",
    );
  });
});

describe("a disconnected device", () => {
  it("says why in the server's words when it gave some, and in the section's otherwise", () => {
    expect(disconnectedWords(null)).toBe("This device was disconnected from your Premium account.");
    expect(
      disconnectedWords(
        "this key already has 10 devices; disconnect one from a device with full access",
      ),
    ).toBe("This key already has 10 devices; disconnect one from a device with full access.");
  });
});
