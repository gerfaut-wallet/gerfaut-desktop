import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { isBeta } from "../../lib/version";
import { APP_VERSION, AboutSection, ISSUES_URL } from "./AboutSection";

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

function renderAbout() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AboutSection />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

/** Every 0.x version is a public beta, and 1.0.0 is the first that is
    not: which of the two the card shows follows the version it prints.
    The rule itself is tested with `isBeta`. */
describe("the About card", () => {
  it.runIf(isBeta(APP_VERSION))(
    "marks the version as a beta, and opens the issues to report a problem",
    async () => {
      const user = renderAbout();
      const pill = screen.getByText("Beta");
      expect(pill.closest("[data-tone]")).toHaveAttribute("data-tone", "pending");
      expect(pill.closest("p")).toHaveTextContent(`Gerfaut ${APP_VERSION}Beta`);
      expect(
        screen.getByText(
          "This is a public beta. Check addresses and amounts on your signing device, and report anything that looks wrong.",
        ),
      ).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Report a problem" }));
      expect(openUrl).toHaveBeenCalledWith(ISSUES_URL);
      expect(ISSUES_URL).toBe("https://github.com/gerfaut-wallet/gerfaut-desktop/issues");
    },
  );

  it.skipIf(isBeta(APP_VERSION))("says nothing of a beta from 1.0.0 on", () => {
    renderAbout();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Report a problem" })).not.toBeInTheDocument();
  });
});
