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
  /** What the core's scan held after each frame sent to it. */
  let assembleCalls: string[][];
  /** Every frame sent, one per call. */
  let pushed: string[];
  let opened: number;
  let closed: number[];

  beforeEach(() => {
    frames.length = 0;
    cursor = 0;
    assembleCalls = [];
    pushed = [];
    opened = 0;
    closed = [];
    fakeCamera();
    tick = manualAnimationFrames();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Stands in for the scan the core holds: it keeps the frames sent
      to it, answers with `script` of all of them, and starts again
      empty once it has answered with a text or a refusal, as the core
      does. */
  function mockAssembly(script: (received: string[]) => QrProgress) {
    let held: string[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "open_qr_scan") {
        opened += 1;
        held = [];
        return opened;
      }
      if (cmd === "close_qr_scan") {
        closed.push((args as { scan: number }).scan);
        return null;
      }
      if (cmd !== "push_qr_frame") throw new Error(`unexpected command ${cmd}`);
      const { scan, frame } = args as { scan: number; frame: string };
      expect(scan).toBe(opened);
      pushed.push(frame);
      held.push(frame);
      const received = [...held];
      assembleCalls.push(received);
      const answer = Promise.resolve(script(received));
      answer.then(
        (progress) => {
          if (progress.complete) held = [];
        },
        () => {
          held = [];
        },
      );
      return answer;
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
      warnings: [],
    }));
    const onScan = vi.fn();
    const onClose = vi.fn();
    render(<ScanQrModal open onClose={onClose} onScan={onScan} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    await tick();
    await waitFor(() => expect(onScan).toHaveBeenCalledWith("wpkh(tpub.../0/*)", []));
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    // The scan the core held is let go with the answer.
    await waitFor(() => expect(closed).toContain(1));
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
      warnings: received.length === 3 ? ["assumed_branches"] : [],
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
    // What the core assumed reading the code goes along with its text.
    await waitFor(() =>
      expect(onScan).toHaveBeenCalledWith("wsh(sortedmulti(2,...))", ["assumed_branches"]),
    );
    // Each distinct frame went to the core once, in order, and the scan
    // it held had every one of them.
    expect(pushed).toEqual([
      "ur:crypto-output/1-3/aaaa",
      "ur:crypto-output/2-3/bbbb",
      "ur:crypto-output/3-3/cccc",
    ]);
    expect(opened).toBe(1);
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
          message:
            "This QR code holds an executable file, which Gerfaut does not read. Show the code this screen asks for instead, such as a wallet export or a signed transaction.",
        }) as unknown as QrProgress;
      }
      return { format: "plain", received: 1, total: 1, complete: true, text: received[0], warnings: [] };
    });
    const onScan = vi.fn();
    render(<ScanQrModal open onClose={vi.fn()} onScan={onScan} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    await tick();
    // The core's sentence, as it is: what it saw, and what to show.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /^This QR code holds an executable file, which Gerfaut does not read\. Show the code this screen asks for instead, such as a wallet export or a signed transaction\.$/,
    );
    await tick();
    await tick();
    await waitFor(() => expect(onScan).toHaveBeenCalledWith("wpkh(tpub.../0/*)", []));
    // The refused frame did not linger in the next assembly.
    expect(assembleCalls.at(-1)).toEqual(["wpkh(tpub.../0/*)"]);
  });

  /** The core names a private key by the check that caught it; the
      scanner says it in the words of the import, as on Android. */
  it("says what to bring instead of a code holding a private key", async () => {
    frames.push("ur:crypto-output/1-1/lpadad");
    mockAssembly(
      () =>
        Promise.reject({
          kind: "private_material",
          message: "input contains private key material and was rejected",
        }) as unknown as QrProgress,
    );
    render(<ScanQrModal open onClose={vi.fn()} onScan={vi.fn()} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    await tick();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This holds a private key, and Gerfaut only watches: nothing was saved. Bring the public descriptor or extended public key instead.",
    );
  });

  /** Another screen says what it waits for instead of a key. */
  it("says a private key in the words of the screen that opened it", async () => {
    frames.push("ur:crypto-output/1-1/lpadad");
    mockAssembly(
      () =>
        Promise.reject({
          kind: "private_material",
          message: "input contains private key material and was rejected",
        }) as unknown as QrProgress,
    );
    render(
      <ScanQrModal open onClose={vi.fn()} onScan={vi.fn()} privateKey="Not a key, a transaction." />,
    );
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    await tick();
    expect(await screen.findByRole("alert")).toHaveTextContent(/^Not a key, a transaction\.$/);
  });

  it("says in plain words that a code has more parts than Gerfaut reads", async () => {
    // The core turns the count away before decoding a part; the words
    // it gives are for logs.
    frames.push("ur:crypto-psbt/1-6000/aaaa", null, "wpkh(tpub.../0/*)");
    mockAssembly((received) => {
      if (received[0].startsWith("ur:")) {
        return Promise.reject({
          kind: "too_many_parts",
          message: "This QR code announces 6000 parts, more than Gerfaut reads.",
        }) as unknown as QrProgress;
      }
      return { format: "plain", received: 1, total: 1, complete: true, text: received[0], warnings: [] };
    });
    const onScan = vi.fn();
    render(<ScanQrModal open onClose={vi.fn()} onScan={onScan} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    await tick();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /^This code has more parts than Gerfaut can read\. If the wallet offers a denser QR code, show that one instead\.$/,
    );
    // The scan is over: the next code is not read, and the reason stays.
    await tick();
    await tick();
    expect(onScan).not.toHaveBeenCalled();
    expect(assembleCalls).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent(/more parts than Gerfaut can read/);
  });

  /** A fountain code never runs out of new frames: once the core says
      the scan took more than a code of its size needs, the scan stops,
      camera off, and the reason stays on screen while new frames keep
      passing in front of the camera. */
  it("stops for good once the core says the code is too large", async () => {
    for (let i = 0; i < 8; i += 1) frames.push(`ur:crypto-output/${i + 3}-2/x${i}`);
    mockAssembly((received) =>
      received.length < 3
        ? { format: "ur", received: 1, total: 2, complete: false, text: null, warnings: [] }
        : (Promise.reject({
            kind: "too_many_parts",
            message: "3 frames were scanned without the code coming together, more than Gerfaut reads.",
          }) as unknown as QrProgress),
    );
    const track = fakeCamera();
    render(<ScanQrModal open onClose={vi.fn()} onScan={vi.fn()} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    for (let i = 0; i < 8; i += 1) await tick();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /^This code has more parts than Gerfaut can read\. If the wallet offers a denser QR code, show that one instead\.$/,
    );
    expect(assembleCalls).toHaveLength(3);
    expect(track.stop).toHaveBeenCalled();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    // The scan is let go with the camera.
    await waitFor(() => expect(closed).toEqual([1]));
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
        : { format: "plain", received: 1, total: 1, complete: true, text: received[0], warnings: [] },
    );
    const onScan = vi.fn();
    render(<ScanQrModal open onClose={vi.fn()} onScan={onScan} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());

    await tick();
    expect(await screen.findByRole("alert")).toHaveTextContent(/holds a PSBT/);
    await tick();
    await tick();
    await tick();
    await waitFor(() => expect(onScan).toHaveBeenCalledWith("wpkh(tpub.../0/*)", []));
    // The refused frame is sent once more, to a fresh scan, before it is
    // barred; then one answer: the further sightings were dropped
    // without going back to the core for the same verdict.
    expect(assembleCalls).toEqual([["B$HP0100ff"], ["B$HP0100ff"], ["wpkh(tpub.../0/*)"]]);
  });

  /** One push at a time, the second try of a lone frame included: a
      part seen while it is out waits, and goes after it. */
  it("never pushes two frames at once, a second try included", async () => {
    frames.push("ur:bytes/1-2/a", "ur:bytes/2-2/b");
    let inFlight = 0;
    let most = 0;
    let lost = true;
    const answers: (() => void)[] = [];
    mockIPC((cmd) => {
      if (cmd === "open_qr_scan") return (opened += 1);
      if (cmd === "close_qr_scan") return null;
      inFlight += 1;
      most = Math.max(most, inFlight);
      if (lost) {
        lost = false;
        inFlight -= 1;
        return Promise.reject({ kind: "invalid_input", message: "this scan was closed" });
      }
      return new Promise((resolve) => {
        answers.push(() => {
          inFlight -= 1;
          resolve({ format: "ur", received: 1, total: 2, complete: false, text: null, warnings: [] });
        });
      });
    });
    render(<ScanQrModal open onClose={vi.fn()} onScan={vi.fn()} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    await tick();
    await waitFor(() => expect(answers).toHaveLength(1));
    // The second part is seen while the second try of the first is out.
    await tick();
    expect(answers).toHaveLength(1);
    answers[0]();
    await waitFor(() => expect(answers).toHaveLength(2));
    answers[1]();
    expect(most).toBe(1);
  });

  /** A scan the core no longer holds (more scans were opened than it
      keeps) refuses the frame sent to it: the modal opens a fresh one
      and sends the frame again, instead of barring a good code. */
  it("opens a fresh scan when the core lost the one it held", async () => {
    frames.push("wpkh(tpub.../0/*)");
    let lost = true;
    mockAssembly((received) => {
      if (lost) {
        lost = false;
        return Promise.reject({
          kind: "invalid_input",
          message: "This scan was closed. Open the scanner again.",
        }) as unknown as QrProgress;
      }
      return { format: "plain", received: 1, total: 1, complete: true, text: received[0], warnings: [] };
    });
    const onScan = vi.fn();
    render(<ScanQrModal open onClose={vi.fn()} onScan={onScan} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    await tick();
    await waitFor(() => expect(onScan).toHaveBeenCalledWith("wpkh(tpub.../0/*)", []));
    expect(opened).toBe(2);
    expect(closed).toContain(1);
  });

  it("a refusal takes down the count it had filled in", async () => {
    frames.push("ur:crypto-output/1-3/aaaa", "ur:crypto-output/2-3/bbbb", "B$HP0100ff");
    mockAssembly((received) =>
      received.at(-1)?.startsWith("B$")
        ? (Promise.reject({
            kind: "invalid_input",
            message: "this QR code holds a PSBT, not a wallet to watch",
          }) as unknown as QrProgress)
        : { format: "ur", received: received.length, total: 3, complete: false, text: null, warnings: [] },
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
      warnings: [],
    }));
    const onScan = vi.fn();
    const onClose = vi.fn();
    render(<ScanQrModal open onClose={onClose} onScan={onScan} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    await tick();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This code came through empty. Export it again from the wallet.",
    );
    // Closing on it would drop the caller back on a page holding an
    // empty string, which is the silent stall this scanner had.
    expect(onScan).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a refusal that lands after the scanner closed belongs to the scan it came from", async () => {
    let refuse: (reason: unknown) => void = () => {};
    mockIPC((cmd) => {
      if (cmd === "open_qr_scan") return (opened += 1);
      if (cmd === "close_qr_scan") return null;
      if (cmd !== "push_qr_frame") throw new Error(`unexpected command ${cmd}`);
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
    // Each opening had a scan of its own.
    expect(opened).toBe(2);
  });

  it("lets the scan go when the scanner closes before an answer", async () => {
    frames.push("ur:crypto-output/1-3/aaaa");
    mockAssembly(() => ({ format: "ur", received: 1, total: 3, complete: false, text: null, warnings: [] }));
    const { rerender } = render(<ScanQrModal open onClose={vi.fn()} onScan={vi.fn()} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    await tick();
    expect(await screen.findByText("1 / 3")).toBeInTheDocument();
    expect(closed).toEqual([]);

    rerender(<ScanQrModal open={false} onClose={vi.fn()} onScan={vi.fn()} />);
    await waitFor(() => expect(closed).toEqual([1]));
  });
});
