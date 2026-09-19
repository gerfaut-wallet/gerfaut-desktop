// Release versions, read and compared the way Semantic Versioning 2.0.0
// orders them. The text comes from the network, a release tag, so
// nothing here trusts it: what does not read as a version is no
// version at all, and the app then says nothing.

export interface Version {
  major: number;
  minor: number;
  patch: number;
  /** The identifiers after the hyphen; empty for a release. */
  pre: string[];
}

/** A tag is a few characters long. Anything longer is not one. */
const MAX_LENGTH = 64;

// Six digits a number at most: far past any real release, far short of
// where a JavaScript number stops being exact. No leading zero, as the
// specification asks, in the numbers and in a numeric pre-release
// identifier alike.
const NUMBER = "(0|[1-9]\\d{0,5})";
const IDENTIFIER = "(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)";
const PATTERN = new RegExp(
  `^v?${NUMBER}\\.${NUMBER}\\.${NUMBER}` +
    `(?:-(${IDENTIFIER}(?:\\.${IDENTIFIER})*))?` +
    "(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$",
);

/** Reads `1.2.3`, `v1.2.3`, `1.2.3-rc.1` and `1.2.3+build`; null for
    anything else. Build metadata is read and dropped: it orders
    nothing. */
export function parseVersion(text: unknown): Version | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LENGTH) return null;
  const match = PATTERN.exec(trimmed);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split(".") : [],
  };
}

/** The version as the app writes it: no `v`, no build metadata. Built
    from the parsed parts, never from the text that came in. */
export function formatVersion(version: Version): string {
  const core = `${version.major}.${version.minor}.${version.patch}`;
  return version.pre.length > 0 ? `${core}-${version.pre.join(".")}` : core;
}

/** `parseVersion` then `formatVersion`: the one form a version is kept
    and shown in, or null. */
export function normalizeVersion(text: unknown): string | null {
  const version = parseVersion(text);
  return version ? formatVersion(version) : null;
}

const NUMERIC = /^\d+$/;

function comparePre(a: string[], b: string[]): number {
  // A release comes after every pre-release of the same numbers.
  if (a.length === 0 || b.length === 0) return (a.length === 0 ? 1 : 0) - (b.length === 0 ? 1 : 0);
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const left = a[i];
    const right = b[i];
    if (left === right) continue;
    const leftNumeric = NUMERIC.test(left);
    const rightNumeric = NUMERIC.test(right);
    if (leftNumeric && rightNumeric) {
      // Digits only and no leading zero: the longer one is the larger.
      if (left.length !== right.length) return left.length < right.length ? -1 : 1;
      return left < right ? -1 : 1;
    }
    // A number sorts before a word; two words sort in ASCII order.
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left < right ? -1 : 1;
  }
  return Math.sign(a.length - b.length);
}

/** Negative when `a` comes before `b`, positive after, zero when they
    are the same release. */
export function compareVersions(a: Version, b: Version): number {
  return (
    Math.sign(a.major - b.major) ||
    Math.sign(a.minor - b.minor) ||
    Math.sign(a.patch - b.patch) ||
    comparePre(a.pre, b.pre)
  );
}

/** Whether `latest` is a version worth telling someone on `current`
    about. It has to read as a version and come after the running one.
    A pre-release is only announced to someone already running a
    pre-release: a release candidate is nobody's update by surprise. */
export function isUpdate(latest: unknown, current: string): boolean {
  const next = parseVersion(latest);
  const running = parseVersion(current);
  if (!next || !running) return false;
  if (next.pre.length > 0 && running.pre.length === 0) return false;
  return compareVersions(next, running) > 0;
}
