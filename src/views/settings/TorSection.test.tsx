import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { TorStatus } from "../../lib/ipc";
import { TorSection } from "./TorSection";

const STATUS: TorStatus = {
  mode: "auto",
  socks_proxy: "127.0.0.1:9050",
  via: null,
  socks: null,
  running: false,
  bootstrapped: false,
  bootstrap_percent: 0,
  error: null,
  embedded_available: true,
};

/** The section, with a vault whose answer to a new mode the test gives
    when it wants. */
function mount() {
  let settle: { resolve: () => void; reject: (error: unknown) => void } | null = null;
  mockIPC((cmd) => {
    if (cmd === "tor_status") return STATUS;
    if (cmd === "set_tor_settings") {
      return new Promise<void>((resolve, reject) => {
        settle = { resolve, reject };
      });
    }
    return undefined;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TorSection tor={{ mode: "auto", socks_proxy: null }} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), settle: () => settle! };
}

const radio = (name: string) => screen.getByRole("radio", { name });

describe("the Tor mode", () => {
  /** The vault answers once the live watch has taken the new route, a
      second or more on a remote server: the choice does not wait. */
  it("shows the mode chosen before the vault answers", async () => {
    const { user, settle } = mount();
    await waitFor(() => expect(radio("Built-in")).toBeEnabled());

    await user.click(radio("Built-in"));
    expect(radio("Built-in")).toHaveAttribute("aria-checked", "true");
    expect(radio("Automatic")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/^Only the built-in Tor\./)).toBeInTheDocument();
    expect(screen.queryByLabelText("SOCKS address")).not.toBeInTheDocument();
    settle().resolve();
  });

  it("puts the vault's mode back when it refuses the new one", async () => {
    const { user, settle } = mount();
    await waitFor(() => expect(radio("System Tor")).toBeEnabled());

    await user.click(radio("System Tor"));
    expect(radio("System Tor")).toHaveAttribute("aria-checked", "true");
    settle().reject({ kind: "internal", message: "the vault could not be written" });
    await screen.findByText("the vault could not be written");
    expect(radio("Automatic")).toHaveAttribute("aria-checked", "true");
  });
});
