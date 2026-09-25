import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BackendConfig,
  ScannedBackend,
  Settings,
  WalletMeta,
  WalletWatch,
} from "../lib/ipc";
import { useLock } from "../state/lock";
import { premiumKeys } from "../state/premiumQueries";
import { useSettings, useWallets } from "../state/queries";
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
  premium: { key: null, certificate: null, watched: [], acknowledged_offline_until: null },
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

/** The view fed from the vault on both sides, settings included: what
    a premium write changes there, the wallets section reads next. */
function VaultSettings() {
  const settings = useSettings();
  const wallets = useWallets();
  if (!settings.data) return null;
  return <SettingsView settings={settings.data} wallets={wallets.data ?? []} />;
}

/** Renders the vault-fed view and hands back its cache, for a test that
    lets part of it go the way time would. */
function renderVaultSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <VaultSettings />
    </QueryClientProvider>,
  );
  return client;
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
      case "premium_status":
        return {
          key: null,
          licence: null,
          consented: [],
          acknowledged_offline_until: null,
          device: null,
          disconnected: false,
          key_saved: false,
          checklist_hidden: false,
          disconnected_reason: null,
          key_change_pending: false,
          connect_pending: false,
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

    // Premium last: the licence card, and without a key nothing else.
    await user.click(nav().getByRole("button", { name: "Premium" }));
    expect(await screen.findByRole("heading", { name: "Licence" })).toBeInTheDocument();
    expect(heading("About")).not.toBeInTheDocument();
    expect(heading("Watched wallets")).not.toBeInTheDocument();
    expect(nav().getByRole("button", { name: "Premium" })).toHaveAttribute("aria-current", "page");
    // Selected, the entry marks itself in the premium colour, not the
    // action blue every other section takes.
    expect(
      nav().getByRole("button", { name: "Premium" }).querySelector("span[aria-hidden]"),
    ).toHaveClass("bg-premium");
  });

  it("lists the eight sections in order, each with an icon, the gem in the premium colour", () => {
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
      "Premium",
    ]);
    for (const item of items) expect(item.querySelector("svg")).not.toBeNull();
    expect(items[7].querySelector("svg.lucide-gem")).toHaveClass("text-premium");
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
    // No key, so the server has nothing of this wallet to forget.
    expect(within(row).queryByText(/alert history/)).not.toBeInTheDocument();
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
        // The server never had it: no secret to ask.
        { id: "w-1", secret: null },
      ]),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("says the server forgets a watched wallet too, when removing it", async () => {
    // A key and a yes for this wallet: the core will queue the unwatch,
    // and the confirmation says what that deletes — without asking the
    // server anything from here.
    const calls = mockSettingsIpc();
    act(() => useUi.getState().openSettings("wallets"));
    renderSettings([WALLET], {
      ...SETTINGS,
      premium: {
        ...SETTINGS.premium,
        key: "abcdefghijkmnpqr",
        watched: [{ wallet_id: "w-1", consented_at: 1_755_000_000 }],
      },
    });
    const user = userEvent.setup();
    const row = screen.getByText("Cold storage").closest("li")!;
    await user.click(within(row).getByRole("button", { name: "Remove" }));
    expect(within(row).getByText(/cannot be undone/)).toHaveTextContent(
      "The server stops watching it too, and deletes its alert history.",
    );
    expect(calls.some((call) => call.cmd === "premium_wallets")).toBe(false);
  });

  it("asks the app lock's secret before a wallet the server watches goes", async () => {
    // Removing the wallet ends the watch as unwatching it does: the
    // same secret, or the one would be the way around the other.
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
    useLock.setState({ lock: { kind: "pin", biometric: false } });
    act(() => useUi.getState().openSettings("wallets"));
    renderSettings([WALLET], {
      ...SETTINGS,
      premium: {
        ...SETTINGS.premium,
        key: "abcdefghijkmnpqr",
        watched: [{ wallet_id: "w-1", consented_at: 1_755_000_000 }],
      },
    });
    const user = userEvent.setup();
    const row = screen.getByText("Cold storage").closest("li")!;
    await user.click(within(row).getByRole("button", { name: "Remove" }));
    await user.click(within(row).getByRole("button", { name: "Remove wallet" }));
    expect(calls.some((call) => call.cmd === "remove_wallet")).toBe(false);
    let dialog = screen.getByRole("dialog", { name: "Confirm it's you" });
    await user.type(within(dialog).getByLabelText("PIN"), "2468");
    await user.click(within(dialog).getByRole("button", { name: "Remove wallet" }));

    // A failure closes the dialog and says why under the row; the
    // question stays for the retry.
    expect(await within(row).findByRole("alert")).toHaveTextContent(
      "Vault i/o error: disk full.",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: "Remove wallet" }));
    dialog = screen.getByRole("dialog", { name: "Confirm it's you" });
    await user.type(within(dialog).getByLabelText("PIN"), "2468");
    await user.click(within(dialog).getByRole("button", { name: "Remove wallet" }));
    await waitFor(() =>
      expect(calls.filter((call) => call.cmd === "remove_wallet").map((call) => call.args)).toEqual([
        { id: "w-1", secret: "2468" },
        { id: "w-1", secret: "2468" },
      ]),
    );
    await waitFor(() => expect(useUi.getState().toast).toBe("Wallet removed"));
    useLock.setState({ lock: null });
  });

  it("stops saying the server forgets a wallet once it was unwatched", async () => {
    // The vault's side: the core drops the wallet from the watched list
    // along with the consent when the server has let it go, and the
    // settings are read again for the sentence to follow.
    let premium = {
      ...SETTINGS.premium,
      key: "abcdefghijkmnpqr",
      watched: [{ wallet_id: "w-1", consented_at: 1_755_000_000 }],
    };
    let consented = ["w-1"];
    let server: WalletWatch[] = [
      {
        id: "w-1",
        name: "Cold storage",
        script_kind: "p2wpkh",
        watched_since: 1_755_000_000,
        baseline_at: 1_755_000_100,
        baseline_height: 910_000,
        coins: 1,
        value_sats: 150_000,
      },
    ];
    const status = () => ({
      key: "abcd-efgh-ijkm-npqr",
      licence: { status: "active", until: 1_804_809_600 },
      consented,
      acknowledged_offline_until: null,
      device: { id: "d-1", connected_at: 1_755_000_000 },
      disconnected: false,
      key_saved: true,
      checklist_hidden: true,
      disconnected_reason: null,
      key_change_pending: false,
      connect_pending: false,
    });
    const device = {
      id: "d-1",
      platform: "windows",
      connected_at: 1_755_000_000,
      access: "full",
      pending_until: null,
      approved_at: 1_755_000_000,
      this_device: true,
    };
    mockSettingsIpc({
      get_settings: () => ({ ...SETTINGS, premium }),
      premium_status: status,
      premium_device: () => device,
      premium_devices: () => [device],
      premium_account: () => ({
        account: { active: true, paid_until: 1_804_809_600, wallets: 1, channels: 0, network: "bitcoin" },
        status: status(),
      }),
      premium_wallets: () => server,
      premium_channels: () => [],
      premium_events: () => [],
      premium_unwatch_wallet: () => {
        server = [];
        consented = [];
        premium = { ...premium, watched: [] };
        return undefined;
      },
    });
    act(() => useUi.getState().openSettings("wallets"));
    useLock.setState({ lock: { kind: "pin", biometric: false } });
    const client = renderVaultSettings();
    const user = userEvent.setup();

    // Watched and agreed to: the removal says what the server does.
    let row = (await screen.findByText("Cold storage")).closest("li")!;
    await user.click(within(row).getByRole("button", { name: "Remove" }));
    expect(within(row).getByText(/cannot be undone/)).toHaveTextContent(
      "The server stops watching it too, and deletes its alert history.",
    );
    await user.click(within(row).getByRole("button", { name: "Cancel" }));

    // Unwatched from the premium section.
    act(() => useUi.getState().openSettings("premium"));
    const cold = await screen.findByRole("switch", { name: "Watch Cold storage from the server" });
    await waitFor(() => expect(cold).toHaveAttribute("aria-checked", "true"));
    await waitFor(() => expect(cold).toBeEnabled());
    await user.click(cold);
    await user.click(screen.getByRole("button", { name: "Unwatch" }));
    const identity = await screen.findByRole("dialog", { name: "Confirm it's you" });
    await user.type(within(identity).getByLabelText("PIN"), "2468");
    await user.click(within(identity).getByRole("button", { name: "Unwatch" }));
    await waitFor(() => expect(cold).toHaveAttribute("aria-checked", "false"));

    // Time passes elsewhere and the server's list leaves the cache, as
    // it does minutes after the premium section is left: what the
    // wallets section says then rests on the settings alone, and they
    // were read again after the unwatch.
    act(() => useUi.getState().openSettings("general"));
    client.removeQueries({ queryKey: premiumKeys.wallets });

    // Back in Wallets: the server has nothing of this wallet to forget
    // any more, and the confirmation no longer says it does.
    act(() => useUi.getState().openSettings("wallets"));
    row = (await screen.findByText("Cold storage")).closest("li")!;
    await user.click(within(row).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(within(row).getByText(/cannot be undone/)).not.toHaveTextContent(
        "The server stops watching",
      ),
    );
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
    expect(nav().getByRole("button", { name: "Premium" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(nav().getByRole("button", { name: "General" })).toHaveFocus();
    // Moving the focus is not choosing: Enter does that.
    expect(heading("Display")).toBeInTheDocument();
    await user.keyboard("{ArrowUp}{ArrowUp}{Enter}");
    expect(heading("About")).toBeInTheDocument();
  });
});
