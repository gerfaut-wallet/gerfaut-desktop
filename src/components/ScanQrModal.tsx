import jsQR from "jsqr";
import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";

type ScanState = "starting" | "scanning" | "denied" | "unavailable";

/** Camera QR scanner: frames are decoded locally with jsQR, nothing
    leaves the machine. The stream stops the moment the modal closes. */
export function ScanQrModal({
  open,
  onClose,
  onScan,
}: {
  open: boolean;
  onClose: () => void;
  /** Called once with the decoded text; the modal closes itself. */
  onScan: (text: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<ScanState>("starting");

  // Callback identity must not restart the camera.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    setState("starting");
    let stream: MediaStream | null = null;
    let raf = 0;
    let lastDecode = 0;
    let done = false;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

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
          done = true;
          onScanRef.current(code.data.trim());
          onCloseRef.current();
          return;
        }
      }
      raf = requestAnimationFrame(tick);
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
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [open]);

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
        </div>
        <p className="font-ui text-xs text-muted">
          Point the camera at a descriptor, extended public key, or address QR
          code. Frames are decoded on this machine and never leave it.
        </p>
      </div>
    </Modal>
  );
}
