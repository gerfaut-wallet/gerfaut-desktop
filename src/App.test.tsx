import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type {
  AddressEntry,
  LockVerdict,
  ParsedInput,
  PolicyKey,
  PolicySnapshot,
  Settings,
  WalletMeta,
  WalletSnapshot,
} from "./lib/ipc";
import { useLock } from "./state/lock";
import { useUi } from "./state/store";

// A vault opened before: the welcome tour is behind this user, so the
// app lands on itself the way it does every other day.
/** What the core answers about Tor on a machine with no daemon. */
const TOR_STATUS = {
  mode: "auto" as const,
  socks_proxy: "127.0.0.1:9050",
  via: null,
  socks: null,
  running: false,
  bootstrapped: false,
  bootstrap_percent: 0,
  error: null,
  embedded_available: false,
};

const SETTINGS: Settings = {
  active_network: "signet",
  backends: {},
  gap_limit: 20,
  app_prefs: { "onboarding.seen": "1" },
  electrum_certs: {},
  app_lock: null,
  tor: { mode: "auto", socks_proxy: null },
};

/** A SHA-256 fingerprint in the shape openssl prints, as the core sends it. */
const FINGERPRINT =
  "4B:CD:74:8E:B9:34:A1:16:FD:6E:8D:08:D3:21:AC:2B:BE:03:50:E1:56:B6:21:92:9C:CA:55:18:BC:A7:36:4F";
const OTHER_FINGERPRINT =
  "11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00";

const WALLET: WalletMeta = {
  id: "w-1",
  name: "Cold storage",
  icon: "wallet",
  network: "signet",
  kind: {
    type: "descriptors",
    external: "wpkh(tpub.../0/*)#aaaaaaaa",
    internal: "wpkh(tpub.../1/*)#bbbbbbbb",
    script: "segwit",
  },
  recognized_as: "extended_key",
  created_at: 1_755_000_000,
  gap_limit: 20,
  scan_gap: 20,
  labels: {},
  last_sync: { at: 1_755_000_100, tip_height: 200_000, backend: "mempool.space" },
  cached: {
    balance: {
      confirmed: 150_000,
      trusted_pending: 0,
      untrusted_pending: 0,
      pending_net_sats: null,
      immature: 0,
      total: 150_000,
    },
    tx_count: 1,
  },
};

const SNAPSHOT: WalletSnapshot = {
  meta: WALLET,
  balance: WALLET.cached.balance,
  txs: [
    {
      txid: "ab".repeat(32),
      net_sats: 150_000,
      fee_sats: 210,
      status: { state: "confirmed", height: 199_990, timestamp: 1_755_000_000 },
      confirmations: 11,
    },
  ],
  tip_height: 200_000,
  truncated: false,
};

const POLICY_AT = 1_755_000_100;

/** The core's reading of the fixture wallet: one key, nothing else. */
const SINGLE_KEY_POLICY: PolicySnapshot = {
  kind: "single_key",
  script: "segwit",
  descriptor: "wpkh([9a6a2580/84'/1'/0']tpub.../<0;1>/*)#aaaaaaaa",
  policy: "pk(Key A)",
  keys: [
    {
      id: "k0",
      label: "Key A",
      fingerprint: "9a6a2580",
      origin_path: "m/84'/1'/0'",
      key_short: "tpubDDnG…so9Kks",
    },
  ],
  branches: [
    {
      id: "b0",
      role: "primary",
      label: "Primary",
      summary: "Key A",
      condition: { kind: "key", key_id: "k0" },
      timelocks: [],
      state: { kind: "spendable_now" },
      spendable_now: true,
    },
  ],
  tip_height: 200_000,
  computed_at: POLICY_AT,
  time_basis: "wall_clock",
  coins: 1,
  has_timelocks: false,
};

const KEY_A: PolicyKey = {
  id: "k0",
  label: "Key A",
  fingerprint: "3442193e",
  origin_path: null,
  key_short: "xpubA…aaaaaa",
};
const KEY_B: PolicyKey = {
  id: "k1",
  label: "Key B",
  fingerprint: "5c1bd648",
  origin_path: "m/48'/1'/0'/2'",
  key_short: "xpubB…bbbbbb",
};
const KEY_C: PolicyKey = {
  id: "k2",
  label: "Key C",
  fingerprint: "bd16bee5",
  origin_path: null,
  key_short: "xpubC…cccccc",
};

/** 42 480 blocks to go on the nearest coin: 295 days at ten minutes a block. */
const NEXT_COIN = {
  remaining_blocks: 42_480,
  remaining_seconds: 42_480 * 600,
  unlocks_at_unix: POLICY_AT + 42_480 * 600,
};

/** A Liana-style wallet: Key A any time, Key B after a year-long wait.
    The core lists branches as the policy wrote them; here the recovery
    path comes first on purpose, so the page has to put them in order. */
const LIANA_POLICY: PolicySnapshot = {
  kind: "miniscript",
  script: "witness_script",
  descriptor: "wsh(or_d(pk(xpubA.../0/*),and_v(v:pkh(xpubB.../0/*),older(52560))))#cccccccc",
  policy: "or(pk(Key A),and(pk(Key B),older(52560)))",
  keys: [KEY_A, KEY_B],
  branches: [
    {
      id: "b1",
      role: "recovery",
      label: "Recovery",
      summary: "Key B, once a coin has waited 52,560 blocks",
      condition: {
        kind: "thresh",
        k: 2,
        n: 2,
        items: [
          { kind: "key", key_id: "k1" },
          { kind: "older", lock: { kind: "blocks", blocks: 52_560 } },
        ],
      },
      timelocks: [
        {
          lock: { kind: "relative", lock: { kind: "blocks", blocks: 52_560 } },
          required: true,
          state: { kind: "per_coin", unlocked: 1, waiting: 0, locked: 2, next: NEXT_COIN },
        },
      ],
      state: { kind: "per_coin", unlocked: 1, waiting: 0, locked: 2, next: NEXT_COIN },
      spendable_now: false,
    },
    {
      id: "b0",
      role: "primary",
      label: "Primary",
      summary: "Key A",
      condition: { kind: "key", key_id: "k0" },
      timelocks: [],
      state: { kind: "spendable_now" },
      spendable_now: true,
    },
  ],
  tip_height: 200_000,
  computed_at: POLICY_AT,
  time_basis: "wall_clock",
  coins: 3,
  has_timelocks: true,
};

const MULTISIG_POLICY: PolicySnapshot = {
  kind: "multisig",
  script: "witness_script",
  descriptor: "wsh(sortedmulti(2,xpubA.../0/*,xpubB.../0/*,xpubC.../0/*))#dddddddd",
  policy: "thresh(2,pk(Key A),pk(Key B),pk(Key C))",
  keys: [KEY_A, KEY_B, KEY_C],
  branches: [
    {
      id: "b0",
      role: "primary",
      label: "Primary",
      summary: "Any 2 of 3 keys",
      condition: {
        kind: "thresh",
        k: 2,
        n: 3,
        items: [
          { kind: "key", key_id: "k0" },
          { kind: "key", key_id: "k1" },
          { kind: "key", key_id: "k2" },
        ],
      },
      timelocks: [],
      state: { kind: "spendable_now" },
      spendable_now: true,
    },
  ],
  tip_height: 200_000,
  computed_at: POLICY_AT,
  time_basis: "wall_clock",
  coins: 0,
  has_timelocks: false,
};

/** `sortedmulti(1, A, B)`: one threshold to the core's kind, and one
    branch per key in its list, each a primary path of its own. */
const ANY_KEY_POLICY: PolicySnapshot = {
  ...MULTISIG_POLICY,
  descriptor: "wsh(sortedmulti(1,xpubA.../0/*,xpubB.../0/*))#eeeeeeee",
  policy: "or(pk(Key A),pk(Key B))",
  keys: [KEY_A, KEY_B],
  branches: [
    {
      id: "b0",
      role: "primary",
      label: "Primary",
      summary: "Key A",
      condition: { kind: "key", key_id: "k0" },
      timelocks: [],
      state: { kind: "spendable_now" },
      spendable_now: true,
    },
    {
      id: "b1",
      role: "primary",
      label: "Primary B",
      summary: "Key B",
      condition: { kind: "key", key_id: "k1" },
      timelocks: [],
      state: { kind: "spendable_now" },
      spendable_now: true,
    },
  ],
};

/** `sortedmulti(1, A, B, C)` as the core sends it now: one branch whose
    threshold is any one of three keys. */
const ANY_OF_THREE_POLICY: PolicySnapshot = {
  ...MULTISIG_POLICY,
  descriptor: "wsh(sortedmulti(1,xpubA.../0/*,xpubB.../0/*,xpubC.../0/*))#ffffffff",
  policy: "or(pk(Key A),pk(Key B),pk(Key C))",
  branches: [
    {
      id: "b0",
      role: "primary",
      label: "Primary",
      summary: "any of 3 keys",
      condition: {
        kind: "thresh",
        k: 1,
        n: 3,
        items: [
          { kind: "key", key_id: "k0" },
          { kind: "key", key_id: "k1" },
          { kind: "key", key_id: "k2" },
        ],
      },
      timelocks: [],
      state: { kind: "spendable_now" },
      spendable_now: true,
    },
  ],
};

const ADDRESS_POLICY: PolicySnapshot = {
  kind: "address",
  script: "segwit",
  descriptor: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
  policy: "address",
  keys: [],
  branches: [],
  tip_height: 200_000,
  computed_at: POLICY_AT,
  time_basis: "wall_clock",
  coins: 1,
  has_timelocks: false,
};

/** The height-locked wallet before its first sync: no tip, so the core
    reports the lock ahead with nothing left to say about it. */
function unsynced(): PolicySnapshot {
  const base = heightLocked(1_432);
  const unknown = { remaining_blocks: null, remaining_seconds: null, unlocks_at_unix: null };
  return {
    ...base,
    tip_height: null,
    branches: base.branches.map((branch) => ({
      ...branch,
      state: { kind: "locked", until: unknown },
      timelocks: branch.timelocks.map((timelock) => ({
        ...timelock,
        state: { kind: "locked", until: unknown },
      })),
    })),
  };
}

/** Key A behind an absolute time lock `seconds` ahead of the clock: a
    lock the chain judges by a median time that trails the clock. */
function timeLocked(seconds: number): PolicySnapshot {
  const unix = POLICY_AT + seconds;
  const remaining = { remaining_blocks: null, remaining_seconds: seconds, unlocks_at_unix: unix };
  return {
    ...SINGLE_KEY_POLICY,
    kind: "miniscript",
    script: "witness_script",
    policy: `and(pk(Key A),after(${unix}))`,
    coins: 0,
    has_timelocks: true,
    branches: [
      {
        id: "b0",
        role: "primary",
        label: "Primary",
        summary: "Key A after 2025-08-22",
        condition: {
          kind: "thresh",
          k: 2,
          n: 2,
          items: [
            { kind: "key", key_id: "k0" },
            { kind: "after", lock: { kind: "time", unix } },
          ],
        },
        timelocks: [
          {
            lock: { kind: "absolute", lock: { kind: "time", unix } },
            required: true,
            state: { kind: "locked", until: remaining },
          },
        ],
        state: { kind: "locked", until: remaining },
        spendable_now: false,
      },
    ],
  };
}

/** Key A behind an absolute height lock still `blocks` ahead of the tip:
    the only path, and it waits. */
function heightLocked(blocks: number): PolicySnapshot {
  const height = 200_000 + blocks;
  const remaining = {
    remaining_blocks: blocks,
    remaining_seconds: blocks * 600,
    unlocks_at_unix: POLICY_AT + blocks * 600,
  };
  return {
    ...SINGLE_KEY_POLICY,
    kind: "miniscript",
    script: "witness_script",
    policy: `and(pk(Key A),after(${height}))`,
    coins: 0,
    has_timelocks: true,
    branches: [
      {
        id: "b0",
        role: "primary",
        label: "Primary",
        summary: `Key A after block ${height}`,
        condition: {
          kind: "thresh",
          k: 2,
          n: 2,
          items: [
            { kind: "key", key_id: "k0" },
            { kind: "after", lock: { kind: "height", height } },
          ],
        },
        timelocks: [
          {
            lock: { kind: "absolute", lock: { kind: "height", height } },
            required: true,
            state: { kind: "locked", until: remaining },
          },
        ],
        state: { kind: "locked", until: remaining },
        spendable_now: false,
      },
    ],
  };
}

const PARSED_TPUB: ParsedInput = {
  kind: "extended_key",
  networks: ["signet", "testnet4", "regtest"],
  payload: {
    type: "descriptors",
    external: "wpkh(tpub.../0/*)#aaaaaaaa",
    internal: "wpkh(tpub.../1/*)#bbbbbbbb",
    script: "segwit",
  },
  warnings: ["assumed_segwit"],
  script_options: ["legacy", "nested_segwit", "segwit", "taproot"],
  derivation: { receive: "0/*", change: "1/*", origin: null },
  derivation_editable: true,
  preview_address: "tb1qpreview0segwit000000000000000000000000",
};

/** What the core answers when the user picks Taproot for the same key. */
const PARSED_TPUB_TAPROOT: ParsedInput = {
  ...PARSED_TPUB,
  payload: {
    type: "descriptors",
    external: "tr(tpub.../0/*)#cccccccc",
    internal: "tr(tpub.../1/*)#dddddddd",
    script: "taproot",
  },
  warnings: [],
  preview_address: "tb1ppreview0taproot00000000000000000000000",
};

const PRICE_HISTORY = {
  points: [
    { t: 1_754_000_000, rate: 90_000 },
    { t: 1_754_500_000, rate: 95_000 },
    { t: 1_755_000_000, rate: 100_000 },
  ],
  currency: "eur",
  source: "coingecko",
  range: "month",
  at: 1_755_000_000,
};

/** What the core publishes for signet, the workspace network here. */
const PUBLIC_SERVERS = [
  {
    id: "mempool.space",
    label: "mempool.space",
    protocol: "esplora",
    url: "https://mempool.space/signet/api",
    self_signed: false,
  },
  {
    id: "blockstream.info",
    label: "blockstream.info",
    protocol: "esplora",
    url: "https://blockstream.info/signet/api",
    self_signed: false,
  },
  {
    id: "electrum:mempool.space",
    label: "mempool.space:60602",
    protocol: "electrum",
    url: "ssl://mempool.space:60602",
    self_signed: false,
  },
  {
    id: "electrum:own.example",
    label: "own.example:50002",
    protocol: "electrum",
    url: "ssl://own.example:50002",
    self_signed: true,
  },
];

function receiveEntries(lookahead: number): AddressEntry[] {
  return Array.from({ length: lookahead + 1 }, (_, index) => ({
    index,
    address: `tb1qexampleaddress${index}xxxxxxxxxxxxxxxxxxxx`,
    used: false,
    derivation: `m/84'/1'/0'/0/${index}`,
  }));
}

/** The IPC surface shared by most suites; tests override per case. */
function walletIpc(overrides: Record<string, (args: Record<string, unknown>) => unknown> = {}) {
  mockIPC((cmd, args) => {
    const payload = (args ?? {}) as Record<string, unknown>;
    if (overrides[cmd]) return overrides[cmd](payload);
    switch (cmd) {
      case "get_settings":
        return SETTINGS;
      case "public_servers":
        return PUBLIC_SERVERS;
      case "list_wallets":
        return [WALLET];
      case "wallet_snapshot":
        return SNAPSHOT;
      case "utxos":
        return [
          {
            txid: "cd".repeat(32),
            vout: 0,
            address: "tb1qutxoaddress",
            value_sats: 150_000,
            status: { state: "confirmed", height: 199_990, timestamp: 1_755_000_000 },
            keychain: "external",
            derivation_index: 0,
          },
        ];
      case "receive_addresses":
        return receiveEntries(Number(payload.lookahead ?? 0));
      case "wallet_policy":
        return SINGLE_KEY_POLICY;
      case "sync_all":
        return { reports: [], failures: [] };
      case "set_app_pref":
        return undefined;
      case "fetch_price":
        return { rate: 100_000, currency: "eur", source: "coingecko", at: 1_755_000_000 };
      case "fetch_price_history":
        return PRICE_HISTORY;
      case "address_list":
        return {
          external: [
            { index: 0, address: "tb1qexternalzero", used: true, balance_sats: 0 },
            { index: 1, address: "tb1qexternalone", used: false, balance_sats: 150_000 },
          ],
          internal: [
            { index: 0, address: "tb1qchangezero", used: true, balance_sats: 0 },
          ],
          truncated: false,
        };
      default:
        throw new Error(`unexpected command ${cmd} ${JSON.stringify(args)}`);
    }
  });
}

function renderApp() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

function sidebar() {
  return within(screen.getByRole("navigation", { name: "Navigation" }));
}

/** Opens Settings from the sidebar, then one of its sections. */
async function openSettings(user: ReturnType<typeof userEvent.setup>, section: string) {
  await user.click(sidebar().getByRole("button", { name: "Settings" }));
  const nav = await screen.findByRole("navigation", { name: "Settings sections" });
  await user.click(within(nav).getByRole("button", { name: section }));
}

/** Picks a row of the shared Select by its visible label. */
async function choose(user: ReturnType<typeof userEvent.setup>, name: string | RegExp, label: string) {
  await user.click(screen.getByRole("combobox", { name }));
  const list = await screen.findByRole("listbox", { name });
  await user.click(within(list).getByRole("option", { name: new RegExp(`^${label}`) }));
}

/** A preview as the core returns it for a signed, well-formed
    transaction spending one watched coin. */
const PREVIEW = {
  txid: "ab".repeat(32),
  source: "psbt",
  network: "signet",
  inputs: [
    {
      txid: "cd".repeat(32),
      vout: 0,
      value_sats: 150_000,
      address: "tb1qutxoaddress",
      signed: true,
      wallet: { id: "w-1", name: "Cold storage" },
    },
  ],
  outputs: [
    { index: 0, value_sats: 100_000, address: "tb1qsomeoneelse", op_return: null, wallet: null, change: false },
    {
      index: 1,
      value_sats: 49_000,
      address: "tb1qchangezero",
      op_return: null,
      wallet: { id: "w-1", name: "Cold storage" },
      change: true,
    },
  ],
  fee_sats: 1_000,
  fee_rate_sat_vb: 7.1,
  vsize: 141,
  weight: 561,
  size: 222,
  version: 2,
  locktime: 0,
  rbf: true,
  ready: true,
  // The core answers the tone: a screen never derives it.
  warnings: [
    { kind: "spends_watched", severity: "info", message: "Spends coins of Cold storage." },
  ],
  hex: "02000000deadbeef",
};

beforeEach(() => {
  useUi.setState({
    view: "home",
    settingsSection: "general",
    activeWalletId: null,
    selectedTxid: null,
    addWalletOpen: false,
    sidebarCollapsed: false,
    masked: false,
    theme: "light",
    unit: "btc",
    fiatEnabled: false,
    fiatCurrency: "eur",
    fiatSource: "coingecko",
    priceRange: "month",
    explorerAck: false,
    toast: null,
    syncErrors: {},
  });
});

describe("empty workspace", () => {
  beforeEach(() => {
    mockIPC((cmd) => {
      switch (cmd) {
        case "get_settings":
          return SETTINGS;
        case "list_wallets":
          return [];
        default:
          throw new Error(`unexpected command ${cmd}`);
      }
    });
  });

  it("shows the empty state and disables the wallet pages", async () => {
    renderApp();
    expect(await screen.findByText("No wallets watched yet")).toBeInTheDocument();
    // One action in the canvas, one in the sidebar switcher slot.
    expect(screen.getAllByRole("button", { name: /add a wallet/i })).toHaveLength(2);
    expect(sidebar().getByRole("button", { name: "Overview" })).toBeDisabled();
    expect(sidebar().getByRole("button", { name: "Transactions" })).toBeDisabled();
    // Settings stays reachable without a wallet.
    expect(sidebar().getByRole("button", { name: "Settings" })).toBeEnabled();
  });
});

describe("overview", () => {
  beforeEach(() => walletIpc());

  it("renders the fixed dashboard: balance, counts, price, status, charts", async () => {
    renderApp();
    expect(await screen.findByText("0.00150000")).toBeInTheDocument();
    expect(screen.getByText("Total balance")).toBeInTheDocument();
    expect(screen.getByText("Bitcoin price")).toBeInTheDocument();
    expect(screen.getByText("Latest activity")).toBeInTheDocument();
    expect(screen.getByText("Received")).toBeInTheDocument();
    expect(screen.getByText("Balance history")).toBeInTheDocument();
    expect(screen.getByText("Watch status")).toBeInTheDocument();
    // Counts lead to their pages.
    expect(await screen.findByRole("button", { name: /1 UTXO/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1 transaction/ })).toBeInTheDocument();
    // The freshness line lives in Watch status only, not under the title.
    expect(screen.queryByText(/synced .* mempool\.space/i)).not.toBeInTheDocument();
    expect(screen.getByText("Backend")).toBeInTheDocument();
    // Nothing to customize: the dashboard is fixed.
    expect(screen.queryByRole("button", { name: /customize/i })).not.toBeInTheDocument();
    // One unit only: no sats echo under the BTC figure.
    expect(screen.queryByText(/150 000 sats/)).not.toBeInTheDocument();
    // The fee card is gone: fees were never a watch-only question. Two
    // shortcuts into the settings hold its place.
    expect(screen.queryByText("Network fees")).not.toBeInTheDocument();
    expect(screen.getByText("Shortcuts")).toBeInTheDocument();
  });

  it("shows the price with a signed change pill, no chart", async () => {
    renderApp();
    // 90k -> 100k over the mocked series.
    expect(await screen.findByText("+11.1%")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /bitcoin price/i })).not.toBeInTheDocument();
    // The compact widget offers no Max range.
    expect(screen.queryByRole("radio", { name: "Max" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "1D" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "1Y" })).toBeInTheDocument();
  });

  it("charts the wallet balance over its life", async () => {
    renderApp();
    expect(
      await screen.findByRole("img", { name: /wallet balance over time/i }),
    ).toBeInTheDocument();
  });

  it("states a failed sync on the dashboard instead of a silent figure", async () => {
    useUi.setState({ syncErrors: { [WALLET.id]: "mempool.space: connection timed out" } });
    renderApp();
    expect(await screen.findByText("Sync failed")).toBeInTheDocument();
    expect(screen.getByText("Sync failed: showing the last known balance.")).toBeInTheDocument();
    expect(screen.getByText("mempool.space: connection timed out")).toBeInTheDocument();
  });

  it("shows why a sync failed under the status", async () => {
    const why = "sync failed via blockstream.info: timed out after 60 s";
    useUi.setState({ syncErrors: { [WALLET.id]: why } });
    renderApp();
    expect(await screen.findByText("Sync failed")).toBeInTheDocument();
    // The reason sits on the card, not behind a hover. It is clamped to
    // two lines, with the whole sentence kept in the tooltip.
    const detail = screen.getByText(why);
    expect(detail).toBeVisible();
    expect(detail).toHaveClass("line-clamp-2");
    expect(detail).toHaveAttribute("title", why);
    // Said once: the pill no longer carries the sentence as a label too.
    expect(screen.queryByLabelText(/^Sync failed:/)).not.toBeInTheDocument();
  });

  it("says nothing under a balance with nothing in flight", async () => {
    renderApp();
    expect(await screen.findByText("0.00150000")).toBeInTheDocument();
    // The normal state does not announce itself: no note, no clock.
    expect(screen.queryByText(/all funds confirmed/i)).not.toBeInTheDocument();
    expect(screen.queryByText("pending")).not.toBeInTheDocument();
  });

  it("shows what of the total is still out of a block, signed", async () => {
    walletIpc({
      wallet_snapshot: () => ({
        ...SNAPSHOT,
        balance: { ...SNAPSHOT.balance, total: 200_000, pending_net_sats: 50_000 },
      }),
    });
    renderApp();
    // The total already counts the arriving funds; the line under it
    // says how much of it is still waiting, in the unit of the total.
    expect(await screen.findByText("0.00200000")).toBeInTheDocument();
    expect(screen.getByText("+0.00050000 BTC")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
    expect(screen.queryByText(/includes pending/i)).not.toBeInTheDocument();
  });

  it("signs a spend the chain has not taken yet as a minus", async () => {
    walletIpc({
      wallet_snapshot: () => ({
        ...SNAPSHOT,
        balance: { ...SNAPSHOT.balance, total: 69_000, pending_net_sats: -31_000 },
      }),
    });
    renderApp();
    expect(await screen.findByText("-0.00031000 BTC")).toBeInTheDocument();
  });

  it("lets a sync failure outrank the pending line", async () => {
    useUi.setState({ syncErrors: { [WALLET.id]: "mempool.space: connection timed out" } });
    walletIpc({
      wallet_snapshot: () => ({
        ...SNAPSHOT,
        balance: { ...SNAPSHOT.balance, pending_net_sats: 50_000 },
      }),
    });
    renderApp();
    // A figure whose source is in doubt is not one to detail.
    expect(
      await screen.findByText("Sync failed: showing the last known balance."),
    ).toBeInTheDocument();
    expect(screen.queryByText("+0.00050000 BTC")).not.toBeInTheDocument();
  });

  it("never pretends a wallet that has not synced holds nothing", async () => {
    const unsynced: WalletMeta = { ...WALLET, last_sync: null };
    walletIpc({
      list_wallets: () => [unsynced],
      wallet_snapshot: () => ({ ...SNAPSHOT, meta: unsynced, txs: [] }),
    });
    renderApp();
    expect(await screen.findByText("Not synced yet.")).toBeInTheDocument();
  });

  it("navigates from the count rows", async () => {
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /1 UTXO/ }));
    expect(await screen.findByRole("heading", { name: /utxos/i })).toBeInTheDocument();
  });

  it("opens the settings on the section a shortcut names", async () => {
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /backup & sync/i }));
    expect(await screen.findByRole("heading", { name: /settings/i })).toBeInTheDocument();
    expect(useUi.getState().settingsSection).toBe("backup");

    await user.click(sidebar().getByRole("button", { name: "Overview" }));
    // The row says where it leads, for a reader who cannot see the icon.
    await user.click(
      await screen.findByRole("button", { name: /manage wallets, rename, reorder, remove/i }),
    );
    expect(useUi.getState().view).toBe("settings");
    expect(useUi.getState().settingsSection).toBe("wallets");
  });

  it("leads from the watch status to the node settings", async () => {
    renderApp();
    const user = userEvent.setup();
    const status = within(await screen.findByRole("region", { name: "Watch status" }));
    await user.click(status.getByRole("button", { name: "Node settings →" }));
    expect(useUi.getState().view).toBe("settings");
    expect(useUi.getState().settingsSection).toBe("network");
  });

  it("renames the wallet from its title", async () => {
    const renames: Record<string, unknown>[] = [];
    walletIpc({
      rename_wallet: (args) => {
        renames.push(args);
        return undefined;
      },
    });
    renderApp();
    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Cold storage" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Rename this wallet" }));
    // The title becomes the field, prefilled and ready to overtype.
    const field = screen.getByRole("textbox", { name: "Wallet name" });
    expect(field).toHaveFocus();
    expect(field).toHaveValue("Cold storage");
    await user.clear(field);
    await user.type(field, "  Vault {Enter}");
    await waitFor(() => expect(renames).toEqual([{ id: "w-1", name: "Vault" }]));
    // The accepted name shows at once, and the keyboard lands back on
    // the title it left.
    expect(await screen.findByRole("heading", { name: "Vault" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename this wallet" })).toHaveFocus();
  });

  it("writes nothing for an escaped, unchanged or empty name", async () => {
    const renames: Record<string, unknown>[] = [];
    walletIpc({
      rename_wallet: (args) => {
        renames.push(args);
        return undefined;
      },
    });
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Rename this wallet" }));
    await user.clear(screen.getByRole("textbox", { name: "Wallet name" }));
    await user.keyboard("Nope{Escape}");
    expect(screen.getByRole("heading", { name: "Cold storage" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Wallet name" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Rename this wallet" }));
    expect(screen.getByRole("textbox", { name: "Wallet name" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: "Cold storage" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Rename this wallet" }));
    await user.clear(screen.getByRole("textbox", { name: "Wallet name" }));
    await user.keyboard("   {Enter}");
    expect(screen.getByRole("heading", { name: "Cold storage" })).toBeInTheDocument();
    expect(renames).toEqual([]);
  });

  it("says under the title what the core refused, without red", async () => {
    walletIpc({
      rename_wallet: () => {
        throw { kind: "storage", message: "a wallet name cannot exceed 64 characters" };
      },
    });
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Rename this wallet" }));
    await user.clear(screen.getByRole("textbox", { name: "Wallet name" }));
    await user.keyboard("Too long{Enter}");
    const note = await screen.findByText("a wallet name cannot exceed 64 characters");
    expect(note).toHaveClass("text-muted");
    expect(note).not.toHaveClass("text-alert");
    expect(screen.getByRole("heading", { name: "Cold storage" })).toBeInTheDocument();
  });

  it("rules the balance chart at round levels and calendar marks", async () => {
    // A life a hundred days long, so the axis reads in months whatever
    // the day the test runs on.
    const now = Math.floor(Date.now() / 1000);
    walletIpc({
      wallet_snapshot: () => ({
        ...SNAPSHOT,
        txs: [
          {
            ...SNAPSHOT.txs[0],
            status: { state: "confirmed", height: 199_990, timestamp: now - 100 * 86_400 },
          },
        ],
      }),
    });
    renderApp();
    expect(
      await screen.findByRole("img", { name: /wallet balance over time/i }),
    ).toBeInTheDocument();
    // 150 000 sats: the floor, then steps of 50 000 up to the total.
    expect(screen.getByText("0.0005 BTC")).toBeInTheDocument();
    expect(screen.getByText("0.001 BTC")).toBeInTheDocument();
    expect(screen.getByText("0.0015 BTC")).toBeInTheDocument();
    expect(screen.getAllByText(/^[A-Z][a-z]{2} \d{4}$/).length).toBeGreaterThanOrEqual(3);
  });
});


describe("navigation", () => {
  beforeEach(() => walletIpc());

  it("moves between pages from the sidebar", async () => {
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");

    await user.click(sidebar().getByRole("button", { name: "Transactions" }));
    expect(await screen.findByRole("heading", { name: /transactions/i })).toBeInTheDocument();
    expect(screen.getByText("Received")).toBeInTheDocument();

    await user.click(sidebar().getByRole("button", { name: "UTXOs" }));
    expect(await screen.findByRole("heading", { name: /utxos/i })).toBeInTheDocument();
    expect(screen.getByText("Outpoint")).toBeInTheDocument();

    await user.click(sidebar().getByRole("button", { name: "Receive" }));
    expect(await screen.findByRole("heading", { name: /receive/i })).toBeInTheDocument();
    expect(sidebar().queryByRole("button", { name: "Addresses" })).not.toBeInTheDocument();

    await user.click(sidebar().getByRole("button", { name: "Broadcast" }));
    expect(await screen.findByRole("heading", { name: /broadcast/i })).toBeInTheDocument();

    await user.click(sidebar().getByRole("button", { name: "Export" }));
    expect(await screen.findByRole("heading", { name: /export/i })).toBeInTheDocument();

    await user.click(sidebar().getByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("heading", { name: /settings/i })).toBeInTheDocument();
  });

  it("collapses the sidebar to icons and back", async () => {
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    expect(sidebar().getByText("Overview")).toBeInTheDocument();
    // The network badge sits in the bottom info area.
    expect(sidebar().getByText("Signet")).toBeInTheDocument();
    await user.click(sidebar().getByRole("button", { name: /collapse sidebar/i }));
    // Labels go; icon buttons stay reachable by name; the network badge
    // survives as its initial.
    expect(sidebar().queryByText("Overview")).not.toBeInTheDocument();
    expect(sidebar().getByRole("button", { name: "Overview" })).toBeInTheDocument();
    expect(sidebar().getByText("S")).toBeInTheDocument();
    await user.click(sidebar().getByRole("button", { name: /expand sidebar/i }));
    expect(sidebar().getByText("Overview")).toBeInTheDocument();
  });

  it("switches wallets from the dropdown, keeping the page", async () => {
    const second: WalletMeta = {
      ...WALLET,
      id: "w-2",
      name: "Lightning float",
      cached: { ...WALLET.cached, balance: { ...WALLET.cached.balance, total: 42_000 } },
    };
    const snapshots: Record<string, WalletSnapshot> = {
      "w-1": SNAPSHOT,
      "w-2": { ...SNAPSHOT, meta: second, txs: [] },
    };
    walletIpc({
      list_wallets: () => [WALLET, second],
      wallet_snapshot: (args) => snapshots[String(args.id)],
    });
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");

    await user.click(sidebar().getByRole("button", { name: "Transactions" }));
    await screen.findByRole("heading", { name: /transactions/i });

    await user.click(sidebar().getByRole("button", { name: /wallet: cold storage/i }));
    await user.click(screen.getByRole("menuitemradio", { name: /lightning float/i }));
    // Same page, other wallet.
    expect(await screen.findByRole("heading", { name: /transactions/i })).toBeInTheDocument();
    expect(await screen.findByText("No transactions yet")).toBeInTheDocument();
    expect(useUi.getState().activeWalletId).toBe("w-2");
  });

  it("shows each wallet's own icon in the switcher", async () => {
    const second: WalletMeta = {
      ...WALLET,
      id: "w-2",
      name: "Lightning float",
      icon: "snowflake",
    };
    walletIpc({ list_wallets: () => [WALLET, second] });
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");

    const trigger = sidebar().getByRole("button", { name: /wallet: cold storage/i });
    expect(trigger.querySelector("svg.lucide-wallet")).not.toBeNull();
    await user.click(trigger);
    expect(
      screen.getByRole("menuitemradio", { name: /cold storage/i }).querySelector("svg.lucide-wallet"),
    ).not.toBeNull();
    expect(
      screen
        .getByRole("menuitemradio", { name: /lightning float/i })
        .querySelector("svg.lucide-snowflake"),
    ).not.toBeNull();

    await user.click(screen.getByRole("menuitemradio", { name: /lightning float/i }));
    const next = sidebar().getByRole("button", { name: /wallet: lightning float/i });
    expect(next.querySelector("svg.lucide-snowflake")).not.toBeNull();
    expect(next.querySelector("svg.lucide-wallet")).toBeNull();
  });

  it("reorders wallets by dragging them in the switcher", async () => {
    const second: WalletMeta = { ...WALLET, id: "w-2", name: "Lightning float", icon: "key" };
    const reordered: unknown[] = [];
    walletIpc({
      list_wallets: () => [WALLET, second],
      reorder_wallets: (args) => {
        reordered.push(args.ids);
        return undefined;
      },
    });
    // jsdom lays nothing out: rows are declared 40px tall, 48px apart.
    const geometry = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const rows = [...document.querySelectorAll("[data-reorder-row]")];
        const index = rows.indexOf(this);
        const top = index === -1 ? 0 : index * 48;
        const bottom = index === -1 ? 0 : top + 40;
        return { top, bottom, height: bottom - top, left: 0, right: 0, width: 0, x: 0, y: top } as DOMRect;
      });
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    await user.click(sidebar().getByRole("button", { name: /wallet: cold storage/i }));
    const menu = screen.getByRole("menu", { name: "Wallets" });
    const names = () =>
      within(menu)
        .getAllByRole("menuitemradio")
        .map((item) => within(item).getByText(/storage|float/).textContent);
    expect(names()).toEqual(["Cold storage", "Lightning float"]);

    // The grip is the pointer's handle only; the settings rows carry the
    // keyboard's.
    const grips = menu.querySelectorAll("[title='Drag to reorder']");
    expect(grips).toHaveLength(2);
    fireEvent.pointerDown(grips[0], { button: 0, clientY: 20 });
    fireEvent.pointerMove(grips[0], { clientY: 80 });
    fireEvent.pointerUp(grips[0]);
    // The menu shows the new order at once and stays open; the vault is
    // told the whole order.
    expect(names()).toEqual(["Lightning float", "Cold storage"]);
    expect(screen.getByRole("menu", { name: "Wallets" })).toBeInTheDocument();
    await waitFor(() => expect(reordered).toEqual([["w-2", "w-1"]]));
    geometry.mockRestore();
  });

  it("has no search field and no command palette", async () => {
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    expect(screen.queryByPlaceholderText(/search/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ctrl k/i)).not.toBeInTheDocument();
    await user.keyboard("{Control>}k{/Control}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("policy page", () => {
  beforeEach(() => walletIpc());

  it("sums the policy up in the balance row and leads to the page", async () => {
    renderApp();
    const user = userEvent.setup();
    // The row reads like the counts above it, and says where it goes.
    const row = await screen.findByRole("button", { name: /^1 key, policy$/ });
    await user.click(row);
    const heading = await screen.findByRole("heading", { name: "Policy" });
    expect(screen.getByText("One key signs. Any coin is spendable now.")).toBeInTheDocument();
    expect(heading.parentElement).toHaveTextContent(/Cold storage · read at block 200.000/);
  });

  it("opens from the sidebar", async () => {
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    await user.click(sidebar().getByRole("button", { name: "Policy" }));
    expect(await screen.findByRole("heading", { name: "Policy" })).toBeInTheDocument();
    expect(sidebar().getByRole("button", { name: "Policy" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("keeps a single key to the sentence, the key and the descriptor", async () => {
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /1 key/ }));
    await screen.findByText("One key signs. Any coin is spendable now.");
    // One key needs no card: the sentence already says it all.
    expect(screen.queryByRole("region", { name: /path$/ })).not.toBeInTheDocument();
    const keys = screen.getByRole("region", { name: "Keys" });
    expect(within(keys).getByText("Key A")).toBeInTheDocument();
    expect(within(keys).getByText("9a6a2580")).toBeInTheDocument();
    expect(within(keys).getByText("m/84'/1'/0'")).toBeInTheDocument();
    expect(within(keys).getByText("tpubDDnG…so9Kks")).toBeInTheDocument();
    // The descriptor is on the page but folded, its normalized policy under it.
    const details = screen.getByText("Descriptor").closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(screen.getByText(SINGLE_KEY_POLICY.descriptor)).toBeInTheDocument();
    expect(screen.getByText("pk(Key A)")).toBeInTheDocument();
    expect(screen.queryByText(/device's clock/)).not.toBeInTheDocument();
  });

  it("reads a Liana-style wallet as two paths, the primary first", async () => {
    walletIpc({ wallet_policy: () => LIANA_POLICY });
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Recovery in 295 days/ }));
    expect(
      await screen.findByText(
        "Key A signs. A recovery key can spend once a coin has waited about 1 year.",
      ),
    ).toBeInTheDocument();
    const cards = screen.getAllByRole("region", { name: /path$/ });
    expect(cards.map((card) => card.getAttribute("aria-label"))).toEqual([
      "Primary path",
      "Recovery path",
    ]);
    const [primary, recovery] = cards;
    expect(within(primary).getByText("Spendable now")).toBeInTheDocument();
    expect(within(primary).getByText("3442193e")).toBeInTheDocument();
    // The recovery card: the condition in words, the key chip with its
    // fingerprint, the lock in blocks and time, the count of coins.
    expect(within(recovery).getByText(/^Key B and a wait of 52.560 blocks$/)).toBeInTheDocument();
    expect(within(recovery).getByText("5c1bd648")).toBeInTheDocument();
    expect(
      within(recovery).getByText(/^52.560 blocks after the coin arrives ≈ 1 year$/),
    ).toBeInTheDocument();
    const pill = within(recovery).getByText("1 of 3 coins unlocked · next in 295 days");
    expect(pill.querySelector("svg.lucide-clock")).not.toBe(null);
    // Far off: neutral, not amber.
    expect(pill).toHaveAttribute("data-tone", "neutral");
    // The nearest coin has waited 10 080 of 52 560 blocks: a fifth of the
    // way, said in words too rather than read out as a bare percentage.
    const bar = within(recovery).getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "19");
    expect(bar).toHaveAttribute("aria-valuetext", "19% of the wait");
    expect(within(recovery).getByText("Next coin").parentElement).toHaveTextContent(
      /42.480 blocks ≈ 295 days/,
    );
    // Block locks need no clock caveat.
    expect(screen.queryByText(/device's clock/)).not.toBeInTheDocument();
  });

  it("turns amber only when a lock is within thirty days", async () => {
    walletIpc({ wallet_policy: () => heightLocked(1_432) });
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Spendable in 10 days/ }));
    expect(
      await screen.findByText(/^Key A signs after block 201.432, about 10 days from now\.$/),
    ).toBeInTheDocument();
    const soon = screen.getByText(/^In 1.432 blocks ≈ 10 days$/);
    expect(soon).toHaveAttribute("data-tone", "pending");
    expect(soon.querySelector("svg.lucide-clock")).not.toBe(null);
    expect(screen.getByText(/^Block 201.432 ≈ in 10 days$/)).toBeInTheDocument();
    // An absolute lock has no start to measure from: no bar.
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("keeps a far lock neutral, in the same words", async () => {
    walletIpc({ wallet_policy: () => heightLocked(52_560) });
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Spendable in 1 year/ }));
    const far = await screen.findByText(/^In 52.560 blocks ≈ 1 year$/);
    expect(far).toHaveAttribute("data-tone", "neutral");
    expect(far.querySelector("svg.lucide-clock")).not.toBe(null);
  });

  it("says the clock decides a time lock, and what it has left", async () => {
    walletIpc({ wallet_policy: () => timeLocked(10 * 86_400) });
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Spendable in 10 days/ }));
    expect(
      await screen.findByText(/^Key A signs after \w{3} \d{2}, \d{4}, about 10 days from now\.$/),
    ).toBeInTheDocument();
    // The lock line dates the lock and says what is left, as a height lock does.
    expect(screen.getByText(/^After \w{3} \d{2}, \d{4} ≈ in 10 days$/)).toBeInTheDocument();
    // A lock the clock decides gets the caveat, once.
    expect(screen.getAllByText(/device's clock/)).toHaveLength(1);
  });

  it("says the wallet never synced rather than counting from block zero", async () => {
    walletIpc({ wallet_policy: () => unsynced() });
    renderApp();
    const user = userEvent.setup();
    // Nothing is known of the wait: the row keeps to the keys.
    await user.click(await screen.findByRole("button", { name: /^1 key, policy$/ }));
    const heading = await screen.findByRole("heading", { name: "Policy" });
    expect(heading.parentElement).toHaveTextContent(/Cold storage · not synced yet/);
    expect(heading.parentElement).not.toHaveTextContent(/read at block/);
    expect(screen.getByText(/^Key A signs after block 201.432\.$/)).toBeInTheDocument();
    const pill = screen.getByText("Locked");
    expect(pill).toHaveAttribute("data-tone", "neutral");
    expect(pill.querySelector("svg.lucide-clock")).not.toBe(null);
    // The lock line names the block and nothing more: no estimate, no
    // countdown, and never a distance of zero blocks for an unknown one.
    expect(screen.getByText(/^Block 201.432$/)).toBeInTheDocument();
    expect(screen.queryByText(/≈/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0 blocks/)).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("reads a one of three multisig the core keeps as one path", async () => {
    walletIpc({ wallet_policy: () => ANY_OF_THREE_POLICY });
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^Any of 3 keys, policy$/ }));
    expect(await screen.findByText("Any of 3 keys signs.")).toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: /path$/ })).toHaveLength(1);
    expect(screen.getByText("Key A, Key B or Key C")).toBeInTheDocument();
    expect(screen.getByText("Spendable now")).toHaveAttribute("data-tone", "confirmed");
  });

  it("shows a multisig as one open path", async () => {
    walletIpc({ wallet_policy: () => MULTISIG_POLICY });
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /2 of 3 keys/ }));
    expect(await screen.findByText("2 of 3 keys sign.")).toBeInTheDocument();
    expect(screen.getByText("Any 2 of Key A, Key B, Key C")).toBeInTheDocument();
    const pill = screen.getByText("Spendable now");
    expect(pill).toHaveAttribute("data-tone", "confirmed");
    expect(pill.querySelector("svg.lucide-check")).not.toBe(null);
    expect(screen.getByText("thresh(2,pk(Key A),pk(Key B),pk(Key C))")).toBeInTheDocument();
  });

  it("reads a one of two multisig as any key, across both of its paths", async () => {
    walletIpc({ wallet_policy: () => ANY_KEY_POLICY });
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^Any of 2 keys, policy$/ }));
    expect(await screen.findByText("Any of 2 keys signs.")).toBeInTheDocument();
    const cards = screen.getAllByRole("region", { name: /path$/ });
    expect(cards.map((card) => card.getAttribute("aria-label"))).toEqual([
      "Primary path",
      "Primary B path",
    ]);
    expect(screen.getAllByText("Spendable now")).toHaveLength(2);
  });

  it("keeps an address wallet to a sentence and its address", async () => {
    walletIpc({ wallet_policy: () => ADDRESS_POLICY });
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /1 address/ }));
    expect(
      await screen.findByText("An address has no policy Gerfaut can read."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy address" })).toHaveAttribute(
      "title",
      ADDRESS_POLICY.descriptor,
    );
    expect(screen.queryByRole("region", { name: "Keys" })).not.toBeInTheDocument();
    expect(screen.queryByText("Descriptor")).not.toBeInTheDocument();
  });

  it("shows a quiet placeholder while the policy loads", async () => {
    walletIpc({ wallet_policy: () => new Promise(() => {}) });
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    // Without a digest the row is only its name.
    await user.click(within(screen.getByRole("main")).getByRole("button", { name: /^Policy$/ }));
    expect(await screen.findByRole("status", { name: "Loading policy" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Policy" })).toBeInTheDocument();
  });

  it("states the core's message when the policy cannot be read", async () => {
    walletIpc({
      wallet_policy: () => {
        throw { kind: "descriptor", message: "the policy cannot be read: unknown fragment" };
      },
    });
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    await user.click(sidebar().getByRole("button", { name: "Policy" }));
    expect(
      await screen.findByText(/the policy cannot be read: unknown fragment/),
    ).toBeInTheDocument();
    expect(screen.getByText("The policy could not be read.")).toBeInTheDocument();
    // The balance row keeps its plain name rather than a wrong digest.
    await user.click(sidebar().getByRole("button", { name: "Overview" }));
    const main = within(screen.getByRole("main"));
    expect(await main.findByRole("button", { name: /^Policy$/ })).toBeInTheDocument();
  });

  it("copies the descriptor from its folded section", async () => {
    walletIpc({ wallet_policy: () => LIANA_POLICY });
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    await user.click(sidebar().getByRole("button", { name: "Policy" }));
    await screen.findByText(/A recovery key can spend/);
    await user.click(screen.getByText("Descriptor"));
    await user.click(screen.getByRole("button", { name: "Copy descriptor" }));
    expect(await navigator.clipboard.readText()).toBe(LIANA_POLICY.descriptor);
  });
});

describe("display settings", () => {
  beforeEach(() => walletIpc());

  it("shows the fiat value next to the balance once enabled", async () => {
    renderApp();
    await screen.findByText("0.00150000");
    expect(
      screen.queryByText((text) => text.includes("€") && text.includes("150")),
    ).not.toBeInTheDocument();
    act(() => useUi.getState().setFiatEnabled(true));
    const matches = await screen.findAllByText(
      (text) => text.includes("€") && text.includes("150"),
    );
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("follows the unit setting everywhere, including the switcher", async () => {
    renderApp();
    await screen.findByText("0.00150000");
    act(() => useUi.getState().setUnit("sats"));
    expect(await screen.findAllByText(/150 000 sats/)).not.toHaveLength(0);
    expect(screen.queryByText("0.00150000")).not.toBeInTheDocument();
  });

  it("masks every amount from the sidebar eye toggle", async () => {
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("0.00150000");
    await user.click(sidebar().getByRole("button", { name: /hide amounts/i }));
    expect(screen.queryByText("0.00150000")).not.toBeInTheDocument();
    expect(screen.getAllByText("•••••").length).toBeGreaterThanOrEqual(2);
    // The public BTC price is not a wallet amount: it stays visible;
    // the balance curve, which is one, goes away.
    expect(screen.getByText("+11.1%")).toBeInTheDocument();
    expect(screen.getByText(/amounts are hidden/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: /wallet balance over time/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps the settings copy short and labels the themes with icons", async () => {
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    await user.click(sidebar().getByRole("button", { name: "Settings" }));
    expect(await screen.findByText("Shows the fiat value next to every amount.")).toBeInTheDocument();
    expect(screen.getByText("Serves the fiat value and the overview price.")).toBeInTheDocument();
    expect(screen.queryByText(/expose this app's IP/)).not.toBeInTheDocument();
    for (const name of ["Light", "Dark", "System"]) {
      expect(screen.getByRole("radio", { name }).querySelector("svg")).not.toBeNull();
    }
    await openSettings(user, "Wallets");
    expect(
      screen.getByText(/How many unused addresses Gerfaut scans past the last used one\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/20 is the norm/)).not.toBeInTheDocument();
    // The backend form has one primary action, like every other form.
    await openSettings(user, "Network");
    expect(screen.getByRole("button", { name: "Save backend" })).toHaveClass("bg-primary");
  });

  it("names the public server that answers, or leaves it automatic", async () => {
    const setBackend = vi.fn();
    walletIpc({
      set_backend: (args) => {
        setBackend(args.config);
        return undefined;
      },
    });
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    await openSettings(user, "Network");

    const select = await screen.findByRole("combobox", { name: "Public server" });
    expect(select).toHaveTextContent("Automatic");
    expect(
      screen.getByText("Every public server is tried in turn until one answers."),
    ).toBeInTheDocument();
    // Every operator the core publishes, with its protocol on a second line.
    await user.click(select);
    const list = await screen.findByRole("listbox", { name: "Public server" });
    expect(within(list).getByRole("option", { name: /blockstream\.info Esplora/ })).toBeInTheDocument();
    expect(
      within(list).getByRole("option", { name: /mempool\.space:60602 Electrum/ }),
    ).toBeInTheDocument();
    await user.click(within(list).getByRole("option", { name: /^blockstream\.info/ }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(select).toHaveTextContent("blockstream.info");
    expect(
      screen.getByText(/Only this server is asked/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save backend" }));
    await waitFor(() =>
      expect(setBackend).toHaveBeenCalledWith({
        type: "public_esplora",
        server: "blockstream.info",
      }),
    );

    // An Electrum server cannot serve a single-address wallet, and says so.
    await choose(user, "Public server", "mempool.space:60602");
    expect(
      screen.getByText(/Electrum servers cannot serve a single-address wallet/),
    ).toBeInTheDocument();

    // Back to automatic: the stored shape carries no operator.
    await choose(user, "Public server", "Automatic");
    await user.click(screen.getByRole("button", { name: "Save backend" }));
    await waitFor(() =>
      expect(setBackend).toHaveBeenLastCalledWith({ type: "public_esplora" }),
    );
  });

  it("offers every currency and moves the source when only one quotes it", async () => {
    walletIpc();
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    await user.click(sidebar().getByRole("button", { name: "Settings" }));

    const currency = await screen.findByRole("combobox", { name: "Fiat currency" });
    await user.click(currency);
    const list = await screen.findByRole("listbox", { name: "Fiat currency" });
    expect(within(list).getAllByRole("option")).toHaveLength(30);
    // The seven every source quotes come first, under their own group,
    // each with its plain name beside the code.
    expect(within(list).getByText("Every source")).toBeInTheDocument();
    expect(within(list).getByText("CoinGecko only")).toBeInTheDocument();
    expect(within(list).getByRole("option", { name: /JPY Japanese yen/ })).toBeInTheDocument();
    expect(within(list).getByRole("option", { name: /NGN Nigerian naira/ })).toBeInTheDocument();

    // A shared currency leaves every source available.
    await user.click(within(list).getByRole("option", { name: /^JPY/ }));
    expect(screen.getByRole("radio", { name: "Kraken" })).toBeEnabled();
    expect(useUi.getState().fiatSource).toBe("coingecko");

    await choose(user, "Fiat currency", "INR");
    expect(useUi.getState().fiatCurrency).toBe("inr");
    expect(screen.getByRole("radio", { name: "Kraken" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "mempool.space" })).toBeDisabled();
    expect(
      screen.getByText("CoinGecko is the only source that quotes INR."),
    ).toBeInTheDocument();
  });

  it("credits CoinGecko while its data is on screen", async () => {
    walletIpc();
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    await user.click(sidebar().getByRole("button", { name: "Settings" }));
    expect(await screen.findByText("Powered by CoinGecko")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Kraken" }));
    expect(screen.queryByText("Powered by CoinGecko")).not.toBeInTheDocument();
  });

  it("saves the shared gap limit from settings", async () => {
    const setGapLimit = vi.fn();
    walletIpc({
      set_gap_limit: (args) => {
        setGapLimit(args.gapLimit);
        return undefined;
      },
    });
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    await openSettings(user, "Wallets");
    const field = await screen.findByRole("textbox", { name: /gap limit/i });
    expect(field).toHaveValue("20");
    await user.clear(field);
    await user.type(field, "50");
    await user.tab();
    await waitFor(() => expect(setGapLimit).toHaveBeenCalledWith(50));
    // An out-of-range value is refused and the field snaps back.
    await user.clear(field);
    await user.type(field, "900");
    await user.tab();
    expect(setGapLimit).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(field).toHaveValue("20"));
  });
});

describe("receive page", () => {
  it("shows the QR, skips to the next address, and returns", async () => {
    walletIpc();
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    await user.click(sidebar().getByRole("button", { name: "Receive" }));

    expect(await screen.findByText(/next unused address · index 0/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /enlarge the address qr code/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /next address/i }));
    expect(await screen.findByText(/unused address · index 1/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /first unused/i }));
    expect(await screen.findByText(/next unused address · index 0/i)).toBeInTheDocument();
  });

  it("copies the shown address with explicit feedback", async () => {
    walletIpc();
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    await user.click(sidebar().getByRole("button", { name: "Receive" }));
    await screen.findByText(/next unused address/i);
    await user.click(screen.getByRole("button", { name: /copy address/i }));
    expect(await screen.findByRole("button", { name: /copied/i })).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toContain("tb1qexampleaddress0");
  });

  it("states the derivation path of the shown address", async () => {
    walletIpc();
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    await user.click(sidebar().getByRole("button", { name: "Receive" }));
    expect(await screen.findByText("m/84'/1'/0'/0/0")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /next address/i }));
    expect(await screen.findByText("m/84'/1'/0'/0/1")).toBeInTheDocument();
  });

  it("warns beyond the gap limit", async () => {
    walletIpc();
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    await user.click(sidebar().getByRole("button", { name: "Receive" }));
    await screen.findByText(/next unused address/i);
    for (let i = 0; i < 20; i += 1) {
      await user.click(screen.getByRole("button", { name: /next address/i }));
    }
    expect(await screen.findByText(/beyond the gap limit of 20/i)).toBeInTheDocument();
  });

  it("shows a single-address wallet without a skip control", async () => {
    const single: WalletMeta = {
      ...WALLET,
      id: "w-3",
      name: "Watched address",
      kind: { type: "single_address", address: "tb1qwatchedonly" },
    };
    walletIpc({
      list_wallets: () => [single],
      wallet_snapshot: () => ({ ...SNAPSHOT, meta: single }),
      receive_addresses: () => [
        { index: 0, address: "tb1qwatchedonly", used: true, derivation: null },
      ],
    });
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    await user.click(sidebar().getByRole("button", { name: "Receive" }));
    expect(await screen.findByText(/watched address/i, { selector: "p" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /next address/i })).not.toBeInTheDocument();
  });
});

describe("transaction detail", () => {
  beforeEach(() => {
    walletIpc({
      tx_detail: () => ({
        summary: SNAPSHOT.txs[0],
        inputs: [
          {
            address: "tb1qsource",
            value_sats: 150_210,
            is_mine: false,
            change: false,
            op_return: null,
          },
        ],
        outputs: [
          {
            address: "tb1qexample",
            value_sats: 150_000,
            is_mine: true,
            change: false,
            op_return: null,
          },
          {
            address: null,
            value_sats: 0,
            is_mine: false,
            change: false,
            op_return: { hex: "68656c6c6f", text: "hello", label: null },
          },
        ],
        vsize: 141,
        fee_rate_sat_vb: 1.5,
        extras: {
          size_bytes: 215,
          vsize: 141,
          weight_wu: 561,
          version: 2,
          locktime: 0,
          rbf_signaled: true,
          segwit: true,
          taproot: false,
          is_coinbase: false,
          coinbase_pool: null,
          coinbase_height: null,
          coinbase_tag: null,
          sigops: 1,
          raw_hex: "02000000abcdef",
        },
      }),
    });
  });

  it("opens from the transactions page with the flow diagram", async () => {
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    await user.click(sidebar().getByRole("button", { name: "Transactions" }));
    await user.click(await screen.findByText("Received"));
    expect(await screen.findByRole("dialog", { name: "Transaction" })).toBeInTheDocument();
    expect(screen.getAllByText("1.5 sat/vB").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("region", { name: "Transaction diagram" })).toBeInTheDocument();
    expect(screen.getByText("RBF")).toBeInTheDocument();
    expect(screen.getByText("SegWit")).toBeInTheDocument();
  });

  it("opens straight from the activity widget", async () => {
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByText("Received"));
    expect(await screen.findByRole("dialog", { name: "Transaction" })).toBeInTheDocument();
  });

  it("warns before opening an external explorer", async () => {
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByText("Received"));
    await user.click(
      await screen.findByRole("button", { name: /view on mempool\.space/i }),
    );
    expect(await screen.findByText(/third-party website/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(useUi.getState().explorerAck).toBe(false);
  });
});

describe("partial history", () => {
  const loadMore = vi.fn(() => 25);

  beforeEach(() => {
    loadMore.mockClear();
    walletIpc({
      wallet_snapshot: () => ({ ...SNAPSHOT, truncated: true }),
      load_more_history: () => loadMore(),
    });
  });

  it("offers to fetch older transactions instead of a dead end", async () => {
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    await user.click(sidebar().getByRole("button", { name: "Transactions" }));
    const button = await screen.findByRole("button", { name: /load older transactions/i });
    expect(screen.getByText(/loads in rounds/i)).toBeInTheDocument();
    await user.click(button);
    await waitFor(() => expect(loadMore).toHaveBeenCalledTimes(1));
  });
});

describe("transaction status marker", () => {
  beforeEach(() => {
    walletIpc({
      wallet_snapshot: () => ({
        ...SNAPSHOT,
        txs: [
          ...SNAPSHOT.txs,
          {
            txid: "ef".repeat(32),
            net_sats: -20_000,
            fee_sats: 210,
            status: { state: "pending" as const },
            confirmations: 0,
          },
        ],
      }),
    });
  });

  it("tells the two states apart by shape, not by colour alone", async () => {
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    await user.click(sidebar().getByRole("button", { name: "Transactions" }));
    const confirmed = (await screen.findAllByText("Confirmed"))[0];
    const pending = screen.getAllByText("Pending")[0];
    // A check and a clock: readable on a monochrome screenshot too.
    expect(confirmed.querySelector("svg.lucide-check")).not.toBe(null);
    expect(pending.querySelector("svg.lucide-clock")).not.toBe(null);
    // The old colour-only dot is gone from both.
    expect(confirmed.querySelector(".bg-current")).toBe(null);
    expect(pending.querySelector(".bg-current")).toBe(null);
  });
});

describe("receive page audit", () => {
  const manyExternal = Array.from({ length: 8 }, (_, index) => ({
    index,
    address: `tb1qexternal${index}`,
    used: index < 2,
    balance_sats: index === 1 ? 150_000 : 0,
  }));

  beforeEach(() =>
    walletIpc({
      address_list: () => ({
        external: manyExternal,
        internal: [{ index: 0, address: "tb1qchangezero", used: true, balance_sats: 0 }],
        truncated: false,
      }),
    }),
  );

  it("lists both keychains in their own cards, folded to five rows", async () => {
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    await user.click(sidebar().getByRole("button", { name: "Receive" }));

    const external = await screen.findByRole("region", { name: "External" });
    const change = screen.getByRole("region", { name: "Change" });
    // Two cards, two tables: never one list.
    expect(external.querySelector("table")).not.toBe(null);
    expect(change.querySelector("table")).not.toBe(null);
    expect(within(external).getAllByRole("row")).toHaveLength(1 + 5);
    expect(within(external).getByText(/^8 · 2 used$/)).toBeInTheDocument();

    await user.click(within(external).getByRole("button", { name: /show all 8/i }));
    expect(within(external).getAllByRole("row")).toHaveLength(1 + 8);
    await user.click(within(external).getByRole("button", { name: /show less/i }));
    expect(within(external).getAllByRole("row")).toHaveLength(1 + 5);
    // The change card is short: no fold control there.
    expect(within(change).queryByRole("button", { name: /show all/i })).not.toBeInTheDocument();

    // Used is Alerte, fresh is Glacier; neither is a bare word.
    const used = within(external).getAllByText("Used")[0];
    expect(used.className).toContain("text-alert");
    expect(used.className).toContain("rounded-full");
    const fresh = within(external).getAllByText("Fresh")[0];
    expect(fresh.className).toContain("text-primary");
    expect(fresh.className).toContain("rounded-full");
    expect(within(external).getByText("0.00150000 BTC")).toBeInTheDocument();
  });

  it("enlarges the QR code on demand", async () => {
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    await user.click(sidebar().getByRole("button", { name: "Receive" }));
    const small = await screen.findByRole("button", { name: /enlarge the address qr code/i });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(small);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("img", { name: "Address QR code" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("electrum certificates", () => {
  /** Reaching the Electrum form and filling in one host. */
  async function fillElectrumForm(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByText("Bitcoin price");
    await openSettings(user, "Network");
    await user.click(
      await screen.findByRole("radio", { name: /My own Electrum server/ }),
    );
    await user.type(await screen.findByLabelText("Host"), "node.example.org");
  }

  it("asks about a certificate nothing vouches for, and stores it only once accepted", async () => {
    const trusted: unknown[] = [];
    const saved: unknown[] = [];
    walletIpc({
      inspect_certificate: () => ({
        host: "node.example.org:50002",
        status: "unknown",
        fingerprint: FINGERPRINT,
        reason: "self-signed, or signed by an authority this machine does not know",
        subject: "CN=node.example.org",
        expires: 1_800_000_000,
      }),
      trust_certificate: (args) => {
        trusted.push(args);
        return undefined;
      },
      set_backend: (args) => {
        saved.push(args.config);
        return undefined;
      },
    });
    renderApp();
    const user = userEvent.setup();
    await fillElectrumForm(user);
    await user.click(screen.getByRole("button", { name: "Save backend" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/No public authority vouches/)).toBeInTheDocument();
    // The fingerprint is shown whole, in two rows that can be compared
    // against what the server prints.
    expect(dialog.textContent).toContain(FINGERPRINT.split(":").slice(0, 16).join(":"));
    expect(dialog.textContent).toContain(FINGERPRINT.split(":").slice(16).join(":"));
    expect(within(dialog).getByText("CN=node.example.org")).toBeInTheDocument();
    expect(within(dialog).getByText(/openssl x509/)).toBeInTheDocument();
    // Nothing is trusted and nothing is saved until the user says so.
    expect(trusted).toHaveLength(0);
    expect(saved).toHaveLength(0);

    await user.click(within(dialog).getByRole("button", { name: "Accept and save" }));
    await waitFor(() =>
      expect(trusted[0]).toMatchObject({
        url: "ssl://node.example.org:50002",
        fingerprint: FINGERPRINT,
      }),
    );
    await waitFor(() =>
      expect(saved[0]).toMatchObject({
        type: "custom_electrum",
        url: "ssl://node.example.org:50002",
      }),
    );
  });

  it("keeps a refused certificate out of the vault when the dialog is cancelled", async () => {
    const trusted: unknown[] = [];
    const saved: unknown[] = [];
    walletIpc({
      inspect_certificate: () => ({
        host: "node.example.org:50002",
        status: "unknown",
        fingerprint: FINGERPRINT,
        reason: "self-signed",
        subject: null,
        expires: null,
      }),
      trust_certificate: (args) => {
        trusted.push(args);
        return undefined;
      },
      set_backend: (args) => {
        saved.push(args.config);
        return undefined;
      },
    });
    renderApp();
    const user = userEvent.setup();
    await fillElectrumForm(user);
    await user.click(screen.getByRole("button", { name: "Save backend" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trusted).toHaveLength(0);
    expect(saved).toHaveLength(0);
  });

  it("refuses a certificate that changed, and takes two deliberate clicks to accept it", async () => {
    const trusted: unknown[] = [];
    walletIpc({
      inspect_certificate: () => ({
        host: "node.example.org:50002",
        status: "changed",
        stored: FINGERPRINT,
        presented: OTHER_FINGERPRINT,
      }),
      trust_certificate: (args) => {
        trusted.push(args);
        return undefined;
      },
      set_backend: () => undefined,
    });
    renderApp();
    const user = userEvent.setup();
    await fillElectrumForm(user);
    await user.click(screen.getByRole("button", { name: "Save backend" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/was accepted with another certificate/)).toBeInTheDocument();
    expect(dialog.textContent).toContain(FINGERPRINT.split(":").slice(0, 16).join(":"));
    expect(dialog.textContent).toContain(OTHER_FINGERPRINT.split(":").slice(0, 16).join(":"));
    // Cancelling is the primary shape here: the safe way out is the
    // obvious one.
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveClass("bg-primary");

    await user.click(within(dialog).getByRole("button", { name: "Trust the new certificate" }));
    expect(trusted).toHaveLength(0);
    await user.click(
      within(dialog).getByRole("button", { name: "Yes, trust the new certificate" }),
    );
    await waitFor(() => expect(trusted[0]).toMatchObject({ fingerprint: OTHER_FINGERPRINT }));
  });

  it("says which public servers sign their own certificate", async () => {
    walletIpc();
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    await openSettings(user, "Network");
    await user.click(await screen.findByRole("combobox", { name: "Public server" }));
    const list = await screen.findByRole("listbox", { name: "Public server" });
    expect(
      within(list).getByRole("option", { name: /own\.example:50002 Electrum · signs its own certificate/ }),
    ).toBeInTheDocument();
    expect(
      within(list).getByRole("option", { name: /mempool\.space:60602 Electrum$/ }),
    ).toBeInTheDocument();
  });

  it("lists the certificates already accepted and forgets one on request", async () => {
    const forgotten: unknown[] = [];
    walletIpc({
      get_settings: () => ({
        ...SETTINGS,
        electrum_certs: { "node.example.org:50002": FINGERPRINT },
      }),
      forget_certificate: (args) => {
        forgotten.push(args.host);
        return undefined;
      },
    });
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    await openSettings(user, "Network");

    expect(await screen.findByText("Trusted certificates")).toBeInTheDocument();
    expect(screen.getByText("node.example.org:50002")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: "Forget the certificate accepted for node.example.org:50002",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Forget it" }));
    await waitFor(() => expect(forgotten).toEqual(["node.example.org:50002"]));
  });
});

describe("broadcast page", () => {
  it("previews a transaction, confirms, and follows it", async () => {
    const broadcastCalls: unknown[] = [];
    walletIpc({
      preview_transaction: () => PREVIEW,
      broadcast_transaction: (args) => {
        broadcastCalls.push(args);
        return { txid: PREVIEW.txid, backend: "mempool.space", at: 1_755_000_000 };
      },
      transaction_status: () => ({
        txid: PREVIEW.txid,
        found: true,
        confirmed: false,
        block_height: null,
        confirmations: 0,
        backend: "mempool.space",
        at: 1_755_000_100,
      }),
    });
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    await user.click(sidebar().getByRole("button", { name: "Broadcast" }));

    const field = await screen.findByLabelText("Signed transaction");
    expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled();
    await user.type(field, "cHNidP8BAH");
    await user.click(screen.getByRole("button", { name: "Preview" }));

    // What the transaction does, before anything leaves the machine.
    expect(await screen.findByText("Ready to broadcast")).toBeInTheDocument();
    expect(screen.getByText("PSBT")).toBeInTheDocument();
    expect(screen.getByText("Spends coins of Cold storage.")).toBeInTheDocument();
    // The diagram says which coins move, not only how many.
    const diagram = within(screen.getByRole("region", { name: "Transaction diagram" }));
    expect(diagram.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("7.1 sat/vB")).toBeInTheDocument();
    expect(screen.getByText("Cold storage · change")).toBeInTheDocument();

    // Broadcasting asks first, then hands the hex to the backend.
    const main = within(screen.getByRole("main"));
    await user.click(main.getByRole("button", { name: "Broadcast" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/cannot be taken back/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Broadcast" }));
    await waitFor(() => expect(broadcastCalls).toHaveLength(1));
    expect(broadcastCalls[0]).toMatchObject({ network: "signet", hex: PREVIEW.hex });

    // The same page follows the transaction, in as few words as it takes.
    expect(await screen.findByText("In the mempool")).toBeInTheDocument();
    expect(screen.getByText("Waiting to be mined.")).toBeInTheDocument();
    expect(screen.queryByText(/checks again every 30 seconds/)).not.toBeInTheDocument();
    // Starting over is this screen's one action, so it wears the one
    // primary shape every other screen uses.
    expect(
      main.getByRole("button", { name: "Broadcast another transaction" }),
    ).toHaveClass("bg-primary");
    expect(useUi.getState().recentBroadcasts[0]).toMatchObject({
      txid: PREVIEW.txid,
      backend: "mempool.space",
    });
  });

  it("keeps an unsigned transaction on the machine and shows the node's refusal verbatim", async () => {
    walletIpc({
      preview_transaction: (args) =>
        args.input === "unsigned"
          ? {
              ...PREVIEW,
              ready: false,
              hex: null,
              inputs: [{ ...PREVIEW.inputs[0], signed: false }],
              warnings: [
                {
                  kind: "unsigned",
                  severity: "alert",
                  message: "1 of 1 inputs carry no signature: the network will refuse this transaction.",
                },
              ],
            }
          : PREVIEW,
      broadcast_transaction: () => {
        throw {
          kind: "broadcast",
          message: "mempool.space refused the transaction: bad-txns-inputs-missingorspent",
        };
      },
    });
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    await user.click(sidebar().getByRole("button", { name: "Broadcast" }));

    const field = await screen.findByLabelText("Signed transaction");
    await user.type(field, "unsigned");
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText("Unsigned")).toBeInTheDocument();
    expect(screen.getByText(/carry no signature/)).toBeInTheDocument();
    const main = within(screen.getByRole("main"));
    expect(main.getByRole("button", { name: "Broadcast" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Start over" }));
    await user.type(await screen.findByLabelText("Signed transaction"), "signed");
    await user.click(screen.getByRole("button", { name: "Preview" }));
    await user.click(await main.findByRole("button", { name: "Broadcast" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Broadcast" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The network refused this transaction.");
    expect(alert).toHaveTextContent("bad-txns-inputs-missingorspent");
  });

  it("points a transaction pasted into the wallet import at the broadcast page", async () => {
    walletIpc({
      parse_input: () => {
        throw {
          kind: "invalid_input",
          message: "invalid transaction: this is a transaction, not a wallet to watch: the Broadcast page sends it",
        };
      },
    });
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    act(() => useUi.getState().setAddWalletOpen(true));
    await user.type(
      await screen.findByLabelText(/descriptor, extended public key/i),
      "cHNidP8BAH",
    );
    await user.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Broadcast page/);
  });
});

describe("export page", () => {
  it("previews the selection and writes the file", async () => {
    const exported = vi.fn((_args: Record<string, unknown>) => undefined);
    walletIpc({
      // The save dialog is Rust's: the command answers with how many
      // rows the file holds, never where it went.
      export_transactions_csv: (args) => {
        exported(args);
        return 1;
      },
    });
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    await user.click(sidebar().getByRole("button", { name: "Export" }));

    expect(await screen.findByText(/1 of 1 transaction selected/)).toBeInTheDocument();
    // The premium teaser is visible but inert.
    expect(screen.getByText("Premium")).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: /fiat value at transaction time/i }),
    ).toBeDisabled();

    // Filtering to outgoing leaves nothing: the export button locks.
    await user.click(screen.getByRole("radio", { name: "Sent" }));
    expect(await screen.findByText(/0 of 1 transaction selected/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export csv/i })).toBeDisabled();

    await user.click(screen.getByRole("radio", { name: "All" }));
    await user.click(screen.getByRole("button", { name: /export csv/i }));
    await waitFor(() => expect(exported).toHaveBeenCalledTimes(1));
    const args = exported.mock.calls[0][0];
    // A name is suggested; no path ever leaves the page.
    expect(args.suggestedName).toBe("cold-storage-transactions.csv");
    expect(Object.keys(args)).not.toContain("path");
    expect((args.options as Record<string, unknown>).include_pending).toBe(true);
    expect(await screen.findByText("1 transaction exported")).toBeInTheDocument();
  });

  it("says nothing when the save dialog is closed on nothing", async () => {
    walletIpc({ export_transactions_csv: () => null });
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    await user.click(sidebar().getByRole("button", { name: "Export" }));
    await screen.findByText(/1 of 1 transaction selected/);

    await user.click(screen.getByRole("button", { name: /export csv/i }));

    // No file, no count: the button simply comes back.
    expect(await screen.findByRole("button", { name: "Export CSV…" })).toBeEnabled();
    expect(screen.queryByText(/transactions? exported/)).not.toBeInTheDocument();
  });
});

describe("add wallet flow", () => {
  beforeEach(() => {
    const added: WalletMeta[] = [];
    mockIPC((cmd, args) => {
      switch (cmd) {
        case "get_settings":
          return SETTINGS;
        case "list_wallets":
          return added;
        case "parse_input":
          return PARSED_TPUB;
        case "add_wallet": {
          added.push(WALLET);
          return WALLET;
        }
        case "wallet_snapshot":
          return SNAPSHOT;
        case "utxos":
          return [];
        case "receive_addresses":
          return receiveEntries(0);
        case "fetch_price_history":
          return PRICE_HISTORY;
        case "set_app_pref":
          return undefined;
        case "tor_status":
          return TOR_STATUS;
        case "sync_wallet":
          return {
            wallet_id: WALLET.id,
            new_tx_count: 0,
            balance: WALLET.cached.balance,
            tip_height: 200_000,
            took_ms: 10,
            backend: "mempool.space",
          };
        case "sync_all":
          return { reports: [], failures: [] };
        default:
          throw new Error(`unexpected command ${cmd} ${JSON.stringify(args)}`);
      }
    });
  });

  it("offers the derivation only for a key that leaves it open", async () => {
    const calls: unknown[] = [];
    mockIPC((cmd, args) => {
      switch (cmd) {
        case "get_settings":
          return SETTINGS;
        case "list_wallets":
          return [];
        case "parse_input": {
          calls.push(args);
          const paths = (args as { derivation?: { receive: string } | null })
            .derivation;
          if (paths?.receive === "0'/*") {
            return Promise.reject({
              kind: "invalid_input",
              message: "invalid derivation path: a hardened step cannot be derived",
            });
          }
          return paths
            ? {
                ...PARSED_TPUB,
                derivation: {
                  receive: paths.receive,
                  change:
                    (args as { derivation: { change: string | null } }).derivation
                      .change,
                  origin: null,
                },
                preview_address: "tb1qother0preview00000000000000000000000",
              }
            : PARSED_TPUB;
        }
        case "set_app_pref":
          return undefined;
        case "sync_all":
          return { reports: [], failures: [] };
        default:
          throw new Error(`unexpected command ${cmd}`);
      }
    });

    renderApp();
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: /add a wallet/i }))[0]);
    await user.type(
      screen.getByLabelText(/descriptor, extended public key/i),
      "tpubDDnGNapGEY6...",
    );
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await screen.findByText(/recognized as/i);

    await user.click(screen.getByRole("button", { name: /advanced/i }));
    const receive = screen.getByLabelText(/receive path/i);
    const change = screen.getByLabelText(/change path/i);
    expect(receive).toHaveValue("0/*");

    // An empty change branch means "do not track change", not "0/*".
    await user.clear(receive);
    await user.type(receive, "5/*");
    await user.clear(change);
    await user.click(screen.getByRole("button", { name: /^apply$/i }));

    await waitFor(() => {
      expect(screen.getByTestId("preview-address")).toHaveTextContent(
        "tb1qother0preview00000000000000000000000",
      );
    });
    const applied = calls.at(-1) as { derivation: { receive: string; change: null } };
    expect(applied.derivation.receive).toBe("5/*");
    expect(applied.derivation.change).toBeNull();

    // A path the core refuses is said under the fields, and the card
    // above keeps the parse that did work.
    await user.clear(screen.getByLabelText(/receive path/i));
    await user.type(screen.getByLabelText(/receive path/i), "0'/*");
    await user.click(screen.getByRole("button", { name: /^apply$/i }));
    expect(
      await screen.findByText(/a hardened step cannot be derived/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("preview-address")).toHaveTextContent(
      "tb1qother0preview00000000000000000000000",
    );
  });

  it("parses, confirms, and adds", async () => {
    renderApp();
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: /add a wallet/i }))[0]);

    await user.type(
      screen.getByLabelText(/descriptor, extended public key/i),
      "tpubDDnGNapGEY6...",
    );
    await user.click(screen.getByRole("button", { name: /continue/i }));

    // Confirmation step: recognition is explicit, never silent.
    expect(await screen.findByText(/recognized as/i)).toBeInTheDocument();
    expect(screen.getByText(/carries no script type/i)).toBeInTheDocument();
    // A lone key leaves the script type open: the choice is offered,
    // preset on the core's default, next to the address it produces.
    expect(screen.getByRole("combobox", { name: "Script type" })).toHaveTextContent("Native SegWit");
    expect(screen.getByTestId("preview-address")).toHaveTextContent(
      PARSED_TPUB.preview_address as string,
    );

    await user.type(screen.getByLabelText(/^name$/i), "Cold storage");
    await user.click(screen.getByRole("button", { name: /^add wallet$/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(await screen.findByText("0.00150000")).toBeInTheDocument();
  });

  it("rebuilds the descriptors through the core when the script type changes", async () => {
    const parseCalls: unknown[] = [];
    const addCalls: unknown[] = [];
    mockIPC((cmd, args) => {
      const payload = (args ?? {}) as Record<string, unknown>;
      switch (cmd) {
        case "get_settings":
          return SETTINGS;
        case "list_wallets":
          return [];
        case "parse_input":
          parseCalls.push(payload.script);
          return payload.script === "taproot" ? PARSED_TPUB_TAPROOT : PARSED_TPUB;
        case "add_wallet":
          addCalls.push(payload.parsed);
          return WALLET;
        case "set_app_pref":
        case "sync_wallet":
          return undefined;
        default:
          return undefined;
      }
    });
    renderApp();
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: /add a wallet/i }))[0]);
    await user.type(screen.getByLabelText(/descriptor, extended public key/i), "tpubDDnGNapGEY6...");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await screen.findByRole("combobox", { name: "Script type" });
    await choose(user, "Script type", "Taproot");
    // The core answered with new descriptors and a new first address.
    await waitFor(() => {
      expect(screen.getByTestId("preview-address")).toHaveTextContent(
        PARSED_TPUB_TAPROOT.preview_address as string,
      );
    });
    expect(screen.getByRole("combobox", { name: "Script type" })).toHaveTextContent("Taproot");
    expect(screen.queryByText(/carries no script type/i)).not.toBeInTheDocument();
    expect(parseCalls).toEqual([null, "taproot"]);

    await user.type(screen.getByLabelText(/^name$/i), "Taproot cold");
    await user.click(screen.getByRole("button", { name: /^add wallet$/i }));
    await waitFor(() => expect(addCalls).toHaveLength(1));
    expect((addCalls[0] as ParsedInput).payload).toMatchObject({ script: "taproot" });
  });
});

describe("private material", () => {
  beforeEach(() => {
    mockIPC((cmd) => {
      switch (cmd) {
        case "get_settings":
          return SETTINGS;
        case "list_wallets":
          return [];
        case "parse_input":
          return Promise.reject({
            kind: "private_material",
            message: "input contains private key material and was rejected",
          });
        default:
          throw new Error(`unexpected command ${cmd}`);
      }
    });
  });

  it("refuses a private key with a clear message", async () => {
    renderApp();
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: /add a wallet/i }))[0]);
    await user.type(
      screen.getByLabelText(/descriptor, extended public key/i),
      "xprv9s21ZrQH143K...",
    );
    await user.click(screen.getByRole("button", { name: /continue/i }));
    expect(
      await screen.findByText(/private key material and was rejected/i),
    ).toBeInTheDocument();
  });
});

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

describe("the app lock", () => {
  const LOCKED: Settings = {
    ...SETTINGS,
    app_lock: { kind: "pin", biometric: false },
  };

  beforeEach(() => {
    useLock.setState({ lock: null, locked: false, seen: false });
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    useLock.setState({ lock: null, locked: false, seen: false });
    useUi.setState({ theme: "light" });
    document.documentElement.removeAttribute("data-theme");
  });

  function mockLocked(verdicts: LockVerdict[], prefs?: Record<string, string>) {
    const settings = prefs ? { ...LOCKED, app_prefs: prefs } : LOCKED;
    let attempt = 0;
    mockIPC((cmd) => {
      switch (cmd) {
        case "get_settings":
          return settings;
        case "app_lock":
          return settings.app_lock;
        case "verify_app_lock":
          return verdicts[Math.min(attempt++, verdicts.length - 1)];
        case "list_wallets":
          return [WALLET];
        case "wallet_snapshot":
          return SNAPSHOT;
        case "utxos":
          return [];
        case "receive_addresses":
          return receiveEntries(0);
        case "fetch_price_history":
          return PRICE_HISTORY;
        case "set_app_pref":
          return undefined;
        case "sync_all":
          return { reports: [], failures: [] };
        default:
          throw new Error(`unexpected command ${cmd}`);
      }
    });
  }

  it("opens locked, with nothing of a wallet behind it", async () => {
    mockLocked([{ unlocked: false, failures: 1, retry_after_secs: 0 }]);
    renderApp();

    expect(await screen.findByText("Locked")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Navigation" })).not.toBeInTheDocument();
    expect(screen.queryByText(WALLET.name)).not.toBeInTheDocument();
  });

  it("syncs nothing while the curtain is drawn", async () => {
    // A sync behind the lock screen posts a notification naming a
    // wallet and an amount over it — the one thing the screen exists
    // to stop. The refresh is not dropped, only held back.
    let syncs = 0;
    mockIPC((cmd) => {
      switch (cmd) {
        case "get_settings":
          return LOCKED;
        case "app_lock":
          return LOCKED.app_lock;
        case "verify_app_lock":
          return { unlocked: true, failures: 0, retry_after_secs: 0 };
        case "list_wallets":
          return [WALLET];
        case "wallet_snapshot":
          return SNAPSHOT;
        case "utxos":
          return [];
        case "receive_addresses":
          return receiveEntries(0);
        case "fetch_price_history":
          return PRICE_HISTORY;
        case "set_app_pref":
          return undefined;
        case "sync_all":
          syncs += 1;
          return { reports: [], failures: [] };
        default:
          throw new Error(`unexpected command ${cmd}`);
      }
    });
    renderApp();
    const user = userEvent.setup();

    await screen.findByText("Locked");
    expect(syncs).toBe(0);

    await user.type(screen.getByLabelText("PIN"), "1234");
    await user.click(screen.getByRole("button", { name: /unlock/i }));
    await screen.findByRole("navigation", { name: "Navigation" });

    await waitFor(() => expect(syncs).toBe(1));
  });

  it("says a wrong PIN plainly and stays", async () => {
    mockLocked([{ unlocked: false, failures: 1, retry_after_secs: 0 }]);
    renderApp();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("PIN"), "9999");
    await user.click(screen.getByRole("button", { name: /unlock/i }));

    expect(await screen.findByText("Wrong PIN")).toBeInTheDocument();
    expect(screen.getByText("Locked")).toBeInTheDocument();
  });

  it("counts down the wait the core imposes, and refuses to try meanwhile", async () => {
    mockLocked([{ unlocked: false, failures: 3, retry_after_secs: 5 }]);
    renderApp();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("PIN"), "0000");
    await user.click(screen.getByRole("button", { name: /unlock/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Too many attempts. Try again in 5 s",
      );
    });
    expect(screen.getByRole("button", { name: /unlock/i })).toBeDisabled();
    expect(screen.getByLabelText("PIN")).toBeDisabled();
  });

  it("the right PIN opens the app", async () => {
    mockLocked([{ unlocked: true, failures: 0, retry_after_secs: 0 }]);
    renderApp();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("PIN"), "1234");
    await user.click(screen.getByRole("button", { name: /unlock/i }));

    expect(
      await screen.findByRole("navigation", { name: "Navigation" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Locked")).not.toBeInTheDocument();
  });

  it("Ctrl+L draws the curtain again", async () => {
    mockLocked([{ unlocked: true, failures: 0, retry_after_secs: 0 }]);
    renderApp();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("PIN"), "1234");
    await user.click(screen.getByRole("button", { name: /unlock/i }));
    await screen.findByRole("navigation", { name: "Navigation" });

    await user.keyboard("{Control>}l{/Control}");

    expect(await screen.findByText("Locked")).toBeInTheDocument();
    expect(screen.queryByText(WALLET.name)).not.toBeInTheDocument();
  });

  it("decides the lock before a wallet or a theme reaches the screen", async () => {
    // The frame that matters is the one where the vault answers with
    // the wallet list already in hand — a refetch, a remount, a slow
    // keychain. Everything is ready to be drawn, and the lock and the
    // theme both live in the answer that has only just landed. Read
    // from an ordinary effect they arrive a frame late, and the
    // sidebar, the wallet names and the light ramp are drawn once
    // before the lock screen takes their place.
    mockLocked([{ unlocked: false, failures: 1, retry_after_secs: 0 }], {
      "onboarding.seen": "1",
      "desktop.theme": "dark",
    });

    // One observer for the document and the theme alike, so what it
    // collects comes back in the order the screen actually changed.
    const drawn: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") {
          drawn.push(`theme:${document.documentElement.dataset.theme}`);
          continue;
        }
        for (const node of Array.from(record.addedNodes)) {
          const text = node.textContent ?? "";
          if (text.includes(WALLET.name)) drawn.push("wallet");
          else if (text.includes("Locked")) drawn.push("lock");
        }
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
      childList: true,
      subtree: true,
    });

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(["wallets", "signet"], [WALLET]);
    try {
      render(
        <QueryClientProvider client={client}>
          <App />
        </QueryClientProvider>,
      );
      await screen.findByText("Locked");
    } finally {
      observer.disconnect();
    }

    expect(drawn).not.toContain("wallet");
    expect(drawn).toContain("lock");
    // And the theme is the first thing the vault's answer changes, so
    // no frame is ever painted on the wrong ramp.
    expect(drawn[0]).toBe("theme:dark");
  });

  it("a PIN field takes digits only", async () => {
    mockLocked([{ unlocked: false, failures: 1, retry_after_secs: 0 }]);
    renderApp();
    const user = userEvent.setup();

    const field = await screen.findByLabelText("PIN");
    await user.type(field, "12ab34");
    expect(field).toHaveValue("1234");
    expect(field).toHaveAttribute("inputmode", "numeric");
  });
});

describe("the welcome tour", () => {
  // Both stores live at module scope: a test that turned the tour off
  // would otherwise decide for the next one.
  beforeEach(() => {
    useUi.setState({ onboardingSeen: false });
    useLock.setState({ lock: null, locked: false, seen: false });
  });

  function mockEmptyVault(prefs: Record<string, string>) {
    mockIPC((cmd) => {
      switch (cmd) {
        case "get_settings":
          return { ...SETTINGS, app_prefs: prefs };
        case "list_wallets":
          return [];
        case "app_lock":
          return null;
        case "set_app_pref":
          return undefined;
        case "sync_all":
          return { reports: [], failures: [] };
        default:
          throw new Error(`unexpected command ${cmd}`);
      }
    });
  }

  it("introduces the app on a vault with nothing in it", async () => {
    mockEmptyVault({});
    renderApp();

    expect(await screen.findByText("Watch, never spend")).toBeInTheDocument();
  });

  it("is not shown again once seen", async () => {
    mockEmptyVault({ "onboarding.seen": "1" });
    renderApp();

    expect(await screen.findByText(/no wallets watched yet/i)).toBeInTheDocument();
    expect(screen.queryByText("Watch, never spend")).not.toBeInTheDocument();
  });

  it("walking to the end remembers it", async () => {
    const prefs: Record<string, string> = {};
    mockIPC((cmd, args) => {
      switch (cmd) {
        case "get_settings":
          return { ...SETTINGS, app_prefs: prefs };
        case "list_wallets":
          return [];
        case "app_lock":
          return null;
        case "set_app_pref": {
          const { key, value } = args as { key: string; value: string };
          prefs[key] = value;
          return undefined;
        }
        case "sync_all":
          return { reports: [], failures: [] };
        default:
          throw new Error(`unexpected command ${cmd}`);
      }
    });
    renderApp();
    const user = userEvent.setup();

    await screen.findByText("Watch, never spend");
    for (let step = 0; step < 3; step++) {
      await user.click(screen.getByRole("button", { name: /^next$/i }));
    }
    expect(screen.getByText("Keep it yours")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /get started/i }));

    await waitFor(() => {
      expect(prefs["onboarding.seen"]).toBe("1");
    });
    expect(screen.queryByText("Keep it yours")).not.toBeInTheDocument();
  });
});

describe("tor", () => {
  it("says which Tor a build carries, and refuses the one it does not", async () => {
    mockIPC((cmd) => {
      switch (cmd) {
        case "get_settings":
          return SETTINGS;
        case "list_wallets":
          return [WALLET];
        case "tor_status":
          return TOR_STATUS;
        case "wallet_snapshot":
          return SNAPSHOT;
        case "utxos":
          return [];
        case "receive_addresses":
          return receiveEntries(0);
        case "fetch_price_history":
          return PRICE_HISTORY;
        case "set_app_pref":
          return undefined;
        case "sync_all":
          return { reports: [], failures: [] };
        default:
          throw new Error(`unexpected command ${cmd}`);
      }
    });
    renderApp();
    const user = userEvent.setup();
    // The sidebar only exists once the vault and its wallets are in.
    await screen.findByRole("navigation", { name: "Navigation" });
    await openSettings(user, "Network");

    // No built-in client here: the option is shown, not offered, and
    // the copy says why rather than failing later.
    expect(
      await screen.findByText(/this build has no tor of its own/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Built-in" })).toBeDisabled();
    // The address is configurable: a Tor Browser listens on 9150.
    expect(screen.getByLabelText(/socks address/i)).toBeInTheDocument();
  });

  it("stores the mode the user picks", async () => {
    let sent: unknown = null;
    mockIPC((cmd, args) => {
      switch (cmd) {
        case "get_settings":
          return SETTINGS;
        case "list_wallets":
          return [WALLET];
        case "tor_status":
          return { ...TOR_STATUS, embedded_available: true };
        case "set_tor_settings":
          sent = args;
          return undefined;
        case "wallet_snapshot":
          return SNAPSHOT;
        case "utxos":
          return [];
        case "receive_addresses":
          return receiveEntries(0);
        case "fetch_price_history":
          return PRICE_HISTORY;
        case "set_app_pref":
          return undefined;
        case "sync_all":
          return { reports: [], failures: [] };
        default:
          throw new Error(`unexpected command ${cmd}`);
      }
    });
    renderApp();
    const user = userEvent.setup();
    await screen.findByRole("navigation", { name: "Navigation" });
    await openSettings(user, "Network");

    await user.click(await screen.findByRole("radio", { name: "Built-in" }));
    await waitFor(() => {
      expect(sent).not.toBeNull();
    });
    expect((sent as { settings: { mode: string } }).settings.mode).toBe("embedded");
  });
});
