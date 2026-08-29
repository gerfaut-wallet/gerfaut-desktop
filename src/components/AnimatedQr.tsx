import { useEffect, useState } from "react";
import { renderSVG } from "uqr";

/** How long each frame of an animated code stays on screen. */
export const FRAME_MS = 200;

/** A code that may take several frames: they loop until the screen is
    left, and the other device may join at any of them. One frame shows
    a still code, with no counter to read. */
export function AnimatedQr({ frames, size = 320 }: { frames: string[]; size?: number }) {
  const [index, setIndex] = useState(0);
  const animated = frames.length > 1;

  useEffect(() => {
    if (!animated) return;
    setIndex(0);
    const timer = setInterval(
      () => setIndex((current) => (current + 1) % frames.length),
      FRAME_MS,
    );
    return () => clearInterval(timer);
  }, [animated, frames]);

  // Bytewords read the same in either case, and uppercase lets the
  // encoder use the alphanumeric mode: fewer modules for the same
  // frame, which a camera catches sooner.
  const svg = renderSVG(frames[index].toUpperCase(), {
    border: 0,
    blackColor: "#0d1317",
    // The lowest correction keeps a dense frame readable: fewer
    // modules, each of them larger on the screen.
    ecc: "L",
  });

  return (
    <div className="flex flex-col items-center gap-3">
      {/* A QR code is data, not chrome: dark on light in both themes,
          the way the receive page draws it. */}
      <div
        className="rounded-lg bg-white p-4"
        style={{ width: size, height: size }}
        role="img"
        aria-label={
          animated
            ? `Backup QR code, frame ${index + 1} of ${frames.length}`
            : "Backup QR code"
        }
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <p className="font-ui text-xs text-muted">
        Scan it with Gerfaut on the other device
      </p>
      {animated && (
        <p className="tabular font-ui text-xs text-muted">
          {index + 1} / {frames.length}
        </p>
      )}
    </div>
  );
}
