import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import type { Settings, UpdateStatus } from "../lib/ipc";
import { useLock } from "../state/lock";
import { useUi } from "../state/store";
import { RELEASES_URL, useUpdate } from "../state/update";
import { PREFERENCES } from "../test/fixtures";
import { APP_VERSION } from "../views/settings/AboutSection";

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

const SETTINGS: Settings = {
  active_network: "signet",
  backends: {},
  gap_limit: 20,
  app_prefs: { "onboarding.seen": "1" },
  electrum_certs: {},
  app_lock: null,
  tor: { mode: "auto", socks_proxy: null },
  preferences: PREFERENCES,
};

/** What a check finds: a newer release, nothing newer, or no answer.
    Which release is newer, when a check is due and what was closed are
    the core's to decide, and tested there: this one only does what the
    test tells it, so that the screens can be held to what it says. */
type Finding = string | null | "offline" | "no-tor";

interface Core {
  /** What the next check finds. */
  finds: Finding;
  /** A session asks GitHub: the core found a check due. */
  due: boolean;
  automatic: boolean;
  /** The newer release known. */
  available: string | null;
  /** The release the notice was closed on. */
  dismissed: string | null;
  torUnavailable: boolean;
  /** How many sessions the window opened, counted as they are asked:
      one asked behind the lock counts too, refused or not. */
  sessions: number;
  /** How many times GitHub was asked. */
  checks: number;
  /** The app lock is set and the window has not been unlocked yet. */
  locked: boolean;
  /** The core answers nothing about releases. */
  silent: boolean;
}

function statusOf(core: Core): UpdateStatus {
  return {
    automatic: core.automatic,
    announce: core.available !== null && core.available !== core.dismissed ? core.available : null,
    available: core.available,
    tor_unavailable: core.torUnavailable,
  };
}

const LOCKED = { kind: "locked", message: "Gerfaut is locked." };
const SILENT = { kind: "internal", message: "no answer" };

/** A vault with no wallet, which is all the notice needs, and a core
    that answers about releases as `options` say. */
function mockCore(options: Partial<Core> & { lock?: boolean } = {}): Core {
  const { lock, ...rest } = options;
  const core: Core = {
    finds: "0.2.0",
    due: true,
    automatic: true,
    available: null,
    dismissed: null,
    torUnavailable: false,
    sessions: 0,
    checks: 0,
    locked: lock ?? false,
    silent: false,
    ...rest,
  };
  /** One request to GitHub, as the core would make it. */
  const ask = () => {
    if (core.finds === "no-tor") {
      core.torUnavailable = true;
      return false;
    }
    core.checks += 1;
    core.torUnavailable = false;
    if (core.finds !== "offline") core.available = core.finds;
    return true;
  };
  mockIPC((cmd, args) => {
    const payload = (args ?? {}) as Record<string, unknown>;
    switch (cmd) {
      case "get_settings":
        return {
          ...SETTINGS,
          app_lock: lock ? { kind: "pin", biometric: false } : null,
        };
      case "verify_app_lock":
        core.locked = false;
        return { unlocked: true, failures: 0, retry_after_secs: 0 };
      case "lock_app":
        core.locked = true;
        return undefined;
      case "list_wallets":
        return [];
      case "set_app_pref":
        return undefined;
      case "update_status":
        if (core.locked) return Promise.reject(LOCKED);
        if (core.silent) return Promise.reject(SILENT);
        return statusOf(core);
      case "update_session":
        core.sessions += 1;
        if (core.locked) return Promise.reject(LOCKED);
        if (core.silent) return Promise.reject(SILENT);
        if (core.automatic && core.due && ask()) core.due = false;
        return statusOf(core);
      case "check_update": {
        if (core.locked) return Promise.reject(LOCKED);
        if (!ask()) return Promise.reject({ kind: "tor", message: "tor: no proxy answers" });
        if (core.finds === "offline") {
          return Promise.reject({ kind: "sync", message: "github: error sending request" });
        }
        // The answer is on screen: the core counts it as seen.
        core.dismissed = core.available;
        return statusOf(core);
      }
      case "dismiss_update":
        if (core.locked) return Promise.reject(LOCKED);
        core.dismissed = String(payload.version);
        return undefined;
      case "set_update_automatic":
        if (core.locked) return Promise.reject(LOCKED);
        core.automatic = Boolean(payload.automatic);
        return undefined;
      default:
        throw new Error(`unexpected command ${cmd}`);
    }
  });
  return core;
}

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

const notice = () => screen.queryByRole("region", { name: "Update available" });
const findNotice = () => screen.findByRole("region", { name: "Update available" });

/** The app is up and its session has been answered. */
async function settled(core: Core, sessions = 1) {
  expect(await screen.findByText("No wallets watched yet")).toBeInTheDocument();
  await waitFor(() => expect(core.sessions).toBe(sessions));
  await waitFor(() => expect(useUpdate.getState().checking).toBe(false));
}

function reset() {
  useLock.setState({ lock: null, locked: false, seen: false });
  useUi.setState({ view: "home", settingsSection: "general", toast: null });
  useUpdate.setState({ status: null, arriving: false, checking: false });
}

beforeEach(() => {
  reset();
  openUrl.mockClear();
});
afterEach(reset);

describe("the update notice", () => {
  it("says that a newer version exists, without taking the focus", async () => {
    const core = mockCore({ finds: "0.2.0" });
    renderApp();

    const region = await findNotice();
    expect(within(region).getByRole("status")).toHaveTextContent(
      `Gerfaut 0.2.0 is availableYou are running ${APP_VERSION}.`,
    );
    expect(within(region).getByRole("button", { name: "See the update" })).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Later" })).toBeInTheDocument();
    // Information, not a dialog: nothing is modal and the focus stays
    // where it was.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(region.contains(document.activeElement)).toBe(false);
    expect(core.sessions).toBe(1);
    expect(core.checks).toBe(1);
  });

  it("sits in the layout above the page, so it can never cover an amount", async () => {
    const core = mockCore({ finds: "0.2.0" });
    renderApp();
    await settled(core);

    const region = await findNotice();
    // Part of the canvas, not a layer over it: no fixed or absolute
    // box, and the page comes after it inside the same column.
    expect(region.className).not.toMatch(/\b(fixed|absolute|sticky)\b/);
    const main = screen.getByRole("main");
    expect(main).toContainElement(region);
    const page = screen.getByText("No wallets watched yet");
    expect(region.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(region).not.toContainElement(page);
  });

  it("closes on Later, has the core close that version, and stays closed the next time", async () => {
    const core = mockCore({ finds: "0.2.0" });
    const first = renderApp();
    const user = userEvent.setup();
    await user.click(within(await findNotice()).getByRole("button", { name: "Later" }));

    expect(notice()).not.toBeInTheDocument();
    await waitFor(() => expect(core.dismissed).toBe("0.2.0"));

    // The next launch, from what the core kept.
    first.unmount();
    reset();
    renderApp();
    await settled(core, 2);
    expect(useUpdate.getState().status?.available).toBe("0.2.0");
    expect(notice()).not.toBeInTheDocument();
    expect(core.checks).toBe(1);
  });

  it("shows a release the core already announces before any check is answered", async () => {
    const core = mockCore({ finds: "offline", due: false, available: "0.2.0" });
    renderApp();

    expect(await findNotice()).toHaveTextContent("Gerfaut 0.2.0 is available");
    await settled(core);
    expect(core.checks).toBe(0);
  });

  it("shows nothing the core does not announce", async () => {
    const core = mockCore({ finds: "0.2.0", due: false, available: "0.2.0", dismissed: "0.2.0" });
    renderApp();
    await settled(core);

    expect(notice()).not.toBeInTheDocument();
  });

  it("closes on Escape while the keyboard is nowhere in particular", async () => {
    const core = mockCore({ finds: "0.2.0" });
    renderApp();
    const user = userEvent.setup();
    await findNotice();
    act(() => (document.activeElement as HTMLElement | null)?.blur());

    await user.keyboard("{Escape}");

    expect(notice()).not.toBeInTheDocument();
    await waitFor(() => expect(core.dismissed).toBe("0.2.0"));
  });

  it("leaves Escape to whatever else holds the focus", async () => {
    mockCore({ finds: "0.2.0" });
    renderApp();
    const user = userEvent.setup();
    await findNotice();

    screen.getByRole("button", { name: "Settings" }).focus();
    await user.keyboard("{Escape}");
    expect(notice()).toBeInTheDocument();

    // From the notice itself, reached with the keyboard, it closes.
    within(notice()!).getByRole("button", { name: "Later" }).focus();
    await user.keyboard("{Escape}");
    expect(notice()).not.toBeInTheDocument();
  });

  it("opens Settings on About, where the download is, and nowhere the network named", async () => {
    const core = mockCore({ finds: "0.2.0" });
    renderApp();
    const user = userEvent.setup();
    await user.click(within(await findNotice()).getByRole("button", { name: "See the update" }));

    const heading = await screen.findByRole("heading", { name: "About" });
    expect(heading).toHaveFocus();
    expect(notice()).not.toBeInTheDocument();
    expect(screen.getByText("Gerfaut 0.2.0 is available.")).toBeInTheDocument();
    await waitFor(() => expect(core.dismissed).toBe("0.2.0"));

    await user.click(screen.getByRole("button", { name: "Get 0.2.0" }));
    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith(RELEASES_URL);

    // Back on another page, the notice has been answered for good.
    await user.click(screen.getByRole("button", { name: "General" }));
    expect(notice()).not.toBeInTheDocument();
  });

  it("says nothing when the check fails", async () => {
    const core = mockCore({ finds: "offline" });
    renderApp();
    await settled(core);

    expect(core.checks).toBe(1);
    expect(notice()).not.toBeInTheDocument();
  });

  it("asks nothing and shows nothing while the app is locked, then both once it opens", async () => {
    const core = mockCore({ finds: "0.2.0", lock: true, locked: true });
    renderApp();
    const user = userEvent.setup();

    expect(await screen.findByText("Locked")).toBeInTheDocument();
    // Long enough for a session to have opened, had one been started.
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(core.sessions).toBe(0);
    expect(notice()).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("PIN"), "1234");
    await user.click(screen.getByRole("button", { name: "Unlock" }));

    expect(await findNotice()).toHaveTextContent("Gerfaut 0.2.0 is available");
    expect(core.sessions).toBe(1);

    // The curtain again: the notice goes with the rest of the shell.
    act(() => useLock.getState().lockNow());
    expect(await screen.findByText("Locked")).toBeInTheDocument();
    expect(notice()).not.toBeInTheDocument();
  });

  it("says so quietly when Tor is needed and cannot be had", async () => {
    const core = mockCore({ finds: "no-tor" });
    renderApp();
    const user = userEvent.setup();
    await settled(core);

    expect(notice()).not.toBeInTheDocument();
    expect(core.checks).toBe(0);

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "About" }));
    expect(
      await screen.findByText("Tor is not available, so the check was not sent."),
    ).toBeInTheDocument();

    // The button goes the same way, and a check that lands clears the line.
    core.finds = null;
    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("You are up to date.")).toBeInTheDocument();
    expect(
      screen.queryByText("Tor is not available, so the check was not sent."),
    ).not.toBeInTheDocument();
  });
});

describe("the About card", () => {
  async function openAbout(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "About" }));
    return screen.findByRole("switch", { name: "Check for updates automatically" });
  }

  it("turns the automatic check off in the core, and on again with a session", async () => {
    const core = mockCore({ finds: "offline", due: false });
    const first = renderApp();
    const user = userEvent.setup();
    await settled(core);
    let toggle = await openAbout(user);

    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    await waitFor(() => expect(core.automatic).toBe(false));

    // The next launch reads it from the core.
    first.unmount();
    reset();
    renderApp();
    toggle = await openAbout(user);
    await waitFor(() => expect(toggle).not.toBeChecked());

    const sessions = core.sessions;
    await user.click(toggle);
    await waitFor(() => expect(core.automatic).toBe(true));
    await waitFor(() => expect(core.sessions).toBe(sessions + 1));
    expect(toggle).toBeChecked();
  });

  it("draws no switch before the core has said whether the check is on", async () => {
    const core = mockCore({ automatic: false, due: false, silent: true });
    renderApp();
    const user = userEvent.setup();
    await settled(core);
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "About" }));
    expect(await screen.findByText("Check for updates automatically")).toBeInTheDocument();
    // Long enough for the card's own read to have come back refused.
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(screen.queryByRole("switch", { name: "Check for updates automatically" })).toBeNull();

    // The core answers: the card asks again when it opens next.
    core.silent = false;
    await user.click(screen.getByRole("button", { name: "General" }));
    const toggle = await openAbout(user);
    expect(toggle).not.toBeChecked();
  });

  it("answers a check asked by hand, and the notice stays quiet about it", async () => {
    const core = mockCore({ finds: "0.2.0", automatic: false });
    renderApp();
    const user = userEvent.setup();
    await openAbout(user);

    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByRole("button", { name: "Get 0.2.0" })).toBeInTheDocument();
    expect(screen.getByText("Gerfaut 0.2.0 is available.")).toBeInTheDocument();
    expect(core.checks).toBe(1);

    await user.click(screen.getByRole("button", { name: "General" }));
    expect(notice()).not.toBeInTheDocument();
  });

  it("says so when there is nothing newer, or no answer", async () => {
    const core = mockCore({ finds: null, automatic: false });
    renderApp();
    const user = userEvent.setup();
    await openAbout(user);

    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("You are up to date.")).toBeInTheDocument();

    core.finds = "offline";
    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(
      await screen.findByText("Could not reach the release page. Try again later."),
    ).toBeInTheDocument();
    expect(openUrl).not.toHaveBeenCalled();
  });
});
