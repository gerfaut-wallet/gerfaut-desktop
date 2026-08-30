import { mockIPC } from "@tauri-apps/api/mocks";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QrProgress } from "../lib/ipc";
import { ScanQrModal } from "./ScanQrModal";

// The camera is replaced by a script of frames: each animation tick
// "sees" the next one, exactly like an animated code on a screen. A
// null entry is a tick where no code is in view.
const frames: (string | null)[] = [];
let cursor = 0;

vi.mock("jsqr", () => ({
  default: () => {
    const data = frames[cursor] ?? null;
    cursor += 1;
    return data === null ? null : { data };
  },
}));

function fakeCamera() {
  const track = { stop: vi.fn() };
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track] }),
    },
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
    getImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  return track;
}

/** Drives requestAnimationFrame by hand, 200 ms apart so the decoder
    throttle lets every tick through. */
function manualAnimationFrames() {
  const queue: FrameRequestCallback[] = [];
  let now = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queue.push(callback);
    return queue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  return async () => {
    // The camera promise registers the first frame request in a
    // microtask; give it a chance before ticking.
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
}

describe("ScanQrModal", () => {
  let tick: () => Promise<void>;
  let assembleCalls: string[][];

  beforeEach(() => {
    frames.length = 0;
    cursor = 0;
    assembleCalls = [];
    fakeCamera();
    tick = manualAnimationFrames();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockAssembly(script: (received: string[]) => QrProgress) {
    mockIPC((cmd, args) => {
      if (cmd !== "assemble_qr") throw new Error(`unexpected command ${cmd}`);
      const received = (args as { frames: string[] }).frames;
      assembleCalls.push([...received]);
      return script(received);
    });
  }

  it("hands a plain code over as soon as it is seen", async () => {
    frames.push("wpkh(tpub.../0/*)");
    mockAssembly((received) => ({
      format: "plain",
      received: 1,
      total: 1,
      complete: true,
      text: received[0],
    }));
    const onScan = vi.fn();
    const onClose = vi.fn();
    render(<ScanQrModal open onClose={onClose} onScan={onScan} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    await tick();
    await waitFor(() => expect(onScan).toHaveBeenCalledWith("wpkh(tpub.../0/*)"));
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("assembles an animated code frame after frame and shows the progress", async () => {
    // Part 2 repeats: the camera often sees the same frame twice.
    frames.push("ur:crypto-output/1-3/aaaa", "ur:crypto-output/2-3/bbbb", "ur:crypto-output/2-3/bbbb", "ur:crypto-output/3-3/cccc");
    mockAssembly((received) => ({
      format: "ur",
      received: received.length,
      total: 3,
      complete: received.length === 3,
      text: received.length === 3 ? "wsh(sortedmulti(2,...))" : null,
    }));
    const onScan = vi.fn();
    render(<ScanQrModal open onClose={vi.fn()} onScan={onScan} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());

    await tick();
    expect(await screen.findByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    expect(screen.getByText(/keep the camera on the animated code/i)).toBeInTheDocument();

    await tick();
    expect(await screen.findByText("2 / 3")).toBeInTheDocument();
    await tick(); // the repeated frame is not fed again
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    expect(assembleCalls).toHaveLength(2);

    await tick();
    await waitFor(() => expect(onScan).toHaveBeenCalledWith("wsh(sortedmulti(2,...))"));
    // Every call carried the distinct frames seen so far, in order.
    expect(assembleCalls).toEqual([
      ["ur:crypto-output/1-3/aaaa"],
      ["ur:crypto-output/1-3/aaaa", "ur:crypto-output/2-3/bbbb"],
      ["ur:crypto-output/1-3/aaaa", "ur:crypto-output/2-3/bbbb", "ur:crypto-output/3-3/cccc"],
    ]);
  });

  it("says why a frame was refused and keeps scanning", async () => {
    frames.push("B$HP0100ff", null, "wpkh(tpub.../0/*)");
    mockAssembly((received) => {
      if (received[0].startsWith("B$")) {
        return Promise.reject({
          kind: "invalid_input",
          message: "this QR code holds a PSBT, not a wallet to watch",
        }) as unknown as QrProgress;
      }
      return { format: "plain", received: 1, total: 1, complete: true, text: received[0] };
    });
    const onScan = vi.fn();
    render(<ScanQrModal open onClose={vi.fn()} onScan={onScan} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    await tick();
    expect(await screen.findByRole("alert")).toHaveTextContent(/holds a PSBT/);
    await tick();
    await tick();
    await waitFor(() => expect(onScan).toHaveBeenCalledWith("wpkh(tpub.../0/*)"));
    // The refused frame did not linger in the next assembly.
    expect(assembleCalls.at(-1)).toEqual(["wpkh(tpub.../0/*)"]);
  });

  it("says it once, however long the camera stays on the refused code", async () => {
    // A camera pointed at a PSBT sees it every tick, not once.
    frames.push("B$HP0100ff", "B$HP0100ff", "B$HP0100ff", "wpkh(tpub.../0/*)");
    mockAssembly((received) =>
      received[0].startsWith("B$")
        ? (Promise.reject({
            kind: "invalid_input",
            message: "this QR code holds a PSBT, not a wallet to watch",
          }) as unknown as QrProgress)
        : { format: "plain", received: 1, total: 1, complete: true, text: received[0] },
    );
    const onScan = vi.fn();
    render(<ScanQrModal open onClose={vi.fn()} onScan={onScan} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());

    await tick();
    expect(await screen.findByRole("alert")).toHaveTextContent(/holds a PSBT/);
    await tick();
    await tick();
    await tick();
    await waitFor(() => expect(onScan).toHaveBeenCalledWith("wpkh(tpub.../0/*)"));
    // One refusal, one answer: the two further sightings were dropped
    // without going back to the core for the same verdict.
    expect(assembleCalls).toEqual([["B$HP0100ff"], ["wpkh(tpub.../0/*)"]]);
  });

  it("a refusal takes down the count it had filled in", async () => {
    frames.push("ur:crypto-output/1-3/aaaa", "ur:crypto-output/2-3/bbbb", "B$HP0100ff");
    mockAssembly((received) =>
      received.at(-1)?.startsWith("B$")
        ? (Promise.reject({
            kind: "invalid_input",
            message: "this QR code holds a PSBT, not a wallet to watch",
          }) as unknown as QrProgress)
        : { format: "ur", received: received.length, total: 3, complete: false, text: null },
    );
    render(<ScanQrModal open onClose={vi.fn()} onScan={vi.fn()} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());

    await tick();
    await tick();
    expect(await screen.findByText("2 / 3")).toBeInTheDocument();

    // The frames counted are dropped with the refusal, so a bar left at
    // 2 of 3 would promise a scan nothing is working towards any more.
    await tick();
    expect(await screen.findByRole("alert")).toHaveTextContent(/holds a PSBT/);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("a code that adds up to nothing says so instead of handing over an empty scan", async () => {
    frames.push("B$HU0100ff");
    mockAssembly(() => ({
      format: "bbqr",
      received: 1,
      total: 1,
      complete: true,
      text: "",
    }));
    const onScan = vi.fn();
    const onClose = vi.fn();
    render(<ScanQrModal open onClose={onClose} onScan={onScan} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    await tick();

    expect(await screen.findByRole("alert")).toHaveTextContent("This code came out empty.");
    // Closing on it would drop the caller back on a page holding an
    // empty string, which is the silent stall this scanner had.
    expect(onScan).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a refusal that lands after the scanner closed belongs to the scan it came from", async () => {
    let refuse: (reason: unknown) => void = () => {};
    mockIPC((cmd) => {
      if (cmd !== "assemble_qr") throw new Error(`unexpected command ${cmd}`);
      return new Promise<QrProgress>((_, no) => {
        refuse = no;
      });
    });
    frames.push("B$HP0100ff");
    const { rerender } = render(<ScanQrModal open onClose={vi.fn()} onScan={vi.fn()} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    await tick(); // the core has the frame and has not answered yet

    // The user gives up mid-assembly and opens the scanner again later.
    rerender(<ScanQrModal open={false} onClose={vi.fn()} onScan={vi.fn()} />);
    rerender(<ScanQrModal open onClose={vi.fn()} onScan={vi.fn()} />);
    await act(async () => {
      refuse({ kind: "invalid_input", message: "this QR code holds a PSBT, not a wallet to watch" });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
