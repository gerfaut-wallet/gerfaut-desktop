import { describe, expect, it } from "vitest";
import { explorerTxUrl } from "../lib/explorer";
import { RELEASES_URL } from "../state/update";
import { ISSUES_URL } from "../views/settings/AboutSection";

const files = import.meta.glob(
  [
    "../../src-tauri/capabilities/default.json",
    "../../src-tauri/tauri.conf.json",
    "../../src-tauri/src/links.rs",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

function raw(name: string): string {
  const [, text] = Object.entries(files).find(([path]) => path.endsWith(name))!;
  return text;
}

function read<T>(name: string): T {
  return JSON.parse(raw(name)) as T;
}

type Permission = string | { identifier: string; allow?: { url: string }[] };

const permissions = read<{ permissions: Permission[] }>("default.json").permissions;

/** The window's whole reach outside the app's own commands: listening
    to the events the Rust side sends. `core:default` would add the
    window, webview, menu, tray, path and resource commands and the
    right to emit events, none of which the window uses: a page gone
    wrong could have hidden, moved or closed the window, or read where
    the system keeps the app's data. */
describe("permissions of the window", () => {
  it("names each one it uses, and nothing more", () => {
    const names = permissions.map((entry) => (typeof entry === "string" ? entry : entry.identifier));
    expect(names).toEqual(["core:event:allow-listen", "core:event:allow-unlisten"]);
  });
});

/** What the window can make the system open is a short list the app's
    own command holds, not any address a page gone wrong could name:
    the explorer, the releases page, the issues page, and the page a
    price source's credit links to. The opener plugin's own command,
    which would open any address its scope lets through, is out of
    reach. The refusals are tested in src-tauri/src/links.rs. */
describe("addresses the window may open", () => {
  it("gives the window no opener permission", () => {
    for (const entry of permissions) {
      const name = typeof entry === "string" ? entry : entry.identifier;
      expect(name.startsWith("opener:"), name).toBe(false);
    }
  });

  it("names, in the app's command, every page the window links to", () => {
    const links = raw("links.rs");
    const txid = "ab".repeat(32);
    for (const url of [
      RELEASES_URL,
      ISSUES_URL,
      ...(["mainnet", "signet", "testnet4"] as const).map((network) =>
        explorerTxUrl(network, txid).slice(0, -txid.length),
      ),
    ]) {
      expect(links, url).toContain(`"${url}"`);
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
