import { render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
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

  it("is named by its title, a level-one heading", () => {
    render(
      <Modal open onClose={() => {}} title="Transaction">
        <p>Body</p>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Transaction" });
    expect(within(dialog).getByRole("heading", { level: 1, name: "Transaction" })).toBeVisible();
  });

  it("lands the focus on what the content marks, never on Close", () => {
    render(
      <Modal open onClose={() => {}} title="Unknown certificate">
        <input aria-label="Note" />
        <button type="button" data-autofocus>
          Cancel
        </button>
      </Modal>,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("closes only the topmost modal on Escape", async () => {
    const closed: string[] = [];
    render(
      <>
        <Modal open onClose={() => closed.push("under")} title="Under">
          <button type="button">Under</button>
        </Modal>
        <Modal open onClose={() => closed.push("over")} title="Over" z={60}>
          <button type="button">Over</button>
        </Modal>
      </>,
    );
    await userEvent.setup().keyboard("{Escape}");
    expect(closed).toEqual(["over"]);
  });

  it("closes on the backdrop and the close button", async () => {
    let closed = 0;
    render(
      <Modal open onClose={() => (closed += 1)} title="Welcome">
        <button type="button">Next</button>
      </Modal>,
    );
    const user = userEvent.setup();
    await user.click(document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')!);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(closed).toBe(2);
  });

  it("keeps Escape, the backdrop and Close off while it cannot be closed", async () => {
    let closed = 0;
    render(
      <Modal open onClose={() => (closed += 1)} title="Saving" closable={false}>
        <button type="button">Saving…</button>
      </Modal>,
    );
    const user = userEvent.setup();
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    await user.keyboard("{Escape}");
    await user.click(document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')!);
    expect(closed).toBe(0);
    expect(screen.getByRole("dialog", { name: "Saving" })).toBeInTheDocument();
  });

  it("hands the focus back to its trigger", async () => {
    function Opener() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <Modal open={open} onClose={() => setOpen(false)} title="Address QR code">
            <button type="button">Copy</button>
          </Modal>
        </>
      );
    }
    render(<Opener />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("button", { name: "Copy" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Open" })).toHaveFocus());
  });
});
