import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InputError } from "./InputError";

describe("InputError", () => {
  /** A refused input is not a chain event: the text colour and a
      glyph, never the red kept for funds and privacy. */
  it("says the refusal in the text colour, with its glyph, as an alert", () => {
    render(<InputError>unrecognized input</InputError>);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("unrecognized input");
    expect(alert.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(alert.innerHTML).not.toContain("text-alert");
  });

  it("keeps the reason under the sentence, in the muted voice", () => {
    render(<InputError detail="bad checksum">This is not a transaction.</InputError>);
    expect(screen.getByRole("alert")).toHaveTextContent("This is not a transaction.bad checksum");
  });
});
