import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "./Modal";

describe("the modal", () => {
  it("never lands the focus on a field that cannot take it", async () => {
    render(
      <Modal open onClose={() => {}} title="Confirm it's you">
        <input aria-label="PIN" disabled />
        <button type="button">Cancel</button>
        <button type="button">Approve</button>
      </Modal>,
    );
    const user = userEvent.setup();
    // The field waits out a delay: the first thing that can act takes
    // the focus, and Tab goes on from there.
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Approve" })).toHaveFocus();
  });

  it("holds while it must not be dismissed, and lets go otherwise", async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal open onClose={onClose} dismissible={false} title="Change your Premium key">
        <button type="button">Done</button>
      </Modal>,
    );
    const user = userEvent.setup();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();

    rerender(
      <Modal open onClose={onClose} title="Change your Premium key">
        <button type="button">Done</button>
      </Modal>,
    );
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
