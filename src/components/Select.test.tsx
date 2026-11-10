import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "./Modal";
import { Select } from "./Select";
import type { SelectOption } from "./Select";

const SERVERS: SelectOption<string>[] = [
  { value: "", label: "Automatic", hint: "Every server, tried in turn" },
  { value: "blockstream.info", label: "blockstream.info", hint: "Esplora", group: "Esplora" },
  { value: "mempool.space", label: "mempool.space", hint: "Esplora", group: "Esplora" },
  { value: "electrum.example", label: "electrum.example", hint: "Electrum", group: "Electrum" },
  { value: "down.example", label: "down.example", disabled: true, group: "Electrum" },
];

function Field({ initial = "", onChange }: { initial?: string; onChange?: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <Select
      label="Public server"
      value={value}
      options={SERVERS}
      onChange={(next) => {
        onChange?.(next);
        setValue(next);
      }}
    />
  );
}

describe("Select", () => {
  it("names the button by its label and shows the current choice", () => {
    render(<Field initial="mempool.space" />);
    const button = screen.getByRole("combobox", { name: "Public server" });
    expect(button).toHaveTextContent("mempool.space");
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("lists two-line rows under their group, the current one selected", async () => {
    const user = userEvent.setup();
    render(<Field />);
    await user.click(screen.getByRole("combobox", { name: "Public server" }));
    const list = await screen.findByRole("listbox", { name: "Public server" });
    expect(within(list).getByRole("option", { name: "Automatic Every server, tried in turn" }))
      .toHaveAttribute("aria-selected", "true");
    expect(within(list).getByRole("option", { name: /^mempool\.space Esplora$/ }))
      .toHaveAttribute("aria-selected", "false");
    expect(within(list).getByRole("group", { name: "Electrum" })).toBeInTheDocument();
    expect(within(list).getByRole("option", { name: "down.example" }))
      .toHaveAttribute("aria-disabled", "true");
  });

  it("chooses with the keyboard, skips a disabled row, and comes back to the empty value", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Field initial="electrum.example" onChange={onChange} />);
    const button = screen.getByRole("combobox", { name: "Public server" });
    button.focus();
    await user.keyboard("{ArrowDown}");
    await screen.findByRole("listbox");
    await user.keyboard("{ArrowDown}{Enter}");
    // The disabled row under the current one is stepped over.
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(button).toHaveFocus();

    await user.click(button);
    const list = await screen.findByRole("listbox");
    await user.click(within(list).getByRole("option", { name: /^Automatic/ }));
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(button).toHaveTextContent("Automatic");
  });

  it("closes on Escape inside a modal without closing the modal", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal open onClose={onClose} title="Backend" z={70}>
        <Field />
      </Modal>,
    );
    const button = screen.getByRole("combobox", { name: "Public server" });
    await user.click(button);
    await screen.findByRole("listbox");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Backend" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(button).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
