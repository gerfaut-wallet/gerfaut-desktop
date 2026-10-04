import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedInput } from "../lib/ipc";
import { useUi } from "../state/store";
import { AddWalletModal, MAX_WALLET_FILE_BYTES, scriptHint } from "./AddWalletModal";

// The camera is out of reach here: the scanner hands over at once the
// text and warnings the core gives for a crypto-output whose key names
// no child path.
vi.mock("../components/ScanQrModal", async () => {
  const { createElement } = await import("react");
  return {
    ScanQrModal: ({
      open,
      onScan,
      onClose,
    }: {
      open: boolean;
      onScan: (text: string, warnings: string[]) => void;
      onClose: () => void;
    }) =>
      open
        ? createElement(
            "button",
            {
              type: "button",
              onClick: () => {
                onScan("wpkh([9a6a2580/84h/1h/0h]tpub.../<0;1>/*)", ["assumed_branches"]);
                onClose();
              },
            },
            "Code seen",
          )
        : null,
  };
});

/** A lone tpub: the core keeps Native SegWit and says it assumed it. */
const PARSED_TPUB: ParsedInput = {
  kind: "extended_key",
  networks: ["signet", "testnet4", "regtest"],
  payload: {
    type: "descriptors",
    external: "wpkh(tpub.../0/*)#aaaaaaaa",
    internal: "wpkh(tpub.../1/*)#bbbbbbbb",
    script: "segwit",
  },
  warnings: ["assumed_segwit"],
  script_options: ["legacy", "nested_segwit", "segwit", "taproot"],
  derivation: { receive: "0/*", change: "1/*", origin: null },
  derivation_editable: true,
  preview_address: "tb1qpreview0segwit000000000000000000000000",
};

function renderModal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AddWalletModal activeNetwork="signet" />
    </QueryClientProvider>,
  );
}

/** Gets to the confirmation step with the fixture the core returns. */
async function confirmStep(parsed: ParsedInput) {
  mockIPC((cmd) => {
    if (cmd === "parse_input") return parsed;
    return undefined;
  });
  useUi.setState({ addWalletOpen: true });
  renderModal();
  const user = userEvent.setup();
  await user.type(
    screen.getByLabelText(/descriptor, extended public key/i),
    "tpubDDnGNapGEY6...",
  );
  await user.click(screen.getByRole("button", { name: /continue/i }));
  await screen.findByText(/recognized as/i);
  return user;
}

describe("AddWalletModal", () => {
  beforeEach(() => {
    useUi.setState({ addWalletOpen: false });
  });

  /** The hints name how the addresses start on the network the wallet
      goes to, the ones the person compares with their own wallet: a
      signet wallet never shows a mainnet prefix. */
  it("names the address prefixes of the wallet's network", async () => {
    const user = await confirmStep(PARSED_TPUB);
    await user.click(screen.getByRole("combobox", { name: "Script type" }));
    const listbox = await screen.findByRole("listbox");
    expect(listbox).toHaveTextContent("P2WPKH, addresses starting with tb1q");
    expect(listbox).toHaveTextContent("P2TR, addresses starting with tb1p");
    expect(listbox).toHaveTextContent("P2SH-P2WPKH, addresses starting with 2");
    expect(listbox).not.toHaveTextContent(/bc1q|bc1p/);
  });

  /** The first address is the network's own: regtest was shown the
      signet one, which no regtest wallet ever gives. The core derives
      it for the network asked, and a network picked asks again, on the
      same wallet. */
  it("shows the first address of the network picked", async () => {
    const asked: Record<string, unknown>[] = [];
    mockIPC((cmd, args) => {
      if (cmd !== "parse_input") return undefined;
      const payload = args as Record<string, unknown>;
      asked.push(payload);
      return {
        ...PARSED_TPUB,
        preview_address:
          payload.network === "regtest"
            ? "bcrt1qpreview0segwit0000000000000000000000"
            : PARSED_TPUB.preview_address,
      };
    });
    useUi.setState({ addWalletOpen: true });
    renderModal();
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText(/descriptor, extended public key/i),
      "tpubDDnGNapGEY6...",
    );
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await screen.findByText(/recognized as/i);
    expect(asked.at(-1)).toMatchObject({ network: "signet", script: null, derivation: null });
    expect(screen.getByTestId("preview-address")).toHaveTextContent(/^tb1q/);

    await user.click(screen.getByRole("combobox", { name: "Network" }));
    const list = await screen.findByRole("listbox", { name: "Network" });
    await user.click(within(list).getByRole("option", { name: /^Regtest/ }));
    expect(await screen.findByText("bcrt1qpreview0segwit0000000000000000000000")).toBeInTheDocument();
    expect(asked.at(-1)).toMatchObject({ network: "regtest", script: null, derivation: null });
    expect(screen.getByRole("combobox", { name: "Network" })).toHaveTextContent("Regtest");
  });

  it("writes each network's prefixes", () => {
    expect(scriptHint("segwit", "mainnet")).toBe("P2WPKH, addresses starting with bc1q");
    expect(scriptHint("taproot", "mainnet")).toBe("P2TR, addresses starting with bc1p");
    expect(scriptHint("legacy", "mainnet")).toBe("P2PKH, addresses starting with 1");
    expect(scriptHint("segwit", "testnet4")).toBe("P2WPKH, addresses starting with tb1q");
    expect(scriptHint("legacy", "signet")).toBe("P2PKH, addresses starting with m or n");
    expect(scriptHint("segwit", "regtest")).toBe("P2WPKH, addresses starting with bcrt1q");
    expect(scriptHint("taproot", "regtest")).toBe("P2TR, addresses starting with bcrt1p");
    expect(scriptHint("witness_script", "signet")).toBe("P2WSH multisig or script");
  });

  it("says what it does not know in an amber notice, outside the recognition card", async () => {
    await confirmStep(PARSED_TPUB);

    const notice = screen
      .getByText(/carries no script type/i)
      .closest("[class*='bg-pending-surface']") as HTMLElement;
    expect(notice).not.toBeNull();
    expect(notice).toHaveClass("border-pending/25", "text-pending");
    expect(notice.querySelector(".lucide-info")).toBeInTheDocument();

    // The card keeps what was recognized; the notice is a panel of its
    // own beside it, never a line inside it.
    const card = screen.getByText(/recognized as/i).closest("div") as HTMLElement;
    expect(card).not.toContainElement(notice);
    expect(card).toHaveTextContent("First address");

    // And it sits between the card and the choice it points at.
    expect(
      notice.compareDocumentPosition(screen.getByRole("combobox", { name: "Script type" })),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  /** Whoever goes back does so to correct what they pasted. */
  it("goes back to the field with the input still in it", async () => {
    const user = await confirmStep(PARSED_TPUB);
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText(/descriptor, extended public key/i)).toHaveValue(
      "tpubDDnGNapGEY6...",
    );
  });

  /** The wallet is in once `add_wallet` answered: a failed move to its
      network closes the dialog all the same, and says where it went. A
      second click would only have heard "already watched". */
  it("closes on a wallet added, even when the network could not follow", async () => {
    const calls: string[] = [];
    mockIPC((cmd) => {
      calls.push(cmd);
      switch (cmd) {
        case "parse_input":
          return { ...PARSED_TPUB, networks: ["testnet4"] };
        case "add_wallet":
          return { id: "w-new", network: "testnet4" };
        case "set_active_network":
          return Promise.reject({ kind: "vault", message: "the vault could not be written" });
        default:
          return undefined;
      }
    });
    useUi.setState({ addWalletOpen: true, toast: null });
    renderModal();
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText(/descriptor, extended public key/i),
      "tpubDDnGNapGEY6...",
    );
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await user.type(await screen.findByLabelText(/name/i), "Cold storage");
    await user.click(screen.getByRole("button", { name: "Add wallet" }));

    await vi.waitFor(() => expect(useUi.getState().addWalletOpen).toBe(false));
    expect(useUi.getState().toast).toBe("Wallet added on Testnet 4");
    expect(calls.filter((cmd) => cmd === "add_wallet")).toHaveLength(1);
  });

  /** The core read a scanned code's missing path as receive and
      change. The notice stays with the text scanned, through a network
      picked, and goes once the field holds something else. */
  it("says a scanned code's branches were assumed", async () => {
    const asked: unknown[] = [];
    mockIPC((cmd, args) => {
      if (cmd !== "parse_input") return undefined;
      asked.push((args as { input: unknown }).input);
      return { ...PARSED_TPUB, warnings: [] };
    });
    useUi.setState({ addWalletOpen: true });
    renderModal();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /scan a qr code/i }));
    await user.click(screen.getByRole("button", { name: "Code seen" }));
    expect(await screen.findByText(/carries no derivation path/i)).toHaveTextContent(
      "This QR code carries no derivation path, so Gerfaut assumes receive and change addresses. Compare the first address with your signer.",
    );

    await user.click(screen.getByRole("combobox", { name: "Network" }));
    const list = await screen.findByRole("listbox", { name: "Network" });
    await user.click(within(list).getByRole("option", { name: /^Regtest/ }));
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    expect(screen.getByText(/carries no derivation path/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.type(screen.getByLabelText(/descriptor, extended public key/i), " ");
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await vi.waitFor(() => expect(asked).toHaveLength(3));
    await screen.findByText(/recognized as/i);
    expect(screen.queryByText(/carries no derivation path/i)).not.toBeInTheDocument();
  });

  it("drops the notice once the key no longer needs one", async () => {
    await confirmStep({ ...PARSED_TPUB, warnings: [] });
    expect(screen.queryByText(/carries no script type/i)).not.toBeInTheDocument();
    expect(screen.getByText(/recognized as/i)).toBeInTheDocument();
  });

  it("refuses a file far too large to be a wallet without reading it", async () => {
    let asked = false;
    mockIPC((cmd) => {
      asked ||= cmd === "parse_input";
      return undefined;
    });
    useUi.setState({ addWalletOpen: true });
    renderModal();
    const file = new File(["wpkh(tpub...)"], "disc.img");
    Object.defineProperty(file, "size", { value: MAX_WALLET_FILE_BYTES + 1 });
    const read = vi.spyOn(file, "text");
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText("This file is too large to hold a wallet.")).toBeInTheDocument();
    expect(read).not.toHaveBeenCalled();
    expect(asked).toBe(false);
  });
});
