import { AlertTriangle, Check, Copy, RotateCcw, SkipForward } from "lucide-react";
import { useEffect, useState } from "react";
import { renderSVG } from "uqr";
import { Button } from "../components/Button";
import { useReceiveAddresses, useSnapshot } from "../state/queries";
import { useUi } from "../state/store";

/** Receive page: the QR of the next unused address, the address in
    full, copy with explicit feedback, and a way to skip to the next
    unused index. Single-address wallets show their one address. */
export function ReceiveView({ walletId }: { walletId: string }) {
  const { showToast } = useUi();
  const snapshot = useSnapshot(walletId);
  // Skipping peeks further down the derivation path; nothing is
  // retired, and a restart returns to the first unused address.
  const [offset, setOffset] = useState(0);
  const addresses = useReceiveAddresses(walletId, offset);
  const [copied, setCopied] = useState(false);

  // A wallet switch resets the peek: offsets are not comparable.
  useEffect(() => setOffset(0), [walletId]);

  const singleAddress = snapshot.data?.meta.kind.type === "single_address";
  const gapLimit = snapshot.data?.meta.gap_limit ?? 20;
  const entry = addresses.data?.[Math.min(offset, (addresses.data?.length ?? 1) - 1)];

  const copy = async () => {
    if (!entry) return;
    await navigator.clipboard.writeText(entry.address);
    setCopied(true);
    showToast("Copied");
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mx-auto max-w-[880px] pb-8">
      <header className="px-1 pb-5 pt-2">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.01em] text-text">
          Receive
        </h1>
        <p className="mt-1 font-ui text-sm text-muted">
          {singleAddress
            ? "The address this wallet watches."
            : "Share an address to receive bitcoin into this wallet."}
        </p>
      </header>

      {addresses.isPending && (
        <p className="px-1 font-ui text-sm text-muted">Deriving address…</p>
      )}
      {addresses.isError && (
        <p className="px-1 font-ui text-sm text-muted">
          The receive address could not be derived.
        </p>
      )}

      {entry && (
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border bg-surface p-6">
            <div className="flex flex-col items-center gap-6 lg:flex-row lg:items-stretch lg:gap-8">
              {/* A QR code stays dark-on-light in every theme: scanners
                  expect it, and inverting hurts contrast for cameras. */}
              <div className="flex shrink-0 items-center justify-center">
                <div
                  aria-label="Address QR code"
                  role="img"
                  className="w-[264px] rounded-lg border border-border bg-white p-4 [&_svg]:block [&_svg]:h-full [&_svg]:w-full"
                  dangerouslySetInnerHTML={{
                    __html: renderSVG(entry.address, { border: 0, blackColor: "#0d1317" }),
                  }}
                />
              </div>

              <div className="flex min-w-0 flex-1 flex-col justify-center gap-4">
                <div>
                  <p className="mb-1.5 font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
                    {singleAddress
                      ? "Watched address"
                      : offset === 0
                        ? `Next unused address · index ${entry.index}`
                        : `Unused address · index ${entry.index}`}
                  </p>
                  <p className="selectable break-all rounded-sm bg-sunken p-4 font-data text-[15px] leading-relaxed text-text">
                    {entry.address}
                  </p>
                </div>

                {!singleAddress && offset >= gapLimit && (
                  <div className="flex items-start gap-2 rounded-md bg-pending-surface p-3">
                    <AlertTriangle
                      size={15}
                      strokeWidth={1.75}
                      aria-hidden
                      className="mt-0.5 shrink-0 text-pending"
                    />
                    <p className="font-ui text-xs text-pending">
                      This is {offset} addresses past the next unused one — beyond
                      the gap limit of {gapLimit}, other wallet software may not
                      detect funds received here.
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary" onClick={() => void copy()}>
                    {copied ? (
                      <Check size={16} strokeWidth={1.5} aria-hidden />
                    ) : (
                      <Copy size={16} strokeWidth={1.5} aria-hidden />
                    )}
                    {copied ? "Copied" : "Copy address"}
                  </Button>
                  {!singleAddress && (
                    <>
                      <Button variant="secondary" onClick={() => setOffset(offset + 1)}>
                        <SkipForward size={15} strokeWidth={1.5} aria-hidden />
                        Next address
                      </Button>
                      {offset > 0 && (
                        <Button variant="ghost" onClick={() => setOffset(0)}>
                          <RotateCcw size={14} strokeWidth={1.5} aria-hidden />
                          First unused
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2.5 rounded-md border border-alert/25 bg-alert-surface p-4">
            <AlertTriangle
              size={16}
              strokeWidth={1.75}
              aria-hidden
              className="mt-0.5 shrink-0 text-alert"
            />
            <div>
              <p className="font-ui text-sm font-medium text-alert">
                Verify this address on your signing device before sharing it.
              </p>
              <p className="mt-0.5 font-ui text-xs text-muted">
                Gerfaut only watches: it never holds the keys behind it.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
