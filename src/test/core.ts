// The reference JSON of gerfaut-core: what the core sends for every type
// that crosses the bridge, in tests/bridge/<Type>.json of the checkout
// beside this repository (the one src-tauri/Cargo.toml builds against,
// at .github/gerfaut-core.rev in CI). Each file maps a case name to one
// value. vite.config.ts lets the tests read that folder.

const files = import.meta.glob("../../../gerfaut-core/tests/bridge/*.json", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Where the files are read from, for the messages. */
export const CORE_FIXTURES_DIR = "../gerfaut-core/tests/bridge";

/** The cases the core writes for each type, by type name. */
export const coreFixtures: ReadonlyMap<string, Readonly<Record<string, unknown>>> = new Map(
  Object.entries(files).map(([path, text]) => [
    path.slice(path.lastIndexOf("/") + 1, -".json".length),
    JSON.parse(text) as Record<string, unknown>,
  ]),
);

/** One case of a type, as it comes over IPC: unchecked here, the
    contract test checks it. */
export function coreCase<T>(type: string, name: string): T {
  const cases = coreFixtures.get(type);
  if (!cases) {
    throw new Error(`no ${type}.json in ${CORE_FIXTURES_DIR}: check out gerfaut-core beside this repository`);
  }
  if (!(name in cases)) throw new Error(`${type}.json has no case ${name}`);
  return JSON.parse(JSON.stringify(cases[name])) as T;
}
