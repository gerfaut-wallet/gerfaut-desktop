import { describe, expect, it } from "vitest";
import { explorerTxUrl } from "../lib/explorer";
import { PREMIUM_URL, RENEW_URL } from "../lib/premium";
import { RELEASES_URL } from "../state/update";

const files = import.meta.glob(
  ["../../src-tauri/capabilities/default.json", "../../src-tauri/tauri.conf.json"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

function read<T>(name: string): T {
  const [, raw] = Object.entries(files).find(([path]) => path.endsWith(name))!;
  return JSON.parse(raw) as T;
}

type Permission = string | { identifier: string; allow?: { url: string }[] };

const permissions = read<{ permissions: Permission[] }>("default.json").permissions;

/** The URL patterns the window may open, as the opener plugin reads
    them: a glob, where `*` is any run of characters and `?` any one. */
const patterns = permissions
  .filter((entry): entry is Exclude<Permission, string> => typeof entry !== "string")
  .filter((entry) => entry.identifier === "opener:allow-open-url")
  .flatMap((entry) => entry.allow ?? [])
  .map(({ url }) => {
    expect(url).not.toMatch(/[[\]{}]/);
    const source = url
      .split("")
      .map((c) => (c === "*" ? ".*" : c === "?" ? "." : c.replace(/[.+^$()|\/]/g, "\\$&")))
      .join("");
    return new RegExp(`^${source}$`);
  });

const opens = (url: string) => patterns.some((pattern) => pattern.test(url));

/** What the window can make the system open is a short list written
    here, not any address a page gone wrong could name: the explorer,
    the releases page, the Premium page, the alerts bot and the ntfy
    topic. */
describe("addresses the window may open", () => {
  it("names no scope wider than its own list", () => {
    expect(permissions).not.toContain("opener:allow-default-urls");
    expect(permissions).not.toContain("opener:allow-open-url");
    expect(permissions).not.toContain("opener:default");
    expect(patterns.length).toBeGreaterThan(0);
  });

  it("opens every page the app links to", () => {
    const txid = "ab".repeat(32);
    for (const url of [
      explorerTxUrl("mainnet", txid),
      explorerTxUrl("signet", txid),
      explorerTxUrl("testnet4", txid),
      RELEASES_URL,
      PREMIUM_URL,
      RENEW_URL,
      "https://t.me/GerfautAlertsBot?start=K7QM2XRA",
      "ntfy://ntfy.gerfaut-wallet.com/abcdefghijkmnpqrstuvwxyz23456789",
    ]) {
      expect(opens(url), url).toBe(true);
    }
  });

  it("opens nothing else", () => {
    for (const url of [
      "https://evil.example/",
      "http://mempool.space/tx/ab",
      "https://mempool.space.evil.example/tx/ab",
      "https://mempool.space@evil.example/tx/ab",
      "https://mempoolxspace/tx/ab",
      "https://github.com/someone/else/releases/latest",
      "https://gerfaut-wallet.com.evil.example/premium",
      "https://t.me/SomeoneElsesBot?start=K7QM2XRA",
      "ntfy://evil.example/topic",
      "file:///C:/Windows/System32/calc.exe",
      "mailto:someone@example.com",
    ]) {
      expect(opens(url), url).toBe(false);
    }
  });
});

describe("content security policy", () => {
  it("loads nothing from outside the app, and allows no plugin, base or form target", () => {
    const csp = read<{ app: { security: { csp: string } } }>("tauri.conf.json").app.security.csp;
    const directives = new Map(
      csp.split(";").map((part) => {
        const [name, ...values] = part.trim().split(/\s+/);
        return [name, values.join(" ")] as const;
      }),
    );
    expect(directives.get("default-src")).toBe("'self'");
    expect(directives.get("object-src")).toBe("'none'");
    expect(directives.get("base-uri")).toBe("'none'");
    expect(directives.get("form-action")).toBe("'none'");
    expect(directives.has("script-src")).toBe(false);
    expect(directives.has("connect-src")).toBe(false);
  });
});
