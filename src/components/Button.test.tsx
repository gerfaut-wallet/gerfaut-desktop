import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Bell } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { Button, Disclosure } from "./Button";

describe("Button", () => {
  it("fills every role", () => {
    render(
      <>
        <Button variant="primary">Test the connection</Button>
        <Button variant="secondary">Cancel</Button>
        <Button variant="danger">Remove wallet</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Test the connection" })).toHaveClass(
      "bg-primary",
      "text-on-primary",
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass("bg-sunken");
    expect(screen.getByRole("button", { name: "Remove wallet" })).toHaveClass(
      "bg-alert",
      "text-on-alert",
    );
  });

  it("ignores clicks while busy, keeps its focus and its colour", async () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" icon={Bell} busy onClick={onClick}>
        Connecting…
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Connecting…" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(button).not.toHaveClass("opacity-50");
    // The spinner in the icon's slot, not beside it.
    expect(button.querySelectorAll("svg")).toHaveLength(1);
    button.focus();
    await userEvent.click(button);
    await userEvent.keyboard("{Enter}");
    expect(onClick).not.toHaveBeenCalled();
    expect(button).toHaveFocus();
  });

  it("switches a busy submit off, so Enter in its form cannot send it again", async () => {
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
    render(
      <form onSubmit={(event) => onSubmit(event.nativeEvent as SubmitEvent)}>
        <input aria-label="PIN" />
        <Button variant="primary" type="submit" busy>
          Unlocking…
        </Button>
      </form>,
    );
    expect(screen.getByRole("button", { name: "Unlocking…" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("PIN"), "1234{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("goes hollow when disabled, with no hover", () => {
    render(
      <Button variant="primary" disabled>
        Save backend
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Save backend" });
    expect(button).toBeDisabled();
    // No fade: half a button wrote white on a pale fill, at 2:1.
    expect(button.className).not.toMatch(/opacity/);
    expect(button).toHaveClass("off:bg-transparent", "off:text-muted");
    // Hover only lives under `live:`, which a disabled button is not.
    expect(button.className).not.toMatch(/(^| )hover:/);
  });
});

describe("Disclosure", () => {
  it("says whether its part is open", async () => {
    const onClick = vi.fn();
    render(
      <Disclosure open={false} onClick={onClick}>
        Advanced
      </Disclosure>,
    );
    const button = screen.getByRole("button", { name: "Advanced" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
