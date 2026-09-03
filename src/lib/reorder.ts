// Moving one item of a list and reading a list back in a chosen order:
// what reordering wallets comes down to, whichever view does it.

/** The list with the item at `from` moved to `to`; the same list when
    either index is out of range or nothing moves. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to) return list;
  if (from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** The items in the order of `ids`; anything the order does not name
    keeps its place after them, so a wallet added meanwhile still shows. */
export function sortByIds<T extends { id: string }>(items: T[], ids: string[]): T[] {
  const rank = new Map(ids.map((id, index) => [id, index]));
  return items
    .map((item, index) => ({ item, key: rank.get(item.id) ?? ids.length + index }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.item);
}
