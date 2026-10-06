import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Modal } from "./Modal";

describe("the modal", () => {
  it("never lands the focus on a field that cannot take it", async () => {
    render(
      <Modal open onClose={() => {}} title="Enter your PIN">
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
});
