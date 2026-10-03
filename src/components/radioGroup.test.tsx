import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Segmented } from "../views/settings/primitives";

function Modes() {
  const [mode, setMode] = useState<"auto" | "system" | "embedded" | "off">("system");
  return (
    <>
      <button type="button">Before</button>
      <Segmented
        label="Tor"
        value={mode}
        onChange={setMode}
        options={[
          { value: "auto", label: "Automatic" },
          { value: "system", label: "System Tor" },
          { value: "embedded", label: "Built-in", disabled: true },
          { value: "off", label: "Off" },
        ]}
      />
      <button type="button">After</button>
    </>
  );
}

const radio = (name: string) => screen.getByRole("radio", { name });

describe("a group of choices at the keyboard", () => {
  it("is one stop for Tab, on the chosen one", async () => {
    render(<Modes />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Before" }));
    await user.tab();
    expect(radio("System Tor")).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "After" })).toHaveFocus();
  });

  it("moves and chooses with the arrows, over a disabled choice, round the ends", async () => {
    render(<Modes />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Before" }));
    await user.tab();

    await user.keyboard("{ArrowRight}");
    expect(radio("Off")).toHaveFocus();
    expect(radio("Off")).toBeChecked();
    expect(radio("Built-in")).not.toBeChecked();

    await user.keyboard("{ArrowRight}");
    expect(radio("Automatic")).toHaveFocus();
    expect(radio("Automatic")).toBeChecked();

    await user.keyboard("{ArrowLeft}");
    expect(radio("Off")).toBeChecked();
    await user.keyboard("{Home}");
    expect(radio("Automatic")).toBeChecked();
    await user.keyboard("{End}");
    expect(radio("Off")).toBeChecked();
  });
});
