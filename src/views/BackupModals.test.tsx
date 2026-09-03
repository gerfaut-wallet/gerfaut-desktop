import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackupPreview, WalletMeta } from "../lib/ipc";
import { useUi } from "../state/store";
import { BackupExportModal, BackupRestoreModal } from "./BackupModals";

// The file dialogs open on the Rust side: a test answers the command
// with what was picked, or with null for a dialog closed on nothing.
const PICKED = { name: "backup.gerfaut", data: "R0ZCQUNLVVA=" };

// What the camera "sees", one entry per animation tick, for the tests
// that drive a real scan all the way to the restore screen.
const cameraFrames: string[] = [];
let cameraCursor = 0;

vi.mock("jsqr", () => ({
  default: () => {
    const data = cameraFrames[cameraCursor] ?? null;
    cameraCursor += 1;
    return data === null ? null : { data };
  },
}));

/** A camera that answers, and a hand on requestAnimationFrame so the
    decode loop runs one step per call, past its 120 ms throttle. */
function fakeCamera() {
  const track = { stop: vi.fn() };
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track] }) },
  });
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
    configurable: true,
    get: () => 4,
  });
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
    configurable: true,
    get: () => 320,
  });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
    configurable: true,
    get: () => 240,
  });
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    drawImage: vi.fn(),
    getImageData: vi
      .fn()
      .mockReturnValue({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;

  const queue: FrameRequestCallback[] = [];
  let now = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queue.push(callback);
    return queue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const tick = async () => {
    if (queue.length === 0) {
      await act(async () => {
        await Promise.resolve();
      });
    }
    const callback = queue.shift();
    now += 200;
    await act(async () => {
      callback?.(now);
      await Promise.resolve();
      await Promise.resolve();
    });
  };
  return { tick, track };
}

const WALLETS: WalletMeta[] = [
  {
    id: "w1",
    name: "Cold storage",
    icon: "wallet",
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
        pending_net_sats: null,
        immature: 0,
        total: 0,
      },
      tx_count: 0,
    },
  },
  {
    id: "w2",
    name: "Mainnet cold",
    icon: "wallet",
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
        pending_net_sats: null,
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
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  cameraFrames.length = 0;
  cameraCursor = 0;
  // The store outlives a test, and a toast lives three seconds.
  useUi.setState({ toast: null });
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

  it("saving the file hands Rust the bytes and a name, and says when it is written", async () => {
    let saved: unknown = null;
    mockIPC((cmd, args) => {
      switch (cmd) {
        case "export_backup":
          return { data: "R0ZCQUNLVVA=", frames: ["ur:bytes/aaa"], wallet_count: 2, size_bytes: 512 };
        case "save_backup_file":
          saved = args;
          return true;
        default:
          throw new Error(`unexpected command ${cmd}`);
      }
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

    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.type(screen.getByLabelText("Confirm password"), "correct horse");
    await user.click(screen.getByRole("button", { name: /create backup/i }));
    await user.click(await screen.findByRole("button", { name: /save file/i }));

    // The dialog is Rust's: the screen sends the sealed bytes and the
    // name it would give the file, never a path.
    await waitFor(() => expect(saved).not.toBeNull());
    const args = saved as { data: string; suggestedName: string };
    expect(args.data).toBe("R0ZCQUNLVVA=");
    expect(args.suggestedName).toMatch(/^gerfaut-backup-\d{4}-\d{2}-\d{2}\.gerfaut$/);
    expect(Object.keys(args)).not.toContain("path");
    await waitFor(() => expect(useUi.getState().toast).toBe("Backup saved"));
  });

  it("a save dialog closed on nothing leaves the screen where it was", async () => {
    mockIPC((cmd) => {
      switch (cmd) {
        case "export_backup":
          return { data: "R0ZCQUNLVVA=", frames: ["ur:bytes/aaa"], wallet_count: 2, size_bytes: 512 };
        case "save_backup_file":
          return false;
        default:
          throw new Error(`unexpected command ${cmd}`);
      }
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

    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.type(screen.getByLabelText("Confirm password"), "correct horse");
    await user.click(screen.getByRole("button", { name: /create backup/i }));
    await user.click(await screen.findByRole("button", { name: /save file/i }));

    // Nothing was written, so nothing is claimed; the file can still be
    // saved or shown as a code.
    await act(async () => {
      await Promise.resolve();
    });
    expect(useUi.getState().toast).toBeNull();
    expect(screen.getByRole("button", { name: /save file/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /show qr code/i })).toBeInTheDocument();
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
    // The scanner shows the same numerals and means progress by them.
    // This counter is a place in a loop, and the caption says so.
    expect(screen.getByText(/The code loops: start at any frame\./)).toBeInTheDocument();

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
        case "pick_backup_file":
          return PICKED;
        case "preview_backup":
          return Promise.reject({ kind: "vault", message: "vault decryption failed" });
        default:
          throw new Error(`unexpected command ${cmd}`);
      }
    });
    renderModal(<BackupRestoreModal open onClose={() => {}} activeNetwork="signet" />);
    const user = userEvent.setup();

    // Nothing to open before a source is held.
    expect(screen.getByRole("button", { name: /open backup/i })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /open a file/i }));
    await screen.findByText(/Backup read from/);
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
        case "pick_backup_file":
          return PICKED;
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

    // Drive the preview step through the file path.
    renderModal(<BackupRestoreModal open onClose={() => {}} activeNetwork="signet" />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /open a file/i }));
    await screen.findByText(/Backup read from/);
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

  it("a wallet already watched stays on the list, greyed and out of reach", async () => {
    mockIPC((cmd) => {
      switch (cmd) {
        case "pick_backup_file":
          return PICKED;
        case "preview_backup":
          return PREVIEW;
        default:
          throw new Error(`unexpected command ${cmd}`);
      }
    });
    renderModal(<BackupRestoreModal open onClose={() => {}} activeNetwork="signet" />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /open a file/i }));
    await screen.findByText(/Backup read from/);
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: /open backup/i }));

    // Shown rather than dropped: a backup that seems to have lost a
    // wallet is worse than one that says why it will skip it. A screen
    // reader gets the reason with the name, not beside it.
    const watched = await screen.findByRole("checkbox", { name: /Savings/ });
    expect(watched).toHaveAccessibleName(/Already watched/);
    expect(watched).toBeDisabled();
    expect(watched).not.toBeChecked();
    // The name drops to the weight of the line under it; the wallet
    // that can be restored keeps the full one.
    expect(screen.getByText("Savings")).toHaveClass("text-muted");
    expect(screen.getByText("Cold storage")).toHaveClass("text-text");

    // Clicking its label cannot slip it back into the restore.
    await user.click(screen.getByText("Savings"));
    expect(watched).not.toBeChecked();
    expect(screen.getByRole("button", { name: /restore 1 wallet/i })).toBeInTheDocument();
  });

  it("a file dialog closed on nothing changes nothing", async () => {
    mockIPC((cmd) => {
      if (cmd === "pick_backup_file") return null;
      throw new Error(`unexpected command ${cmd}`);
    });
    renderModal(<BackupRestoreModal open onClose={() => {}} activeNetwork="signet" />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /open a file/i }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText(/Backup read from/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open backup/i })).toBeDisabled();
  });

  it("a file lands in plain words and hands the caret to the password", async () => {
    mockIPC((cmd) => {
      if (cmd === "pick_backup_file") return PICKED;
      throw new Error(`unexpected command ${cmd}`);
    });
    renderModal(<BackupRestoreModal open onClose={() => {}} activeNetwork="signet" />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /open a file/i }));

    expect(await screen.findByText(/Backup read from/)).toHaveTextContent(
      "Backup read from backup.gerfaut",
    );
    expect(screen.getByText("Type its password to open it.")).toBeInTheDocument();

    // The caret lands on the next step, and what just happened is read
    // out with it rather than left to a panel a screen reader may miss.
    const field = screen.getByLabelText("Password");
    await waitFor(() => expect(field).toHaveFocus());
    expect(field).toHaveAccessibleDescription(/Backup read from backup\.gerfaut/);
    expect(screen.getByRole("button", { name: /open backup/i })).toBeEnabled();
  });

  it("a scan lands the same way, with the scanner gone and the camera off", async () => {
    mockIPC((cmd, args) => {
      if (cmd !== "assemble_qr") throw new Error(`unexpected command ${cmd}`);
      const seen = (args as { frames: string[] }).frames;
      return {
        format: "ur",
        received: seen.length,
        total: 2,
        complete: seen.length === 2,
        text: seen.length === 2 ? "gerfaut-backup:R0ZCQUNLVVA=" : null,
      };
    });
    cameraFrames.push("ur:bytes/1-2/aaaa", "ur:bytes/2-2/bbbb");
    const { tick, track } = fakeCamera();

    renderModal(<BackupRestoreModal open onClose={() => {}} activeNetwork="signet" />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /scan a qr code/i }));
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());

    // Both screens count fragments, so the scanner's denominator is the
    // sending screen's frame count, and it climbs one at a time.
    await tick();
    expect(await screen.findByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    await tick();

    // The scanner closes on the last frame, and the page it uncovers
    // says what it now holds instead of a grey line that reads as a
    // crash after a bar that looked stuck.
    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
    expect(await screen.findByText(/Backup read from/)).toHaveTextContent(
      "Backup read from the QR code",
    );
    expect(screen.getByText("Type its password to open it.")).toBeInTheDocument();

    const field = screen.getByLabelText("Password");
    await waitFor(() => expect(field).toHaveFocus());
    expect(field).toHaveAccessibleDescription(/Backup read from the QR code/);
    expect(screen.getByRole("button", { name: /open backup/i })).toBeEnabled();
    // Nothing keeps the webcam once the scan is over.
    expect(track.stop).toHaveBeenCalled();
  });
});
