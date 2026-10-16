// Policy snapshots as gerfaut-core writes them, for the tests of the
// Policy page: the cases of its reference PolicySnapshot.json (see
// core.ts), five wallets of the BIP-32 test vector keys read at block
// 800 000 and unix time 1 750 000 000, one of them twice.

import type { PolicySnapshot } from "../lib/ipc";
import { coreCase } from "./core";

const policy = (name: string) => coreCase<PolicySnapshot>("PolicySnapshot", name);

/** Keys A and B together any time; Keys C and D after 4 320
    blocks, Key D alone after 26 280, Key C alone after 52 560,
    written farthest first. Three coins: one past every lock, one
    4 001 blocks old, one unconfirmed. */
export const RECOVERY_PATHS = policy("recovery_paths");

/** Liana's everyday shape: Key A any time, Key B once a coin has
    waited 52 560 blocks. Two coins, one past the lock, one 10 001
    blocks old. */
export const RELATIVE = policy("relative");

/** The same wallet, both coins past the lock. */
export const RELATIVE_OPEN = policy("relative_open");

/** Key A any time, Key B after noon UTC on 17 March 2030, Key C
    after block 801 432, the date written first. */
export const ABSOLUTE = policy("absolute");

/** Any 2 of 3 keys. */
export const MULTISIG = policy("multisig");
