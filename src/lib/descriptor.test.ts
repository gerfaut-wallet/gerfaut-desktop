import { describe, expect, it } from "vitest";
import { descriptorChecksum, multipathDescriptor } from "./descriptor";

/** A public test key, the one gerfaut-core's tests use. */
const TPUB =
  "tpubDDnGNapGEY6AZAdQbfRJgMg9fvz8pUBrLwvyvUqEgcUfgzM6zc2eVK4vY9x9L5FJWdX8WumXuLEDV5zDZnTfbn87vLe9XceCFwTu9so9Kks";

/** Descriptors as the core writes them, checksums computed by
    rust-miniscript: the ground truth this module is held to. */
const RECEIVE = `wpkh([9a6a2580/84'/1'/0']${TPUB}/0/*)#76ngmkux`;
const CHANGE = `wpkh([9a6a2580/84'/1'/0']${TPUB}/1/*)#0wkfxrv7`;

describe("the descriptor checksum", () => {
  it("is the one BIP 380 and rust-miniscript compute", () => {
    // The example of BIP 380.
    expect(descriptorChecksum("raw(deadbeef)")).toBe("89f8spxm");
    for (const [body, checksum] of [
      [`wpkh([9a6a2580/84'/1'/0']${TPUB}/0/*)`, "76ngmkux"],
      [`wpkh([9a6a2580/84'/1'/0']${TPUB}/1/*)`, "0wkfxrv7"],
      [`tr([9a6a2580/86'/1'/0']${TPUB}/0/*)`, "06k0xnt5"],
      [`tr([9a6a2580/86'/1'/0']${TPUB}/1/*)`, "7wnwmxmv"],
      [`wpkh(${TPUB}/0/*)`, "dmh8w44d"],
      [`wpkh(${TPUB}/1/*)`, "u0jxnq94"],
    ]) {
      expect(descriptorChecksum(body), body).toBe(checksum);
    }
  });

  it("refuses a character no descriptor holds", () => {
    expect(descriptorChecksum("wpkh(é)")).toBeNull();
  });
});

describe("one wallet's two branches as one descriptor", () => {
  it("writes them as a multipath descriptor, checksum included", () => {
    const multipath = multipathDescriptor(RECEIVE, CHANGE)!;
    const [body, checksum] = multipath.split("#");
    expect(body).toBe(`wpkh([9a6a2580/84'/1'/0']${TPUB}/<0;1>/*)`);
    expect(checksum).toBe(descriptorChecksum(body));
  });

  it("puts each key's own pair in place, in a multisig", () => {
    const multi = (a: number, b: number) =>
      `wsh(multi(1,[9a6a2580/48'/1'/0'/2']${TPUB}/${a}/*,[00000000/48'/1'/0'/2']${TPUB}/${b}/*))`;
    const withChecksum = (body: string) => `${body}#${descriptorChecksum(body)}`;
    expect(multipathDescriptor(withChecksum(multi(0, 2)), withChecksum(multi(1, 3)))).toBe(
      withChecksum(
        `wsh(multi(1,[9a6a2580/48'/1'/0'/2']${TPUB}/<0;1>/*,[00000000/48'/1'/0'/2']${TPUB}/<2;3>/*))`,
      ),
    );
  });

  it("gives up rather than write a descriptor it cannot vouch for", () => {
    // A checksum that does not match its descriptor.
    expect(multipathDescriptor(RECEIVE.replace("76ngmkux", "76ngmkuy"), CHANGE)).toBeNull();
    // None at all.
    expect(multipathDescriptor(RECEIVE.split("#")[0], CHANGE)).toBeNull();
    // Two descriptors that are not the same wallet.
    const other = `tr([9a6a2580/86'/1'/0']${TPUB}/1/*)#7wnwmxmv`;
    expect(multipathDescriptor(RECEIVE, other)).toBeNull();
    // The same branch twice.
    expect(multipathDescriptor(RECEIVE, RECEIVE)).toBeNull();
  });
});
