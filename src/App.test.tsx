import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { ParsedInput, Settings, WalletMeta, WalletSnapshot } from "./lib/ipc";
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

beforeEach(() => {
  useUi.setState({
    view: "wallet",
    activeWalletId: null,
    selectedTxid: null,
    addWalletOpen: false,
    receiveOpen: false,
    paletteOpen: false,
    masked: false,
    toast: null,
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

  it("shows the empty state with a single primary action", async () => {
    renderApp();
    expect(await screen.findByText("No wallets watched yet")).toBeInTheDocument();
    // One in the canvas empty state, one row in the rail.
    expect(screen.getAllByRole("button", { name: /add a wallet/i })).toHaveLength(2);
  });
});

describe("with a wallet", () => {
  beforeEach(() => {
    mockIPC((cmd, args) => {
      switch (cmd) {
        case "get_settings":
          return SETTINGS;
        case "list_wallets":
          return [WALLET];
        case "wallet_snapshot":
          return SNAPSHOT;
        case "sync_all":
          return { reports: [], failures: [] };
        case "tx_detail":
          return {
            summary: SNAPSHOT.txs[0],
            inputs: [],
            outputs: [{ address: "tb1qexample", value_sats: 150_000, is_mine: true }],
            vsize: 141,
            fee_rate_sat_vb: 1.5,
          };
        default:
          throw new Error(`unexpected command ${cmd} ${JSON.stringify(args)}`);
      }
    });
  });

  it("renders balance, freshness, and the transaction list", async () => {
    renderApp();
    expect(await screen.findByText("0.00150000")).toBeInTheDocument();
    expect(screen.getByText(/synced .* mempool\.space/i)).toBeInTheDocument();
    expect(screen.getByText("Received")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^receive$/i })).toBeInTheDocument();
  });

  it("masks every amount with the eye toggle", async () => {
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("0.00150000");
    await user.click(screen.getByRole("button", { name: /hide balances/i }));
    expect(screen.queryByText("0.00150000")).not.toBeInTheDocument();
    expect(screen.getAllByText("•••••").length).toBeGreaterThanOrEqual(2);
  });

  it("opens the transaction detail rail on row click", async () => {
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Received");
    await user.click(screen.getByText("Received"));
    expect(
      await screen.findByRole("complementary", { name: /transaction detail/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("1.5 sat/vB")).toBeInTheDocument();
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
