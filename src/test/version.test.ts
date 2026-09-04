import { describe, expect, it } from "vitest";

/** The version lives in four files that nothing links together: the npm
    manifest, the Cargo manifest, the Tauri configuration, and the line
    the About card prints. A tag ships whatever they say, and one left
    behind ships a build that lies about which build it is. */
const raw = import.meta.glob(
  [
    "../../package.json",
    "../../src-tauri/Cargo.toml",
    "../../src-tauri/tauri.conf.json",
    "../../CHANGELOG.md",
    "../views/settings/AboutSection.tsx",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

const read = (suffix: string) => {
  const entry = Object.entries(raw).find(([path]) => path.endsWith(suffix));
  if (!entry) throw new Error(`no such file: ${suffix}`);
  return entry[1];
};

const current = () =>
  (JSON.parse(read("package.json")) as { version: string }).version;

/** The first `version = "x"` of a TOML file, which is the package's own:
    dependencies carry theirs inline, after a name. */
const cargoVersion = (toml: string) => /^version = "(.+)"$/m.exec(toml)?.[1];

describe("version", () => {
  it("reads the same in every file that carries it", () => {
    const npm = current();
    expect(npm).toMatch(/^\d+\.\d+\.\d+$/);
    expect(cargoVersion(read("Cargo.toml"))).toBe(npm);
    expect((JSON.parse(read("tauri.conf.json")) as { version: string }).version).toBe(npm);
    expect(/APP_VERSION = "(.+)"/.exec(read("AboutSection.tsx"))?.[1]).toBe(npm);
  });

  it("is a version the changelog has an entry for", () => {
    const changelog = read("CHANGELOG.md");
    const headings = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)]/gm)].map((m) => m[1]);
    expect(headings).toContain(current());
  });
});
