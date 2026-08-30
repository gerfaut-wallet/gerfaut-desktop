import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackendConfig, ScannedBackend, Settings } from "../lib/ipc";
import { BackendSection } from "./SettingsView";

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

function renderBackend(onSave: (config: BackendConfig) => void = () => {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BackendSection
        network="mainnet"
        settings={SETTINGS}
        onSave={onSave}
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
});
