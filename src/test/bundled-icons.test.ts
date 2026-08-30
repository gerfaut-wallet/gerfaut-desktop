import { describe, expect, it } from "vitest";

/** Everything `tauri icon` left under the mobile folders, if anything. */
const android = import.meta.glob("../../src-tauri/icons/android/**/*");
const ios = import.meta.glob("../../src-tauri/icons/ios/**/*");

const config = import.meta.glob("../../src-tauri/tauri.conf.json", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** `tauri icon` writes a full mobile set whether or not the project has
    a mobile target. This one does not, and what it left behind was an
    adaptive foreground that was the finished tile itself — the mark on
    an opaque square with its corners already rounded, which the
    launcher then masks a second time. That is the exact mistake the
    icon decision was written to prevent. Dead output contradicting a
    written decision is worse than no output: it reads as the intended
    result the day someone opens the folder. */
describe("bundled icons", () => {
  it("ships no mobile icon set, for a target this app does not have", () => {
    expect(Object.keys(android)).toEqual([]);
    expect(Object.keys(ios)).toEqual([]);
  });

  it("names no mobile icon in the bundle configuration", () => {
    const raw = Object.values(config)[0];
    const bundle: { bundle: { icon: string[] } } = JSON.parse(raw);
    expect(bundle.bundle.icon.length).toBeGreaterThan(0);
    for (const icon of bundle.bundle.icon) {
      expect(icon).not.toMatch(/android|ios/);
    }
  });
});
