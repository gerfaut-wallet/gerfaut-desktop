import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { Settings } from "../lib/ipc";
import { QUIET, afterFailure, usePulse } from "../state/premium";
import { WatchOfflineBanner } from "./WatchOfflineBanner";

const SETTINGS: Settings = {
  active_network: "mainnet",
  backends: {},
  gap_limit: 20,
  app_prefs: {},
  electrum_certs: {},
  app_lock: null,
  tor: { mode: "auto", socks_proxy: null },
  premium: {
    key: "abcdefghijkmnpqr",
    certificate: "x.y",
    watched: [{ wallet_id: "w-1", consented_at: 1 }],
    acknowledged_offline_until: null,
  },
};

function renderBanner() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WatchOfflineBanner />
    </QueryClientProvider>,
  );
}

afterEach(() => usePulse.getState().reset());

describe("the watch offline banner", () => {
  it("says nothing after one failure, and everything after two", async () => {
    mockIPC((cmd) => {
      if (cmd === "get_settings") return SETTINGS;
      throw new Error(`unexpected command ${cmd}`);
    });
    const at = Math.floor(new Date(2026, 8, 5, 14, 2).getTime() / 1000);
    act(() => usePulse.setState(afterFailure(QUIET, at)));
    renderBanner();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    act(() => usePulse.setState(afterFailure(usePulse.getState(), at + 900)));
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent(
      /Gerfaut's watch is offline since (14:02|Sep 5, 14:02)\. Your wallets are not being monitored\./,
    );
    expect(banner.querySelector("svg.lucide-shield-alert")).not.toBeNull();
    // The heartbeat comes back: the banner goes on its own.
    act(() => usePulse.getState().recordSuccess());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("is acknowledged through the vault and stays quiet after", async () => {
    let settings = SETTINGS;
    const calls: string[] = [];
    mockIPC((cmd) => {
      calls.push(cmd);
      if (cmd === "get_settings") return settings;
      if (cmd === "premium_acknowledge_offline") {
        const until = Math.floor(Date.now() / 1000) + 86_400;
        settings = { ...SETTINGS, premium: { ...SETTINGS.premium, acknowledged_offline_until: until } };
        return { key: "abcd-efgh-ijkm-npqr", licence: null, consented: ["w-1"], acknowledged_offline_until: until };
      }
      throw new Error(`unexpected command ${cmd}`);
    });
    act(() => usePulse.setState(afterFailure(afterFailure(QUIET, 1_000), 2_000)));
    renderBanner();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Acknowledge" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(calls).toContain("premium_acknowledge_offline");
  });
});
