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
import { DropLine, useDragReorder } from "../../components/DragReorder";
import { Notice } from "../../components/Notice";
import type { WalletMeta } from "../../lib/ipc";
import { moveItem } from "../../lib/reorder";
import { walletGlyph } from "../../lib/walletIcons";
import {
  useRemoveWallet,
  useRenameWallet,
  useRescanWallet,
  useSetGapLimit,
  useSetWalletIcon,
} from "../../state/queries";
import { useUi } from "../../state/store";
import { useWalletOrder } from "../../state/walletOrder";
import { SectionCard, SettingRow } from "./primitives";
import { WalletIconPicker } from "./WalletIconPicker";

/** Numeric gap-limit field: commits on blur or Enter, clamped to what
    the backend accepts, shared by every wallet. */
function GapLimitField({ gapLimit }: { gapLimit: number }) {
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
    void setGapLimit.mutateAsync(value).then(() => showToast("Setting saved"));
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

/** The shared gap limit, then every wallet of the shown network in the
    order it is listed everywhere, with what can be done to it: move,
    change its icon, rescan, rename, remove. */
export function WalletsSection({ wallets, gapLimit }: { wallets: WalletMeta[]; gapLimit: number }) {
  const { showToast, syncErrors } = useUi();
  const removeWallet = useRemoveWallet();
  const renameWallet = useRenameWallet();
  const setIcon = useSetWalletIcon();
  const rescan = useRescanWallet();
  const { shown, reorder } = useWalletOrder(wallets);
  const drag = useDragReorder(shown, reorder);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [rescanning, setRescanning] = useState<string | null>(null);
  // One wallet has no order to speak of.
  const movable = shown.length > 1;

  const commitRename = () => {
    if (!renaming || renaming.name.trim().length === 0) return;
    void renameWallet
      .mutateAsync({ id: renaming.id, name: renaming.name.trim() })
      .then(() => {
        setRenaming(null);
        showToast("Setting saved");
      });
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
          <GapLimitField gapLimit={gapLimit} />
        </SettingRow>
      </div>
      {shown.length === 0 ? (
        <p className="font-ui text-sm text-muted">No wallets on this network yet.</p>
      ) : (
        <ul ref={drag.listRef} className="relative flex flex-col gap-2">
          {shown.map((wallet, index) => {
            const single = wallet.kind.type === "single_address";
            const Glyph = walletGlyph(wallet.icon);
            const dragging = drag.dragging === index;
            const first = index === 0;
            const last = index === shown.length - 1;
            return (
              <li
                key={wallet.id}
                {...drag.rowProps(index)}
                className={clsx(
                  "group rounded-md border border-border bg-surface py-3 pr-4",
                  movable ? "pl-2" : "pl-4",
                  dragging && "relative z-10 opacity-80",
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2.5">
                    {movable && (
                      <span
                        aria-hidden
                        title="Drag to reorder"
                        {...drag.handleProps(index)}
                        className={clsx(
                          "inline-flex h-8 w-6 shrink-0 items-center justify-center rounded-sm text-muted/50",
                          "transition-colors duration-150 hover:text-muted",
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
                        <span className="truncate font-ui text-sm font-medium text-text">
                          {wallet.name}
                        </span>
                        <span className="font-ui text-xs text-muted">
                          {single ? "Single address" : "Descriptor wallet"}
                        </span>
                      </span>
                    )}
                  </span>
                  {renaming?.id !== wallet.id && confirmRemove !== wallet.id && (
                    <span className="flex items-center gap-1">
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
                        onChoose={(icon) =>
                          void setIcon
                            .mutateAsync({ id: wallet.id, icon })
                            .then(() => showToast("Icon changed"))
                        }
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
                      <Button
                        variant="ghost"
                        className="h-9 text-alert hover:text-alert"
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
                {confirmRemove === wallet.id && (
                  <Notice
                    tone="info"
                    className="mt-3"
                    action={<span className="flex items-center gap-2">
                      <Button
                        variant="danger"
                        className="h-9"
                        onClick={() =>
                          void removeWallet.mutateAsync(wallet.id).then(() => {
                            setConfirmRemove(null);
                            showToast("Wallet removed");
                          })
                        }
                      >
                        Remove wallet
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-9 hover:bg-surface hover:shadow-[inset_0_0_0_1px_var(--color-border)] dark:hover:bg-sunken dark:hover:shadow-none"
                        onClick={() => setConfirmRemove(null)}
                      >
                        Cancel
                      </Button>
                    </span>}
                  >
                    You are removing "{wallet.name}" from Gerfaut. This only
                    stops watching. Nothing moves on chain.
                  </Notice>
                )}
              </li>
            );
          })}
          <DropLine y={drag.lineY} />
        </ul>
      )}
    </SectionCard>
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
    <IconButton
      label={label}
      aria-disabled={blocked || undefined}
      onClick={blocked ? undefined : onClick}
      className={clsx(
        "size-9 opacity-0 transition-opacity duration-150",
        "focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100",
        blocked && "cursor-default text-muted/40 hover:bg-transparent hover:text-muted/40 active:scale-100",
      )}
    >
      {children}
    </IconButton>
  );
}
