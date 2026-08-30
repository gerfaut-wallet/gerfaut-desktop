import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WelcomeTour } from "./WelcomeTour";

function renderTour() {
  const onClose = vi.fn();
  render(<WelcomeTour open onClose={onClose} />);
  return { onClose, user: userEvent.setup() };
}

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
});
