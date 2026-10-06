import { describe, expect, it } from "vitest";
import type { PolicySnapshot, WalletKind } from "../lib/ipc";
import { shownDescriptor } from "./PolicyView";

/** A public test key, the one gerfaut-core's tests use. */
const TPUB =
  "tpubDDnGNapGEY6AZAdQbfRJgMg9fvz8pUBrLwvyvUqEgcUfgzM6zc2eVK4vY9x9L5FJWdX8WumXuLEDV5zDZnTfbn87vLe9XceCFwTu9so9Kks";
/** As the core stores a `<0;1>` import: two descriptors, checksums by
    rust-miniscript. */
const RECEIVE = `wpkh([9a6a2580/84'/1'/0']${TPUB}/0/*)#76ngmkux`;
const CHANGE = `wpkh([9a6a2580/84'/1'/0']${TPUB}/1/*)#0wkfxrv7`;

const SNAPSHOT = { kind: "single_key", descriptor: RECEIVE } as PolicySnapshot;

describe("the descriptor the Policy page shows", () => {
  /** The core reads the policy from the receive branch; copied as it
      is, it would watch the wallet without its change. */
  it("is the whole wallet, both branches in one multipath descriptor", () => {
    const wallet: WalletKind = { type: "descriptors", external: RECEIVE, internal: CHANGE, script: "segwit" };
    const shown = shownDescriptor(SNAPSHOT, wallet);
    expect(shown.split("#")[0]).toBe(`wpkh([9a6a2580/84'/1'/0']${TPUB}/<0;1>/*)`);
    expect(shown).not.toBe(RECEIVE);
  });

  it("stays the receive descriptor when there is no change branch, or no wallet yet", () => {
    const alone: WalletKind = { type: "descriptors", external: RECEIVE, internal: null, script: "segwit" };
    expect(shownDescriptor(SNAPSHOT, alone)).toBe(RECEIVE);
    expect(shownDescriptor(SNAPSHOT, undefined)).toBe(RECEIVE);
  });

  it("never pairs the policy with another wallet's branches", () => {
    const other: WalletKind = {
      type: "descriptors",
      external: `tr([9a6a2580/86'/1'/0']${TPUB}/0/*)#06k0xnt5`,
      internal: `tr([9a6a2580/86'/1'/0']${TPUB}/1/*)#7wnwmxmv`,
      script: "taproot",
    };
    expect(shownDescriptor(SNAPSHOT, other)).toBe(RECEIVE);
  });
});
