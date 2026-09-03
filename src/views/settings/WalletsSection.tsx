import { Check, Pencil, ScanSearch, Trash2, Wallet as WalletIcon, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, IconButton } from "../../components/Button";
import { Notice } from "../../components/Notice";
import type { WalletMeta } from "../../lib/ipc";
import {
  useRemoveWallet,
  useRenameWallet,
  useRescanWallet,
  useSetGapLimit,
} from "../../state/queries";
import { useUi } from "../../state/store";
import { SectionCard, SettingRow } from "./primitives";

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

/** The shared gap limit, then every wallet of the shown network with
    what can be done to it: rescan, rename, remove. */
export function WalletsSection({ wallets, gapLimit }: { wallets: WalletMeta[]; gapLimit: number }) {
  const { showToast, syncErrors } = useUi();
  const removeWallet = useRemoveWallet();
  const renameWallet = useRenameWallet();
  const rescan = useRescanWallet();
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [rescanning, setRescanning] = useState<string | null>(null);

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
      {wallets.length === 0 ? (
        <p className="font-ui text-sm text-muted">No wallets on this network yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {wallets.map((wallet) => {
            const single = wallet.kind.type === "single_address";
            return (
              <li
                key={wallet.id}
                className="rounded-md border border-border px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="text-muted">
                      <WalletIcon size={16} strokeWidth={1.5} aria-hidden />
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
        </ul>
      )}
    </SectionCard>
  );
}
