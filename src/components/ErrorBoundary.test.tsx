import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

function Broken(): never {
  throw new Error("frames[index] is undefined");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a screen that throws while it renders", () => {
  it("says so and offers to reload, rather than an empty window", async () => {
    // React reports the error to the console on its own; this test is
    // about what the window shows.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reload = vi.fn();
    render(
      <ErrorBoundary onReload={reload}>
        <Broken />
      </ErrorBoundary>,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("This screen failed");
    expect(alert).toHaveTextContent("frames[index] is undefined");
    await userEvent.setup().click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("stays out of the way when nothing throws", () => {
    render(
      <ErrorBoundary>
        <p>Overview</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("Overview")).toBeInTheDocument();
  });
});
