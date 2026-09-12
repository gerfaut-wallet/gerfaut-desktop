import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Channel,
  PremiumAccountReport,
  PremiumEvent,
  PremiumStatus,
  WalletMeta,
  WalletWatch,
} from "../../lib/ipc";
import { TIMING } from "../../lib/premium";
import { useUi } from "../../state/store";
import { PremiumSection } from "./PremiumSection";

// The browser is a function the section calls with a URL; what the site
// does with it is the site's business.
const opened = vi.hoisted(() => ({ urls: [] as string[] }));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (url: string) => {
    opened.urls.push(url);
    return Promise.resolve();
  },
}));

const NOW = Math.floor(Date.now() / 1000);

const NO_KEY: PremiumStatus = {
  key: null,
  licence: null,
  consented: [],
  acknowledged_offline_until: null,
};

const ACTIVE: PremiumStatus = {
  key: "abcd-efgh-ijkm-npqr",
  licence: { status: "active", until: 1_804_809_600 },
  consented: [],
  acknowledged_offline_until: null,
};

const ACCOUNT: PremiumAccountReport = {
  account: { active: true, paid_until: 1_804_809_600, wallets: 0, channels: 0, network: "bitcoin" },
  status: ACTIVE,
};

const COLD: WalletMeta = {
  id: "w-1",
  name: "Cold storage",
  icon: "snowflake",
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
      confirmed: 0,
      trusted_pending: 0,
      untrusted_pending: 0,
      pending_net_sats: null,
      immature: 0,
      total: 0,
    },
    tx_count: 0,
  },
};

const DONATION: WalletMeta = {
  ...COLD,
  id: "w-2",
  name: "Donations",
  icon: "wallet",
  kind: { type: "single_address", address: "bc1qexample" },
  recognized_as: "address",
};

const WATCHED_SCANNING: WalletWatch = {
  id: "w-1",
  name: "Cold storage",
  script_kind: "p2wpkh",
  watched_since: NOW - 30,
  baseline_at: null,
  baseline_height: null,
  coins: 0,
  value_sats: 0,
};

const WATCHED_DONE: WalletWatch = {
  ...WATCHED_SCANNING,
  baseline_at: NOW,
  baseline_height: 910_000,
  coins: 3,
  value_sats: 150_000_000,
};

const NTFY: Channel = {
  id: "c-ntfy",
  kind: "ntfy",
  target: "abc…xyz",
  linked: true,
  link_code: null,
  link_url: null,
  linked_name: null,
  enabled: true,
  created_at: NOW - 3_600,
  telegram_url: null,
};

const TELEGRAM_WAITING: Channel = {
  id: "c-tg",
  kind: "telegram",
  target: "",
  linked: false,
  link_code: "0123456789ab",
  link_url: "https://t.me/GerfautAlertsBot",
  linked_name: null,
  enabled: true,
  created_at: NOW - 60,
  telegram_url: "https://t.me/GerfautAlertsBot?start=0123456789ab",
};

const EMAIL_WAITING: Channel = {
  id: "c-mail",
  kind: "email",
  target: "l…c@example.org",
  linked: false,
  link_code: null,
  link_url: null,
  linked_name: null,
  enabled: true,
  created_at: NOW - 120,
  telegram_url: null,
};

/** A webhook the server turned off: it points at an address no one can
    reach from the internet, so nothing is delivered to it. */
const WEBHOOK_OFF: Channel = {
  id: "c-hook",
  kind: "webhook",
  target: "https://192.168.1.40/gerfaut/alerts?token=wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww",
  linked: true,
  link_code: null,
  link_url: null,
  linked_name: null,
  enabled: false,
  created_at: NOW - 86_400,
  telegram_url: null,
};

const EVENTS: PremiumEvent[] = [
  {
    id: 42,
    kind: "spend_detected",
    wallet: "w-1",
    wallet_name: "Cold storage",
    at: NOW - 120,
    data: {},
  },
  {
    id: 41,
    kind: "wallet_registered",
    wallet: "w-1",
    wallet_name: "Cold storage",
    at: NOW - 3_600,
    data: {},
  },
  {
    id: 40,
    kind: "receive_confirmed",
    wallet: "w-gone",
    wallet_name: "Old wallet",
    at: NOW - 86_400 * 2,
    data: {},
  },
];

type Answer = (args: Record<string, unknown>) => unknown;

/** The server as the section sees it, one answer per command, each
    replaceable by a test; every call is kept for the assertions. */
function mockPremium(overrides: Record<string, Answer> = {}) {
  const calls: { cmd: string; args: Record<string, unknown> }[] = [];
  const answers: Record<string, Answer> = {
    premium_status: () => ACTIVE,
    premium_account: () => ACCOUNT,
    list_wallets: () => [COLD, DONATION],
    premium_wallets: () => [],
    premium_channels: () => [],
    premium_events: () => [],
    set_app_pref: () => undefined,
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

function refused(kind: string, message = kind) {
  return () => Promise.reject({ kind, message }) as never;
}

function renderSection(wallets: WalletMeta[] = [COLD, DONATION]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PremiumSection wallets={wallets} />
    </QueryClientProvider>,
  );
}

function of(cmd: string, calls: { cmd: string; args: Record<string, unknown> }[]) {
  return calls.filter((call) => call.cmd === cmd).map((call) => call.args);
}

function card(name: string) {
  return within(screen.getByRole("heading", { name }).closest("section")!);
}

beforeEach(() => {
  opened.urls = [];
  useUi.setState({ view: "settings", activeWalletId: null });
});

afterEach(() => {
  vi.clearAllMocks();
  TIMING.walletPollMs = 5_000;
  TIMING.telegramPollMs = 3_000;
});

// --- licence ---------------------------------------------------------------

describe("the licence card", () => {
  it("formats the key as it is typed and activates once it is whole", async () => {
    let stored: PremiumStatus = NO_KEY;
    const calls = mockPremium({
      premium_status: () => stored,
      premium_activate: () => {
        stored = ACTIVE;
        return ACTIVE;
      },
    });
    renderSection();
    const user = userEvent.setup();
    const field = await screen.findByLabelText("Account key");
    const activate = screen.getByRole("button", { name: "Activate" });
    expect(field).toHaveAttribute("placeholder", "xxxx-xxxx-xxxx-xxxx");
    expect(activate).toBeDisabled();
    // Without a key the section is one card, and asks the server nothing.
    expect(screen.queryByRole("heading", { name: "Watched wallets" })).not.toBeInTheDocument();
    expect(calls.some((call) => call.cmd.startsWith("premium_") && call.cmd !== "premium_status")).toBe(false);

    await user.type(field, "ABCD EFGH");
    expect(field).toHaveValue("abcd-efgh");
    expect(activate).toBeDisabled();
    await user.type(field, "ijkmnpqr");
    expect(field).toHaveValue("abcd-efgh-ijkm-npqr");
    expect(activate).toBeEnabled();

    await user.click(activate);
    expect(of("premium_activate", calls)).toEqual([{ key: "abcd-efgh-ijkm-npqr" }]);
    // The vault now holds a certificate the core verified: the date
    // shows, with the one premium marker, and the rest of the section.
    expect(await screen.findByText(/Active until/)).toHaveTextContent("Active until");
    expect(screen.getByText("Premium", { selector: "span" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Watched wallets" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Channels" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recent alerts" })).toBeInTheDocument();
  });

  it("takes a pasted key with or without its dashes", async () => {
    mockPremium({ premium_status: () => NO_KEY });
    renderSection();
    const user = userEvent.setup();
    const field = await screen.findByLabelText("Account key");
    await user.click(field);
    await user.paste("ABCDEFGHIJKMNPQR");
    expect(field).toHaveValue("abcd-efgh-ijkm-npqr");
    await user.clear(field);
    await user.paste("abcd-efgh-ijkm-npqr");
    expect(field).toHaveValue("abcd-efgh-ijkm-npqr");
    expect(screen.getByRole("button", { name: "Activate" })).toBeEnabled();
  });

  it("says in amber what the server answered, and offers Retry only when it may change", async () => {
    let answer: "unknown" | "unpaid" | "down" = "unknown";
    mockPremium({
      premium_status: () => NO_KEY,
      premium_activate: () => {
        const kinds = {
          unknown: "premium_unknown_key",
          unpaid: "premium_no_paid_time",
          down: "premium_unreachable",
        };
        return Promise.reject({ kind: kinds[answer], message: answer }) as never;
      },
    });
    renderSection();
    const user = userEvent.setup();
    const field = await screen.findByLabelText("Account key");
    await user.type(field, "abcdefghijkmnpqr");

    await user.click(screen.getByRole("button", { name: "Activate" }));
    let note = await screen.findByRole("alert");
    expect(note).toHaveTextContent("Unknown key.");
    expect(within(note).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    // Amber, never red: nothing is at risk.
    expect(note.className).toMatch(/pending/);
    expect(note.className).not.toMatch(/alert-surface/);

    answer = "unpaid";
    await user.click(screen.getByRole("button", { name: "Activate" }));
    note = await screen.findByRole("alert");
    expect(note).toHaveTextContent("This key has no paid time.");

    answer = "down";
    await user.click(screen.getByRole("button", { name: "Activate" }));
    note = await screen.findByRole("alert");
    expect(note).toHaveTextContent("Could not reach the Gerfaut server.");
    expect(within(note).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    // Typing again drops the note: it no longer describes the field.
    await user.type(field, "x");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the licence from the vault, and lets the key go behind an amber confirmation", async () => {
    let stored: PremiumStatus = ACTIVE;
    const calls = mockPremium({
      premium_status: () => stored,
      premium_account: refused("premium_unreachable", "timed out"),
      premium_forget: () => {
        stored = NO_KEY;
        return NO_KEY;
      },
    });
    renderSection();
    const user = userEvent.setup();
    // Offline: the date still shows, since the certificate was verified
    // here; the server's silence is one note under the card.
    expect(await screen.findByText(/Active until/)).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the Gerfaut server.");

    // The key is the account, and an address bar is not a private
    // channel: it goes to the clipboard, the site is opened without it.
    await user.click(screen.getByRole("button", { name: "Renew" }));
    await waitFor(() =>
      expect(opened.urls).toEqual(["https://gerfaut-wallet.com/premium#renew"]),
    );
    expect(await navigator.clipboard.readText()).toBe("abcd-efgh-ijkm-npqr");
    expect(useUi.getState().toast).toBe("Key copied, paste it on the renewal page");

    await user.click(screen.getByRole("button", { name: "Forget this key" }));
    expect(of("premium_forget", calls)).toEqual([]);
    const confirmation = screen.getByRole("status");
    expect(confirmation).toHaveTextContent(/stops the watch on this device, not on the server/);
    await user.click(within(confirmation).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Forget this key" }));
    await user.click(within(screen.getByRole("status")).getByRole("button", { name: "Forget the key" }));
    await waitFor(() => expect(of("premium_forget", calls)).toHaveLength(1));
    expect(await screen.findByLabelText("Account key")).toBeInTheDocument();
  });

  it("deletes the account on the server only when asked to, and says so first", async () => {
    let stored = ACTIVE;
    let refuse = true;
    const calls = mockPremium({
      premium_status: () => stored,
      premium_account: () => ACCOUNT,
      premium_delete_account: () => {
        if (refuse) {
          throw { kind: "tor", message: "tor: no proxy answers" };
        }
        stored = NO_KEY;
        return NO_KEY;
      },
    });
    renderSection();
    const user = userEvent.setup();
    await screen.findByText(/Active until/);

    await user.click(screen.getByRole("button", { name: "Forget this key" }));
    const box = screen.getByLabelText("Also delete everything on the server");
    // Off to start with: nobody deletes an account by clicking twice in
    // the same place, and the default is the harmless half.
    expect(box).not.toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent(
      /stops the watch on this device, not on the server/,
    );
    expect(screen.getByRole("button", { name: "Forget the key" })).toBeInTheDocument();

    await user.click(box);
    // And the sentence says what it costs, in the word that matters.
    const confirmation = screen.getByRole("status");
    expect(confirmation).toHaveTextContent(
      /removes the wallets it watches, the channels it tells and the key itself/,
    );
    expect(confirmation).toHaveTextContent(/cannot be undone/);

    // A call that fails leaves the key here: the core deletes on the
    // server first and forgets afterwards.
    await user.click(screen.getByRole("button", { name: "Delete the account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Tor is not reachable/);
    expect(screen.getByText(/Active until/)).toBeInTheDocument();

    refuse = false;
    await user.click(screen.getByRole("button", { name: "Delete the account" }));
    await waitFor(() => expect(of("premium_delete_account", calls)).toHaveLength(2));
    expect(await screen.findByLabelText("Account key")).toBeInTheDocument();
    expect(useUi.getState().toast).toBe("Account deleted");
    // Forgetting alone never reached the server.
    expect(of("premium_forget", calls)).toEqual([]);
  });

  it("says an expired licence in amber with the grace it has left", async () => {
    mockPremium({
      premium_status: () => ({
        ...ACTIVE,
        licence: { status: "expired", since: 1_772_000_000 },
      }),
    });
    renderSection();
    expect(await screen.findByText(/Expired on .* · alerts stop 7 days after expiry\./)).toBeInTheDocument();
    expect(screen.queryByText(/Active until/)).not.toBeInTheDocument();
  });
});

// --- watched wallets ---------------------------------------------------------

describe("the watched wallets card", () => {
  it("lists the wallets of the server's network and keeps a single address on the shelf", async () => {
    mockPremium();
    renderSection();
    const cold = await screen.findByRole("switch", { name: "Watch Cold storage from the server" });
    const donations = screen.getByRole("switch", { name: "Watch Donations from the server" });
    await waitFor(() => expect(cold).toBeEnabled());
    expect(cold).toHaveAttribute("aria-checked", "false");
    expect(donations).toBeDisabled();
    expect(screen.getByText("Single addresses cannot be watched yet.")).toBeInTheDocument();
    // The row wears the wallet's own glyph.
    expect(cold.closest("li")!.querySelector("svg.lucide-snowflake")).not.toBeNull();
  });

  it("asks once before a descriptor leaves, in red, and sends nothing on Cancel", async () => {
    let watched: WalletWatch[] = [];
    const calls = mockPremium({
      premium_wallets: () => watched,
      premium_watch_wallet: () => {
        watched = [WATCHED_SCANNING];
        return undefined;
      },
    });
    TIMING.walletPollMs = 20;
    renderSection();
    const user = userEvent.setup();
    const cold = await screen.findByRole("switch", { name: "Watch Cold storage from the server" });
    await waitFor(() => expect(cold).toBeEnabled());

    await user.click(cold);
    const dialog = screen.getByRole("dialog", { name: "Watch this wallet from the server" });
    expect(dialog).toHaveTextContent(
      "Gerfaut's server will learn every address of this wallet, present and future, and see when coins move. It keeps nothing else: no name, no e-mail unless you add one as a channel, no IP address.",
    );
    // Red: privacy is what is at stake.
    const note = dialog.querySelector(".bg-alert-surface");
    expect(note).not.toBeNull();
    expect(note!.querySelector("svg.lucide-triangle-alert, svg.lucide-alert-triangle")).not.toBeNull();
    expect(dialog).toHaveTextContent("The descriptor");
    expect(dialog).toHaveTextContent("The name you gave the wallet");
    expect(dialog).toHaveTextContent("Cold storage");

    // Escape closes it, nothing went out, the focus is back on the switch.
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(of("premium_watch_wallet", calls)).toEqual([]);
    expect(cold).toHaveFocus();
    expect(cold).toHaveAttribute("aria-checked", "false");

    await user.click(cold);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(of("premium_watch_wallet", calls)).toEqual([]);

    // The yes repeats the consequence; then the server scans.
    await user.click(cold);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Watch this wallet" }));
    await waitFor(() => expect(of("premium_watch_wallet", calls)).toEqual([{ id: "w-1" }]));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const row = cold.closest("li")!;
    expect(await within(row).findByText("First scan pending")).toBeInTheDocument();
    expect(within(row).getByText("Watched")).toBeInTheDocument();
    expect(row.querySelector("svg.lucide-gem")).not.toBeNull();
    expect(cold).toHaveAttribute("aria-checked", "true");

    // The first scan finishes: the list was asked again on its own.
    watched = [WATCHED_DONE];
    expect(await within(row).findByText(/Watched since \w+ \d+ · 3 coins/)).toBeInTheDocument();
    expect(within(row).queryByText("First scan pending")).not.toBeInTheDocument();
  });

  it("does not ask again for a wallet already agreed to, and stops at once", async () => {
    let watched: WalletWatch[] = [WATCHED_DONE];
    const calls = mockPremium({
      premium_status: () => ({ ...ACTIVE, consented: ["w-1"] }),
      premium_wallets: () => watched,
      premium_unwatch_wallet: () => {
        watched = [];
        return undefined;
      },
      premium_watch_wallet: () => {
        watched = [WATCHED_DONE];
        return undefined;
      },
    });
    renderSection();
    const user = userEvent.setup();
    const cold = await screen.findByRole("switch", { name: "Watch Cold storage from the server" });
    await waitFor(() => expect(cold).toHaveAttribute("aria-checked", "true"));
    await waitFor(() => expect(cold).toBeEnabled());

    // Off: no confirmation, the server is told at once.
    await user.click(cold);
    await waitFor(() => expect(of("premium_unwatch_wallet", calls)).toEqual([{ id: "w-1" }]));
    await waitFor(() => expect(cold).toHaveAttribute("aria-checked", "false"));
    expect(screen.queryByText("Watched")).not.toBeInTheDocument();

    // On again: the consent stands, so no dialog.
    await user.click(cold);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(of("premium_watch_wallet", calls)).toEqual([{ id: "w-1" }]));
    await waitFor(() => expect(cold).toHaveAttribute("aria-checked", "true"));
  });

  it("says in amber what the server refused, in its own words", async () => {
    mockPremium({
      premium_status: () => ({ ...ACTIVE, consented: ["w-1"] }),
      premium_watch_wallet: refused("premium_no_paid_time", "this key has no paid time left"),
    });
    renderSection();
    const user = userEvent.setup();
    const cold = await screen.findByRole("switch", { name: "Watch Cold storage from the server" });
    await waitFor(() => expect(cold).toBeEnabled());
    await user.click(cold);
    expect(await screen.findByRole("alert")).toHaveTextContent("This key has no paid time.");
    expect(cold).toHaveAttribute("aria-checked", "false");
  });
});

// --- channels ---------------------------------------------------------------

describe("the channels card", () => {
  it("lists the channels with their state and their glyph", async () => {
    mockPremium({ premium_channels: () => [NTFY, TELEGRAM_WAITING] });
    renderSection();
    await screen.findByText("abc…xyz");
    const channels = card("Channels");
    const rows = channels.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector("svg.lucide-bell")).not.toBeNull();
    expect(within(rows[0]).getByText("Linked")).toBeInTheDocument();
    expect(rows[1].querySelector("svg.lucide-send")).not.toBeNull();
    const waiting = within(rows[1]).getByText("Waiting for the bot");
    expect(waiting.closest("[data-tone]")).toHaveAttribute("data-tone", "pending");
    expect(within(rows[1]).getByRole("button", { name: "Open Telegram" })).toBeInTheDocument();
  });

  it("adds an ntfy channel in one step, shows the topic once, and tests the first channel", async () => {
    let channels: Channel[] = [];
    const calls = mockPremium({
      premium_channels: () => channels,
      premium_add_channel: () => {
        channels = [NTFY];
        return {
          channel: NTFY,
          subscribe_url: "https://ntfy.gerfaut-wallet.com/abcdefghijkmnpqrstuvwxyz",
        };
      },
      premium_test_channel: () => undefined,
    });
    renderSection();
    const user = userEvent.setup();
    expect(await screen.findByText(/No channels yet/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add a channel" }));
    const dialog = screen.getByRole("dialog", { name: "Add a channel" });
    for (const [label, hint] of [
      ["ntfy", /ntfy server/],
      ["Telegram", /@GerfautAlertsBot/],
      ["E-mail", /e-mail per alert/],
      ["Webhook", /signed POST/],
    ] as const) {
      const choice = within(dialog).getByRole("button", { name: new RegExp(`^${label}`) });
      expect(choice).toHaveTextContent(hint);
    }

    await user.click(within(dialog).getByRole("button", { name: /^ntfy/ }));
    await waitFor(() =>
      expect(of("premium_add_channel", calls)).toEqual([{ kind: "ntfy", target: null, secret: null }]),
    );
    const done = await screen.findByRole("dialog", { name: "Subscribe to this topic in the ntfy app" });
    expect(done).toHaveTextContent("https://ntfy.gerfaut-wallet.com/abcdefghijkmnpqrstuvwxyz");
    expect(within(done).getByRole("button", { name: "Copy" })).toBeInTheDocument();
    await user.click(within(done).getByRole("button", { name: "Open in ntfy" }));
    expect(opened.urls).toEqual(["ntfy://ntfy.gerfaut-wallet.com/abcdefghijkmnpqrstuvwxyz"]);
    // The first channel is proved out without being asked.
    await waitFor(() => expect(of("premium_test_channel", calls)).toEqual([{ id: "c-ntfy" }]));

    await user.click(within(done).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByText("abc…xyz")).toBeInTheDocument();
  });

  it("links Telegram with a code, and notices on its own when the bot answers", async () => {
    let channels: Channel[] = [NTFY];
    const calls = mockPremium({
      premium_channels: () => channels,
      premium_add_channel: () => {
        channels = [NTFY, TELEGRAM_WAITING];
        return { channel: TELEGRAM_WAITING, subscribe_url: null };
      },
    });
    TIMING.telegramPollMs = 20;
    renderSection();
    const user = userEvent.setup();
    await screen.findByText("abc…xyz");

    await user.click(screen.getByRole("button", { name: "Add a channel" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^Telegram/ }));
    const dialog = await screen.findByRole("dialog", { name: "Link Telegram" });
    expect(dialog).toHaveTextContent("0123456789ab");
    expect(dialog).toHaveTextContent("@GerfautAlertsBot");
    expect(within(dialog).getByRole("status")).toHaveTextContent("Waiting for the bot…");
    await user.click(within(dialog).getByRole("button", { name: "Open Telegram" }));
    expect(opened.urls).toEqual(["https://t.me/GerfautAlertsBot?start=0123456789ab"]);
    // Not the first channel: no test on its own, and none for a channel
    // the bot has not answered yet anyway.
    expect(of("premium_test_channel", calls)).toEqual([]);

    // The bot answered: the list, asked again, says so in the dialog.
    channels = [NTFY, { ...TELEGRAM_WAITING, linked: true, link_code: null, telegram_url: null }];
    expect(await within(dialog).findByText("Linked")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Open Telegram" })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(card("Channels").getAllByText("Linked")).toHaveLength(2);
  });

  it("takes an e-mail address and a webhook with its secret, and repeats a refusal in the server's words", async () => {
    let refuse = false;
    const calls = mockPremium({
      premium_channels: () => [NTFY],
      premium_add_channel: (args) => {
        if (refuse) return Promise.reject({ kind: "premium_rejected", message: "the webhook did not answer" }) as never;
        return {
          channel: { ...NTFY, id: "c-new", kind: args.kind, target: String(args.target ?? "") },
          subscribe_url: null,
        };
      },
    });
    renderSection();
    const user = userEvent.setup();
    await screen.findByText("abc…xyz");

    await user.click(screen.getByRole("button", { name: "Add a channel" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^E-mail/ }));
    const email = screen.getByRole("dialog", { name: "Add an e-mail channel" });
    expect(email).toHaveTextContent("Alerts say which wallet moved, never an address or an amount.");
    const add = within(email).getByRole("button", { name: "Add channel" });
    expect(add).toBeDisabled();
    await user.type(within(email).getByLabelText("E-mail address"), "loic@example.org");
    expect(add).toBeEnabled();
    await user.click(add);
    await waitFor(() =>
      expect(of("premium_add_channel", calls)).toEqual([
        { kind: "email", target: "loic@example.org", secret: null },
      ]),
    );
    // Created and silent: the server wrote once, to send the code.
    const sent = screen.getByRole("dialog", { name: "Confirm this e-mail address" });
    expect(sent).toHaveTextContent("Confirmation sent to loic@example.org");
    await user.click(within(sent).getByRole("button", { name: "Later" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add a channel" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^Webhook/ }));
    const webhook = screen.getByRole("dialog", { name: "Add a webhook" });
    expect(webhook).toHaveTextContent("Signed with HMAC-SHA256. See the docs.");
    await user.type(within(webhook).getByLabelText("URL"), "https://example.invalid/hook");
    await user.type(within(webhook).getByLabelText("Secret (optional)"), "s3cret");
    refuse = true;
    await user.click(within(webhook).getByRole("button", { name: "Add channel" }));
    expect(await within(webhook).findByRole("alert")).toHaveTextContent("The webhook did not answer.");
    expect(of("premium_add_channel", calls).at(-1)).toEqual({
      kind: "webhook",
      target: "https://example.invalid/hook",
      secret: "s3cret",
    });
  });

  it("turns an e-mail channel on only once its code comes back", async () => {
    // An address is not a channel until its owner proves they read it:
    // anyone can type someone else's e-mail into that field.
    let channels: Channel[] = [EMAIL_WAITING];
    let answer: () => unknown = () => {
      channels = [{ ...EMAIL_WAITING, linked: true }];
      return channels[0];
    };
    const calls = mockPremium({
      premium_channels: () => channels,
      premium_confirm_channel: () => answer(),
    });
    renderSection();
    const user = userEvent.setup();

    // The row says what it is waiting for, and offers the field.
    expect(await screen.findByText("Waiting for the code")).toBeInTheDocument();
    expect(card("Channels").queryByText("Linked")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Enter code" }));
    const dialog = screen.getByRole("dialog", { name: "Confirm this e-mail address" });

    const confirm = within(dialog).getByRole("button", { name: "Confirm" });
    const field = within(dialog).getByLabelText("Code");
    expect(confirm).toBeDisabled();
    // Digits only, six of them.
    await user.type(field, "48ab2913x");
    expect(field).toHaveValue("482913");
    expect(confirm).toBeEnabled();

    await user.click(confirm);
    await waitFor(() =>
      expect(of("premium_confirm_channel", calls)).toEqual([
        { id: "c-mail", code: "482913" },
      ]),
    );
    expect(await card("Channels").findByText("Linked")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useUi.getState().toast).toBe("Channel confirmed");
  });

  it("repeats what the server said about a code, in its own words", async () => {
    let answer: () => unknown = () => {
      throw { kind: "premium_rejected", message: "wrong or expired code" };
    };
    mockPremium({
      premium_channels: () => [EMAIL_WAITING],
      premium_confirm_channel: () => answer(),
    });
    renderSection();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Enter code" }));
    const dialog = screen.getByRole("dialog", { name: "Confirm this e-mail address" });
    const type = async (code: string) => {
      await user.clear(within(dialog).getByLabelText("Code"));
      await user.type(within(dialog).getByLabelText("Code"), code);
      await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    };

    await type("000000");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Wrong or expired code.",
    );

    answer = () => {
      throw { kind: "premium_rejected", message: "too many tries" };
    };
    await type("111111");
    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveTextContent("Too many tries."),
    );

    // A 5xx that says what failed says it: the channel was not kept,
    // and "could not reach the server" would send nobody anywhere.
    answer = () => {
      throw {
        kind: "premium_unreachable",
        message: "the premium server is unreachable: HTTP 502: the e-mail could not be sent",
      };
    };
    await type("222222");
    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "The e-mail could not be sent.",
      ),
    );
    // The dialog stays: the code is retyped where it was typed.
    expect(within(dialog).getByRole("button", { name: "Confirm" })).toBeInTheDocument();
  });

  it("names the chat a Telegram channel is linked to", async () => {
    mockPremium({
      premium_channels: () => [
        { ...TELEGRAM_WAITING, linked: true, link_code: null, telegram_url: null, linked_name: "Loïc" },
      ],
    });
    renderSection();

    // Who receives the alerts, not only that someone does.
    expect(await screen.findByText("Linked to Loïc")).toBeInTheDocument();
  });

  it("tests and removes a channel from its menu, from the keyboard", async () => {
    let channels: Channel[] = [NTFY];
    const calls = mockPremium({
      premium_channels: () => channels,
      premium_test_channel: () => undefined,
      premium_delete_channel: () => {
        channels = [];
        return undefined;
      },
    });
    renderSection();
    const user = userEvent.setup();
    await screen.findByText("abc…xyz");
    const more = screen.getByRole("button", { name: /^More for ntfy/ });

    await user.click(more);
    const menu = screen.getByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["Send a test", "Remove"]);
    expect(items[0]).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(more).toHaveFocus();

    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(of("premium_test_channel", calls)).toEqual([{ id: "c-ntfy" }]));
    await waitFor(() => expect(useUi.getState().toast).toBe("Test sent"));

    await user.click(screen.getByRole("button", { name: /^More for ntfy/ }));
    await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Remove" }));
    await waitFor(() => expect(of("premium_delete_channel", calls)).toEqual([{ id: "c-ntfy" }]));
    expect(await screen.findByText(/No channels yet/)).toBeInTheDocument();
  });

  it("offers no test on a channel the server has no target for yet", async () => {
    // The server answers "this channel is not linked yet" to a test on
    // an address that has not sent its code back. The menu said so
    // afterwards, as an error; it says so before, as a reason.
    const calls = mockPremium({ premium_channels: () => [EMAIL_WAITING] });
    renderSection();
    const user = userEvent.setup();
    await screen.findByText("l…c@example.org");

    await user.click(screen.getByRole("button", { name: /^More for E-mail/ }));
    const item = within(screen.getByRole("menu")).getByRole("menuitem", {
      name: /^Send a test/,
    });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).toHaveTextContent("Not linked yet");

    await user.click(item);
    expect(of("premium_test_channel", calls)).toEqual([]);
    // The menu stays open, and what can still be done is still offered.
    const remove = within(screen.getByRole("menu")).getByRole("menuitem", { name: "Remove" });
    expect(remove).not.toHaveAttribute("aria-disabled");
  });

  it("says a channel the server turned off delivers nothing", async () => {
    // A disabled channel used to read like any linked one: the pill said
    // "Linked" while the server wrote nothing to it, and its owner had
    // no way to learn that.
    const silent: Channel = { ...EMAIL_WAITING, id: "c-mail-off", target: "", enabled: false };
    const calls = mockPremium({ premium_channels: () => [NTFY, WEBHOOK_OFF, silent] });
    renderSection();
    const user = userEvent.setup();
    await screen.findByText("abc…xyz");
    const rows = card("Channels").getAllByRole("listitem");

    // The one that works is untouched.
    expect(within(rows[0]).getByText("Linked")).toBeInTheDocument();
    expect(within(rows[0]).queryByRole("status")).not.toBeInTheDocument();

    // The webhook says its own state in words and in a shape, never in a
    // colour alone, and the whole URL is still there to be read.
    const state = within(rows[1]).getByText("Not delivering");
    expect(state.closest("[data-tone]")).toHaveAttribute("data-tone", "pending");
    expect(rows[1].querySelector("svg.lucide-triangle-alert")).not.toBeNull();
    expect(within(rows[1]).queryByText("Linked")).not.toBeInTheDocument();
    expect(within(rows[1]).getByTitle(WEBHOOK_OFF.target)).toHaveTextContent(WEBHOOK_OFF.target);
    expect(within(rows[1]).getByRole("status")).toHaveTextContent(
      "This webhook points at an address that is not reachable from the internet, so nothing is delivered to it. Point it at a public address and add it again.",
    );

    // And no test where a test cannot go: the reason takes its place.
    await user.click(screen.getByRole("button", { name: /^More for Webhook/ }));
    const item = within(screen.getByRole("menu")).getByRole("menuitem", { name: /^Send a test/ });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).toHaveTextContent("Nothing is delivered");
    await user.click(item);
    expect(of("premium_test_channel", calls)).toEqual([]);

    // A kind the address sentence does not fit still says the truth, and
    // the code it was waiting for is no longer asked for: nothing that
    // arrives now would be delivered anywhere.
    expect(within(rows[2]).getByText("Not delivering")).toBeInTheDocument();
    expect(within(rows[2]).getByRole("status")).toHaveTextContent(
      "The server turned this channel off, so nothing is delivered to it. Remove it and add it again.",
    );
    expect(within(rows[2]).queryByRole("button", { name: "Enter code" })).not.toBeInTheDocument();
  });

  it("says the channels could not be read, and offers to ask again", async () => {
    const calls = mockPremium({ premium_channels: refused("premium_unreachable") });
    renderSection();
    const user = userEvent.setup();
    const note = await screen.findByText("Could not reach the Gerfaut server.");
    expect(note.closest("[role='alert']")).not.toBeNull();
    // The card says what it has, which is nothing, and never a state it
    // cannot stand behind.
    expect(card("Channels").queryByText("Linked")).not.toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Retry" })[0]);
    await waitFor(() => expect(of("premium_channels", calls).length).toBeGreaterThan(1));
  });
});

// --- recent alerts ------------------------------------------------------------

describe("the recent alerts card", () => {
  it("lists what the server said, newest first, and opens the wallet it names", async () => {
    mockPremium({ premium_events: () => EVENTS });
    renderSection([COLD, DONATION]);
    const user = userEvent.setup();
    const alerts = within((await screen.findByRole("heading", { name: "Recent alerts" })).closest("section")!);
    const rows = await alerts.findAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Cold storage · coins are moving");
    expect(rows[0]).toHaveTextContent("2 min ago");
    expect(rows[0].querySelector("svg.lucide-arrow-up-right")).not.toBeNull();
    expect(rows[1]).toHaveTextContent("Cold storage · watch started");
    expect(rows[1]).toHaveTextContent("1 h ago");
    // A wallet this device no longer has is read, not opened.
    expect(rows[2]).toHaveTextContent("Old wallet · a payment confirmed");
    expect(within(rows[2]).queryByRole("button")).not.toBeInTheDocument();

    await user.click(within(rows[0]).getByRole("button"));
    expect(useUi.getState().activeWalletId).toBe("w-1");
    expect(useUi.getState().view).toBe("home");
  });

  it("says what an empty list means", async () => {
    mockPremium();
    renderSection();
    expect(
      await screen.findByText("No alerts yet. Gerfaut will tell you here and on your channels."),
    ).toBeInTheDocument();
  });

  it("leaves a note with Retry when the server cannot be reached", async () => {
    let down = true;
    mockPremium({
      premium_events: () => {
        if (down) return Promise.reject({ kind: "premium_unreachable", message: "timed out" }) as never;
        return EVENTS;
      },
    });
    renderSection();
    const user = userEvent.setup();
    const section = (await screen.findByRole("heading", { name: "Recent alerts" })).closest("section")!;
    const note = await waitFor(() => {
      const notes = screen.getAllByRole("alert");
      const below = notes.find((candidate) => candidate.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_PRECEDING);
      expect(below).toBeDefined();
      return below!;
    });
    expect(note).toHaveTextContent("Could not reach the Gerfaut server.");
    down = false;
    await user.click(within(note).getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/coins are moving/)).toBeInTheDocument();
  });
});
