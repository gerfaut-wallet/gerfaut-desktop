import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button, Disclosure } from "./Button";

describe("Button", () => {
  it("is filled in the primary colour by default", () => {
    render(<Button>Test the connection</Button>);
    expect(screen.getByRole("button", { name: "Test the connection" })).toHaveClass(
      "bg-primary",
      "text-on-primary",
    );
  });

  it("keeps a fill for the secondary and the danger roles", () => {
    render(
      <>
        <Button variant="secondary">Cancel</Button>
        <Button variant="danger">Remove wallet</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass("bg-sunken");
    expect(screen.getByRole("button", { name: "Remove wallet" })).toHaveClass(
      "bg-alert",
      "text-on-alert",
    );
  });

  it("is inert and says so while busy, without greying out", async () => {
    const onClick = vi.fn();
    render(
      <Button busy onClick={onClick}>
        Connecting…
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Connecting…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).not.toHaveClass("opacity-50");
    expect(button.querySelector("svg")).not.toBeNull();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("greys out when disabled, with no hover", () => {
    render(<Button disabled>Save backend</Button>);
    const button = screen.getByRole("button", { name: "Save backend" });
    expect(button).toBeDisabled();
    expect(button).toHaveClass("opacity-50");
    expect(button.className).not.toContain("hover:");
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
