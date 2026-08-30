import { render, screen } from "@testing-library/react";
import { Clock, PenOff } from "lucide-react";
import { describe, expect, it } from "vitest";
import { Notice } from "./Notice";

describe("Notice", () => {
  it("carries the red tone and the triangle when funds or privacy are at stake", () => {
    const { container } = render(
      <Notice tone="alert">This opens the transaction on a third-party website.</Notice>,
    );
    const panel = container.firstElementChild as HTMLElement;
    expect(panel).toHaveClass("border-alert/25", "bg-alert-surface", "text-alert");
    expect(container.querySelector(".lucide-triangle-alert")).toBeInTheDocument();
    expect(container.querySelector(".lucide-info")).not.toBeInTheDocument();
  });

  it("carries the amber tone and the info glyph for everything else worth reading", () => {
    const { container } = render(
      <Notice tone="info">This key carries no script type. Check the one selected below.</Notice>,
    );
    const panel = container.firstElementChild as HTMLElement;
    expect(panel).toHaveClass("border-pending/25", "bg-pending-surface", "text-pending");
    expect(container.querySelector(".lucide-info")).toBeInTheDocument();
    expect(container.querySelector(".lucide-triangle-alert")).not.toBeInTheDocument();
  });

  it("is its own panel, with the icon on the first line and not on the middle", () => {
    const { container } = render(<Notice tone="info">Two lines of text, at least.</Notice>);
    const panel = container.firstElementChild as HTMLElement;
    expect(panel).toHaveClass("rounded-md", "border", "items-start");
    // One line-tall box around the glyph, matching the text's leading:
    // the icon's centre lands on the first line's centre, with no
    // corrective padding to forget.
    const glyphBox = container.querySelector(".lucide-info")?.parentElement as HTMLElement;
    expect(glyphBox).toHaveClass("h-5", "items-center");
    expect(screen.getByText("Two lines of text, at least.")).toHaveClass("leading-5");
  });

  it("takes a glyph of its own without letting go of the tone", () => {
    const { container } = render(
      <Notice tone="info" icon={Clock}>
        A time lock keeps this transaction out of the chain for now.
      </Notice>,
    );
    // The colour still says how much this matters; the glyph only says
    // what it is about. Without the escape hatch, a caution list has to
    // be hand-rolled to keep its per-kind icons.
    const panel = container.firstElementChild as HTMLElement;
    expect(panel).toHaveClass("border-pending/25", "bg-pending-surface", "text-pending");
    expect(container.querySelector(".lucide-clock")).toBeInTheDocument();
    expect(container.querySelector(".lucide-info")).not.toBeInTheDocument();
  });

  it("keeps the red while wearing another glyph", () => {
    const { container } = render(
      <Notice tone="alert" icon={PenOff}>
        Some inputs carry no signature.
      </Notice>,
    );
    const panel = container.firstElementChild as HTMLElement;
    expect(panel).toHaveClass("border-alert/25", "bg-alert-surface", "text-alert");
    expect(container.querySelector(".lucide-pen-off")).toBeInTheDocument();
    expect(container.querySelector(".lucide-triangle-alert")).not.toBeInTheDocument();
  });

  it("takes an action on the right", () => {
    render(
      <Notice tone="alert" action={<button type="button">Acknowledge</button>}>
        Funds left this wallet.
      </Notice>,
    );
    expect(screen.getByRole("button", { name: "Acknowledge" })).toBeInTheDocument();
  });

  it("announces itself only when asked to", () => {
    const { rerender } = render(<Notice tone="info">Quiet.</Notice>);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    rerender(
      <Notice tone="alert" role="alert">
        The network refused this transaction.
      </Notice>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("The network refused this transaction.");
  });
});
