import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { act, configure, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Device, PremiumAccountReport, PremiumStatus } from "../../lib/ipc";
import { dayMonthYear } from "../../lib/premium";
import { useLock } from "../../state/lock";
import { useUi } from "../../state/store";
import { PremiumSection } from "./PremiumSection";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: () => Promise.resolve() }));

// The first render of a file pays for its imports, which a loaded
// machine running every file at once can stretch past the default wait.
configure({ asyncUtilTimeout: 4000 });

const NOW = Math.floor(Date.now() / 1000);
const DAY = 86_400;
const PIN = "2468";

const STATUS: PremiumStatus = {
  key: "abcd-efgh-ijkm-npqr",
  licence: { status: "active", until: NOW + 300 * DAY },
  consented: [],
  acknowledged_offline_until: null,
  device: { id: "d-this", connected_at: NOW - 40 * DAY },
  disconnected: false,
  key_saved: true,
  checklist_hidden: true,
  disconnected_reason: null,
  key_change_pending: false,
  connect_pending: false,
};

const ACCOUNT: PremiumAccountReport = {
  account: { active: true, paid_until: NOW + 300 * DAY, wallets: 0, channels: 0, network: "bitcoin" },
  status: STATUS,
};

/** This computer, the account's first device. */
const THIS: Device = {
  id: "d-this",
  platform: "windows",
  connected_at: NOW - 40 * DAY,
  access: "full",
  pending_until: null,
  approved_at: NOW - 40 * DAY,
  this_device: true,
};

/** A phone approved a while ago. */
const PHONE: Device = {
  id: "d-phone",
  platform: "android",
  connected_at: NOW - 20 * DAY,
  access: "full",
  pending_until: null,
  approved_at: NOW - 19 * DAY,
  this_device: false,
};

/** A Mac that connected two days ago and waits. */
const STRANGER: Device = {
  id: "d-mac",
  platform: "macos",
  connected_at: NOW - 2 * DAY,
  access: "pending",
  pending_until: NOW - 2 * DAY + 10 * DAY,
  approved_at: null,
  this_device: false,
};

type Answer = (args: Record<string, unknown>) => unknown;

function mockPremium(overrides: Record<string, Answer> = {}) {
  const calls: { cmd: string; args: Record<string, unknown> }[] = [];
  const answers: Record<string, Answer> = {
    premium_status: () => STATUS,
    premium_device: () => THIS,
    premium_devices: () => [THIS, PHONE, STRANGER],
    premium_account: () => ACCOUNT,
    list_wallets: () => [],
    premium_wallets: () => [],
    premium_channels: () => [],
    premium_events: () => [],
    ...overrides,
  };
  mockIPC((cmd, args) => {
    const payload = (args ?? {}) as Record<string, unknown>;
    calls.push({ cmd, args: payload });
    const answer = answers[cmd];
    if (!answer) throw new Error(`unexpected command ${cmd}`);
    return answer(payload);
  });
  return calls;
}

function of(cmd: string, calls: { cmd: string; args: Record<string, unknown> }[]) {
  return calls.filter((call) => call.cmd === cmd).map((call) => call.args);
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PremiumSection wallets={[]} />
    </QueryClientProvider>,
  );
  return client;
}

function card(name: string) {
  return within(screen.getByRole("heading", { name }).closest("section")!);
}

async function rowOf(label: string) {
  return (await screen.findByText(label)).closest("li")!;
}

async function confirmIdentity(user: ReturnType<typeof userEvent.setup>, action: string) {
  const dialog = await screen.findByRole("dialog", { name: "Confirm it's you" });
  await user.type(within(dialog).getByLabelText("PIN"), PIN);
  await user.click(within(dialog).getByRole("button", { name: action }));
}

beforeEach(() => {
  useUi.setState({ view: "settings", settingsSection: "premium", settingsTarget: null, toast: null });
  useLock.setState({ lock: { kind: "pin", biometric: false } });
});

afterEach(() => {
  vi.clearAllMocks();
});

// --- the devices card --------------------------------------------------------

describe("the devices card", () => {
  it("lists every device, oldest first, with what each may do", async () => {
    mockPremium();
    renderSection();
    const devices = await screen.findByRole("heading", { name: "Devices" });
    expect(devices.closest("section")!.querySelector("svg")).toHaveClass("lucide-monitor-smartphone");
    expect(
      screen.getByText(
        "Every device that entered your key. A new one waits 10 days, or until you approve it here.",
      ),
    ).toBeInTheDocument();

    await screen.findByText("Mac");
    const rows = within(devices.closest("section")!).getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector(".font-medium")?.textContent)).toEqual([
      "Windows computer",
      "Android phone",
      "Mac",
    ]);

    // This computer: its pill, full access, and nothing to do from here.
    const self = rows[0];
    expect(within(self).getByText("This device")).toBeInTheDocument();
    expect(within(self).getByText(`Connected ${dayMonthYear(THIS.connected_at)}`)).toBeInTheDocument();
    expect(within(self).getByText("Full access").closest("[data-tone]")).toHaveAttribute(
      "data-tone",
      "neutral",
    );
    expect(self.querySelector("svg.lucide-monitor")).not.toBeNull();
    expect(within(self).queryByRole("button")).not.toBeInTheDocument();

    // Another device with full access: a menu with Disconnect.
    const phone = rows[1];
    expect(phone.querySelector("svg.lucide-smartphone")).not.toBeNull();
    expect(within(phone).queryByText("This device")).not.toBeInTheDocument();
    expect(within(phone).getByRole("button", { name: /^More for Android phone/ })).toBeInTheDocument();

    // The one waiting: amber, the days it has left, Refuse and Approve.
    const mac = rows[2];
    expect(mac.querySelector("svg.lucide-laptop")).not.toBeNull();
    const waiting = within(mac).getByText("Waiting · 8 days left");
    expect(waiting.closest("[data-tone]")).toHaveAttribute("data-tone", "pending");
    const refuse = within(mac).getByRole("button", { name: /^Refuse/ });
    const approve = within(mac).getByRole("button", { name: /^Approve/ });
    expect(refuse).toHaveClass("bg-alert");
    expect(approve).toHaveClass("bg-premium");
    expect(within(mac).queryByRole("button", { name: /^More for/ })).not.toBeInTheDocument();
  });

  it("approves a waiting device after an amber question and the app lock's secret", async () => {
    let devices = [THIS, PHONE, STRANGER];
    const calls = mockPremium({
      premium_devices: () => devices,
      premium_approve_device: ({ id }) => {
        const approved: Device = { ...STRANGER, access: "full", pending_until: null, approved_at: NOW };
        devices = devices.map((device) => (device.id === id ? approved : device));
        return approved;
      },
    });
    renderSection();
    const user = userEvent.setup();
    const mac = await rowOf("Mac");
    const approve = within(mac).getByRole("button", { name: /^Approve/ });

    await user.click(approve);
    const question = within(mac).getByRole("status");
    expect(question).toHaveTextContent(
      "Approve only a device you just connected yourself. Once approved, it sees your watched wallets, channels and alerts, and can change them.",
    );
    expect(question).toHaveClass("bg-pending-surface");
    expect(approve).toHaveAttribute("aria-expanded", "true");
    expect(within(question).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Cancel",
      "Approve",
    ]);

    // Cancel: nothing left, and the focus is back where it was asked.
    await user.click(within(question).getByRole("button", { name: "Cancel" }));
    expect(within(mac).queryByRole("status")).not.toBeInTheDocument();
    expect(approve).toHaveFocus();

    await user.click(approve);
    await user.click(within(within(mac).getByRole("status")).getByRole("button", { name: "Approve" }));
    // Nothing left before the secret.
    expect(of("premium_approve_device", calls)).toEqual([]);
    const dialog = screen.getByRole("dialog", { name: "Confirm it's you" });
    expect(within(dialog).getByLabelText("PIN")).toHaveFocus();
    expect(within(dialog).getByRole("button", { name: "Approve" })).toBeDisabled();
    await confirmIdentity(user, "Approve");

    await waitFor(() =>
      expect(of("premium_approve_device", calls)).toEqual([{ id: "d-mac", secret: PIN }]),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(within(mac).getByText("Full access")).toBeInTheDocument());
    expect(within(mac).queryByRole("status")).not.toBeInTheDocument();
    expect(useUi.getState().toast).toBe("Device approved");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Devices" })).toHaveFocus());
  });

  it("refuses a waiting device, in danger, and says what a stranger means", async () => {
    let devices = [THIS, STRANGER];
    const calls = mockPremium({
      premium_devices: () => devices,
      premium_remove_device: ({ id }) => {
        devices = devices.filter((device) => device.id !== id);
        return undefined;
      },
    });
    renderSection();
    const user = userEvent.setup();
    const mac = await rowOf("Mac");

    await user.click(within(mac).getByRole("button", { name: /^Refuse/ }));
    const question = within(mac).getByRole("status");
    expect(question).toHaveTextContent(
      "Refuse this device? It is disconnected at once and sees nothing. If you did not connect it, someone has your key: change it in Licence above.",
    );
    const yes = within(question).getByRole("button", { name: "Refuse" });
    expect(yes).toHaveClass("bg-alert");
    await user.click(yes);
    const dialog = screen.getByRole("dialog", { name: "Confirm it's you" });
    expect(within(dialog).getByRole("button", { name: "Refuse" })).toHaveClass("bg-alert");
    await confirmIdentity(user, "Refuse");

    await waitFor(() =>
      expect(of("premium_remove_device", calls)).toEqual([{ id: "d-mac", secret: PIN }]),
    );
    await waitFor(() => expect(screen.queryByText("Mac")).not.toBeInTheDocument());
    expect(useUi.getState().toast).toBe("Device refused");
  });

  it("disconnects another device from its menu, from the keyboard", async () => {
    let devices = [THIS, PHONE];
    const calls = mockPremium({
      premium_devices: () => devices,
      premium_remove_device: ({ id }) => {
        devices = devices.filter((device) => device.id !== id);
        return undefined;
      },
    });
    renderSection();
    const user = userEvent.setup();
    const phone = await rowOf("Android phone");
    const more = within(phone).getByRole("button", { name: /^More for Android phone/ });

    await user.click(more);
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["Disconnect"]);
    expect(items[0]).toHaveFocus();
    await user.keyboard("{Enter}");
    const question = within(phone).getByRole("status");
    expect(question).toHaveTextContent(
      "Disconnect this device? It loses access at once. To use Premium there again, enter the key on it and approve it here.",
    );
    // Cancel hands the focus back to the menu it came from.
    await user.click(within(question).getByRole("button", { name: "Cancel" }));
    expect(more).toHaveFocus();

    await user.click(more);
    await user.keyboard("{Enter}");
    await user.click(within(within(phone).getByRole("status")).getByRole("button", { name: "Disconnect" }));
    await confirmIdentity(user, "Disconnect");
    await waitFor(() =>
      expect(of("premium_remove_device", calls)).toEqual([{ id: "d-phone", secret: PIN }]),
    );
    await waitFor(() => expect(screen.queryByText("Android phone")).not.toBeInTheDocument());
    expect(useUi.getState().toast).toBe("Device disconnected");
  });

  it("says a wrong PIN the way the lock screen does, and waits when the core says so", async () => {
    let attempts = 0;
    const calls = mockPremium({
      premium_approve_device: () => {
        attempts += 1;
        return Promise.reject(
          attempts < 2
            ? { kind: "identity_refused", message: "wrong secret", retry_after_secs: 0 }
            : { kind: "identity_refused", message: "wrong secret", retry_after_secs: 5 },
        ) as never;
      },
    });
    renderSection();
    const user = userEvent.setup();
    const mac = await rowOf("Mac");
    await user.click(within(mac).getByRole("button", { name: /^Approve/ }));
    await user.click(within(within(mac).getByRole("status")).getByRole("button", { name: "Approve" }));

    await confirmIdentity(user, "Approve");
    const dialog = screen.getByRole("dialog", { name: "Confirm it's you" });
    const status = await within(dialog).findByText("Wrong PIN");
    // Muted, never red: a refused secret is a fact, not an alarm.
    expect(status).toHaveClass("text-muted");
    const field = within(dialog).getByLabelText("PIN");
    expect(field).toHaveValue("");
    expect(field).toHaveFocus();

    await user.type(field, "1111");
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));
    expect(await within(dialog).findByText(/Too many attempts\. Try again in/)).toBeInTheDocument();
    expect(field).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(of("premium_approve_device", calls)).toHaveLength(2);
    // The question is still there behind the dialog.
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(within(mac).getByRole("status")).toBeInTheDocument();
  });

  it("sends an approval once, however fast the second click", async () => {
    let release: () => void = () => {};
    const calls = mockPremium({
      premium_approve_device: () =>
        new Promise((resolve) => {
          release = () => resolve({ ...STRANGER, access: "full", pending_until: null });
        }),
    });
    renderSection();
    const user = userEvent.setup();
    const mac = await rowOf("Mac");
    await user.click(within(mac).getByRole("button", { name: /^Approve/ }));
    await user.click(within(within(mac).getByRole("status")).getByRole("button", { name: "Approve" }));
    const dialog = screen.getByRole("dialog", { name: "Confirm it's you" });
    await user.type(within(dialog).getByLabelText("PIN"), PIN);
    const yes = within(dialog).getByRole("button", { name: "Approve" });
    await user.click(yes);
    const busy = within(dialog).getByRole("button", { name: "Approving…" });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    await user.click(busy);
    await user.keyboard("{Enter}");
    // No way out while it runs, either: Escape waits for the answer.
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Confirm it's you" })).toBeInTheDocument();
    expect(of("premium_approve_device", calls)).toHaveLength(1);
    act(() => release());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(of("premium_approve_device", calls)).toHaveLength(1);
  });

  it("asks for an app lock before anything changes, and leads to it", async () => {
    useLock.setState({ lock: null });
    const calls = mockPremium();
    renderSection();
    const user = userEvent.setup();
    const mac = await rowOf("Mac");
    await user.click(within(mac).getByRole("button", { name: /^Refuse/ }));
    await user.click(within(within(mac).getByRole("status")).getByRole("button", { name: "Refuse" }));

    const dialog = screen.getByRole("dialog", { name: "Confirm it's you" });
    expect(dialog).toHaveTextContent(
      "Changing who can use your Premium account needs an app lock on this device, so that nobody holding it unlocked can do it.",
    );
    expect(within(dialog).queryByLabelText("PIN")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Set an app lock" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useUi.getState().settingsSection).toBe("security");
    expect(of("premium_remove_device", calls)).toEqual([]);
  });

  it("turns to the app lock message when the Rust side finds none", async () => {
    mockPremium({
      premium_approve_device: () =>
        Promise.reject({ kind: "app_lock_required", message: "no lock" }) as never,
    });
    renderSection();
    const user = userEvent.setup();
    const mac = await rowOf("Mac");
    await user.click(within(mac).getByRole("button", { name: /^Approve/ }));
    await user.click(within(within(mac).getByRole("status")).getByRole("button", { name: "Approve" }));
    await confirmIdentity(user, "Approve");
    const dialog = screen.getByRole("dialog", { name: "Confirm it's you" });
    expect(await within(dialog).findByRole("button", { name: "Set an app lock" })).toBeInTheDocument();
  });

  it("says a failure under the card and keeps the question for the retry", async () => {
    mockPremium({
      premium_remove_device: () =>
        Promise.reject({ kind: "premium_unreachable", message: "timed out" }) as never,
    });
    renderSection();
    const user = userEvent.setup();
    const phone = await rowOf("Android phone");
    await user.click(within(phone).getByRole("button", { name: /^More for Android phone/ }));
    await user.keyboard("{Enter}");
    await user.click(within(within(phone).getByRole("status")).getByRole("button", { name: "Disconnect" }));
    await confirmIdentity(user, "Disconnect");
    const note = await screen.findByRole("alert");
    expect(note).toHaveTextContent("Could not reach the Gerfaut server.");
    expect(note).toHaveClass("bg-pending-surface");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(within(phone).getByRole("status")).toBeInTheDocument();
  });

  it("takes the focus when the Overview sends someone to review", async () => {
    mockPremium();
    act(() => useUi.getState().openSettings("premium", "devices"));
    renderSection();
    const heading = await screen.findByRole("heading", { name: "Devices" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(useUi.getState().settingsTarget).toBeNull();
  });

  it("drops the errand when this device turns out to have no Devices card", async () => {
    mockPremium({
      premium_device: () => ({ ...THIS, access: "pending", pending_until: NOW + DAY }),
    });
    act(() => useUi.getState().openSettings("premium", "devices"));
    renderSection();
    await screen.findByRole("heading", { name: "Waiting for approval" });
    await waitFor(() => expect(useUi.getState().settingsTarget).toBeNull());
  });

  it("never says full access for a device that waits without a date", async () => {
    mockPremium({
      premium_devices: () => [
        THIS,
        { ...STRANGER, pending_until: null, connected_at: NOW - 3 * DAY },
      ],
    });
    renderSection();
    const mac = await rowOf("Mac");
    expect(within(mac).queryByText("Full access")).not.toBeInTheDocument();
    expect(within(mac).getByText("Waiting · 7 days left")).toBeInTheDocument();
  });

  it("reads the list again when the device it acted on is already gone", async () => {
    let devices = [THIS, STRANGER];
    const calls = mockPremium({
      premium_devices: () => devices,
      premium_approve_device: () => {
        devices = [THIS];
        return Promise.reject({ kind: "premium_rejected", message: "no such device" }) as never;
      },
    });
    renderSection();
    const user = userEvent.setup();
    const mac = await rowOf("Mac");
    await user.click(within(mac).getByRole("button", { name: /^Approve/ }));
    await user.click(within(within(mac).getByRole("status")).getByRole("button", { name: "Approve" }));
    await confirmIdentity(user, "Approve");
    expect(await screen.findByRole("alert")).toHaveTextContent("No such device.");
    await waitFor(() => expect(of("premium_devices", calls).length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(screen.queryByText("Mac")).not.toBeInTheDocument());
  });
});

// --- a device waiting for approval -------------------------------------------

describe("a device waiting for approval", () => {
  const WAITING: Device = {
    ...THIS,
    id: "d-this",
    platform: "windows",
    connected_at: Math.floor(new Date(2026, 8, 24, 10, 0).getTime() / 1000),
    access: "pending",
    pending_until: Math.floor(new Date(2026, 9, 4, 10, 0).getTime() / 1000),
    approved_at: null,
  };

  it("shows one card that says until when, and asks the server nothing else", async () => {
    let me = WAITING;
    const calls = mockPremium({ premium_device: () => me });
    renderSection();
    const user = userEvent.setup();

    const waiting = await screen.findByRole("heading", { name: "Waiting for approval" });
    const body = within(waiting.closest("section")!);
    expect(
      body.getByText(/^This device connected to your Premium account on/),
    ).toHaveTextContent(
      "This device connected to your Premium account on 24 Sep 2026. It shows your watched wallets, channels and alerts once one of your other devices approves it, or on 4 Oct 2026 without approval.",
    );
    expect(
      body.getByText("Approve it in Gerfaut on another device: Settings › Premium › Devices."),
    ).toBeInTheDocument();
    expect(
      body.getByText(
        "The wait protects you if someone else gets your key: they see nothing and can change nothing while you are warned.",
      ),
    ).toBeInTheDocument();

    // None of the account: no cards, no calls.
    for (const name of ["Devices", "Watched wallets", "Channels", "Recent alerts"]) {
      expect(screen.queryByRole("heading", { name })).not.toBeInTheDocument();
    }
    for (const cmd of ["premium_account", "premium_devices", "premium_wallets", "premium_channels", "premium_events"]) {
      expect(of(cmd, calls)).toEqual([]);
    }
    // No changing the key, and the key leaves through this card rather
    // than the licence card: one "Forget this key", here.
    expect(screen.queryByRole("button", { name: "Change key" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Forget this key" })).toHaveLength(1);
    expect(
      card("Licence").queryByRole("button", { name: "Forget this key" }),
    ).not.toBeInTheDocument();

    // Approved elsewhere: "Check again" asks, and the account appears.
    me = { ...WAITING, access: "full", pending_until: null, approved_at: NOW };
    await user.click(body.getByRole("button", { name: "Check again" }));
    expect(await screen.findByRole("heading", { name: "Devices" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Waiting for approval" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Watched wallets" })).toBeInTheDocument();
  });

  it("lets the key leave this device, and never offers to delete the account", async () => {
    const calls = mockPremium({
      premium_device: () => WAITING,
      premium_forget: () => ({ ...STATUS, key: null, device: null }),
    });
    renderSection();
    const user = userEvent.setup();
    const waiting = await screen.findByRole("heading", { name: "Waiting for approval" });
    await user.click(
      within(waiting.closest("section")!).getByRole("button", { name: "Forget this key" }),
    );
    const question = screen.getByRole("status");
    expect(question).toHaveTextContent(/disconnects this device from your Premium account/);
    expect(screen.queryByLabelText("Also delete everything on the server")).not.toBeInTheDocument();
    // Waiting, the device leaves without the secret: nothing depends on it.
    await user.click(within(question).getByRole("button", { name: "Forget the key" }));
    await waitFor(() => expect(of("premium_forget", calls)).toEqual([{ secret: null }]));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks for the secret when the Rust side finds it was approved since", async () => {
    let me = WAITING;
    const calls = mockPremium({
      premium_device: () => me,
      premium_forget: ({ secret }) => {
        if (secret == null) {
          // Approved on another device a moment ago: the Rust side
          // asked the server again before letting it go.
          me = { ...WAITING, access: "full", pending_until: null, approved_at: NOW };
          return Promise.reject({
            kind: "identity_refused",
            message: "this needs the PIN or password of the app lock",
          }) as never;
        }
        return { ...STATUS, key: null, device: null };
      },
    });
    renderSection();
    const user = userEvent.setup();
    const waiting = await screen.findByRole("heading", { name: "Waiting for approval" });
    await user.click(
      within(waiting.closest("section")!).getByRole("button", { name: "Forget this key" }),
    );
    await user.click(
      within(screen.getByRole("status")).getByRole("button", { name: "Forget the key" }),
    );
    await confirmIdentity(user, "Forget the key");
    await waitFor(() =>
      expect(of("premium_forget", calls)).toEqual([{ secret: null }, { secret: PIN }]),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Nothing of the refusal is left under the card: it was a question.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the access it has once the secret is not given", async () => {
    let me = WAITING;
    mockPremium({
      premium_device: () => me,
      premium_forget: () => {
        me = { ...WAITING, access: "full", pending_until: null, approved_at: NOW };
        return Promise.reject({ kind: "identity_refused", message: "x" }) as never;
      },
    });
    renderSection();
    const user = userEvent.setup();
    const waiting = await screen.findByRole("heading", { name: "Waiting for approval" });
    await user.click(
      within(waiting.closest("section")!).getByRole("button", { name: "Forget this key" }),
    );
    await user.click(
      within(screen.getByRole("status")).getByRole("button", { name: "Forget the key" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Confirm it's you" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("heading", { name: "Devices" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Waiting for approval" })).not.toBeInTheDocument();
  });
});

// --- a device the server disconnected -----------------------------------------

describe("a disconnected device", () => {
  const DISCONNECTED: PremiumStatus = { ...STATUS, device: null, disconnected: true };

  it("says so in amber and connects again with the key it kept", async () => {
    let status = DISCONNECTED;
    const calls = mockPremium({
      premium_status: () => status,
      premium_reconnect: () => {
        status = { ...STATUS, device: { id: "d-new", connected_at: NOW } };
        return status;
      },
      premium_device: () => ({ ...THIS, id: "d-new", connected_at: NOW, access: "pending", pending_until: NOW + 10 * DAY }),
    });
    renderSection();
    const user = userEvent.setup();
    const note = await screen.findByText("This device was disconnected from your Premium account.");
    const panel = note.closest("[role=status]")!;
    expect(panel).toHaveClass("bg-pending-surface");
    // Nothing is asked of the server for a device it no longer knows.
    expect(of("premium_device", calls)).toEqual([]);
    expect(screen.queryByRole("heading", { name: "Watched wallets" })).not.toBeInTheDocument();

    await user.click(within(panel as HTMLElement).getByRole("button", { name: "Connect again" }));
    await waitFor(() => expect(of("premium_reconnect", calls)).toHaveLength(1));
    // A device connected again waits like any new one.
    expect(await screen.findByRole("heading", { name: "Waiting for approval" })).toBeInTheDocument();
  });

  it("brings the key field back when the key itself was changed", async () => {
    let status = DISCONNECTED;
    const calls = mockPremium({
      premium_status: () => status,
      premium_reconnect: () =>
        Promise.reject({ kind: "premium_unknown_key", message: "unknown key" }) as never,
      premium_activate: ({ key }) => {
        status = { ...STATUS, device: { id: "d-new", connected_at: NOW } };
        expect(key).toBe("2345-6789-abcd-efgh");
        return status;
      },
    });
    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Connect again" }));
    const field = await screen.findByLabelText("Account key");
    await waitFor(() => expect(field).toHaveFocus());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This key no longer works. Enter the new one.",
    );
    await user.type(field, "23456789abcdefgh");
    await user.click(screen.getByRole("button", { name: "Activate" }));
    await waitFor(() => expect(of("premium_activate", calls)).toHaveLength(1));
    expect(await screen.findByText(/Active until/)).toBeInTheDocument();
    expect(screen.queryByText("This key no longer works. Enter the new one.")).not.toBeInTheDocument();
  });

  it("shows nothing of the old account's devices once another key is entered", async () => {
    let status = DISCONNECTED;
    let release: (devices: Device[]) => void = () => {};
    mockPremium({
      premium_status: () => status,
      premium_reconnect: () =>
        Promise.reject({ kind: "premium_unknown_key", message: "unknown key" }) as never,
      premium_activate: () => {
        status = { ...STATUS, device: { id: "d-new", connected_at: NOW } };
        return status;
      },
      premium_device: () => ({ ...THIS, id: "d-new", connected_at: NOW }),
      premium_devices: () =>
        new Promise<Device[]>((resolve) => {
          release = resolve;
        }),
    });
    const client = renderSection();
    // What the cache still holds from the account before.
    act(() => client.setQueryData(["premium", "devices"], [THIS, PHONE, STRANGER]));
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Connect again" }));
    await user.type(await screen.findByLabelText("Account key"), "23456789abcdefgh");
    await user.click(screen.getByRole("button", { name: "Activate" }));

    // The new account's list is still on its way: the old one is gone.
    await screen.findByRole("heading", { name: "Devices" });
    expect(screen.queryByText("Android phone")).not.toBeInTheDocument();
    expect(screen.queryByText("Mac")).not.toBeInTheDocument();
    expect(card("Devices").getByText("Loading…")).toBeInTheDocument();
    act(() => release([{ ...THIS, id: "d-new", connected_at: NOW }]));
    expect(await screen.findByText("Windows computer")).toBeInTheDocument();
    expect(screen.queryByText("Android phone")).not.toBeInTheDocument();
  });

  it("reads the vault again when the server disowns the device mid-visit", async () => {
    let status = STATUS;
    const calls = mockPremium({
      premium_status: () => status,
      premium_device: () => {
        status = { ...STATUS, device: null, disconnected: true };
        return Promise.reject({
          kind: "premium_device_disconnected",
          message: "this device was disconnected from the Premium account",
        }) as never;
      },
    });
    renderSection();
    expect(
      await screen.findByText("This device was disconnected from your Premium account."),
    ).toBeInTheDocument();
    await waitFor(() => expect(of("premium_status", calls).length).toBeGreaterThanOrEqual(2));
    expect(screen.getByRole("button", { name: "Connect again" })).toBeInTheDocument();
  });

  it("says in the server's words why it could not connect again", async () => {
    mockPremium({
      premium_status: () => ({
        ...DISCONNECTED,
        disconnected_reason:
          "this key already has 10 devices; disconnect one from a device with full access",
      }),
    });
    renderSection();
    const note = await screen.findByText(
      "This key already has 10 devices; disconnect one from a device with full access.",
    );
    const panel = note.closest("[role=status]") as HTMLElement;
    expect(panel).toHaveClass("bg-pending-surface");
    expect(within(panel).getByRole("button", { name: "Connect again" })).toBeInTheDocument();
    expect(
      screen.queryByText("This device was disconnected from your Premium account."),
    ).not.toBeInTheDocument();
  });

  it("keeps the plain note when the refusal came with a status and no words", async () => {
    let status = DISCONNECTED;
    mockPremium({
      premium_status: () => status,
      // A proxy with no route answers in the server's place.
      premium_reconnect: () => {
        status = { ...DISCONNECTED, disconnected_reason: "HTTP 404" };
        return Promise.reject({ kind: "premium_rejected", message: "HTTP 404" }) as never;
      },
    });
    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Connect again" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not reach the Gerfaut server.",
    );
    const note = await screen.findByText("This device was disconnected from your Premium account.");
    expect(screen.queryByText(/HTTP 404/)).not.toBeInTheDocument();
    expect(
      within(note.closest("[role=status]") as HTMLElement).getByRole("button", {
        name: "Connect again",
      }),
    ).toBeInTheDocument();
  });

  it("drops what Connect again met once the device is connected again", async () => {
    let status = DISCONNECTED;
    mockPremium({
      premium_status: () => status,
      premium_reconnect: () =>
        Promise.reject({
          kind: "premium_unreachable",
          message: "the premium server is unreachable: timed out",
        }) as never,
    });
    const client = renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Connect again" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not reach the Gerfaut server.",
    );
    // The background round connected it meanwhile.
    status = STATUS;
    await act(() => client.invalidateQueries({ queryKey: ["premium", "status"] }));
    await waitFor(() =>
      expect(screen.queryByText("Could not reach the Gerfaut server.")).not.toBeInTheDocument(),
    );
    // Disowned again later: the old failure does not come back with it.
    status = DISCONNECTED;
    await act(() => client.invalidateQueries({ queryKey: ["premium", "status"] }));
    expect(await screen.findByRole("button", { name: "Connect again" })).toBeInTheDocument();
    expect(screen.queryByText("Could not reach the Gerfaut server.")).not.toBeInTheDocument();
  });

  it("lets a key the server no longer knows go, for whoever lacks the new one", async () => {
    let status = DISCONNECTED;
    const calls = mockPremium({
      premium_status: () => status,
      premium_reconnect: () =>
        Promise.reject({ kind: "premium_unknown_key", message: "unknown key" }) as never,
      premium_forget: () => {
        status = { ...STATUS, key: null, device: null, licence: null };
        return status;
      },
      premium_activate: () =>
        Promise.reject({
          kind: "premium_unreachable",
          message: "the premium server is unreachable: timed out",
        }) as never,
    });
    const client = renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Connect again" }));
    await screen.findByText("This key no longer works. Enter the new one.");
    const licence = card("Licence");
    await user.click(licence.getByRole("button", { name: "Forget this key" }));
    // Disconnected already: nothing depends on this device, no secret.
    await user.click(
      within(licence.getByRole("status")).getByRole("button", { name: "Forget the key" }),
    );
    await waitFor(() => expect(of("premium_forget", calls)).toEqual([{ secret: null }]));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // The field stays, for a key of any account, without the note that
    // spoke of the dead one.
    await waitFor(() =>
      expect(
        screen.queryByText("This key no longer works. Enter the new one."),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Account key")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Forget this key" })).not.toBeInTheDocument();

    // Another key, whose answer is lost and which the background then
    // connects: it is the key in place, not one that "no longer works".
    await user.type(screen.getByLabelText("Account key"), "23456789abcdefgh");
    await user.click(screen.getByRole("button", { name: "Activate" }));
    await screen.findByText("Could not reach the Gerfaut server.");
    status = { ...STATUS, key: "2345-6789-abcd-efgh" };
    await act(() => client.invalidateQueries({ queryKey: ["premium", "status"] }));
    expect(await screen.findByText(/Active until/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Account key")).not.toBeInTheDocument();
    expect(
      screen.queryByText("This key no longer works. Enter the new one."),
    ).not.toBeInTheDocument();
  });
});

// --- a way out of every state --------------------------------------------------

describe("every state of the connection", () => {
  const unreachable = () =>
    Promise.reject({ kind: "premium_unreachable", message: "timed out" }) as never;

  it.each([
    ["full access", {}, ["Forget this key", "Change key"]],
    [
      "waiting for approval",
      { premium_device: () => ({ ...THIS, access: "pending", pending_until: NOW + DAY }) },
      ["Forget this key", "Check again"],
    ],
    [
      "disconnected",
      { premium_status: () => ({ ...STATUS, device: null, disconnected: true }) },
      ["Forget this key", "Connect again"],
    ],
    [
      "disconnected with every device the key takes",
      {
        premium_status: () => ({
          ...STATUS,
          device: null,
          disconnected: true,
          disconnected_reason: "this key already has 10 devices; disconnect one from a device with full access",
        }),
      },
      ["Forget this key", "Connect again"],
    ],
    ["out of reach", { premium_device: unreachable }, ["Forget this key", "Retry"]],
    [
      "a key change left unfinished",
      { premium_status: () => ({ ...STATUS, key_change_pending: true }) },
      ["Try again"],
    ],
    [
      "a connection on its way",
      { premium_status: () => ({ ...STATUS, key: null, device: null, connect_pending: true }) },
      ["Activate"],
    ],
  ] as [string, Record<string, Answer>, string[]][])(
    "offers a way on when %s",
    async (_, overrides, ways) => {
      mockPremium(overrides);
      renderSection();
      for (const name of ways) {
        expect(await screen.findByRole("button", { name })).toBeInTheDocument();
      }
    },
  );
});

// --- change key ---------------------------------------------------------------

describe("changing the key", () => {
  it("says what happens, asks for the secret, then shows the new key once", async () => {
    let status = STATUS;
    const calls = mockPremium({
      premium_status: () => status,
      premium_change_key: () => {
        status = { ...STATUS, key: "wxyz-2345-6789-abcd", key_saved: false };
        return "wxyz-2345-6789-abcd";
      },
      premium_set_key_saved: ({ saved }) => {
        status = { ...status, key_saved: saved as boolean };
        return status;
      },
    });
    renderSection();
    const user = userEvent.setup();
    const open = await screen.findByRole("button", { name: "Change key" });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Devices" })).toBeInTheDocument());

    await user.click(open);
    let dialog = screen.getByRole("dialog", { name: "Change your Premium key" });
    expect(dialog).toHaveTextContent(
      "A new key replaces this one. The old key stops working at once, on the website too. Every other device is disconnected: enter the new key there, then approve it here.",
    );
    expect(dialog.querySelector(".bg-pending-surface")).not.toBeNull();
    expect(within(dialog).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "",
      "Cancel",
      "Change key",
    ]);
    expect(within(dialog).getByRole("button", { name: "Change key" })).toHaveClass("bg-alert");

    // Cancel: nothing went.
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(of("premium_change_key", calls)).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Change key" }));
    dialog = screen.getByRole("dialog", { name: "Change your Premium key" });
    await user.click(within(dialog).getByRole("button", { name: "Change key" }));
    await confirmIdentity(user, "Change key");
    await waitFor(() => expect(of("premium_change_key", calls)).toEqual([{ secret: PIN }]));

    // The new key, whole, in mono, with the focus on it.
    const key = await within(dialog).findByText("wxyz-2345-6789-abcd");
    expect(key).toHaveClass("font-data");
    await waitFor(() => expect(key).toHaveFocus());
    expect(dialog).toHaveTextContent(
      "Save it in your password manager now. This device keeps it, but nothing else does.",
    );
    // No stray way out: no close button, Escape does nothing.
    expect(within(dialog).queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Change your Premium key" })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Copy" }));
    expect(await navigator.clipboard.readText()).toBe("wxyz-2345-6789-abcd");

    const done = within(dialog).getByRole("button", { name: "Done" });
    expect(done).toBeDisabled();
    await user.click(within(dialog).getByLabelText("I saved my new key"));
    expect(done).toBeEnabled();
    await user.click(done);
    await waitFor(() => expect(of("premium_set_key_saved", calls)).toEqual([{ saved: true }]));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("drops the devices the old key connected, rather than show them until the list is back", async () => {
    let changed = false;
    let release: (devices: Device[]) => void = () => {};
    mockPremium({
      premium_change_key: () => {
        changed = true;
        return "wxyz-2345-6789-abcd";
      },
      premium_devices: () =>
        changed
          ? new Promise<Device[]>((resolve) => {
              release = resolve;
            })
          : [THIS, PHONE, STRANGER],
    });
    renderSection();
    const user = userEvent.setup();
    expect(await screen.findByText("Android phone")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Change key" }));
    const dialog = screen.getByRole("dialog", { name: "Change your Premium key" });
    await user.click(within(dialog).getByRole("button", { name: "Change key" }));
    await confirmIdentity(user, "Change key");
    await within(dialog).findByText("wxyz-2345-6789-abcd");

    await waitFor(() => expect(screen.queryByText("Android phone")).not.toBeInTheDocument());
    expect(screen.queryByText("Mac")).not.toBeInTheDocument();
    act(() => release([THIS]));
    expect(await screen.findByText("Windows computer")).toBeInTheDocument();
    expect(screen.queryByText("Android phone")).not.toBeInTheDocument();
  });

  it("keeps the question and says why when the server refuses", async () => {
    mockPremium({
      premium_change_key: () =>
        Promise.reject({ kind: "premium_rate_limited", message: "Try again in 30 s." }) as never,
    });
    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Change key" }));
    const dialog = screen.getByRole("dialog", { name: "Change your Premium key" });
    await user.click(within(dialog).getByRole("button", { name: "Change key" }));
    await confirmIdentity(user, "Change key");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "The server asks to wait. Try again in 30 s.",
    );
    expect(within(dialog).getByRole("button", { name: "Change key" })).toBeEnabled();
  });
});

// --- a key change that did not finish ---------------------------------------------

describe("a key change that did not finish", () => {
  const UNFINISHED: PremiumStatus = {
    ...STATUS,
    key_saved: false,
    checklist_hidden: false,
    key_change_pending: true,
  };
  const WORDS = "The key change did not finish. Try again to complete it.";

  async function noteOf() {
    return (await screen.findByText(WORDS)).closest("[role=status]") as HTMLElement;
  }

  it("says so under the licence, and offers neither the key nor a new change", async () => {
    mockPremium({ premium_status: () => UNFINISHED });
    renderSection();
    const note = await noteOf();
    expect(note).toHaveClass("bg-pending-surface");
    expect(within(note).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    // The key in place may be dead: nothing offers to copy it, and
    // leaving would lose the new one.
    const licence = card("Licence");
    expect(licence.getByRole("button", { name: "Renew" })).toBeInTheDocument();
    for (const name of ["Copy key", "Change key", "Forget this key"]) {
      expect(licence.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    await screen.findByRole("heading", { name: "Protect your Premium account" });
    expect(
      card("Protect your Premium account").queryByRole("button", { name: "Copy key" }),
    ).not.toBeInTheDocument();
  });

  it("finishes with the secret and shows the new key the way a change does", async () => {
    let status = UNFINISHED;
    const calls = mockPremium({
      premium_status: () => status,
      premium_change_key: () => {
        status = { ...STATUS, key: "wxyz-2345-6789-abcd", key_saved: false };
        return "wxyz-2345-6789-abcd";
      },
      premium_set_key_saved: ({ saved }) => {
        status = { ...status, key_saved: saved as boolean };
        return status;
      },
    });
    renderSection();
    const user = userEvent.setup();
    await user.click(within(await noteOf()).getByRole("button", { name: "Try again" }));
    expect(of("premium_change_key", calls)).toEqual([]);
    await confirmIdentity(user, "Change key");
    await waitFor(() => expect(of("premium_change_key", calls)).toEqual([{ secret: PIN }]));

    const dialog = await screen.findByRole("dialog", { name: "Change your Premium key" });
    const key = await within(dialog).findByText("wxyz-2345-6789-abcd");
    await waitFor(() => expect(key).toHaveFocus());
    // The note goes with the change it spoke of; the key stays.
    await waitFor(() => expect(screen.queryByText(WORDS)).not.toBeInTheDocument());
    expect(within(dialog).getByText("wxyz-2345-6789-abcd")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Change your Premium key" })).toBeInTheDocument();

    await user.click(within(dialog).getByLabelText("I saved my new key"));
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(of("premium_set_key_saved", calls)).toEqual([{ saved: true }]));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("reads the devices again after a change whose answer was lost", async () => {
    let applied = false;
    mockPremium({
      premium_status: () => (applied ? { ...STATUS, key_change_pending: true } : STATUS),
      // The server applied it, and dropped every other device; the
      // answer never came back.
      premium_change_key: () => {
        applied = true;
        return Promise.reject({
          kind: "premium_unreachable",
          message: "the premium server is unreachable: connection reset",
        }) as never;
      },
      premium_devices: () => (applied ? [THIS] : [THIS, PHONE]),
    });
    renderSection();
    const user = userEvent.setup();
    expect(await screen.findByText("Android phone")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Change key" }));
    const dialog = screen.getByRole("dialog", { name: "Change your Premium key" });
    await user.click(within(dialog).getByRole("button", { name: "Change key" }));
    await confirmIdentity(user, "Change key");
    await waitFor(() => expect(screen.queryByText("Android phone")).not.toBeInTheDocument());
    expect(card("Devices").getByText("Windows computer")).toBeInTheDocument();
  });

  it("says a failed try under the note, which stays", async () => {
    mockPremium({
      premium_status: () => UNFINISHED,
      premium_change_key: () =>
        Promise.reject({
          kind: "premium_unreachable",
          message: "the premium server is unreachable: timed out",
        }) as never,
    });
    renderSection();
    const user = userEvent.setup();
    await user.click(within(await noteOf()).getByRole("button", { name: "Try again" }));
    await confirmIdentity(user, "Change key");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not reach the Gerfaut server.",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(within(await noteOf()).getByRole("button", { name: "Try again" })).toBeEnabled();
  });
});

// --- the checklist --------------------------------------------------------------

describe("the protect your premium account card", () => {
  it("ticks each gesture from what is true, and leads to the rest", async () => {
    let status: PremiumStatus = { ...STATUS, key_saved: false, checklist_hidden: false };
    useLock.setState({ lock: null });
    const calls = mockPremium({
      premium_status: () => status,
      premium_devices: () => [THIS, PHONE],
      premium_set_key_saved: ({ saved }) => {
        status = { ...status, key_saved: saved as boolean };
        return status;
      },
    });
    renderSection();
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Protect your Premium account" });
    const protect = card("Protect your Premium account");
    const steps = protect.getAllByRole("listitem");
    expect(steps.map((step) => step.querySelector(".font-medium")?.textContent)).toEqual([
      "Done: Connect a second device",
      "To do: Turn on the app lock",
      "To do: Save your key in a password manager",
    ]);
    // Two devices with full access: the first is ticked, by its shape too.
    expect(steps[0].querySelector("svg.lucide-circle-check")).not.toBeNull();
    expect(steps[1].querySelector("svg.lucide-circle")).not.toBeNull();
    expect(steps[0]).toHaveTextContent(
      "Enter this key in Gerfaut on your computer or another phone, then approve it here. If this device is lost, the other keeps full access.",
    );
    expect(steps[1]).toHaveTextContent(
      "Anyone holding this device unlocked could approve a stranger's device. A PIN stops them.",
    );
    expect(steps[2]).toHaveTextContent(
      "Your key is the whole account. Nobody can send it to you again.",
    );

    await user.click(within(steps[2]).getByRole("button", { name: "Copy key" }));
    expect(await navigator.clipboard.readText()).toBe("abcd-efgh-ijkm-npqr");
    await user.click(within(steps[2]).getByRole("button", { name: "Mark as done" }));
    await waitFor(() => expect(of("premium_set_key_saved", calls)).toEqual([{ saved: true }]));
    await waitFor(() =>
      expect(
        card("Protect your Premium account").getAllByRole("listitem")[2].querySelector(".font-medium"),
      ).toHaveTextContent("Done: Save your key in a password manager"),
    );

    await user.click(within(steps[1]).getByRole("button", { name: "Set up" }));
    expect(useUi.getState().settingsSection).toBe("security");
  });

  it("goes once hidden, and on its own once everything is done", async () => {
    let status: PremiumStatus = { ...STATUS, key_saved: true, checklist_hidden: false };
    const calls = mockPremium({
      premium_status: () => status,
      premium_devices: () => [THIS],
      premium_hide_checklist: () => {
        status = { ...status, checklist_hidden: true };
        return status;
      },
    });
    const client = renderSection();
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Protect your Premium account" });
    await user.click(card("Protect your Premium account").getByRole("button", { name: "Hide" }));
    await waitFor(() => expect(of("premium_hide_checklist", calls)).toHaveLength(1));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Protect your Premium account" })).not.toBeInTheDocument(),
    );

    // All three true: nothing left to say, hidden or not.
    status = { ...status, checklist_hidden: false };
    act(() => {
      client.setQueryData(["premium", "devices"], [THIS, PHONE]);
      void client.invalidateQueries({ queryKey: ["premium", "status"] });
    });
    await waitFor(() => expect(of("premium_status", calls).length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByRole("heading", { name: "Protect your Premium account" })).not.toBeInTheDocument();
  });
});

// --- copying the key --------------------------------------------------------------

describe("copying the key", () => {
  /** A clipboard that refuses, for the length of one test. */
  function refusingClipboard() {
    const spy = vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    return () => spy.mockRestore();
  }

  it("offers the key on the licence card until it is saved, and says a refusal under it", async () => {
    let status: PremiumStatus = { ...STATUS, key_saved: false };
    mockPremium({ premium_status: () => status });
    const client = renderSection();
    const user = userEvent.setup();
    const licence = await screen.findByRole("heading", { name: "Licence" });
    const copy = await within(licence.closest("section")!).findByRole("button", {
      name: "Copy key",
    });

    const restore = refusingClipboard();
    await user.click(copy);
    const note = await within(licence.closest("section")!).findByRole("alert");
    expect(note).toHaveTextContent("Could not copy the key.");
    expect(note).toHaveClass("bg-pending-surface");
    expect(useUi.getState().toast).toBeNull();
    restore();

    await user.click(copy);
    expect(await navigator.clipboard.readText()).toBe("abcd-efgh-ijkm-npqr");
    await waitFor(() =>
      expect(within(licence.closest("section")!).queryByRole("alert")).not.toBeInTheDocument(),
    );

    // Saved: the licence card no longer offers it.
    status = { ...status, key_saved: true };
    await act(() => client.invalidateQueries({ queryKey: ["premium", "status"] }));
    await waitFor(() =>
      expect(
        within(licence.closest("section")!).queryByRole("button", { name: "Copy key" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("says a refused copy of the new key under it, never in a toast", async () => {
    mockPremium({ premium_change_key: () => "wxyz-2345-6789-abcd" });
    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Change key" }));
    const dialog = screen.getByRole("dialog", { name: "Change your Premium key" });
    await user.click(within(dialog).getByRole("button", { name: "Change key" }));
    await confirmIdentity(user, "Change key");
    await within(dialog).findByText("wxyz-2345-6789-abcd");

    const restore = refusingClipboard();
    await user.click(within(dialog).getByRole("button", { name: "Copy" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Could not copy the key.");
    expect(useUi.getState().toast).toBeNull();
    restore();
  });

  it("says a refused copy under the checklist step", async () => {
    mockPremium({
      premium_status: () => ({ ...STATUS, key_saved: false, checklist_hidden: false }),
    });
    renderSection();
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Protect your Premium account" });
    const step = card("Protect your Premium account").getAllByRole("listitem")[2];
    const restore = refusingClipboard();
    await user.click(within(step).getByRole("button", { name: "Copy key" }));
    expect(await within(step).findByRole("alert")).toHaveTextContent("Could not copy the key.");
    expect(useUi.getState().toast).toBeNull();
    restore();
  });
});
