import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WelcomeTour } from "./WelcomeTour";

function renderTour({ beta = true }: { beta?: boolean } = {}) {
  const onClose = vi.fn();
  render(<WelcomeTour open onClose={onClose} beta={beta} />);
  return { onClose, user: userEvent.setup() };
}

const betaLine = () => screen.queryByText(/Check addresses and amounts on your signing device/);

describe("WelcomeTour", () => {
  it("offers no way back on the first page", () => {
    renderTour();
    expect(screen.getByText("Watch, never spend")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
  });

  it("takes the second page back to the first, Skip still within reach", async () => {
    const { user } = renderTour();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Add a wallet")).toBeInTheDocument();

    const back = screen.getByRole("button", { name: "Back" });
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
    await user.click(back);

    expect(screen.getByText("Watch, never spend")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  it("keeps Skip away from Back: one of the two retires the tour", async () => {
    const { user } = renderTour();
    await user.click(screen.getByRole("button", { name: "Next" }));

    const back = screen.getByRole("button", { name: "Back" });
    const skip = screen.getByRole("button", { name: "Skip" });
    // Two ghost buttons four pixels apart, and the wrong one dismisses
    // onboarding for good: Skip belongs on the far side of the row.
    expect(back.parentElement).not.toBe(skip.parentElement);
    expect(skip.parentElement).toHaveClass("ml-auto");
    expect(skip.parentElement).toContainElement(screen.getByRole("button", { name: "Next" }));
  });

  it("keeps the arrow keys walking the pages", async () => {
    const { user } = renderTour();
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByText("Choose who you talk to")).toBeInTheDocument();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByText("Add a wallet")).toBeInTheDocument();
  });

  it("ends on Get started, with the way back still open", async () => {
    const { user, onClose } = renderTour();
    for (const _ of [0, 1, 2]) {
      await user.click(screen.getByRole("button", { name: "Next" }));
    }
    expect(screen.getByText("Keep it yours")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Get started" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("says on its first page, and only there, that a 0.x version is a public beta", async () => {
    const { user } = renderTour();
    expect(betaLine()).toHaveTextContent(
      "Public beta. Check addresses and amounts on your signing device.",
    );
    expect(screen.getByText("Public beta.")).toHaveClass("text-pending");

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(betaLine()).not.toBeInTheDocument();
  });

  it("says nothing of a beta on a stable version", () => {
    renderTour({ beta: false });
    expect(screen.getByText("Watch, never spend")).toBeInTheDocument();
    expect(betaLine()).not.toBeInTheDocument();
  });
});
