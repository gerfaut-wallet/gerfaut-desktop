import { describe, expect, it } from "vitest";
import { moveItem, sortByIds } from "./reorder";

describe("moveItem", () => {
  it("moves an item down and up", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
  });

  it("leaves the list alone when nothing moves or an index is off", () => {
    const list = ["a", "b", "c"];
    expect(moveItem(list, 1, 1)).toBe(list);
    expect(moveItem(list, -1, 1)).toBe(list);
    expect(moveItem(list, 0, 3)).toBe(list);
    expect(list).toEqual(["a", "b", "c"]);
  });
});

describe("sortByIds", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("reads the items in the order asked for", () => {
    expect(sortByIds(items, ["c", "a", "b"]).map((item) => item.id)).toEqual(["c", "a", "b"]);
  });

  it("keeps what the order does not name after it, in place", () => {
    expect(sortByIds(items, ["b"]).map((item) => item.id)).toEqual(["b", "a", "c"]);
    expect(sortByIds(items, ["c", "zz"]).map((item) => item.id)).toEqual(["c", "a", "b"]);
  });
});
