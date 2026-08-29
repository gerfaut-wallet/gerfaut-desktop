import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackupPreview, WalletMeta } from "../lib/ipc";
import { BackupExportModal, BackupRestoreModal } from "./BackupModals";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(async () => "C:/tmp/gerfaut-backup.gerfaut"),
  open: vi.fn(async () => null),
}));

const WALLETS: WalletMeta[] = [
  {
    id: "w1",
    name: "Cold storage",
    network: "signet",
    kind: { type: "descriptors", external: "wpkh(...)", internal: null, script: "segwit" },
    recognized_as: "descriptor",
    created_at: 1_755_000_000,
    gap_limit: 20,
    scan_gap: 20,
    labels: {},
    last_sync: null,
    cached: {
      balance: {
        confirmed: 0,
        trusted_pending: 0,
        untrusted_pending: 0,
        immature: 0,
        total: 0,
      },
      tx_count: 0,
    },
  },
  {
    id: "w2",
    name: "Mainnet cold",
    network: "mainnet",
    kind: { type: "single_address", address: "bc1qexample" },
    recognized_as: "address",
    created_at: 1_755_000_000,
    gap_limit: 20,
    scan_gap: 20,
    labels: {},
    last_sync: null,
    cached: {
      balance: {
        confirmed: 0,
        trusted_pending: 0,
        untrusted_pending: 0,
        immature: 0,
        total: 0,
      },
      tx_count: 0,
    },
  },
];

const PREVIEW: BackupPreview = {
  created_at: 1_755_000_000,
  has_settings: true,
  wallets: [
    {
      index: 0,
      name: "Cold storage",
      network: "signet",
      kind: { type: "descriptors", external: "wpkh(...)", internal: null, script: "segwit" },
      already_watched: false,
    },
    {
      index: 1,
      name: "Savings",
      network: "signet",
      kind: { type: "single_address", address: "tb1qexample" },
      already_watched: true,
    },
  ],
};

function renderModal(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

afterEach(() => {
  // Restored here and not at the end of the test that installs them:
  // a failure there would otherwise leave every later test hanging on
  // a clock that never advances.
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("exporting a backup", () => {
  it("a password too short never reaches the core", async () => {
    const calls: string[] = [];
    mockIPC((cmd) => {
      calls.push(cmd);
      throw new Error(`unexpected command ${cmd}`);
    });
    renderModal(
      <BackupExportModal
        open
        onClose={() => {}}
        wallets={WALLETS}
        activeNetwork="signet"
      />,
    );
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Password"), "short");
    await user.type(screen.getByLabelText("Confirm password"), "short");
    await user.click(screen.getByRole("button", { name: /create backup/i }));

    expect(await screen.findByText("Use at least 8 characters.")).toBeInTheDocument();
    expect(calls).not.toContain("export_backup");
  });

  it("two different passwords are refused", async () => {
    mockIPC(() => undefined);
    renderModal(
      <BackupExportModal
        open
        onClose={() => {}}
        wallets={WALLETS}
        activeNetwork="signet"
      />,
    );
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.type(screen.getByLabelText("Confirm password"), "correct hors");
    await user.click(screen.getByRole("button", { name: /create backup/i }));

    expect(await screen.findByText("The two passwords differ.")).toBeInTheDocument();
  });

  it("takes every wallet by default and the settings when asked", async () => {
    let sent: unknown = null;
    mockIPC((cmd, args) => {
      if (cmd === "export_backup") {
        sent = args;
        return { data: "R0ZCQUNLVVA=", frames: ["ur:bytes/aaa"], wallet_count: 2, size_bytes: 512 };
      }
      throw new Error(`unexpected command ${cmd}`);
    });
    renderModal(
      <BackupExportModal
        open
        onClose={() => {}}
        wallets={WALLETS}
        activeNetwork="signet"
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("switch", { name: /include node settings/i }));
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.type(screen.getByLabelText("Confirm password"), "correct horse");
    await user.click(screen.getByRole("button", { name: /create backup/i }));

    await screen.findByText(/2 wallets ·/);
    const options = (sent as { options: { wallet_ids: null; include_settings: boolean } })
      .options;
    // Null means every wallet on every network, not a filtered list.
    expect(options.wallet_ids).toBeNull();
    expect(options.include_settings).toBe(true);
    expect(screen.getByRole("button", { name: /save file/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /show qr code/i })).toBeInTheDocument();
  });

  it("the network scope sends only that network's ids", async () => {
    let sent: unknown = null;
    mockIPC((cmd, args) => {
      if (cmd === "export_backup") {
        sent = args;
        return { data: "R0ZCQUNLVVA=", frames: ["ur:bytes/aaa"], wallet_count: 1, size_bytes: 400 };
      }
      throw new Error(`unexpected command ${cmd}`);
    });
    renderModal(
      <BackupExportModal
        open
        onClose={() => {}}
        wallets={WALLETS}
        activeNetwork="signet"
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("radio", { name: /signet only/i }));
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.type(screen.getByLabelText("Confirm password"), "correct horse");
    await user.click(screen.getByRole("button", { name: /create backup/i }));

    await screen.findByText(/1 wallet ·/);
    expect((sent as { options: { wallet_ids: string[] } }).options.wallet_ids).toEqual(["w1"]);
  });

  it("shows the frames as a code, one after the other", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockIPC((cmd) => {
      if (cmd === "export_backup") {
        return {
          data: "R0ZCQUNLVVA=",
          frames: ["ur:bytes/1-2/aaa", "ur:bytes/2-2/bbb"],
          wallet_count: 2,
          size_bytes: 900,
        };
      }
      throw new Error(`unexpected command ${cmd}`);
    });
    renderModal(
      <BackupExportModal
        open
        onClose={() => {}}
        wallets={WALLETS}
        activeNetwork="signet"
      />,
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.type(screen.getByLabelText("Confirm password"), "correct horse");
    await user.click(screen.getByRole("button", { name: /create backup/i }));
    await screen.findByText(/2 wallets ·/);
    await user.click(screen.getByRole("button", { name: /show qr code/i }));

    expect(
      await screen.findByRole("img", { name: "Backup QR code, frame 1 of 2" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(200);
    await waitFor(() => {
      expect(
        screen.getByRole("img", { name: "Backup QR code, frame 2 of 2" }),
      ).toBeInTheDocument();
    });
  });
});

describe("restoring a backup", () => {
  it("a wrong password says so in plain words", async () => {
    mockIPC((cmd) => {
      switch (cmd) {
        case "read_backup_file":
          return "R0ZCQUNLVVA=";
        case "preview_backup":
          return Promise.reject({ kind: "vault", message: "vault decryption failed" });
        default:
          throw new Error(`unexpected command ${cmd}`);
      }
    });
    const dialog = await import("@tauri-apps/plugin-dialog");
    vi.mocked(dialog.open).mockResolvedValue("C:/tmp/backup.gerfaut");

    renderModal(<BackupRestoreModal open onClose={() => {}} activeNetwork="signet" />);
    const user = userEvent.setup();

    // Nothing to open before a source is held.
    expect(screen.getByRole("button", { name: /open backup/i })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /open a file/i }));
    await screen.findByText(/File: backup.gerfaut/);
    await user.type(screen.getByLabelText("Password"), "wrong one");
    await user.click(screen.getByRole("button", { name: /open backup/i }));

    // The core's own wording would say "vault decryption failed"; the
    // screen says what it means to the person typing.
    expect(
      await screen.findByText("Wrong password, or the file is damaged."),
    ).toBeInTheDocument();
  });

  it("unchecking a wallet leaves it out of the restore", async () => {
    let sent: unknown = null;
    mockIPC((cmd, args) => {
      switch (cmd) {
        case "read_backup_file":
          return "R0ZCQUNLVVA=";
        case "preview_backup":
          return PREVIEW;
        case "import_backup":
          sent = args;
          return { added: [WALLETS[0]], skipped: 1, settings_applied: false };
        case "sync_all":
          return { reports: [], failures: [] };
        default:
          throw new Error(`unexpected command ${cmd}`);
      }
    });

    // Drive the preview step through the file path, which the dialog
    // mock answers with a path.
    const dialog = await import("@tauri-apps/plugin-dialog");
    vi.mocked(dialog.open).mockResolvedValue("C:/tmp/backup.gerfaut");

    renderModal(<BackupRestoreModal open onClose={() => {}} activeNetwork="signet" />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /open a file/i }));
    await screen.findByText(/File: backup.gerfaut/);
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: /open backup/i }));

    await screen.findByText("Savings");
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    // A wallet already watched cannot be chosen twice.
    expect(boxes[1]).toBeDisabled();
    expect(boxes[1]).not.toBeChecked();
    expect(boxes[0]).toBeChecked();
    expect(screen.getByRole("button", { name: /restore 1 wallet/i })).toBeInTheDocument();

    // Unchecking the only pickable wallet leaves nothing to restore,
    // and the action says so instead of sending an empty list.
    await user.click(boxes[0]);
    expect(boxes[0]).not.toBeChecked();
    expect(screen.getByRole("button", { name: /restore 0 wallets/i })).toBeDisabled();

    await user.click(boxes[0]);
    await user.click(screen.getByRole("switch", { name: /apply node settings/i }));
    await user.click(screen.getByRole("button", { name: /restore 1 wallet/i }));

    await waitFor(() => {
      expect(sent).not.toBeNull();
    });
    const choices = (sent as { choices: { indexes: number[]; apply_settings: boolean } })
      .choices;
    expect(choices.indexes).toEqual([0]);
    expect(choices.apply_settings).toBe(true);
  });
});
