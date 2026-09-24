import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/Button";
import { Modal } from "../../../components/Modal";
import { Notice } from "../../../components/Notice";
import { useChangeKey, useSetKeySaved } from "../../../state/premiumQueries";
import { useUi } from "../../../state/store";
import { FieldLabel } from "../primitives";
import { IdentityModal } from "./IdentityModal";
import { FailureNote } from "./shared";

/** "Change key": what it does, the secret of the app lock, then the new
 *  key, once.
 *
 *  The question says everything that happens at the moment of the
 *  click — the old key dead everywhere, the site included, every other
 *  device disconnected — in amber, with the button in `danger`. Once
 *  the server has answered, the dialog shows the new key and cannot be
 *  closed by a stray Escape or a click beside it: "Done" waits for "I
 *  saved my new key". The key stays on this device either way; nothing
 *  else has it. */
export function ChangeKeyModal({ onClose }: { onClose: () => void }) {
  const change = useChangeKey();
  const saved = useSetKeySaved();
  const { showToast } = useUi();
  const [identity, setIdentity] = useState(false);
  const [failure, setFailure] = useState<unknown>(undefined);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [stored, setStored] = useState(false);
  const [copied, setCopied] = useState(false);
  const keyHeading = useRef<HTMLParagraphElement>(null);

  // The new key is the one thing on screen now: the focus goes to it,
  // so a screen reader reads it and Tab walks on to Copy.
  useEffect(() => {
    if (newKey !== null) keyHeading.current?.focus();
  }, [newKey]);

  const copy = async () => {
    if (newKey === null) return;
    try {
      await navigator.clipboard.writeText(newKey);
      setCopied(true);
      showToast("Key copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      showToast("Could not copy the key");
    }
  };

  const done = () => {
    if (!stored || saved.isPending) return;
    saved.mutate(true, { onSettled: onClose });
  };

  return (
    <>
      <Modal
        open
        onClose={onClose}
        dismissible={newKey === null && !change.isPending}
        centered
        width={520}
        title="Change your Premium key"
      >
        {newKey === null ? (
          <div className="flex flex-col gap-4">
            <Notice tone="info">
              A new key replaces this one. The old key stops working at once, on the website
              too. Every other device is disconnected: enter the new key there, then approve it
              here.
            </Notice>
            {failure !== undefined && <FailureNote error={failure} />}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={change.isPending} onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={change.isPending}
                aria-busy={change.isPending || undefined}
                onClick={() => {
                  setFailure(undefined);
                  setIdentity(true);
                }}
              >
                {change.isPending ? "Changing…" : "Change key"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <FieldLabel>Your new key</FieldLabel>
              <div className="flex items-stretch gap-2">
                {/* An identifier: mono, whole, selectable, read out as
                    one piece. */}
                <p
                  ref={keyHeading}
                  tabIndex={-1}
                  aria-label={`Your new key: ${newKey}`}
                  className="selectable min-w-0 flex-1 rounded-sm bg-sunken px-3 py-3 text-center font-data text-[22px] tracking-[0.08em] text-text focus-visible:outline-none"
                >
                  {newKey}
                </p>
                <Button variant="secondary" className="h-auto" onClick={() => void copy()}>
                  {copied ? (
                    <Check size={14} strokeWidth={2} aria-hidden />
                  ) : (
                    <Copy size={14} strokeWidth={1.5} aria-hidden />
                  )}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <p className="mt-3 font-ui text-sm text-text">
                Save it in your password manager now. This device keeps it, but nothing else
                does.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <label className="flex cursor-pointer items-center gap-2 font-ui text-sm text-text">
                <input
                  type="checkbox"
                  checked={stored}
                  onChange={(event) => setStored(event.target.checked)}
                  className="size-4 accent-(--color-premium)"
                />
                I saved my new key
              </label>
              <Button
                variant="premium"
                disabled={!stored || saved.isPending}
                aria-busy={saved.isPending || undefined}
                onClick={done}
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </Modal>
      {identity && (
        <IdentityModal
          action="Change key"
          busyLabel="Changing…"
          tone="danger"
          z={60}
          run={(secret) =>
            change.mutateAsync(secret).then((key) => {
              setNewKey(key);
            })
          }
          onDone={() => setIdentity(false)}
          onFailure={(problem) => {
            setIdentity(false);
            setFailure(problem);
          }}
          onCancel={() => setIdentity(false)}
        />
      )}
    </>
  );
}
