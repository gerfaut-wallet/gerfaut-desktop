import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUi } from "../state/store";
import { OpenFailure, useExplorer, useOpenExternal } from "./ExternalLink";

const opener = vi.hoisted(() => ({
  opened: [] as string[],
  refuses: false,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (url: string) => {
    if (opener.refuses) return Promise.reject(new Error("no browser"));
    opener.opened.push(url);
    return Promise.resolve();
  },
}));

const RELEASES = "https://github.com/gerfaut-wallet/gerfaut-desktop/releases/latest";
const TX = `https://mempool.space/signet/tx/${"ab".repeat(32)}`;

function Link({ url }: { url: string }) {
  const link = useOpenExternal();
  return (
    <>
      <button type="button" onClick={() => void link.open(url)}>
        Open the releases page
      </button>
      <OpenFailure url={link.failed} />
    </>
  );
}

function Explorer({ url }: { url: string }) {
  const explorer = useExplorer(url);
  return (
    <>
      <button type="button" onClick={explorer.ask}>
        View on mempool.space
      </button>
      <OpenFailure url={explorer.failed} />
      {explorer.warning}
    </>
  );
}

beforeEach(() => {
  opener.opened = [];
  opener.refuses = false;
  useUi.setState({ explorerAck: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a link nothing opens", () => {
  it("says so, with the address to copy by hand", async () => {
    opener.refuses = true;
    render(<Link url={RELEASES} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Open the releases page" }));
    const note = await screen.findByRole("alert");
    expect(note).toHaveTextContent("Nothing on this computer opened the link.");
    expect(note).toHaveTextContent(RELEASES);

    // Opened the next time: the note goes.
    opener.refuses = false;
    await user.click(screen.getByRole("button", { name: "Open the releases page" }));
    expect(opener.opened).toEqual([RELEASES]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("the explorer", () => {
  it("opens behind its warning, and straight away once told not to ask", async () => {
    render(<Explorer url={TX} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "View on mempool.space" }));
    const dialog = await screen.findByRole("dialog", { name: "Open an external explorer" });
    expect(dialog).toHaveTextContent("Its operator can link this transaction to your IP address.");
    expect(opener.opened).toEqual([]);

    await user.click(screen.getByRole("checkbox", { name: "Do not show this warning again" }));
    await user.click(screen.getByRole("button", { name: "Open explorer" }));
    expect(opener.opened).toEqual([TX]);
    expect(useUi.getState().explorerAck).toBe(true);

    await user.click(screen.getByRole("button", { name: "View on mempool.space" }));
    expect(opener.opened).toEqual([TX, TX]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers nothing to open without an address, on regtest", async () => {
    render(<Explorer url="" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "View on mempool.space" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener.opened).toEqual([]);
  });
});
