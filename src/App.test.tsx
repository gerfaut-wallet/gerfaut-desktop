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
  gap_limit: 20,
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
  scan_gap: 20,
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
  script_options: ["legacy", "nested_segwit", "segwit", "taproot"],
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
  },
  {
    id: "blockstream.info",
    label: "blockstream.info",
    protocol: "esplora",
    url: "https://blockstream.info/signet/api",
  },
  {
    id: "electrum:mempool.space",
    label: "mempool.space:60602",
    protocol: "electrum",
    url: "ssl://mempool.space:60602",
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
      case "sync_all":
        return { reports: [], failures: [] };
      case "set_app_pref":
        return undefined;
      case "fetch_price":
        return { rate: 100_000, currency: "eur", source: "coingecko", at: 1_755_000_000 };
      case "fetch_price_history":
        return PRICE_HISTORY;
      case "fetch_fees":
        return { fastest: 12, half_hour: 8.5, hour: 4, economy: 2, minimum: 1, at: 1_755_000_000 };
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
  warnings: [{ kind: "spends_watched", message: "Spends coins of Cold storage." }],
  hex: "02000000deadbeef",
};

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
    // Recommended fees, from mempool.space.
    expect(await screen.findByText("Network fees")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("8.5")).toBeInTheDocument();
    expect(screen.getByText("Next block")).toBeInTheDocument();
    expect(screen.getByText("~3 blocks")).toBeInTheDocument();
    expect(screen.queryByText(/via mempool\.space/)).not.toBeInTheDocument();
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
    expect(screen.getByLabelText(/mempool\.space: connection timed out/)).toBeInTheDocument();
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
    expect(
      screen.getByText("How many unused addresses Gerfaut scans past the last used one."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/20 is the norm/)).not.toBeInTheDocument();
    expect(screen.queryByText(/expose this app's IP/)).not.toBeInTheDocument();
    for (const name of ["Light", "Dark", "System"]) {
      expect(screen.getByRole("radio", { name }).querySelector("svg")).not.toBeNull();
    }
    // The backend form has one primary action, like every other form.
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
    await user.click(sidebar().getByRole("button", { name: "Settings" }));

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
    await user.click(sidebar().getByRole("button", { name: "Settings" }));
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
    expect(screen.getByText("1 input")).toBeInTheDocument();
    expect(screen.getByText("2 outputs")).toBeInTheDocument();
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

    // The same page follows the transaction.
    expect(await screen.findByText("In the mempool")).toBeInTheDocument();
    expect(screen.getByText(/checks again every 30 seconds/)).toBeInTheDocument();
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
                  message: "1 of 1 inputs carry no signature: the network will refuse this transaction.",
                },
              ],
            }
          : PREVIEW,
      broadcast_transaction: () => {
        throw { kind: "sync", message: "mempool.space: bad-txns-inputs-missingorspent" };
      },
    });
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Bitcoin price");
    await user.click(sidebar().getByRole("button", { name: "Broadcast" }));

    const field = await screen.findByLabelText("Signed transaction");
    await user.type(field, "unsigned");
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText("Not fully signed")).toBeInTheDocument();
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
    const { save } = await import("@tauri-apps/plugin-dialog");
    const exported = vi.fn((_args: Record<string, unknown>) => 1);
    walletIpc({
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
    expect(save).toHaveBeenCalled();
    const args = exported.mock.calls[0][0];
    expect(args.path).toBe("C:/exports/wallet.csv");
    expect((args.options as Record<string, unknown>).include_pending).toBe(true);
    expect(await screen.findByText("1 transaction exported")).toBeInTheDocument();
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

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(() => Promise.resolve("C:/exports/wallet.csv")),
}));
