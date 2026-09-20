import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import type { BackendConfig, Network, Settings } from "../lib/ipc";
import { useLock } from "../state/lock";
import { useUi } from "../state/store";
import { CHECK_EVERY, RELEASES_URL, useUpdate } from "../state/update";
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
  premium: { key: null, certificate: null, watched: [], acknowledged_offline_until: null },
};

/** What GitHub is made to answer: a tag, or a failure. */
type Answer = { latest: unknown } | "offline" | "no-tor";

interface Vault {
  /** The preferences as the vault holds them, written through. */
  prefs: Record<string, string>;
  /** How many times the release page was asked. */
  checks: number;
  answer: Answer;
  /** The app lock is set and the vault has not been opened yet. */
  locked: boolean;
}

/** A vault with no wallet, which is all the notice needs: the empty
    workspace, the settings, and a release page that answers `answer`. */
function mockVault(options: {
  answer?: Answer;
  prefs?: Record<string, string>;
  lock?: boolean;
  backends?: Partial<Record<Network, BackendConfig>>;
}): Vault {
  const vault: Vault = {
    prefs: { "onboarding.seen": "1", ...options.prefs },
    checks: 0,
    answer: options.answer ?? { latest: "v0.2.0" },
    locked: options.lock ?? false,
  };
  mockIPC((cmd, args) => {
    const payload = (args ?? {}) as Record<string, string>;
    switch (cmd) {
      case "get_settings":
        // Behind the lock the vault answers the theme and the tour, and
        // no backend: the same cut the Rust side makes.
        return vault.locked
          ? {
              ...SETTINGS,
              app_lock: { kind: "pin", biometric: false },
              app_prefs: { "onboarding.seen": "1" },
            }
          : {
              ...SETTINGS,
              app_lock: options.lock ? { kind: "pin", biometric: false } : null,
              backends: options.backends ?? {},
              app_prefs: { ...vault.prefs },
            };
      case "verify_app_lock":
        vault.locked = false;
        return { unlocked: true, failures: 0, retry_after_secs: 0 };
      case "lock_app":
        vault.locked = true;
        return undefined;
      case "list_wallets":
        return [];
      case "set_app_pref":
        if (vault.locked) return Promise.reject({ kind: "locked", message: "Gerfaut is locked." });
        vault.prefs[payload.key] = payload.value;
        return undefined;
      case "check_update":
        vault.checks += 1;
        if (vault.answer === "offline") {
          return Promise.reject({ kind: "sync", message: "github: error sending request" });
        }
        // Tor is required and cannot be had: the core sent nothing.
        if (vault.answer === "no-tor") {
          return Promise.reject({ kind: "tor", message: "tor: no proxy answers" });
        }
        return { latest: vault.answer.latest, url: "https://evil.example/download", update_available: true };
      default:
        throw new Error(`unexpected command ${cmd}`);
    }
  });
  return vault;
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

/** The app is up and the check, if one was due, has been answered. */
async function settled(vault: Vault, checks: number) {
  expect(await screen.findByText("No wallets watched yet")).toBeInTheDocument();
  await waitFor(() => expect(vault.checks).toBe(checks));
  await waitFor(() => expect(useUpdate.getState().checking).toBe(false));
}

function reset() {
  useLock.setState({ lock: null, locked: false, seen: false });
  useUi.setState({ view: "home", settingsSection: "general", toast: null });
  useUpdate.setState({
    ready: false,
    auto: true,
    latest: null,
    dismissed: null,
    checkedAt: 0,
    arriving: false,
    checking: false,
    torUnavailable: false,
  });
}

beforeEach(() => {
  reset();
  openUrl.mockClear();
});
afterEach(reset);

describe("the update notice", () => {
  it("says that a newer version exists, without taking the focus", async () => {
    const vault = mockVault({ answer: { latest: "v0.2.0" } });
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
    // The check was stamped, and what it found is kept.
    expect(vault.checks).toBe(1);
    await waitFor(() => expect(vault.prefs["update.latest"]).toBe("0.2.0"));
    expect(Number(vault.prefs["update.checked_at"])).toBeGreaterThan(0);
  });

  it("sits in the layout above the page, so it can never cover an amount", async () => {
    const vault = mockVault({ answer: { latest: "v0.2.0" } });
    renderApp();
    await settled(vault, 1);

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

  it("closes on Later, remembers the version, and stays closed the next time", async () => {
    const vault = mockVault({ answer: { latest: "v0.2.0" } });
    const first = renderApp();
    const user = userEvent.setup();
    await user.click(within(await findNotice()).getByRole("button", { name: "Later" }));

    expect(notice()).not.toBeInTheDocument();
    await waitFor(() => expect(vault.prefs["update.dismissed"]).toBe("0.2.0"));

    // The next launch, from what the vault kept: nothing is shown, and
    // inside the same day GitHub is not asked again.
    first.unmount();
    reset();
    renderApp();
    await settled(vault, 1);
    expect(useUpdate.getState().latest).toBe("0.2.0");
    expect(notice()).not.toBeInTheDocument();
  });

  it("shows again for a version newer than the one closed", async () => {
    const yesterday = Math.floor(Date.now() / 1000) - CHECK_EVERY - 60;
    const vault = mockVault({
      answer: { latest: "v0.3.0" },
      prefs: {
        "update.latest": "0.2.0",
        "update.dismissed": "0.2.0",
        "update.checked_at": String(yesterday),
      },
    });
    renderApp();

    expect(await findNotice()).toHaveTextContent("Gerfaut 0.3.0 is available");
    expect(vault.checks).toBe(1);
  });

  it("shows a version already known without asking again inside the day", async () => {
    const vault = mockVault({
      answer: "offline",
      prefs: {
        "update.latest": "0.2.0",
        "update.checked_at": String(Math.floor(Date.now() / 1000) - 3600),
      },
    });
    renderApp();

    expect(await findNotice()).toHaveTextContent("Gerfaut 0.2.0 is available");
    expect(vault.checks).toBe(0);
  });

  it("closes on Escape while the keyboard is nowhere in particular", async () => {
    const vault = mockVault({ answer: { latest: "v0.2.0" } });
    renderApp();
    const user = userEvent.setup();
    await findNotice();
    act(() => (document.activeElement as HTMLElement | null)?.blur());

    await user.keyboard("{Escape}");

    expect(notice()).not.toBeInTheDocument();
    await waitFor(() => expect(vault.prefs["update.dismissed"]).toBe("0.2.0"));
  });

  it("leaves Escape to whatever else holds the focus", async () => {
    mockVault({ answer: { latest: "v0.2.0" } });
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
    const vault = mockVault({ answer: { latest: "v0.2.0" } });
    renderApp();
    const user = userEvent.setup();
    await user.click(within(await findNotice()).getByRole("button", { name: "See the update" }));

    const heading = await screen.findByRole("heading", { name: "About" });
    expect(heading).toHaveFocus();
    expect(notice()).not.toBeInTheDocument();
    expect(screen.getByText("Gerfaut 0.2.0 is available.")).toBeInTheDocument();
    await waitFor(() => expect(vault.prefs["update.dismissed"]).toBe("0.2.0"));

    await user.click(screen.getByRole("button", { name: "Get 0.2.0" }));
    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith(RELEASES_URL);

    // Back on another page, the notice has been answered for good.
    await user.click(screen.getByRole("button", { name: "General" }));
    expect(notice()).not.toBeInTheDocument();
  });

  it("says nothing when the check fails", async () => {
    const vault = mockVault({ answer: "offline" });
    renderApp();
    await settled(vault, 1);

    expect(notice()).not.toBeInTheDocument();
    expect(vault.prefs["update.latest"]).toBeUndefined();
    // A failure still counts as today's check.
    expect(Number(vault.prefs["update.checked_at"])).toBeGreaterThan(0);
  });

  it.each([
    ["a tag that is no version", "nightly"],
    ["markup", "<img src=x onerror=alert(1)>"],
    ["a version with markup after it", "0.2.0<script>alert(1)</script>"],
    ["no tag at all", undefined],
    ["a number", 2],
    ["the version already running", `v${APP_VERSION}`],
    ["an older version", "v0.0.9"],
    ["a release candidate", "v0.2.0-rc.1"],
  ])("says nothing for %s", async (_name, latest) => {
    const vault = mockVault({ answer: { latest } });
    renderApp();
    await settled(vault, 1);

    expect(notice()).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("<img src=x");
    expect(document.body.innerHTML).not.toContain("<script>alert");
  });

  it("ignores a stored version that does not read as one", async () => {
    const vault = mockVault({
      answer: "offline",
      prefs: {
        "update.latest": "<b>9.9.9</b>",
        "update.checked_at": String(Math.floor(Date.now() / 1000)),
      },
    });
    renderApp();
    await settled(vault, 0);

    expect(notice()).not.toBeInTheDocument();
  });

  it("asks nothing and shows nothing while the app is locked, then both once it opens", async () => {
    const vault = mockVault({ answer: { latest: "v0.2.0" }, lock: true });
    vault.locked = true;
    renderApp();
    const user = userEvent.setup();

    expect(await screen.findByText("Locked")).toBeInTheDocument();
    // Long enough for a check to have gone out, had one been started.
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(vault.checks).toBe(0);
    expect(notice()).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("PIN"), "1234");
    await user.click(screen.getByRole("button", { name: "Unlock" }));

    expect(await findNotice()).toHaveTextContent("Gerfaut 0.2.0 is available");
    expect(vault.checks).toBe(1);

    // The curtain again: the notice goes with the rest of the shell.
    act(() => useLock.getState().lockNow());
    expect(await screen.findByText("Locked")).toBeInTheDocument();
    expect(notice()).not.toBeInTheDocument();
  });

  it("asks nothing when the setting is off", async () => {
    const vault = mockVault({ answer: { latest: "v0.2.0" }, prefs: { "update.auto": "0" } });
    renderApp();
    await settled(vault, 0);
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

    expect(vault.checks).toBe(0);
    expect(notice()).not.toBeInTheDocument();
  });

  it("checks with an onion backend too: the core sends it through Tor", async () => {
    const vault = mockVault({
      answer: { latest: "v0.2.0" },
      backends: {
        mainnet: {
          type: "custom_electrum",
          url: "tcp://explorerzydxu5ecjrkwceayqybizmpjjznk5izmitf2modhcusuqlid.onion:50001",
        },
      },
    });
    renderApp();
    const user = userEvent.setup();
    await settled(vault, 1);

    expect(await findNotice()).toHaveTextContent("Gerfaut 0.2.0 is available");
    await user.click(screen.getByRole("button", { name: "Later" }));
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "About" }));
    expect(await screen.findByText(/With an onion backend the request goes through Tor/)).toBeInTheDocument();
    expect(screen.queryByText(/Paused/)).not.toBeInTheDocument();
  });

  it("says so quietly when Tor is needed and cannot be had, and does not spend the day", async () => {
    const vault = mockVault({ answer: "no-tor" });
    renderApp();
    const user = userEvent.setup();
    await settled(vault, 1);

    expect(notice()).not.toBeInTheDocument();
    // Nothing went out, so the next unlock or hour tries again.
    await waitFor(() => expect(vault.prefs["update.checked_at"]).toBe("0"));
    expect(useUpdate.getState().checkedAt).toBe(0);

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "About" }));
    expect(
      await screen.findByText("Tor is not available, so the check was not sent."),
    ).toBeInTheDocument();

    // The button goes the same way, and a check that lands clears the line.
    vault.answer = { latest: `v${APP_VERSION}` };
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

  it("turns the automatic check off and keeps it off", async () => {
    const vault = mockVault({
      answer: "offline",
      prefs: { "update.checked_at": String(Math.floor(Date.now() / 1000)) },
    });
    renderApp();
    const user = userEvent.setup();
    const toggle = await openAbout(user);

    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    await waitFor(() => expect(vault.prefs["update.auto"]).toBe("0"));
  });

  it("answers a check asked by hand, and the notice stays quiet about it", async () => {
    const vault = mockVault({ answer: { latest: "v0.2.0" }, prefs: { "update.auto": "0" } });
    renderApp();
    const user = userEvent.setup();
    await openAbout(user);

    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByRole("button", { name: "Get 0.2.0" })).toBeInTheDocument();
    expect(vault.checks).toBe(1);

    await user.click(screen.getByRole("button", { name: "General" }));
    expect(notice()).not.toBeInTheDocument();
  });

  it("says so when there is nothing newer, or no answer", async () => {
    const vault = mockVault({ answer: { latest: `v${APP_VERSION}` }, prefs: { "update.auto": "0" } });
    renderApp();
    const user = userEvent.setup();
    await openAbout(user);

    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("You are up to date.")).toBeInTheDocument();

    vault.answer = "offline";
    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(
      await screen.findByText("Could not reach the release page. Try again later."),
    ).toBeInTheDocument();
    expect(openUrl).not.toHaveBeenCalled();
  });
});
