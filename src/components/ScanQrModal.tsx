import jsQR from "jsqr";
import { useEffect, useRef, useState } from "react";
import type { InputWarning, QrProgress } from "../lib/ipc";
import { ipc, isCommandError } from "../lib/ipc";
import { Modal } from "./Modal";

type ScanState = "starting" | "scanning" | "denied" | "unavailable";

/** A code with more parts than Gerfaut reads, the same words as on
    Android. */
const TOO_MANY_PARTS = "This code has more parts than Gerfaut can read.";

/** The most distinct frames one scan collects before the code says how
    many parts it has. Every new frame sends the whole collection to the
    core again, so an endless stream of distinct frames, which a
    fountain code is, would cost more at each one, and hold every frame
    it ever showed. */
export const MAX_SCAN_FRAMES = 2000;

/** The most distinct frames any scan collects. A camera that misses
    half of the frames of a fountain code needs about twice as many as
    the code has parts, and a large PSBT shown at low density runs to
    well over a thousand parts. */
export const MAX_SCAN_FRAMES_CEILING = 10000;

/** The frames a scan may collect once the code has announced `total`
    parts: three times as many, within the two bounds above. The same
    rule as on Android. */
export function scanFrameLimit(total: number | null): number {
  return Math.min(Math.max((total ?? 0) * 3, MAX_SCAN_FRAMES), MAX_SCAN_FRAMES_CEILING);
}

/** What the scanner says when the core turns down what it collected:
    a code with more parts than Gerfaut reads in a sentence of its own,
    the same as on Android, anything else in the core's words. */
function refusal(error: unknown): string {
  if (!isCommandError(error)) return String(error);
  return error.kind === "too_many_parts" ? TOO_MANY_PARTS : error.message;
}

/** Camera QR scanner: frames are decoded locally with jsQR, nothing
    leaves the machine. Animated codes (UR, BBQr) are assembled by the
    core frame after frame; the modal reports the progress and closes
    itself with the final text. The stream stops the moment it closes. */
export function ScanQrModal({
  open,
  onClose,
  onScan,
  caption,
}: {
  open: boolean;
  onClose: () => void;
  /** Called once with the assembled text, and what the core assumed
      reading the code; the modal closes itself. */
  onScan: (text: string, warnings: InputWarning[]) => void;
  /** What this scan expects to see. The wallet import and the backend
      settings both open this modal, and telling someone to point at a
      descriptor when they are holding their node's server QR is worse
      than saying nothing. */
  caption?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<ScanState>("starting");
  const [progress, setProgress] = useState<QrProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Callback identity must not restart the camera.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    setState("starting");
    setProgress(null);
    setError(null);
    let stream: MediaStream | null = null;
    let raf = 0;
    let lastDecode = 0;
    let done = false;
    let assembling = false;
    let pending: string | null = null;
    const frames: string[] = [];
    /** The parts the code announced, once the core has read one. */
    let total: number | null = null;
    const seen = new Set<string>();
    /** Frames the core has already turned down. */
    const refused = new Set<string>();
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    // The scan goes back to nothing and says why. The bar goes with it:
    // left standing it would show progress towards an assembly that no
    // longer exists. A lone frame at fault is barred from the next try,
    // since the camera sees the same code eight times a second and the
    // answer will not change; further along any of the frames could be
    // the bad one, so none of them is.
    const giveUp = (reason: string) => {
      setError(reason);
      setProgress(null);
      if (frames.length === 1) refused.add(frames[0]);
      frames.length = 0;
      total = null;
      seen.clear();
    };

    // One assembly at a time; a frame seen meanwhile waits its turn
    // rather than being lost until the animation loops back to it.
    const feed = async (frame: string) => {
      if (seen.has(frame) || refused.has(frame)) return;
      if (assembling) {
        pending = frame;
        return;
      }
      if (frames.length >= scanFrameLimit(total)) {
        giveUp(TOO_MANY_PARTS);
        return;
      }
      seen.add(frame);
      frames.push(frame);
      assembling = true;
      try {
        const result = await ipc.assembleQr(frames);
        if (done) return;
        total = result.total;
        setError(null);
        setProgress(result);
        if (result.complete) {
          if (result.text) {
            done = true;
            onScanRef.current(result.text, result.warnings);
            onCloseRef.current();
          } else {
            // Every part arrived and they add up to nothing. Closing on
            // that would hand the caller an empty string; saying it
            // keeps the camera on a code that may be readable elsewhere.
            giveUp("This code came out empty.");
          }
        }
      } catch (err) {
        // A frame the core refuses (a PSBT, an unknown envelope) is said
        // once and dropped: the camera keeps looking for the right code.
        // A refusal landing after the modal closed belongs to a scan the
        // user walked away from, and must not surface in the next one.
        if (done) return;
        giveUp(refusal(err));
      } finally {
        assembling = false;
      }
      if (pending !== null && !done) {
        const next = pending;
        pending = null;
        void feed(next);
      }
    };

    const tick = (now: number) => {
      const video = videoRef.current;
      if (video && context && video.readyState >= 2 && now - lastDecode > 120) {
        lastDecode = now;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0);
        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(image.data, image.width, image.height, {
          inversionAttempts: "dontInvert",
        });
        if (code && code.data.trim().length > 0 && !done) {
          void feed(code.data.trim());
        }
      }
      if (!done) raf = requestAnimationFrame(tick);
    };

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } } })
      .then((media) => {
        stream = media;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = media;
        void video.play();
        setState("scanning");
        raf = requestAnimationFrame(tick);
      })
      .catch((error: unknown) => {
        const name = error instanceof DOMException ? error.name : "";
        setState(name === "NotAllowedError" ? "denied" : "unavailable");
      });

    return () => {
      done = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [open]);

  const multiPart = progress !== null && progress.total > 1 && !progress.complete;

  return (
    <Modal open={open} onClose={onClose} title="Scan a QR code" width={480} z={60} centered>
      <div className="flex flex-col gap-3">
        <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-black">
          {/* The mirror is intentional: people aim faster with a mirrored
              preview, and decoding uses the unmirrored frames. */}
          <video
            ref={videoRef}
            muted
            playsInline
            className="h-full w-full -scale-x-100 object-cover"
          />
          {state === "scanning" && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 m-auto aspect-square w-3/5 rounded-lg border-2 border-white/70"
            />
          )}
          {state !== "scanning" && (
            <p className="absolute inset-0 flex items-center justify-center px-8 text-center font-ui text-sm text-white/80">
              {state === "starting" && "Starting the camera…"}
              {state === "denied" &&
                "Camera access was refused. Allow it for Gerfaut in the system settings, then try again."}
              {state === "unavailable" && "No usable camera was found on this machine."}
            </p>
          )}
          {multiPart && (
            <div
              role="progressbar"
              aria-label="Animated QR code"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.received}
              // Without it a progress bar is announced as a percentage,
              // and the count of frames is the whole point here.
              aria-valuetext={`${progress.received} of ${progress.total} frames received`}
              className="absolute inset-x-3 bottom-3 rounded-md bg-black/60 px-3 py-2 backdrop-blur-sm"
            >
              <div className="mb-1.5 flex items-baseline justify-between font-ui text-xs text-white">
                <span>Keep the camera on the animated code</span>
                <span className="tabular">
                  {progress.received} / {progress.total}
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-white/20">
                <div
                  className="h-full rounded-full bg-white transition-[width] duration-200"
                  style={{ width: `${(100 * progress.received) / progress.total}%` }}
                />
              </div>
            </div>
          )}
        </div>
        {error ? (
          <p role="alert" className="font-ui text-xs text-muted">
            {error}
          </p>
        ) : (
          <p className="font-ui text-xs text-muted">
            {caption ??
              "Point the camera at a descriptor, extended public key, or address QR code: plain text, UR, or BBQr, animated or not."}{" "}
            Frames are decoded on this machine and never leave it.
          </p>
        )}
      </div>
    </Modal>
  );
}
