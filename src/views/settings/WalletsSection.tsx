import {
  Check,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Pencil,
  ScanSearch,
  Trash2,
  Wallet as WalletIcon,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { clsx } from "clsx";
import { Button, IconButton } from "../../components/Button";
import { CoverageBadge } from "../../components/CoverageBadge";
import { DropLine, useDragReorder } from "../../components/DragReorder";
import { Notice } from "../../components/Notice";
import { isCommandError } from "../../lib/ipc";
import type { PremiumState, WalletMeta, WalletWatch } from "../../lib/ipc";
import { moveItem } from "../../lib/reorder";
import { premiumFailure } from "../../lib/premium";
import { walletGlyph } from "../../lib/walletIcons";
import { coverageOf, useLiveStatus } from "../../state/live";
import { usePremiumWallets } from "../../state/premiumQueries";
import {
  useRemoveWallet,
  useRenameWallet,
  useRescanWallet,
  useSetGapLimit,
  useSetWalletIcon,
  useSetWalletLivePinned,
} from "../../state/queries";
import { useUi } from "../../state/store";
import { useWalletOrder } from "../../state/walletOrder";
import { IdentityModal } from "./premium/IdentityModal";
import { SaveFailure, SectionCard, SettingRow, Toggle } from "./primitives";
import { WalletIconPicker } from "./WalletIconPicker";

/** Numeric gap-limit field: commits on blur or Enter, clamped to what
    the backend accepts, shared by every wallet. A value the vault
    refused goes back to the one it holds. */
function GapLimitField({
  gapLimit,
  onFailure,
}: {
  gapLimit: number;
  onFailure: (error: unknown) => void;
}) {
  const { showToast } = useUi();
  const setGapLimit = useSetGapLimit();
  const [draft, setDraft] = useState(String(gapLimit));

  // Follow external changes (another commit, a vault reload).
  useEffect(() => setDraft(String(gapLimit)), [gapLimit]);

  const commit = () => {
    const value = Number.parseInt(draft, 10);
    if (Number.isNaN(value) || value < 1 || value > 500) {
      setDraft(String(gapLimit));
      return;
    }
    if (value === gapLimit) return;
    onFailure(null);
    void setGapLimit.mutateAsync(value).then(
      () => showToast("Setting saved"),
      (error) => {
        setDraft(String(gapLimit));
        onFailure(error);
      },
    );
  };

  return (
    <input
      id="gap-limit"
      value={draft}
      onChange={(event) => setDraft(event.target.value.replace(/\D/g, ""))}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
      inputMode="numeric"
      aria-label="Gap limit"
      className="field-focus selectable h-11 w-24 rounded-sm border border-transparent bg-sunken px-3 text-right font-data text-[13px] text-text"
    />
  );
}

/** Where a refused gap limit is said, among the rows' wallet ids. */
const GAP_LIMIT = "gap-limit";

/** Whether removing a wallet also ends the server's watch of it. The
    core queues the unwatch when a key is set and the wallet was agreed
    to, so that is the rule read here; the server's own list, when the
    Premium section already fetched it, narrows the answer — a wallet
    switched off there was agreed to once and is watched no more. */
function watchedByServer(
  premium: PremiumState,
  server: WalletWatch[] | undefined,
  id: string,
): boolean {
  if (premium.key === null || !premium.watched.some((wallet) => wallet.wallet_id === id)) {
    return false;
  }
  return server === undefined || server.some((wallet) => wallet.id === id);
}

/** Whether removing a wallet takes the app lock's secret: the rule the
    Rust side holds to, a key set and the wallet agreed to. Ending the
    server's watch by removing the wallet must not be the way around the
    secret that unwatching it asks for. */
function removalNeedsIdentity(premium: PremiumState, id: string): boolean {
  return premium.key !== null && premium.watched.some((wallet) => wallet.wallet_id === id);
}

/** The shared gap limit, then every wallet of the shown network in the
    order it is listed everywhere, with what can be done to it: move,
    change its icon, rescan, rename, remove. */
export function WalletsSection({
  wallets,
  gapLimit,
  premium,
}: {
  wallets: WalletMeta[];
  gapLimit: number;
  /** The account as the vault keeps it: enough to know, with no
      network, which removal the server will hear about. */
  premium: PremiumState;
}) {
  const { showToast, syncErrors } = useUi();
  const removeWallet = useRemoveWallet();
  // What the server said it watches, if the Premium section asked it
  // this session. Read from the cache only: this section asks nothing.
  const server = usePremiumWallets(false);
  const renameWallet = useRenameWallet();
  const setIcon = useSetWalletIcon();
  const rescan = useRescanWallet();
  const { shown, reorder } = useWalletOrder(wallets);
  const drag = useDragReorder(shown, reorder);
  // How much of each wallet the live watch hears: a badge on the rows
  // only while it is short of room.
  const live = useLiveStatus();
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  /** The removal whose yes was given and waits for the secret. */
  const [identity, setIdentity] = useState<string | null>(null);
  /** What a removal left behind, under its row. */
  const [removeFailure, setRemoveFailure] = useState<{ id: string; error: unknown } | null>(
    null,
  );
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [rescanning, setRescanning] = useState<string | null>(null);
  /** A change the vault refused, under the row it was for: the gap
      limit's, or a wallet's name or icon. */
  const [saveFailure, setSaveFailure] = useState<{ id: string; error: unknown } | null>(null);
  const failureOf = (id: string) => (saveFailure?.id === id ? saveFailure.error : null);
  // One wallet has no order to speak of.
  const movable = shown.length > 1;

  const commitRename = () => {
    if (!renaming || renaming.name.trim().length === 0) return;
    const { id } = renaming;
    setSaveFailure(null);
    // Refused, the field stays open on the name typed.
    void renameWallet.mutateAsync({ id, name: renaming.name.trim() }).then(
      () => {
        setRenaming(null);
        showToast("Setting saved");
      },
      (error) => setSaveFailure({ id, error }),
    );
  };

  return (
    <SectionCard
      icon={<WalletIcon size={18} strokeWidth={1.5} />}
      title="Wallets"
    >
      <div className="mb-4 border-b border-border pb-4">
        <SettingRow
          title="Gap limit"
          hint="How many unused addresses Gerfaut scans past the last used one. Rescan a wallet to look again from its first address."
        >
          <GapLimitField
            gapLimit={gapLimit}
            onFailure={(error) => setSaveFailure(error === null ? null : { id: GAP_LIMIT, error })}
          />
        </SettingRow>
        <SaveFailure error={failureOf(GAP_LIMIT)} />
      </div>
      {shown.length === 0 ? (
        <p className="font-ui text-sm text-muted">No wallets on this network yet.</p>
      ) : (
        // The line lives beside the list, not in it: a list holds items only.
        <div className="relative">
          <ul ref={drag.listRef} className="flex flex-col gap-2">
            {shown.map((wallet, index) => {
              const single = wallet.kind.type === "single_address";
              const Glyph = walletGlyph(wallet.icon);
              const coverage = coverageOf(live.data?.status, wallet.id);
              const dragging = drag.dragging === index;
              const first = index === 0;
              const last = index === shown.length - 1;
              return (
                <li
                  key={wallet.id}
                  {...drag.rowProps(index)}
                  className={clsx(
                    // The grip's glyph then starts where a row without one starts.
                    "group rounded-md border border-border bg-surface py-3 pr-4",
                    movable ? "pl-1" : "pl-4",
                    dragging && "relative z-10 opacity-80",
                  )}
                >
                  {/* The name takes the room there is, and the actions go
                      under it when the row is too narrow for both: a row
                      that squeezed the name to nothing named nothing. */}
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span className="flex min-w-0 flex-[1_1_10rem] items-center gap-2.5">
                      {movable && (
                        <span
                          aria-hidden
                          title="Drag to reorder"
                          {...drag.handleProps(index)}
                          className={clsx(
                            "inline-flex size-10 shrink-0 items-center justify-center rounded-sm text-muted",
                            "transition-colors duration-150 hover:text-text",
                            dragging ? "cursor-grabbing" : "cursor-grab",
                          )}
                        >
                          <GripVertical size={16} strokeWidth={1.5} />
                        </span>
                      )}
                      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-sunken text-text">
                        <Glyph size={16} strokeWidth={1.5} aria-hidden />
                      </span>
                      {renaming?.id === wallet.id ? (
                        <span className="flex items-center gap-1.5">
                          <input
                            autoFocus
                            value={renaming.name}
                            onChange={(event) =>
                              setRenaming({ id: wallet.id, name: event.target.value })
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") commitRename();
                              if (event.key === "Escape") setRenaming(null);
                            }}
                            className="field-focus h-9 w-56 rounded-sm border border-transparent bg-sunken px-2 font-ui text-sm text-text"
                            aria-label="Wallet name"
                          />
                          <IconButton
                            label="Save name"
                            className="size-9 text-primary"
                            onClick={commitRename}
                          >
                            <Check size={16} strokeWidth={2} aria-hidden />
                          </IconButton>
                          <IconButton
                            label="Cancel renaming"
                            className="size-9"
                            onClick={() => setRenaming(null)}
                          >
                            <X size={16} strokeWidth={1.5} aria-hidden />
                          </IconButton>
                        </span>
                      ) : (
                        <span className="flex min-w-0 flex-col">
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              title={wallet.name}
                              className="truncate font-ui text-sm font-medium text-text"
                            >
                              {wallet.name}
                            </span>
                            {coverage && <CoverageBadge coverage={coverage} />}
                          </span>
                          <span className="truncate font-ui text-xs text-muted">
                            {single ? "Single address" : "Descriptor wallet"}
                          </span>
                        </span>
                      )}
                    </span>
                    {renaming?.id !== wallet.id && confirmRemove !== wallet.id && (
                      <span className="ml-auto flex shrink-0 flex-wrap items-center gap-1">
                        {movable && (
                          <>
                            <MoveButton
                              label="Move up"
                              blocked={first}
                              onClick={() => reorder(moveItem(shown, index, index - 1))}
                            >
                              <ChevronUp size={16} strokeWidth={1.5} aria-hidden />
                            </MoveButton>
                            <MoveButton
                              label="Move down"
                              blocked={last}
                              onClick={() => reorder(moveItem(shown, index, index + 1))}
                            >
                              <ChevronDown size={16} strokeWidth={1.5} aria-hidden />
                            </MoveButton>
                          </>
                        )}
                        <WalletIconPicker
                          name={wallet.name}
                          value={wallet.icon}
                          disabled={rescanning !== null}
                          onChoose={(icon) => {
                            setSaveFailure(null);
                            void setIcon.mutateAsync({ id: wallet.id, icon }).then(
                              () => showToast("Icon changed"),
                              (error) => setSaveFailure({ id: wallet.id, error }),
                            );
                          }}
                        />
                        <Button
                          variant="ghost"
                          className="h-9"
                          disabled={rescanning !== null}
                          onClick={() => {
                            setRescanning(wallet.id);
                            void rescan
                              .mutateAsync(wallet.id)
                              .catch(() => undefined)
                              .finally(() => setRescanning(null));
                          }}
                        >
                          <ScanSearch size={14} strokeWidth={1.5} aria-hidden />
                          {rescanning === wallet.id ? "Rescanning…" : "Rescan"}
                        </Button>
                        <Button
                          variant="ghost"
                          className="h-9"
                          disabled={rescanning !== null}
                          onClick={() => {
                            setConfirmRemove(null);
                            setRenaming({ id: wallet.id, name: wallet.name });
                          }}
                        >
                          <Pencil size={14} strokeWidth={1.5} aria-hidden />
                          Rename
                        </Button>
                        {/* Neutral here: red belongs to the confirmation
                            step, on its yes below, never to a lone remove
                            button. */}
                        <Button
                          variant="ghost"
                          className="h-9"
                          disabled={rescanning !== null}
                          onClick={() => {
                            setRenaming(null);
                            setConfirmRemove(wallet.id);
                          }}
                        >
                          <Trash2 size={14} strokeWidth={1.5} aria-hidden />
                          Remove
                        </Button>
                      </span>
                    )}
                  </div>
                  {syncErrors[wallet.id] && (
                    <p className="mt-2 font-ui text-xs text-muted">
                      {syncErrors[wallet.id]}
                    </p>
                  )}
                  <SaveFailure error={failureOf(wallet.id)} />
                  {confirmRemove === wallet.id && (
                    <Notice
                      tone="info"
                      className="mt-3"
                      // Cancel first, the destructive yes last: the way
                      // out comes before the way through, here as on
                      // the mobile.
                      action={<span className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          className="h-9 hover:bg-surface hover:shadow-[inset_0_0_0_1px_var(--color-border)] dark:hover:bg-sunken dark:hover:shadow-none"
                          onClick={() => setConfirmRemove(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="danger"
                          className="h-9"
                          disabled={removeWallet.isPending}
                          aria-busy={removeWallet.isPending || undefined}
                          onClick={() => {
                            setRemoveFailure(null);
                            if (removalNeedsIdentity(premium, wallet.id)) {
                              setIdentity(wallet.id);
                              return;
                            }
                            removeWallet.mutate(
                              { id: wallet.id },
                              {
                                onSuccess: () => {
                                  setConfirmRemove(null);
                                  showToast("Wallet removed");
                                },
                                onError: (error) => setRemoveFailure({ id: wallet.id, error }),
                              },
                            );
                          }}
                        >
                          Remove wallet
                        </Button>
                      </span>}
                    >
                      Removing "{wallet.name}" deletes its labels and cached
                      history from Gerfaut, and cannot be undone. It only stops
                      watching: nothing moves on chain.
                      {/* The terms promise it, the server cascades it: the
                          alert history goes with the wallet. Said here,
                          where the decision is made. */}
                      {watchedByServer(premium, server.data, wallet.id) &&
                        " The server stops watching it too, and deletes its alert history."}
                    </Notice>
                  )}
                  {confirmRemove === wallet.id && removeFailure?.id === wallet.id && (
                    <p role="alert" className="mt-2 font-ui text-xs text-muted">
                      {premiumFailure(removeFailure.error).message}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <DropLine y={drag.lineY} />
        </div>
      )}
      {shown.length > 0 && <LivePins wallets={shown} />}
      {identity !== null && (
        <IdentityModal
          action="Remove wallet"
          busyLabel="Removing…"
          tone="danger"
          run={(secret) => removeWallet.mutateAsync({ id: identity, secret })}
          onDone={() => {
            setIdentity(null);
            setConfirmRemove(null);
            showToast("Wallet removed");
          }}
          onFailure={(error) => {
            setRemoveFailure({ id: identity, error });
            setIdentity(null);
          }}
          onCancel={() => setIdentity(null)}
        />
      )}
    </SectionCard>
  );
}

/** "Always watch live first": an advanced setting, folded away. When
    the live watch cannot follow every address, it serves the pinned
    wallets before the others, then the ones holding coins. Pinning many
    large wallets can leave the rest to the syncs, which is the user's
    call to make, and why the switch is out of the way. */
function LivePins({ wallets }: { wallets: WalletMeta[] }) {
  const { showToast } = useUi();
  const pin = useSetWalletLivePinned();
  const [open, setOpen] = useState(false);
  /** What the vault refused, under the wallet it was for. */
  const [failure, setFailure] = useState<{ id: string; error: unknown } | null>(null);
  const pinned = wallets.filter((wallet) => wallet.live_pinned === true).length;

  return (
    <div className="mt-4 border-t border-border pt-3">
      <Button
        variant="ghost"
        className="-ml-2 h-9 px-2"
        aria-expanded={open}
        aria-controls="live-pins"
        onClick={() => setOpen(!open)}
      >
        {open ? (
          <ChevronUp size={14} strokeWidth={1.5} aria-hidden />
        ) : (
          <ChevronDown size={14} strokeWidth={1.5} aria-hidden />
        )}
        Advanced
        {/* A space for the name read out; the gap already draws one. */}
        {!open && pinned > 0 && " "}
        {!open && pinned > 0 && (
          <span className="font-normal">
            · {pinned === 1 ? "1 wallet" : `${pinned} wallets`} watched live first
          </span>
        )}
      </Button>
      {open && (
        <div id="live-pins" className="mt-2">
          <p className="font-ui text-sm font-medium text-text">Always watch live first</p>
          <p id="live-pins-hint" className="mt-0.5 max-w-xl font-ui text-xs text-muted">
            When the live watch cannot follow every address, the wallets turned on here are
            followed first.
          </p>
          <ul className="mt-2 flex flex-col divide-y divide-border">
            {wallets.map((wallet) => {
              const Glyph = walletGlyph(wallet.icon);
              return (
                <li key={wallet.id} className="py-1.5">
                  <div className="flex min-h-11 items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-sunken text-text">
                        <Glyph size={16} strokeWidth={1.5} aria-hidden />
                      </span>
                      <span className="truncate font-ui text-sm text-text">{wallet.name}</span>
                    </span>
                    <Toggle
                      checked={wallet.live_pinned === true}
                      label={`Always watch ${wallet.name} live first`}
                      describedBy="live-pins-hint"
                      busy={pin.isPending && pin.variables?.id === wallet.id}
                      disabled={pin.isPending && pin.variables?.id !== wallet.id}
                      onChange={(pinned) => {
                        setFailure(null);
                        pin.mutate(
                          { id: wallet.id, pinned },
                          {
                            onSuccess: () => showToast("Setting saved"),
                            onError: (error) => setFailure({ id: wallet.id, error }),
                          },
                        );
                      }}
                    />
                  </div>
                  {failure?.id === wallet.id && (
                    <p role="alert" className="mt-1 font-ui text-xs text-muted">
                      {isCommandError(failure.error) ? failure.error.message : String(failure.error)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The keyboard's way of moving a row: shown when the row is hovered
    or holds the focus, dimmed at the end it cannot pass. It stays
    focusable there, so the focus is not dropped on the floor when a
    row reaches the top or the bottom. */
function MoveButton({
  label,
  blocked,
  onClick,
  children,
}: {
  label: string;
  blocked: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-disabled={blocked || undefined}
      onClick={blocked ? undefined : onClick}
      className={clsx(
        "inline-flex size-10 items-center justify-center rounded-md",
        "opacity-0 transition-[color,background-color,opacity] duration-150 ease-out",
        "focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100",
        blocked
          ? "cursor-default text-muted/40"
          : "cursor-pointer text-muted hover:bg-sunken hover:text-text active:scale-[0.96]",
      )}
    >
      {children}
    </button>
  );
}
