import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendConfig, Network, WatchStatus } from "../../lib/ipc";
import { notifier } from "../../state/notifications";
import { useUi } from "../../state/store";
import { NotificationsSection } from "./NotificationsSection";

const OFF: WatchStatus = {
  state: "off",
  transport: null,
  server: null,
  detail: null,
  watched_scripts: 0,
  pushed_scripts: 0,
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
  useUi.setState({ notifyNewTx: false, notificationsRefused: false });
  vi.spyOn(notifier, "isPermissionGranted").mockResolvedValue(true);
  vi.spyOn(notifier, "requestPermission").mockResolvedValue("granted");
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

  it("stays off, and says why, when the system refuses notifications", async () => {
    const desk = mockDesk();
    vi.spyOn(notifier, "isPermissionGranted").mockResolvedValue(false);
    vi.spyOn(notifier, "requestPermission").mockResolvedValue("denied");
    renderCard();
    const user = userEvent.setup();

    await user.click(screen.getByRole("switch", { name: "Notify about new transactions" }));
    expect(
      await screen.findByText("Notifications are off for Gerfaut in the system settings."),
    ).toBeInTheDocument();
    expect(desk.prefs["notify.new_tx"]).toBeUndefined();
    expect(statusLine()).toHaveTextContent("Off");
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
      screen.getByText(/The server learns what a sync already tells it, and also how long Gerfaut stays connected\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/With the Automatic backend, Gerfaut first tries an Electrum server run by one of the public operators already in the rotation, because Electrum is what pushes changes\./),
    ).toBeInTheDocument();
    automatic.unmount();

    renderCard({ mainnet: { type: "custom_electrum", url: "ssl://node.example:50002" } });
    expect(screen.queryByText(/With the Automatic backend/)).not.toBeInTheDocument();
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
