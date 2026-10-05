import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendConfig, ScannedBackend, Settings, WalletMeta } from "../lib/ipc";
import { useWallets } from "../state/queries";
import { useUi } from "../state/store";
import { BackendSection } from "./settings/BackendSection";
import { SettingsView } from "./SettingsView";

// The camera is a button that hands one code over, the way the scanner
// does once its frames assemble. What it takes to decode them is the
// scanner's own test; what the form does with the result is this one.
const scan = vi.hoisted(() => ({ code: "" }));

vi.mock("../components/ScanQrModal", () => ({
  ScanQrModal: ({
    open,
    onScan,
    onClose,
  }: {
    open: boolean;
    onScan: (text: string) => void;
    onClose: () => void;
  }) =>
    open ? (
      <button
        type="button"
        onClick={() => {
          onScan(scan.code);
          onClose();
        }}
      >
        code in view
      </button>
    ) : null,
}));

/** A workspace already pointed at an Electrum server over TLS: the form
    a scan comes to overwrite. */
const SETTINGS: Settings = {
  active_network: "mainnet",
  backends: { mainnet: { type: "custom_electrum", url: "ssl://node.local:50002" } },
  gap_limit: 20,
  app_prefs: {},
  electrum_certs: {},
  app_lock: null,
  tor: { mode: "auto", socks_proxy: null },
};

function renderBackend(
  onSave: (config: BackendConfig) => void = () => {},
  settings: Settings = SETTINGS,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BackendSection
        network="mainnet"
        settings={settings}
        onSave={async (config) => onSave(config)}
        saving={false}
      />
    </QueryClientProvider>,
  );
}

/** Answers the commands the section makes on its own, plus the address
    the core reads out of the scan. */
function mockBackendIpc(reply: ScannedBackend | { error: string }) {
  const calls: { cmd: string; args: unknown }[] = [];
  mockIPC((cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === "public_servers") return [];
    if (cmd === "inspect_certificate")
      return { host: "node.local:50002", status: { type: "trusted" } };
    if (cmd === "parse_backend") {
      if ("error" in reply)
        return Promise.reject({ kind: "server", message: reply.error }) as never;
      return reply;
    }
    throw new Error(`unexpected command ${cmd}`);
  });
  return calls;
}

async function scanCode(user: ReturnType<typeof userEvent.setup>, code: string) {
  scan.code = code;
  await user.click(screen.getByRole("button", { name: /scan a server address/i }));
  await user.click(await screen.findByRole("button", { name: "code in view" }));
}

/** What a field holds right now. */
function field(name: string): HTMLInputElement {
  return screen.getByLabelText(name) as HTMLInputElement;
}

function toggle(name: string): HTMLElement {
  return screen.getByRole("switch", { name });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("saving a server address", () => {
  /** A port typed into the host field: the core would only call the
      whole a bad IPv6 literal, so the section says where the port goes
      before anything is asked of it. */
  it("says the port belongs in its own field", async () => {
    const calls = mockBackendIpc({ error: "unused" });
    const saved: BackendConfig[] = [];
    renderBackend((config) => saved.push(config));
    const user = userEvent.setup();
    await user.clear(field("Host"));
    await user.type(field("Host"), "abcdef.onion:50001");
    await user.click(screen.getByRole("button", { name: "Save backend" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The host holds a port. Put abcdef.onion in the host field and the port in its own.",
    );
    expect(saved).toEqual([]);
    expect(calls.map((call) => call.cmd)).not.toContain("inspect_certificate");

    // Typing drops the note: it no longer describes the field.
    await user.type(field("Host"), "x");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  /** An address the core refuses is refused before its certificate is
      looked at: taken for a server that did not answer, it read
      "Saved" while nothing was. */
  it("says in the core's words why an address is refused, and saves nothing", async () => {
    const reason =
      "invalid server: [abcdef.onion:50001] is not a host name: invalid IPv6 address";
    const calls = mockBackendIpc({ error: reason });
    const saved: BackendConfig[] = [];
    renderBackend((config) => saved.push(config));
    const user = userEvent.setup();
    await user.clear(field("Host"));
    await user.type(field("Host"), "[[abcdef.onion:50001]");
    await user.click(screen.getByRole("button", { name: "Save backend" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(reason);
    expect(saved).toEqual([]);
    expect(calls.map((call) => call.cmd)).not.toContain("inspect_certificate");
  });

  it("says why the core would not store a setting", async () => {
    mockBackendIpc({
      kind: "electrum",
      url: "ssl://node.local:50002",
      host: "node.local",
      port: 50002,
      tls: true,
      onion: false,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <BackendSection
          network="mainnet"
          settings={SETTINGS}
          onSave={() => Promise.reject({ kind: "vault", message: "vault i/o error: disk full" })}
          saving={false}
        />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Save backend" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("vault i/o error: disk full");
  });
});

describe("scanning a server address", () => {
  it("fills the form from the one-liner a node prints", async () => {
    const calls = mockBackendIpc({
      kind: "electrum",
      url: "tcp://gerfautexample123.onion:50001",
      host: "gerfautexample123.onion",
      port: 50001,
      tls: false,
      onion: true,
    });
    const saved: BackendConfig[] = [];
    renderBackend((config) => saved.push(config));
    const user = userEvent.setup();
    expect(toggle("Use TLS")).toHaveAttribute("aria-checked", "true");

    await scanCode(user, "gerfautexample123.onion:50001:t");

    // Read by the core, never by the view.
    expect(calls.at(-1)).toEqual({
      cmd: "parse_backend",
      args: { input: "gerfautexample123.onion:50001:t" },
    });
    expect(field("Host")).toHaveValue("gerfautexample123.onion");
    expect(field("Port")).toHaveValue("50001");
    expect(toggle("Use TLS")).toHaveAttribute("aria-checked", "false");
    // Filled, not saved: the person still presses Save.
    expect(saved).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Save backend" }));
    expect(saved).toEqual([
      { type: "custom_electrum", url: "tcp://gerfautexample123.onion:50001" },
    ]);
  });

  it("switches to Esplora when that is what was scanned", async () => {
    mockBackendIpc({
      kind: "esplora",
      url: "https://esplora.example.org/api",
      host: "esplora.example.org",
      port: null,
      tls: true,
      onion: false,
    });
    const saved: BackendConfig[] = [];
    renderBackend((config) => saved.push(config));
    const user = userEvent.setup();
    expect(screen.getByRole("radio", { name: /my own electrum server/i })).toBeChecked();

    await scanCode(user, "https://esplora.example.org/api");

    // Refusing it would be pedantic: the QR says which backend it is.
    expect(screen.getByRole("radio", { name: /my own esplora/i })).toBeChecked();
    expect(field("Server URL")).toHaveValue("https://esplora.example.org/api");
    expect(screen.queryByLabelText("Host")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save backend" }));
    expect(saved).toEqual([
      { type: "custom_esplora", url: "https://esplora.example.org/api" },
    ]);
  });

  it("refuses wallet material in the words of the core", async () => {
    const reason = "this is an extended public key, not the address of a server";
    mockBackendIpc({ error: reason });
    const saved: BackendConfig[] = [];
    renderBackend((config) => saved.push(config));
    const user = userEvent.setup();

    await scanCode(user, "xpub661MyMwAqRbcFexample");

    expect(await screen.findByRole("alert")).toHaveTextContent(reason);
    // Not one field moved, and the choice is where it was.
    expect(screen.getByRole("radio", { name: /my own electrum server/i })).toBeChecked();
    expect(field("Host")).toHaveValue("node.local");
    expect(field("Port")).toHaveValue("50002");
    expect(toggle("Use TLS")).toHaveAttribute("aria-checked", "true");
    expect(saved).toEqual([]);

    // Typing drops the refusal: it no longer describes the field.
    await user.type(field("Host"), "x");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says when the address scanned is a Tor hidden service", async () => {
    mockBackendIpc({
      kind: "electrum",
      url: "tcp://gerfautexample123.onion:50001",
      host: "gerfautexample123.onion",
      port: 50001,
      tls: false,
      onion: true,
    });
    renderBackend(() => {}, { ...SETTINGS, tor: { mode: "system", socks_proxy: null } });
    const user = userEvent.setup();
    expect(screen.queryByText(/A Tor hidden service/)).not.toBeInTheDocument();

    await scanCode(user, "gerfautexample123.onion:50001:t");

    // The core read it as an onion; the form says what that means, under
    // the onion the Tor card wears. Which Tor is that card's to say.
    const note = screen.getByText("A Tor hidden service: reached through Tor only.");
    expect(note).toBeInTheDocument();
    expect(note.querySelector("svg.gerfaut-onion")).not.toBe(null);
    expect(note.querySelector("svg.lucide-eye-off")).toBe(null);

    // A fact about the address scanned, not about whatever is typed next.
    await user.type(field("Host"), "x");
    expect(screen.queryByText(/A Tor hidden service/)).not.toBeInTheDocument();
  });

  it("says nothing of Tor for a clearnet host", async () => {
    mockBackendIpc({
      kind: "electrum",
      url: "ssl://electrum.example.org:50002",
      host: "electrum.example.org",
      port: 50002,
      tls: true,
      onion: false,
    });
    renderBackend();
    const user = userEvent.setup();

    await scanCode(user, "electrum.example.org:50002:s");

    expect(field("Host")).toHaveValue("electrum.example.org");
    expect(screen.queryByText(/A Tor hidden service/)).not.toBeInTheDocument();
  });
});

describe("this is my node", () => {
  const TRUSTED: ScannedBackend = {
    kind: "electrum",
    url: "ssl://node.local:50002",
    host: "node.local",
    port: 50002,
    tls: true,
    onion: false,
  };

  /** The core leaves the switch out of a stored backend while it is
      off, so a form that rebuilt the config from the address alone
      turned it off at every save. It is read back and sent back. */
  it("stays on when the address is saved again", async () => {
    mockBackendIpc(TRUSTED);
    const saved: BackendConfig[] = [];
    renderBackend((config) => saved.push(config), {
      ...SETTINGS,
      backends: {
        mainnet: { type: "custom_electrum", url: "ssl://node.local:50002", own_node: true },
      },
    });
    const user = userEvent.setup();
    expect(toggle("This is my node")).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("button", { name: "Save backend" }));
    await waitFor(() =>
      expect(saved).toEqual([
        { type: "custom_electrum", url: "ssl://node.local:50002", own_node: true },
      ]),
    );
  });

  it("is off for a server stored before it existed, and goes along once turned on", async () => {
    mockBackendIpc(TRUSTED);
    const saved: BackendConfig[] = [];
    renderBackend((config) => saved.push(config), {
      ...SETTINGS,
      backends: { mainnet: { type: "custom_esplora", url: "https://node.local/api" } },
    });
    const user = userEvent.setup();
    const ownNode = toggle("This is my node");
    expect(ownNode).toHaveAttribute("aria-checked", "false");
    // What it does and when to leave it off, read out with its name.
    expect(ownNode).toHaveAccessibleDescription(
      "The live watch then follows up to 20 000 addresses instead of 2 000. Leave it off for a server you do not run: it would refuse most of them, and learn every one.",
    );

    await user.click(ownNode);
    await user.click(screen.getByRole("button", { name: "Save backend" }));
    await user.click(toggle("This is my node"));
    await user.click(screen.getByRole("button", { name: "Save backend" }));
    await waitFor(() =>
      expect(saved).toEqual([
        { type: "custom_esplora", url: "https://node.local/api", own_node: true },
        { type: "custom_esplora", url: "https://node.local/api" },
      ]),
    );
  });

  /** A code read is another server, unless it is the one stored: the
      switch does not carry over to it. */
  it("goes off for another server read from a code", async () => {
    const STORED: Settings = {
      ...SETTINGS,
      backends: {
        mainnet: { type: "custom_electrum", url: "ssl://node.local:50002", own_node: true },
      },
    };
    mockBackendIpc(TRUSTED);
    const { unmount } = renderBackend(undefined, STORED);
    const user = userEvent.setup();
    await scanCode(user, "node.local:50002:s");
    expect(toggle("This is my node")).toHaveAttribute("aria-checked", "true");
    unmount();

    mockBackendIpc({
      ...TRUSTED,
      url: "ssl://electrum.example.org:50002",
      host: "electrum.example.org",
    });
    renderBackend(undefined, STORED);
    await scanCode(user, "electrum.example.org:50002:s");
    expect(field("Host")).toHaveValue("electrum.example.org");
    expect(toggle("This is my node")).toHaveAttribute("aria-checked", "false");
  });

  it("is not offered for the public servers", async () => {
    mockBackendIpc(TRUSTED);
    renderBackend();
    const user = userEvent.setup();
    expect(toggle("This is my node")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /public api/i }));
    expect(screen.queryByRole("switch", { name: "This is my node" })).not.toBeInTheDocument();
  });
});

// --- the sections --------------------------------------------------------

/** What the core answers about Tor on a machine with no daemon. */
const TOR_STATUS = {
  mode: "auto",
  socks_proxy: "127.0.0.1:9050",
  via: null,
  socks: null,
  running: false,
  bootstrapped: false,
  bootstrap_percent: 0,
  error: null,
  embedded_available: false,
};

const WALLET: WalletMeta = {
  id: "w-1",
  name: "Cold storage",
  icon: "wallet",
  network: "mainnet",
  kind: {
    type: "descriptors",
    external: "wpkh(xpub.../0/*)#aaaaaaaa",
    internal: "wpkh(xpub.../1/*)#bbbbbbbb",
    script: "segwit",
  },
  recognized_as: "extended_key",
  created_at: 1_755_000_000,
  gap_limit: 20,
  scan_gap: 20,
  labels: {},
  last_sync: null,
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

function renderSettings(wallets: WalletMeta[] = [WALLET], settings: Settings = SETTINGS) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SettingsView settings={settings} wallets={wallets} />
    </QueryClientProvider>,
  );
}

/** The view fed from the vault, as the app feeds it: what the wallets
    section shows after a write is what the list then says. */
function LiveSettings() {
  const wallets = useWallets();
  return <SettingsView settings={SETTINGS} wallets={wallets.data ?? []} />;
}

function renderLiveSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LiveSettings />
    </QueryClientProvider>,
  );
}

/** Answers what the sections ask on their own, and records every call. */
function mockSettingsIpc(
  overrides: Record<string, (args: Record<string, unknown>) => unknown> = {},
) {
  const calls: { cmd: string; args: Record<string, unknown> }[] = [];
  mockIPC((cmd, args) => {
    const payload = (args ?? {}) as Record<string, unknown>;
    calls.push({ cmd, args: payload });
    if (overrides[cmd]) return overrides[cmd](payload);
    switch (cmd) {
      case "public_servers":
        return [];
      case "tor_status":
        return TOR_STATUS;
      case "list_wallets":
        return [WALLET];
      case "set_app_pref":
        return undefined;
      case "live_status":
        return {
          enabled: false,
          status: {
            state: "off",
            transport: null,
            server: null,
            detail: null,
            watched_scripts: 0,
            pushed_scripts: 0,
            left_out_scripts: 0,
            left_out_wallets: 0,
            wallets: [],
          },
        };
      default:
        throw new Error(`unexpected command ${cmd}`);
    }
  });
  return calls;
}

function nav() {
  return within(screen.getByRole("navigation", { name: "Settings sections" }));
}

function heading(name: string | RegExp) {
  return screen.queryByRole("heading", { name });
}

describe("settings sections", () => {
  beforeEach(() => {
    useUi.setState({ view: "settings", settingsSection: "general" });
  });

  it("shows one section at a time and moves between them", async () => {
    mockSettingsIpc();
    renderSettings();
    const user = userEvent.setup();

    // General first: how the app reads, and nothing of the network.
    expect(heading("Display")).toBeInTheDocument();
    expect(heading("Appearance")).toBeInTheDocument();
    expect(heading("Network")).not.toBeInTheDocument();
    expect(heading("Wallets")).not.toBeInTheDocument();
    expect(nav().getByRole("button", { name: "General" })).toHaveAttribute("aria-current", "page");

    await user.click(nav().getByRole("button", { name: "Network" }));
    expect(heading("Network")).toBeInTheDocument();
    expect(heading(/^Backend/)).toBeInTheDocument();
    expect(heading("Tor")).toBeInTheDocument();
    expect(heading("Display")).not.toBeInTheDocument();
    expect(nav().getByRole("button", { name: "Network" })).toHaveAttribute("aria-current", "page");
    expect(nav().getByRole("button", { name: "General" })).not.toHaveAttribute("aria-current");
    expect(useUi.getState().settingsSection).toBe("network");

    // Each of the others holds its own card and no other.
    for (const name of ["Wallets", "Security", "Notifications", "Backup & sync", "About"]) {
      await user.click(nav().getByRole("button", { name }));
      expect(heading(name)).toBeInTheDocument();
      expect(heading("Network")).not.toBeInTheDocument();
      expect(heading("Display")).not.toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeInTheDocument();

    // The backup card says what a backup holds in the words the phone uses.
    await user.click(nav().getByRole("button", { name: "Backup & sync" }));
    expect(
      screen.getByText(/A backup holds descriptors and addresses, never a private key or seed\.$/),
    ).toBeInTheDocument();
  });

  it("lists the seven sections in order, each with an icon", () => {
    mockSettingsIpc();
    renderSettings();
    const items = nav().getAllByRole("button");
    expect(items.map((item) => item.textContent)).toEqual([
      "General",
      "Network",
      "Wallets",
      "Security",
      "Notifications",
      "Backup & sync",
      "About",
    ]);
    for (const item of items) expect(item.querySelector("svg")).not.toBeNull();
  });

  it("opens straight on the section asked for", () => {
    mockSettingsIpc();
    act(() => useUi.getState().openSettings("wallets"));
    renderSettings();
    expect(useUi.getState().view).toBe("settings");
    expect(heading("Wallets")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Gap limit" })).toBeInTheDocument();
    expect(screen.getByText("Cold storage")).toBeInTheDocument();
    expect(heading("Display")).not.toBeInTheDocument();
    expect(nav().getByRole("button", { name: "Wallets" })).toHaveAttribute("aria-current", "page");
  });

  it("changes a wallet's icon from the picker", async () => {
    const calls = mockSettingsIpc({ set_wallet_icon: () => undefined });
    act(() => useUi.getState().openSettings("wallets"));
    renderSettings();
    const user = userEvent.setup();
    const row = screen.getByText("Cold storage").closest("li")!;
    // The row wears the icon the core stores.
    expect(row.querySelector("svg.lucide-wallet")).not.toBeNull();

    await user.click(within(row).getByRole("button", { name: "Icon" }));
    const group = screen.getByRole("radiogroup", { name: "Icon of Cold storage" });
    expect(within(group).getAllByRole("radio")).toHaveLength(7);
    const wallet = within(group).getByRole("radio", { name: "Wallet" });
    expect(wallet).toHaveAttribute("aria-checked", "true");
    expect(wallet).toHaveFocus();

    // Arrows move without choosing; Enter chooses.
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}");
    expect(within(group).getByRole("radio", { name: "Snowflake" })).toHaveFocus();
    expect(calls.filter((call) => call.cmd === "set_wallet_icon")).toHaveLength(0);
    await user.keyboard("{Enter}");
    expect(calls.filter((call) => call.cmd === "set_wallet_icon").map((call) => call.args)).toEqual([
      { id: "w-1", icon: "snowflake" },
    ]);
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Icon" })).toHaveFocus();
  });

  it("closes the icon picker on Escape or a click outside, choosing nothing", async () => {
    const calls = mockSettingsIpc();
    act(() => useUi.getState().openSettings("wallets"));
    renderSettings();
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "Icon" });
    await user.click(trigger);
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "Piggy bank" })).toHaveFocus();
    await user.click(screen.getByRole("heading", { name: "Wallets" }));
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(calls.some((call) => call.cmd === "set_wallet_icon")).toBe(false);
  });

  it("closes the icon picker on Tab and hands the focus back to the action", async () => {
    const calls = mockSettingsIpc();
    act(() => useUi.getState().openSettings("wallets"));
    renderSettings();
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "Icon" });
    await user.click(trigger);
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    await user.tab();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(calls.some((call) => call.cmd === "set_wallet_icon")).toBe(false);
  });

  it("moves a wallet down the list from the keyboard and keeps that order", async () => {
    const second: WalletMeta = { ...WALLET, id: "w-2", name: "Lightning float", icon: "key" };
    // The vault lists the wallets in the order it was last given.
    let listed = [WALLET, second];
    const calls = mockSettingsIpc({
      reorder_wallets: (args) => {
        const ids = args.ids as string[];
        listed = ids.map((id) => listed.find((wallet) => wallet.id === id)!);
        return undefined;
      },
      list_wallets: () => listed,
    });
    act(() => useUi.getState().openSettings("wallets"));
    renderLiveSettings();
    const user = userEvent.setup();
    const card = (await screen.findByRole("heading", { name: "Wallets" })).closest("section")!;
    const names = () =>
      within(card)
        .getAllByRole("listitem")
        .map((row) => within(row).getByText(/storage|float/).textContent);
    await waitFor(() => expect(names()).toEqual(["Cold storage", "Lightning float"]));

    const row = screen.getByText("Cold storage").closest("li")!;
    // Nowhere up to go from the top; down, then, and the order is sent whole.
    expect(within(row).getByRole("button", { name: "Move up" })).toHaveAttribute("aria-disabled", "true");
    await user.click(within(row).getByRole("button", { name: "Move up" }));
    expect(calls.some((call) => call.cmd === "reorder_wallets")).toBe(false);
    // The move shows before the vault answers, and stays once it has.
    const down = within(row).getByRole("button", { name: "Move down" });
    down.focus();
    fireEvent.click(down);
    expect(names()).toEqual(["Lightning float", "Cold storage"]);
    await waitFor(() =>
      expect(calls.filter((call) => call.cmd === "reorder_wallets").map((call) => call.args)).toEqual([
        { ids: ["w-2", "w-1"] },
      ]),
    );
    await waitFor(() => expect(calls.filter((call) => call.cmd === "list_wallets")).toHaveLength(2));
    expect(names()).toEqual(["Lightning float", "Cold storage"]);
    expect(within(row).getByRole("button", { name: "Move down" })).toHaveAttribute("aria-disabled", "true");
    // The row that moved keeps the focus, on the control still usable.
    expect(within(row).getByRole("button", { name: "Move down" })).toHaveFocus();
  });

  it("removes a wallet behind a confirmation that says what goes, red on the yes alone", async () => {
    const calls = mockSettingsIpc({ remove_wallet: () => undefined });
    act(() => useUi.getState().openSettings("wallets"));
    renderSettings();
    const user = userEvent.setup();
    const row = screen.getByText("Cold storage").closest("li")!;
    const remove = within(row).getByRole("button", { name: "Remove" });
    // A removal is a neutral action: Alerte is kept for coins moving.
    expect(remove.className).not.toMatch(/alert/);

    await user.click(remove);
    expect(calls.some((call) => call.cmd === "remove_wallet")).toBe(false);
    expect(within(row).getByText(/cannot be undone/)).toBeInTheDocument();
    // The yes of a destructive confirmation is the one button that
    // wears red; the note around it keeps its amber, and reads Cancel
    // first, the yes last.
    const confirm = within(row).getByRole("button", { name: "Remove wallet" });
    expect(confirm).toHaveClass("bg-alert");
    const notice = within(row).getByText(/cannot be undone/).closest<HTMLElement>(".bg-pending-surface");
    expect(notice).not.toBeNull();
    expect(within(notice!).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Cancel",
      "Remove wallet",
    ]);

    await user.click(within(row).getByRole("button", { name: "Cancel" }));
    expect(within(row).queryByRole("button", { name: "Remove wallet" })).not.toBeInTheDocument();
    expect(calls.some((call) => call.cmd === "remove_wallet")).toBe(false);

    await user.click(within(row).getByRole("button", { name: "Remove" }));
    await user.click(within(row).getByRole("button", { name: "Remove wallet" }));
    await waitFor(() =>
      expect(calls.filter((call) => call.cmd === "remove_wallet").map((call) => call.args)).toEqual([
        { id: "w-1" },
      ]),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("says why a removal failed, under its row, and keeps the question for a retry", async () => {
    let refuse = true;
    const calls = mockSettingsIpc({
      remove_wallet: () => {
        if (refuse) {
          refuse = false;
          return Promise.reject({ kind: "vault", message: "vault i/o error: disk full" });
        }
        return undefined;
      },
    });
    act(() => useUi.getState().openSettings("wallets"));
    renderSettings();
    const user = userEvent.setup();
    const row = screen.getByText("Cold storage").closest("li")!;
    await user.click(within(row).getByRole("button", { name: "Remove" }));
    await user.click(within(row).getByRole("button", { name: "Remove wallet" }));

    expect(await within(row).findByRole("alert")).toHaveTextContent(
      "Not removed: vault i/o error: disk full",
    );
    await user.click(within(row).getByRole("button", { name: "Remove wallet" }));
    await waitFor(() => expect(useUi.getState().toast).toBe("Wallet removed"));
    expect(calls.filter((call) => call.cmd === "remove_wallet")).toHaveLength(2);
    expect(within(row).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("badges each wallet with what the live watch hears, only while it is short of room", async () => {
    const short = {
      state: "connected",
      transport: "electrum",
      server: "electrum.example.org",
      detail: null,
      watched_scripts: 2_000,
      pushed_scripts: 2_000,
      left_out_scripts: 1_240,
      left_out_wallets: 2,
      wallets: [
        { wallet_id: "w-1", coverage: "partial", watched_scripts: 200, left_out_scripts: 1_040 },
        { wallet_id: "w-2", coverage: "sync_only", watched_scripts: 0, left_out_scripts: 200 },
        { wallet_id: "w-3", coverage: "live", watched_scripts: 12, left_out_scripts: 0 },
      ],
    };
    mockSettingsIpc({ live_status: () => ({ enabled: true, status: short }) });
    useUi.setState({ settingsSection: "wallets" });
    renderSettings([
      WALLET,
      { ...WALLET, id: "w-2", name: "Savings" },
      { ...WALLET, id: "w-3", name: "Spending" },
    ]);
    const row = (name: string) => within(screen.getByText(name).closest("li")!);
    expect(await row("Cold storage").findByText("Partly live")).toBeInTheDocument();
    expect(row("Savings").getByText("At next sync")).toBeInTheDocument();
    expect(row("Spending").getByText("Live")).toBeInTheDocument();
    // The count rides along for a pointer, and is read out with the badge.
    expect(row("Savings").getByTitle("200 addresses wait for the next sync.")).toBeInTheDocument();
    expect(row("Spending").getByTitle("Every address is followed live.")).toBeInTheDocument();
  });

  it("puts no badge on a wallet while the live watch has room, or is off", async () => {
    mockSettingsIpc({
      live_status: () => ({
        enabled: false,
        status: {
          state: "off",
          transport: null,
          server: null,
          detail: null,
          watched_scripts: 0,
          pushed_scripts: 0,
          left_out_scripts: 0,
          left_out_wallets: 0,
          wallets: [],
        },
      }),
    });
    useUi.setState({ settingsSection: "wallets" });
    renderSettings();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Advanced/ })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/^(Live|Partly live|At next sync)$/)).not.toBeInTheDocument();
  });

  /** An advanced setting, out of the way: folded until asked for. */
  it("pins a wallet to the live watch from a folded advanced list", async () => {
    let pinned = false;
    const calls = mockSettingsIpc({
      list_wallets: () => [{ ...WALLET, ...(pinned ? { live_pinned: true } : {}) }],
      set_wallet_live_pinned: (args) => {
        pinned = args.pinned as boolean;
        return undefined;
      },
    });
    useUi.setState({ settingsSection: "wallets" });
    renderLiveSettings();
    const user = userEvent.setup();
    const advanced = await screen.findByRole("button", { name: /^Advanced/ });
    expect(advanced).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("switch", { name: /live first/ })).not.toBeInTheDocument();

    await user.click(advanced);
    expect(advanced).toHaveAttribute("aria-expanded", "true");
    const pin = screen.getByRole("switch", { name: "Always watch Cold storage live first" });
    expect(pin).toHaveAttribute("aria-checked", "false");
    expect(pin).toHaveAccessibleDescription(
      "When the live watch cannot follow every address, the wallets turned on here are followed first.",
    );

    await user.click(pin);
    await waitFor(() => expect(pin).toHaveAttribute("aria-checked", "true"));
    expect(calls.filter((call) => call.cmd === "set_wallet_live_pinned")).toEqual([
      { cmd: "set_wallet_live_pinned", args: { id: "w-1", pinned: true } },
    ]);

    // Folded again, the count still says something is set.
    await user.click(advanced);
    expect(advanced).toHaveAccessibleName("Advanced · 1 wallet watched live first");
  });

  it("says why a pin was not saved, under its wallet", async () => {
    mockSettingsIpc({
      set_wallet_live_pinned: () =>
        Promise.reject({ kind: "vault", message: "vault i/o error: disk full" }),
    });
    useUi.setState({ settingsSection: "wallets" });
    renderSettings();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Advanced/ }));
    const pin = screen.getByRole("switch", { name: "Always watch Cold storage live first" });
    await user.click(pin);
    expect(await screen.findByRole("alert")).toHaveTextContent("vault i/o error: disk full");
    expect(pin).toHaveAttribute("aria-checked", "false");
  });

  it("offers no reordering to a single wallet", () => {
    mockSettingsIpc();
    act(() => useUi.getState().openSettings("wallets"));
    renderSettings();
    expect(screen.queryByRole("button", { name: /^Move/ })).not.toBeInTheDocument();
    expect(screen.queryByTitle("Drag to reorder")).not.toBeInTheDocument();
  });

  it("walks the sections with the arrow keys", async () => {
    mockSettingsIpc();
    renderSettings();
    const user = userEvent.setup();
    nav().getByRole("button", { name: "General" }).focus();
    await user.keyboard("{ArrowDown}");
    expect(nav().getByRole("button", { name: "Network" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(nav().getByRole("button", { name: "About" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(nav().getByRole("button", { name: "General" })).toHaveFocus();
    // Moving the focus is not choosing: Enter does that.
    expect(heading("Display")).toBeInTheDocument();
    await user.keyboard("{ArrowUp}{ArrowUp}{Enter}");
    expect(heading("Backup & sync")).toBeInTheDocument();
  });
});

/** A write the vault refuses — a full disk, a file an antivirus holds
    during the rename — is said under the setting, and the control shows
    what the vault holds, not what was asked. */
describe("a setting the vault refuses", () => {
  const refused = () => Promise.reject({ kind: "vault", message: "the vault could not be written" });

  beforeEach(() => {
    useUi.setState({ view: "settings", settingsSection: "general", notifyNewTx: false, toast: null });
  });

  it("puts the gap limit back and says why", async () => {
    mockSettingsIpc({ set_gap_limit: refused });
    act(() => useUi.getState().openSettings("wallets"));
    renderSettings();
    const user = userEvent.setup();
    const field = screen.getByRole("textbox", { name: "Gap limit" });

    await user.clear(field);
    await user.type(field, "50{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Not saved: the vault could not be written",
    );
    expect(field).toHaveValue(String(SETTINGS.gap_limit));
    expect(useUi.getState().toast).toBeNull();
  });

  it("keeps the rename open on the name typed", async () => {
    mockSettingsIpc({ rename_wallet: refused });
    act(() => useUi.getState().openSettings("wallets"));
    renderSettings();
    const user = userEvent.setup();
    const row = screen.getByText("Cold storage").closest("li")!;

    await user.click(within(row).getByRole("button", { name: "Rename" }));
    const name = within(row).getByRole("textbox", { name: "Wallet name" });
    await user.clear(name);
    await user.type(name, "Savings{Enter}");
    expect(await within(row).findByRole("alert")).toHaveTextContent("Not saved:");
    expect(within(row).getByRole("textbox", { name: "Wallet name" })).toHaveValue("Savings");
  });

  it("stays on the network the vault holds", async () => {
    mockSettingsIpc({ set_active_network: refused });
    act(() => useUi.getState().openSettings("network"));
    renderSettings();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /^Signet/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not saved:");
    expect(screen.getByRole("button", { name: /^Mainnet/ })).toHaveAttribute("aria-pressed", "true");
  });

  /** The Rust side starts the watch on what the vault holds: a switch
      left on over a refused write would promise alerts nobody sends. */
  it("turns the alerts switch back off", async () => {
    mockSettingsIpc({ set_app_pref: refused });
    act(() => useUi.getState().openSettings("notifications"));
    renderSettings();
    const user = userEvent.setup();
    const alerts = screen.getByRole("switch", { name: "Notify about new transactions" });

    await user.click(alerts);
    expect(await screen.findByRole("alert")).toHaveTextContent("Not saved:");
    expect(alerts).not.toBeChecked();
    expect(useUi.getState().notifyNewTx).toBe(false);
  });
});

describe("turning the app lock on", () => {
  beforeEach(() => {
    useUi.setState({ view: "settings", settingsSection: "general", toast: null });
  });

  /** A form: Enter sends it from any field, and what is wrong is read
      out with the fields it is about. */
  it("sends on Enter and says what is wrong out loud", async () => {
    const calls = mockSettingsIpc({ set_app_lock: () => undefined, get_settings: () => SETTINGS });
    act(() => useUi.getState().openSettings("security"));
    renderSettings();
    const user = userEvent.setup();

    await user.click(screen.getByRole("switch", { name: "App lock" }));
    const dialog = await screen.findByRole("dialog", { name: "Turn on the app lock" });
    const pin = within(dialog).getByLabelText("New PIN");
    const confirm = within(dialog).getByLabelText("Confirm");
    await user.type(pin, "246813");
    await user.type(confirm, "246812{Enter}");

    const problem = await within(dialog).findByRole("alert");
    expect(problem).toHaveTextContent("The two entries differ.");
    expect(confirm).toHaveAttribute("aria-invalid", "true");
    expect(confirm).toHaveAccessibleDescription("The two entries differ.");
    expect(calls.filter((call) => call.cmd === "set_app_lock")).toHaveLength(0);

    await user.clear(confirm);
    await user.type(confirm, "246813{Enter}");
    await waitFor(() =>
      expect(calls.filter((call) => call.cmd === "set_app_lock")).toEqual([
        { cmd: "set_app_lock", args: { kind: "pin", secret: "246813", current: null } },
      ]),
    );
  });
});
