import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type {
  AddressEntry,
  ParsedInput,
  Settings,
  WalletMeta,
  WalletSnapshot,
} from "./lib/ipc";
import { useUi } from "./state/store";

const SETTINGS: Settings = {
  active_network: "signet",
  backends: {},
  app_prefs: {},
};

const WALLET: WalletMeta = {
  id: "w-1",
  name: "Cold storage",
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
  labels: {},
  last_sync: { at: 1_755_000_100, tip_height: 200_000, backend: "mempool.space" },
  cached: {
    balance: {
      confirmed: 150_000,
      trusted_pending: 0,
      untrusted_pending: 0,
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

function receiveEntries(lookahead: number): AddressEntry[] {
  return Array.from({ length: lookahead + 1 }, (_, index) => ({
    index,
    address: `tb1qexampleaddress${index}xxxxxxxxxxxxxxxxxxxx`,
    used: false,
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
      case "sync_all":
        return { reports: [], failures: [] };
      case "set_app_pref":
        return undefined;
      case "fetch_price":
        return { rate: 100_000, currency: "eur", source: "coingecko", at: 1_755_000_000 };
      case "fetch_price_history":
        return PRICE_HISTORY;
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

beforeEach(() => {
  useUi.setState({
    view: "home",
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
    explorerAck: false,
    homeLayouts: {},
    sharedHome: false,
    sharedHomeLayout: null,
    homeEditing: false,
    priceRange: "month",
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

  it("renders the widgets: balance, price, activity, utxos, status", async () => {
    renderApp();
    const canvas = within(await screen.findByRole("main"));
    expect(await canvas.findByText("0.00150000")).toBeInTheDocument();
    expect(canvas.getByText("Total balance")).toBeInTheDocument();
    expect(canvas.getByText("Bitcoin price")).toBeInTheDocument();
    expect(canvas.getByText("Latest activity")).toBeInTheDocument();
    expect(canvas.getByText("Received")).toBeInTheDocument();
    expect(canvas.getByText("UTXOs")).toBeInTheDocument();
    expect(canvas.getByText("Watch status")).toBeInTheDocument();
    expect(canvas.getByText(/synced .* mempool\.space/i)).toBeInTheDocument();
  });

  it("charts the price and states its change over the range", async () => {
    renderApp();
    // 90k -> 100k over the mocked series.
    expect(await screen.findByText(/\+11\.1% over 1M/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /bitcoin price over 1M/i })).toBeInTheDocument();
    // CoinGecko cannot serve Max without a key: the pill is absent.
    expect(screen.queryByRole("radio", { name: "Max" })).not.toBeInTheDocument();
  });

  it("removes, adds back, and reorders widgets, persisting the layout", async () => {
    const saved: Record<string, string> = {};
    walletIpc({
      set_app_pref: (args) => {
        saved[String(args.key)] = String(args.value);
        return undefined;
      },
    });
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");

    await user.click(screen.getByRole("button", { name: /customize/i }));
    await user.click(screen.getByRole("button", { name: /remove bitcoin price/i }));
    expect(screen.queryByText("Bitcoin price")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(saved["home.widgets.w-1"]).toBe(
        JSON.stringify(["balance", "activity", "utxos", "status"]),
      ),
    );

    // The removed widget is offered back.
    await user.click(screen.getByRole("button", { name: /add a widget/i }));
    await user.click(screen.getByRole("menuitem", { name: /bitcoin price/i }));
    expect(await screen.findByText("Bitcoin price")).toBeInTheDocument();

    // Keyboard reordering works without a pointer drag.
    await user.click(screen.getByRole("button", { name: /move total balance later/i }));
    await waitFor(() =>
      expect(saved["home.widgets.w-1"]).toBe(
        JSON.stringify(["activity", "balance", "utxos", "status", "price"]),
      ),
    );
    await user.click(screen.getByRole("button", { name: /done/i }));
    expect(screen.queryByRole("button", { name: /remove total balance/i })).not.toBeInTheDocument();
  });

  it("writes the shared layout when the shared overview is on", async () => {
    const saved: Record<string, string> = {};
    walletIpc({
      // The flag arrives through pref hydration, like in production.
      get_settings: () => ({ ...SETTINGS, app_prefs: { "home.widgets.shared": "1" } }),
      set_app_pref: (args) => {
        saved[String(args.key)] = String(args.value);
        return undefined;
      },
    });
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    await user.click(screen.getByRole("button", { name: /customize/i }));
    await user.click(screen.getByRole("button", { name: /remove watch status/i }));
    await waitFor(() =>
      expect(saved["home.widgets.shared_layout"]).toBe(
        JSON.stringify(["balance", "price", "activity", "utxos"]),
      ),
    );
    expect(saved["home.widgets.w-1"]).toBeUndefined();
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

    await user.click(sidebar().getByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("heading", { name: /settings/i })).toBeInTheDocument();
  });

  it("collapses the sidebar to icons and back", async () => {
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    expect(sidebar().getByText("Overview")).toBeInTheDocument();
    await user.click(sidebar().getByRole("button", { name: /collapse sidebar/i }));
    // Labels go; icon buttons stay reachable by name.
    expect(sidebar().queryByText("Overview")).not.toBeInTheDocument();
    expect(sidebar().getByRole("button", { name: "Overview" })).toBeInTheDocument();
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
    // The public BTC price is not a wallet amount: it stays visible.
    expect(screen.getByText(/over 1M/)).toBeInTheDocument();
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
    expect(screen.getByRole("img", { name: /address qr code/i })).toBeInTheDocument();

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
      receive_addresses: () => [{ index: 0, address: "tb1qwatchedonly", used: true }],
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
    expect(screen.getByText("fee")).toBeInTheDocument();
    expect(screen.getByText("Replaceable")).toBeInTheDocument();
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
    expect(screen.getByText(/native segwit was assumed/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^name$/i), "Cold storage");
    await user.click(screen.getByRole("button", { name: /^add wallet$/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(await screen.findByText("0.00150000")).toBeInTheDocument();
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
