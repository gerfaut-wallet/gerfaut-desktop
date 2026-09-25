import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Maximize2,
  RotateCcw,
  SkipForward,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { renderSVG } from "uqr";
import { AddressChip } from "../components/AddressChip";
import { StackedAmount } from "../components/Amount";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { Notice } from "../components/Notice";
import type { AddressEntry, AddressRow } from "../lib/ipc";
import { useAddressList, useReceiveAddresses, useSnapshot } from "../state/queries";
import { useUi } from "../state/store";

/** Rows each keychain shows before "Show all". */
const FOLDED_ROWS = 5;

/** How many upcoming addresses the core hands out past the next unused
    one, at most. It skips the ones a payment already reached, so the
    200th is often further than 200 indexes away. */
const MAX_LOOKAHEAD = 200;

/** How many unused addresses come right before the one at `position`,
    back to the last used one. The core leaves out an address a payment
    already reached, so a jump between two indexes is a used address,
    and the count starts again after it. Everything before the next
    unused address is used. */
export function unusedBefore(entries: AddressEntry[], position: number): number {
  let start = entries[0].index;
  for (let k = 1; k <= position; k += 1) {
    if (entries[k].index !== entries[k - 1].index + 1) start = entries[k].index;
  }
  return entries[position].index - start;
}

/** Receive page: the next unused address first (QR, the address in
    full, copy, skip), then the audit of every revealed address, one
    card per keychain, folded to a few rows. Single-address wallets
    show their one address and its one row. */
export function ReceiveView({ walletId }: { walletId: string }) {
  const { showToast } = useUi();
  const snapshot = useSnapshot(walletId);
  // Skipping peeks further down the derivation path; nothing is
  // retired, and a restart returns to the first unused address.
  const [offset, setOffset] = useState(0);
  // One more than the one shown, so the page knows whether there is a
  // next one before "Next address" is pressed.
  const addresses = useReceiveAddresses(walletId, Math.min(offset + 1, MAX_LOOKAHEAD));
  const list = useAddressList(walletId);
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  // A wallet switch resets the peek: offsets are not comparable.
  useEffect(() => setOffset(0), [walletId]);

  const entries = addresses.data ?? [];
  // The list the core answered, not the one kept on screen while it
  // was asked: only that one says where the upcoming addresses end.
  const settled = addresses.data !== undefined && !addresses.isPlaceholderData;
  const position = Math.min(offset, entries.length - 1);
  const entry = entries[position];
  const hasNext = settled ? entries.length > offset + 1 : offset < MAX_LOOKAHEAD;

  // A sync that found a payment shortens the list under the page: the
  // peek comes back to the last address still offered.
  useEffect(() => {
    if (settled && entries.length > 0 && offset > entries.length - 1) {
      setOffset(entries.length - 1);
    }
  }, [settled, entries.length, offset]);

  const singleAddress = snapshot.data?.meta.kind.type === "single_address";
  const gapLimit = snapshot.data?.meta.gap_limit ?? 20;
  const gap = entry ? unusedBefore(entries, position) : 0;

  const copy = async () => {
    if (!entry) return;
    await navigator.clipboard.writeText(entry.address);
    setCopied(true);
    showToast("Copied");
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="pb-8">
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

      <div className="flex flex-col gap-4">
        {entry && (
          <>
            <div className="rounded-lg border border-border bg-surface p-5">
              <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-stretch sm:gap-6">
                {/* A QR code stays dark-on-light in every theme: scanners
                    expect it, and inverting hurts contrast for cameras.
                    Small here, full size on click. */}
                <button
                  type="button"
                  onClick={() => setQrOpen(true)}
                  aria-label="Enlarge the address QR code"
                  className="group relative shrink-0 cursor-zoom-in self-center rounded-lg border border-border bg-white p-2.5 transition-shadow duration-150 hover:shadow-[0_0_0_2px_var(--color-primary)] focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-primary)]"
                >
                  <div
                    aria-hidden
                    className="w-[132px] [&_svg]:block [&_svg]:h-full [&_svg]:w-full"
                    dangerouslySetInnerHTML={{
                      __html: renderSVG(entry.address, { border: 0, blackColor: "#0d1317" }),
                    }}
                  />
                  <span
                    aria-hidden
                    className="absolute bottom-1.5 right-1.5 inline-flex size-6 items-center justify-center rounded-md bg-white/90 text-[#0d1317] opacity-0 shadow-[0_1px_2px_rgba(13,19,23,0.25)] transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                  >
                    <Maximize2 size={13} strokeWidth={1.75} />
                  </span>
                </button>

                <div className="flex min-w-0 flex-1 flex-col justify-center gap-3">
                  <div>
                    <p className="mb-1.5 font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
                      {singleAddress
                        ? "Watched address"
                        : position === 0
                          ? `Next unused address · index ${entry.index}`
                          : `Unused address · index ${entry.index}`}
                    </p>
                    <p className="selectable break-all rounded-sm bg-sunken p-3.5 font-data text-[15px] leading-relaxed text-text">
                      {entry.address}
                    </p>
                    {entry.derivation && (
                      <p className="mt-1.5 flex items-baseline gap-2 px-0.5">
                        <span className="font-ui text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
                          Derivation path
                        </span>
                        <span className="selectable font-data text-[12px] text-text">
                          {entry.derivation}
                        </span>
                      </p>
                    )}
                  </div>

                  {/* A convention other software follows, not a risk to
                      funds or privacy: amber, and the info glyph. */}
                  {!singleAddress && gap >= gapLimit && (
                    <Notice tone="info">
                      {gap} unused addresses come before this one, beyond the gap
                      limit of {gapLimit}: other wallet software may not detect funds
                      received here.
                    </Notice>
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
                        <Button
                          variant="ghost"
                          disabled={!hasNext}
                          onClick={() => setOffset(position + 1)}
                        >
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
                  {/* Why "Next address" stopped: a hint, since nothing is
                      at stake. */}
                  {!singleAddress && settled && !hasNext && (
                    <p className="font-ui text-xs text-muted">
                      {entries.length === 1
                        ? "This descriptor has one address and no other to skip to."
                        : `Gerfaut looks ${MAX_LOOKAHEAD} unused addresses ahead and no further.`}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <Notice tone="alert">
              <span className="font-medium">
                Verify this address on your signing device before sharing it.
              </span>
              <span className="mt-0.5 block text-xs text-muted">
                Gerfaut only watches: it never holds the private keys behind it.
              </span>
            </Notice>

            <Modal open={qrOpen} onClose={() => setQrOpen(false)} title="Address QR code" centered>
              <div className="flex flex-col items-center gap-4">
                <div
                  role="img"
                  aria-label="Address QR code"
                  className="w-[360px] max-w-full rounded-lg border border-border bg-white p-5 [&_svg]:block [&_svg]:h-full [&_svg]:w-full"
                  dangerouslySetInnerHTML={{
                    __html: renderSVG(entry.address, { border: 0, blackColor: "#0d1317" }),
                  }}
                />
                <p className="selectable break-all text-center font-data text-[13px] text-text">
                  {entry.address}
                </p>
              </div>
            </Modal>
          </>
        )}

        {/* The audit of what was revealed so far, per keychain. */}
        {list.isPending && (
          <p className="px-1 font-ui text-sm text-muted">Loading addresses…</p>
        )}
        {list.isError && (
          <p className="px-1 font-ui text-sm text-muted">The addresses could not be loaded.</p>
        )}
        {list.data && (
          <>
            <AddressCard
              title={singleAddress ? "Watched address" : "External"}
              hint={
                singleAddress
                  ? "The one address this wallet watches."
                  : "Receive addresses, in derivation order."
              }
              rows={list.data.external}
            />
            {!singleAddress && (
              <AddressCard
                title="Change"
                hint="Internal addresses used by outgoing transactions."
                rows={list.data.internal}
                empty="No change addresses revealed yet."
              />
            )}
            {list.data.truncated && (
              <p className="px-1 font-ui text-xs text-muted">
                Long keychains are capped: only the first 200 addresses of each are listed.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** One keychain: its rows folded to a handful, with a count and a
    control to see them all. Its own card, never merged with the other
    keychain's. */
function AddressCard({
  title,
  hint,
  rows,
  empty,
}: {
  title: string;
  hint: string;
  rows: AddressRow[];
  empty?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, FOLDED_ROWS);
  const hidden = rows.length - shown.length;
  const used = rows.filter((row) => row.used).length;

  return (
    <section aria-label={title} className="overflow-clip rounded-lg border border-border bg-surface">
      <div className="flex items-baseline justify-between gap-3 px-4 pb-1 pt-3">
        <h2 className="flex items-baseline gap-2 font-ui text-sm font-semibold text-text">
          {title}
          {rows.length > 0 && (
            <span className="tabular rounded-full bg-sunken px-2 py-0.5 font-ui text-[11px] font-medium text-muted">
              {rows.length}
              {used > 0 && ` · ${used} used`}
            </span>
          )}
        </h2>
        <p className="font-ui text-xs text-muted">{hint}</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 pb-4 pt-1 font-ui text-sm text-muted">{empty ?? "Nothing here yet."}</p>
      ) : (
        <>
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr className="text-left [&>th]:border-b [&>th]:border-border [&>th]:bg-surface">
                <Th className="w-16">Index</Th>
                <Th>Address</Th>
                <Th className="w-24">Status</Th>
                <Th className="w-40 text-right">Balance</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr
                  key={row.index}
                  className="transition-colors duration-100 hover:bg-sunken/60 [&>td]:border-b [&>td]:border-border"
                >
                  <td className="tabular px-3 py-2 text-[13px] text-muted">{row.index}</td>
                  <td className="px-3 py-2">
                    <AddressChip value={row.address} head={16} tail={10} />
                  </td>
                  <td className="px-3 py-2">
                    <StatusChip used={row.used} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {row.balance_sats > 0 ? (
                      <StackedAmount sats={row.balance_sats} />
                    ) : (
                      <span className="font-ui text-[13px] text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > FOLDED_ROWS && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
              className="flex w-full cursor-pointer items-center justify-center gap-1.5 px-4 py-2.5 font-ui text-xs font-medium text-muted transition-colors duration-150 hover:bg-sunken/60 hover:text-text"
            >
              {expanded ? (
                <>
                  <ChevronUp size={14} strokeWidth={1.75} aria-hidden />
                  Show less
                </>
              ) : (
                <>
                  <ChevronDown size={14} strokeWidth={1.75} aria-hidden />
                  Show all {rows.length}
                  <span className="font-normal">({hidden} more)</span>
                </>
              )}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/** Whether an address has ever appeared on chain. Both states are read
    side by side down one column, so both are pills: Alerte for an
    address that must not be handed out again, Glacier for one still
    untouched. */
function StatusChip({ used }: { used: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 font-ui text-[11px] font-medium ${
        used
          ? "border-alert/25 bg-alert-surface text-alert dark:bg-alert/10"
          : "border-primary/25 bg-primary/10 text-primary dark:bg-primary/10"
      }`}
    >
      {used ? "Used" : "Fresh"}
    </span>
  );
}

function Th({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th
      className={`px-3 py-2 font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted ${className ?? ""}`}
    >
      {children}
    </th>
  );
}
