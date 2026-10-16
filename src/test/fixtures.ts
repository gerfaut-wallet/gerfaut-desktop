// What gerfaut-core answers about the preferences and the price table,
// read from its reference JSON (see core.ts), as the tests need it.

import type { Preferences, PreferencesChange, PriceTable } from "../lib/ipc";
import { coreCase } from "./core";

/** The preferences of a vault that never stored any: the core's
    defaults, as it sends them. */
export const PREFERENCES = coreCase<Preferences>("Preferences", "default");

/** The core's table, whole, in its shape and order. */
export const PRICE_TABLE = coreCase<PriceTable>("PriceTable", "table");

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
