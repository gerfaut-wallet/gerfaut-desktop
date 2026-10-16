// What gerfaut-core answers about the preferences and the price table,
// as the tests need it.

import type { Preferences, PreferencesChange, PriceTable } from "../lib/ipc";

/** The preferences of a vault that never stored any: the core's
    defaults, as it sends them. */
export const PREFERENCES: Preferences = {
  unit: "btc",
  masked: false,
  fiat: false,
  fiat_currency: "eur",
  price_source: "coingecko",
  notify_new_tx: false,
  explorer_ack: false,
};

/** Part of the core's table, in its shape and order: three currencies
    every source quotes, two only CoinGecko does. */
export const PRICE_TABLE: PriceTable = {
  currencies: [
    {
      currency: "eur",
      code: "EUR",
      name: "Euro",
      reach: "every",
      sources: ["coingecko", "kraken", "mempool_space"],
    },
    {
      currency: "usd",
      code: "USD",
      name: "US dollar",
      reach: "every",
      sources: ["coingecko", "kraken", "mempool_space"],
    },
    {
      currency: "jpy",
      code: "JPY",
      name: "Japanese yen",
      reach: "every",
      sources: ["coingecko", "kraken", "mempool_space"],
    },
    {
      currency: "inr",
      code: "INR",
      name: "Indian rupee",
      reach: "coingecko_only",
      sources: ["coingecko"],
    },
    {
      currency: "ngn",
      code: "NGN",
      name: "Nigerian naira",
      reach: "coingecko_only",
      sources: ["coingecko"],
    },
  ],
  sources: [
    { source: "coingecko", label: "CoinGecko", ranges: ["day", "week", "month", "year"] },
    { source: "kraken", label: "Kraken", ranges: ["day", "week", "month", "year", "max"] },
    { source: "mempool_space", label: "mempool.space", ranges: ["month", "year", "max"] },
  ],
  refresh_secs: 60,
};

/** A stand-in for the core's `set_preferences`: the change applied to
    what it holds, answered whole. Nothing more: a test of a rule the
    core applies answers what the core would. */
export function preferencesHeld(initial: Preferences = PREFERENCES) {
  let held = { ...initial };
  return (change: PreferencesChange): Preferences => {
    held = { ...held, ...change };
    return held;
  };
}
