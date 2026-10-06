import { describe, expect, it } from "vitest";
import type { PriceQuote } from "../lib/ipc";
import { liveAnswer } from "./queries";

const QUOTE: PriceQuote = { rate: 100_000, currency: "eur", source: "coingecko", at: 1_755_000_000 };

/** A price display uses the last answer only while it still holds. */
describe("the price a display may use", () => {
  it("is the last answer, in the chosen currency", () => {
    expect(liveAnswer({ isError: false, data: QUOTE }, "eur")).toBe(QUOTE);
  });

  it("is none before the first answer", () => {
    expect(liveAnswer({ isError: false, data: undefined }, "eur")).toBeNull();
  });

  /** The cache keeps the answer before a failed refresh: it is an hour
      old by the time anyone reads it, and says nothing of it. */
  it("is none once the last request failed, whatever the cache holds", () => {
    expect(liveAnswer({ isError: true, data: QUOTE }, "eur")).toBeNull();
  });

  it("is none in another currency than the one chosen", () => {
    expect(liveAnswer({ isError: false, data: QUOTE }, "usd")).toBeNull();
  });
});
