import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendConfig, Network, WatchStatus } from "../../lib/ipc";
import { useUi } from "../../state/store";
import { NotificationsSection } from "./NotificationsSection";

const OFF: WatchStatus = {
  state: "off",
  transport: null,
  server: null,
  detail: null,
  watched_scripts: 0,
  pushed_scripts: 0,
  left_out_scripts: 0,
  left_out_wallets: 0,
  wallets: [],
};

interface Desk {
  status: WatchStatus;
  prefs: Record<string, string>;
  tests: number;
  refuseTest: boolean;
}

function mockDesk(status: WatchStatus = OFF): Desk {
  const desk: Desk = { status, prefs: {}, tests: 0, refuseTest: false };
  mockIPC((cmd, args) => {
    const payload = (args ?? {}) as Record<string, string>;
    switch (cmd) {
      case "live_status":
        return { enabled: desk.prefs["notify.new_tx"] === "1", status: desk.status };
      case "set_app_pref":
        desk.prefs[payload.key] = payload.value;
        return undefined;
      case "send_test_notification":
        desk.tests += 1;
        if (desk.refuseTest) {
          return Promise.reject({ kind: "notification", message: "no notification server" });
        }
        return undefined;
      default:
        throw new Error(`unexpected command ${cmd}`);
    }
  });
  return desk;
}

function renderCard(
  backends: Partial<Record<Network, BackendConfig>> = {},
  network: Network = "mainnet",
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NotificationsSection settings={{ backends, active_network: network }} />
    </QueryClientProvider>,
  );
}

const statusLine = () => screen.getByRole("status", { name: "Live watch status" });

beforeEach(() => {
  useUi.setState({ notifyNewTx: false });
});
afterEach(() => {
  vi.restoreAllMocks();
  clearMocks();
});

describe("Settings › Notifications", () => {
  it("is off until asked for, and no longer offers a rhythm", async () => {
    mockDesk();
    renderCard();
    expect(screen.getByRole("switch", { name: "Notify about new transactions" })).not.toBeChecked();
    expect(statusLine()).toHaveTextContent("Off");
    expect(screen.queryByText("Check while open")).not.toBeInTheDocument();
  });

  it("writes the preference the Rust side starts the watch on, and shows where it stands", async () => {
    const desk = mockDesk({
      ...OFF,
      state: "connected",
      transport: "electrum",
      server: "mempool.space",
      watched_scripts: 42,
      pushed_scripts: 42,
    });
    renderCard();
    const user = userEvent.setup();

    await user.click(screen.getByRole("switch", { name: "Notify about new transactions" }));
    await waitFor(() => expect(desk.prefs["notify.new_tx"]).toBe("1"));
    await waitFor(() =>
      expect(statusLine()).toHaveTextContent("Connected · Electrum · mempool.space"),
    );
  });

  it("says why it is reconnecting, and that an Esplora backend is polled", async () => {
    useUi.setState({ notifyNewTx: true });
    const desk = mockDesk({
      ...OFF,
      state: "reconnecting",
      transport: "electrum",
      server: "node.example",
      detail: "connection refused",
    });
    desk.prefs["notify.new_tx"] = "1";
    const first = renderCard({ mainnet: { type: "custom_electrum", url: "ssl://node.example:50002" } });
    await waitFor(() =>
      expect(statusLine()).toHaveTextContent("Reconnecting… · Electrum · node.example"),
    );
    expect(screen.getByText("connection refused")).toBeInTheDocument();
    first.unmount();

    desk.status = { ...OFF, state: "polling", transport: "esplora_polling", server: "esplora.example" };
    renderCard({ mainnet: { type: "custom_esplora", url: "https://esplora.example/api" } });
    await waitFor(() =>
      expect(statusLine()).toHaveTextContent("Polling every minute · esplora.example"),
    );
  });

  it("says what the open connection tells the server, and where it goes when no server was named", () => {
    mockDesk();
    const automatic = renderCard({}, "mainnet");
    expect(
      screen.getByText(/which learns what a sync already tells it and how long Gerfaut stays connected\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/With the Automatic backend, that is an Electrum server of an operator already in the rotation: Electrum is what pushes changes\./),
    ).toBeInTheDocument();
    automatic.unmount();

    renderCard({ mainnet: { type: "custom_electrum", url: "ssl://node.example:50002" } });
    expect(screen.queryByText(/With the Automatic backend/)).not.toBeInTheDocument();
  });

  /** Short of room, the watch says what it leaves to the syncs and the
      way out; on the user's own node there is no further way out. */
  it("says what it leaves to the syncs, and offers the own node", async () => {
    useUi.setState({ notifyNewTx: true, settingsSection: "notifications" });
    const short: WatchStatus = {
      ...OFF,
      state: "connected",
      transport: "electrum",
      server: "electrum.example.org",
      watched_scripts: 2_000,
      pushed_scripts: 2_000,
      left_out_scripts: 1_240,
      left_out_wallets: 2,
      wallets: [],
    };
    const desk = mockDesk(short);
    desk.prefs["notify.new_tx"] = "1";
    const first = renderCard({}, "mainnet");
    expect(
      await screen.findByText(
        // The matcher reads a no-break space as a space.
        "The live watch follows at most 200 addresses per wallet and 2 000 in all. 1 240 addresses of 2 wallets are checked at the next sync instead. Connect your own node and turn on \"This is my node\" to follow up to 20 000.",
      ),
    ).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Node settings" }));
    expect(useUi.getState().view).toBe("settings");
    expect(useUi.getState().settingsSection).toBe("network");
    first.unmount();

    desk.status = { ...short, left_out_scripts: 1, left_out_wallets: 1 };
    renderCard({
      mainnet: { type: "custom_electrum", url: "ssl://node.example:50002", own_node: true },
    });
    expect(
      await screen.findByText(
        "The live watch follows at most 20 000 addresses, even on your own node. 1 address of 1 wallet is checked at the next sync instead.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Node settings" })).not.toBeInTheDocument();
  });

  it("says nothing of room while every address is followed, or the watch is off", async () => {
    const desk = mockDesk({
      ...OFF,
      state: "connected",
      transport: "electrum",
      server: "electrum.example.org",
      watched_scripts: 36,
      pushed_scripts: 36,
    });
    useUi.setState({ notifyNewTx: true });
    desk.prefs["notify.new_tx"] = "1";
    renderCard();
    await waitFor(() => expect(statusLine()).toHaveTextContent("Connected"));
    expect(screen.queryByText(/checked at the next sync/)).not.toBeInTheDocument();
  });

  it("sends a test notification and says what to check, or what the system answered", async () => {
    const desk = mockDesk();
    renderCard();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Send a test notification" }));
    expect(await screen.findByText(/^Sent\. If nothing appeared, allow notifications/)).toBeInTheDocument();
    expect(desk.tests).toBe(1);

    desk.refuseTest = true;
    await user.click(screen.getByRole("button", { name: "Send a test notification" }));
    expect(
      await screen.findByText("The system refused the notification: no notification server"),
    ).toBeInTheDocument();
  });
});
