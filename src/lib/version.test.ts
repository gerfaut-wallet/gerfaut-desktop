import { describe, expect, it } from "vitest";
import { compareVersions, isUpdate, normalizeVersion, parseVersion } from "./version";

const order = (a: string, b: string) => compareVersions(parseVersion(a)!, parseVersion(b)!);

describe("parseVersion", () => {
  it("reads a release, with or without the v of a tag", () => {
    expect(parseVersion("0.2.0")).toEqual({ major: 0, minor: 2, patch: 0, pre: [] });
    expect(parseVersion("v1.12.3")).toEqual({ major: 1, minor: 12, patch: 3, pre: [] });
    expect(parseVersion("  v0.2.0\n")).toEqual({ major: 0, minor: 2, patch: 0, pre: [] });
  });

  it("reads a pre-release and drops build metadata", () => {
    expect(parseVersion("v0.2.0-rc.1")?.pre).toEqual(["rc", "1"]);
    expect(normalizeVersion("v0.2.0-rc.1+build.5")).toBe("0.2.0-rc.1");
    expect(normalizeVersion("0.2.0+20260919")).toBe("0.2.0");
  });

  it("reads nothing out of what is not a version", () => {
    for (const garbage of [
      "",
      "nightly",
      "latest",
      "0.2",
      "0.2.0.1",
      "V0.2.0",
      "vv0.2.0",
      "0.2.x",
      "01.2.0",
      "0.2.0-",
      "0.2.0-rc..1",
      "0.2.0-01",
      "0.2.0 beta",
      "-1.0.0",
      "1e3.0.0",
      "0.2.0<script>alert(1)</script>",
      '0.2.0"><img src=x>',
      "https://example.com/0.2.0",
      "9999999.0.0",
      "1.0.0-" + "a".repeat(80),
    ]) {
      expect(parseVersion(garbage), garbage).toBeNull();
    }
    for (const notText of [undefined, null, 2, {}, ["0.2.0"], true]) {
      expect(parseVersion(notText)).toBeNull();
    }
  });
});

describe("compareVersions", () => {
  it("orders numbers as numbers", () => {
    expect(order("0.1.10", "0.1.9")).toBeGreaterThan(0);
    expect(order("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(order("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(order("0.1.0", "0.2.0")).toBeLessThan(0);
    expect(order("v0.2.0", "0.2.0")).toBe(0);
    expect(order("0.2.0+a", "0.2.0+b")).toBe(0);
  });

  it("follows the pre-release order of the specification", () => {
    const chain = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ];
    for (let i = 0; i < chain.length - 1; i += 1) {
      expect(order(chain[i], chain[i + 1]), `${chain[i]} < ${chain[i + 1]}`).toBeLessThan(0);
      expect(order(chain[i + 1], chain[i])).toBeGreaterThan(0);
    }
    expect(order("1.0.0-rc.1", "1.0.0-rc.1")).toBe(0);
  });
});

describe("isUpdate", () => {
  it("says yes to a later release only", () => {
    expect(isUpdate("v0.2.0", "0.1.0")).toBe(true);
    expect(isUpdate("0.1.1", "0.1.0")).toBe(true);
    expect(isUpdate("v0.1.0", "0.1.0")).toBe(false);
    expect(isUpdate("v0.0.9", "0.1.0")).toBe(false);
  });

  it("keeps a pre-release from someone on a release", () => {
    expect(isUpdate("v0.2.0-rc.1", "0.1.0")).toBe(false);
    expect(isUpdate("v0.2.0-rc.2", "0.2.0-rc.1")).toBe(true);
    expect(isUpdate("v0.2.0", "0.2.0-rc.1")).toBe(true);
    expect(isUpdate("v0.2.0-rc.1", "0.2.0")).toBe(false);
  });

  it("says no to garbage on either side", () => {
    expect(isUpdate("nightly", "0.1.0")).toBe(false);
    expect(isUpdate(undefined, "0.1.0")).toBe(false);
    expect(isUpdate("0.2.0", "garbage")).toBe(false);
  });
});
