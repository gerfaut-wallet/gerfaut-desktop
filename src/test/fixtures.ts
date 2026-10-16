// What gerfaut-core answers about the preferences, as the tests need it.

import type { Preferences, PreferencesChange } from "../lib/ipc";

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
