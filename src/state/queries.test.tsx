import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PremiumStatus } from "../lib/ipc";
import { usePremiumStatus } from "./premiumQueries";
import { useRemoveWallet } from "./queries";

/** The premium section as it reads the vault, next to the button that
    removes a wallet the user agreed to have watched. */
function Harness() {
  const status = usePremiumStatus();
  const remove = useRemoveWallet();
  return (
    <>
      <p data-testid="consented">{(status.data?.consented ?? []).join(" ")}</p>
      <button type="button" onClick={() => remove.mutate({ id: "w-1", secret: "2468" })}>
        Remove
      </button>
    </>
  );
}

describe("useRemoveWallet", () => {
  it("reads the premium state again once the wallet is gone", async () => {
    // The core drops the consent in the same write that removes the
    // wallet: the status the vault answers changes under the section.
    let status: PremiumStatus = {
      key: "abcd-efgh-ijkm-npqr",
      licence: null,
      consented: ["w-1"],
      acknowledged_offline_until: null,
      device: { id: "d-1", connected_at: 1_790_000_000 },
      disconnected: false,
      key_saved: false,
      checklist_hidden: false,
      disconnected_reason: null,
      key_change_pending: false,
      connect_pending: false,
    };
    const removed: string[] = [];
    mockIPC((cmd, args) => {
      switch (cmd) {
        case "premium_status":
          return status;
        case "remove_wallet":
          removed.push((args as { id: string }).id);
          expect((args as { secret: string }).secret).toBe("2468");
          status = { ...status, consented: [] };
          return undefined;
        default:
          throw new Error(`unexpected command ${cmd}`);
      }
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("consented")).toHaveTextContent("w-1"));

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(removed).toEqual(["w-1"]));
    await waitFor(() => expect(screen.getByTestId("consented")).toHaveTextContent(""));
    expect(screen.getByTestId("consented").textContent).toBe("");
  });
});
