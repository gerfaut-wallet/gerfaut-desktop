import { describe, expect, it } from "vitest";
import tokens from "./tokens.css?inline";

/** Every declaration the built stylesheet gives `selector` on its own,
    outside any at-rule, the last one of a property winning. */
function declared(selector: string): Record<string, string> {
  const props: Record<string, string> = {};
  for (const [, selectors, body] of tokens.matchAll(/(?:^|\n)([^{}@\n][^{}]*)\{([^{}]*)\}/g)) {
    if (!selectors.split(",").some((s) => s.trim() === selector)) continue;
    for (const declaration of body.split(";")) {
      const colon = declaration.indexOf(":");
      if (colon === -1) continue;
      props[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim();
    }
  }
  return props;
}

// jsdom lays nothing out, so a lifted window cannot be seen here: what
// is kept is the style that leaves the document nothing to scroll. A
// scrollIntoView or a focus moves every box above its target that can
// scroll, the window included, and `overflow: hidden` on the body only
// stops the wheel.
describe("the window", () => {
  it("has nothing to scroll, whatever a page places past its edge", () => {
    expect(declared("#root")).toMatchObject({ position: "relative", overflow: "clip" });
  });

  it("leaves the wheel to the app's own scroll boxes", () => {
    expect(declared("body")).toMatchObject({ overflow: "hidden" });
  });
});
