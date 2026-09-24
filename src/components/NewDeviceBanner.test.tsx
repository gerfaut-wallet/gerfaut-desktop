import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, cleanup, configure, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Device, PremiumStatus } from "../lib/ipc";
import { TIMING } from "../lib/premium";
import { useDeviceWatch } from "../state/premium";
import { premiumKeys } from "../state/premiumQueries";
import { useUi } from "../state/store";
import { NewDeviceBanner, resetBannerAnnouncement } from "./NewDeviceBanner";

// The first render of a file pays for its imports, which a loaded
// machine running every file at once can stretch past the default wait.
configure({ asyncUtilTimeout: 4000 });

const NOW = Math.floor(Date.now() / 1000);

const STATUS: PremiumStatus = {
  key: "abcd-efgh-ijkm-npqr",
  licence: null,
  consented: [],
  acknowledged_offline_until: null,
  device: { id: "d-this", connected_at: NOW - 86_400 },
  disconnected: false,
  key_saved: false,
  checklist_hidden: false,
  disconnected_reason: null,
  key_change_pending: false,
  connect_pending: false,
};

const THIS: Device = {
  id: "d-this",
  platform: "linux",
  connected_at: NOW - 86_400,
  access: "full",
  pending_until: null,
  approved_at: NOW - 86_400,
  this_device: true,
};

const STRANGER: Device = {
  id: "d-new",
  platform: "android",
  connected_at: NOW - 60,
  access: "pending",
  pending_until: NOW - 60 + 10 * 86_400,
  approved_at: null,
  this_device: false,
};

function mock(answers: Record<string, () => unknown>) {
  const calls: string[] = [];
  mockIPC(
    (cmd) => {
      calls.push(cmd);
      const answer = answers[cmd];
      if (!answer) throw new Error(`unexpected command ${cmd}`);
      return answer();
    },
    { shouldMockEvents: true },
  );
  return calls;
}

function Watched() {
  useDeviceWatch(true);
  return <NewDeviceBanner />;
}

function renderBanner() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Watched />
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  useUi.setState({ view: "home", settingsSection: "general", settingsTarget: null });
  resetBannerAnnouncement();
});

const WORDS = /A new device asks for access to your Premium account/;

afterEach(() => {
  clearMocks();
  TIMING.devicesFocusMs = 60_000;
});

describe("the new device banner", () => {
  it("says a device waits, in red, and leads to the Devices card", async () => {
    mock({
      premium_status: () => STATUS,
      premium_device: () => THIS,
      premium_devices: () => [THIS, STRANGER],
    });
    renderBanner();
    const user = userEvent.setup();
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent(
      "A new device asks for access to your Premium account. If it is not yours, refuse it and change your key.",
    );
    expect(banner).toHaveClass("bg-alert-surface");
    expect(banner.querySelector("svg.lucide-shield-alert")).not.toBeNull();
    // No way to wave it off: it goes once nothing waits.
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Review"]);

    await user.click(screen.getByRole("button", { name: "Review" }));
    expect(useUi.getState().view).toBe("settings");
    expect(useUi.getState().settingsSection).toBe("premium");
    expect(useUi.getState().settingsTarget).toBe("devices");
  });

  it("goes on its own once nothing waits", async () => {
    mock({
      premium_status: () => STATUS,
      premium_device: () => THIS,
      premium_devices: () => [THIS, STRANGER],
    });
    const client = renderBanner();
    await screen.findByText(WORDS);
    act(() => client.setQueryData(premiumKeys.devices, [THIS]));
    await waitFor(() => expect(screen.queryByText(WORDS)).not.toBeInTheDocument());
  });

  it("says nothing and asks nothing without a key, or on a device that waits itself", async () => {
    let calls = mock({ premium_status: () => ({ ...STATUS, key: null, device: null }) });
    renderBanner();
    await waitFor(() => expect(calls).toContain("premium_status"));
    expect(calls).toEqual(["premium_status"]);
    expect(screen.queryByText(WORDS)).not.toBeInTheDocument();

    act(() => clearMocks());
    calls = mock({
      premium_status: () => STATUS,
      premium_device: () => ({ ...THIS, access: "pending", pending_until: NOW + 86_400 }),
    });
    renderBanner();
    await waitFor(() => expect(calls).toContain("premium_device"));
    expect(calls).not.toContain("premium_devices");
    expect(screen.queryByText(WORDS)).not.toBeInTheDocument();
  });

  it("says nothing for a disconnected device", async () => {
    const calls = mock({ premium_status: () => ({ ...STATUS, device: null, disconnected: true }) });
    renderBanner();
    await waitFor(() => expect(calls).toContain("premium_status"));
    expect(calls).toEqual(["premium_status"]);
    expect(screen.queryByText(WORDS)).not.toBeInTheDocument();
  });

  it("takes the list the Rust side handed over, and reads everything again on a change", async () => {
    let status = STATUS;
    const calls = mock({
      premium_status: () => status,
      premium_device: () => THIS,
      premium_devices: () => [THIS],
    });
    renderBanner();
    await waitFor(() => expect(calls).toContain("premium_devices"));
    expect(screen.queryByText(WORDS)).not.toBeInTheDocument();

    // Five minutes on, the Rust side asked on its own: the list comes
    // with the event, and nothing is asked again for it.
    await act(() => emit("premium://devices", [THIS, STRANGER]));
    expect(await screen.findByText(WORDS)).toBeInTheDocument();
    expect(calls.filter((cmd) => cmd === "premium_devices")).toHaveLength(1);
    // Something that is not a list is not taken for one.
    await act(() => emit("premium://devices", { devices: [] }));
    expect(screen.getByText(WORDS)).toBeInTheDocument();

    // The server disowned this device: the vault is read again.
    status = { ...STATUS, device: null, disconnected: true };
    await act(() => emit("premium://changed", null));
    await waitFor(() => expect(screen.queryByText(WORDS)).not.toBeInTheDocument());
  });

  it("goes the moment the server disowns this device, whatever the list held", async () => {
    let status = STATUS;
    let answer: () => unknown = () => [THIS, STRANGER];
    const calls = mock({
      premium_status: () => status,
      premium_device: () => THIS,
      premium_devices: () => answer(),
    });
    TIMING.devicesFocusMs = 0;
    renderBanner();
    expect(await screen.findByText(WORDS)).toBeInTheDocument();

    // The window comes back to the front; the server no longer knows
    // this device, and the core has dropped its token on the way.
    answer = () => {
      status = { ...STATUS, device: null, disconnected: true };
      return Promise.reject({
        kind: "premium_device_disconnected",
        message: "this device was disconnected from the Premium account",
      });
    };
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(screen.queryByText(WORDS)).not.toBeInTheDocument());
    // The vault was read again, and nothing is asked of a device that
    // has no connection any more.
    await waitFor(() =>
      expect(calls.filter((cmd) => cmd === "premium_status").length).toBeGreaterThanOrEqual(2),
    );
    const asked = calls.length;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(calls.slice(asked).filter((cmd) => cmd !== "premium_status")).toEqual([]);
  });

  it("raises the alarm once per set of waiting devices, not at every visit", async () => {
    mock({
      premium_status: () => STATUS,
      premium_device: () => THIS,
      premium_devices: () => [THIS, STRANGER],
    });
    const first = renderBanner();
    expect(await screen.findByRole("alert")).toHaveTextContent(WORDS);
    cleanup();
    first.clear();

    // Back on the Overview: the banner is there, the alarm is not
    // raised again for the same device.
    const client = renderBanner();
    expect(await screen.findByText(WORDS)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // Another device joins the wait: that is news again.
    act(() =>
      client.setQueryData(premiumKeys.devices, [THIS, STRANGER, { ...STRANGER, id: "d-other" }]),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(WORDS);
  });

  it("asks again when the window comes back to the front after a while", async () => {
    let devices = [THIS];
    const calls = mock({
      premium_status: () => STATUS,
      premium_device: () => THIS,
      premium_devices: () => devices,
    });
    renderBanner();
    await waitFor(() => expect(calls).toContain("premium_devices"));
    expect(screen.queryByText(WORDS)).not.toBeInTheDocument();

    // Fresh: the focus asks nothing.
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(calls.filter((cmd) => cmd === "premium_devices")).toHaveLength(1);

    // Old enough: it asks, and what came back shows.
    TIMING.devicesFocusMs = 0;
    devices = [THIS, STRANGER];
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByText(WORDS)).toBeInTheDocument();
  });
});
