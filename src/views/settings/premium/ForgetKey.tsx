import { useState } from "react";
import { Button } from "../../../components/Button";
import { Notice } from "../../../components/Notice";
import { useDeleteAccount, useForgetPremium } from "../../../state/premiumQueries";
import { useUi } from "../../../state/store";
import { IdentityModal } from "./IdentityModal";
import { FailureNote, GHOST_ON_TINT } from "./shared";

/** The amber question before the key leaves this device, and, for a
 *  device with full access, the box that deletes the account on the
 *  server as well.
 *
 *  Forgetting disconnects this device and drops the key here; the
 *  account and what it watches stay. A device with full access asks the
 *  app lock's secret first: coming back takes an approval or ten days.
 *  Deleting the account is the one half that cannot be undone: the
 *  note stays amber — nothing here can lose funds — the button turns
 *  `danger`, and the secret is asked before it goes. */
export function ForgetKey({
  allowDelete,
  confirm,
  onClose,
}: {
  /** Whether this device may delete the account: full access only. */
  allowDelete: boolean;
  /** Whether forgetting asks the secret: a device the account may
      depend on, full access or not known to wait. */
  confirm: boolean;
  onClose: () => void;
}) {
  const forget = useForgetPremium();
  const erase = useDeleteAccount();
  const { showToast } = useUi();
  /** Whether the server is asked to drop the account too, not only this
      device. Off every time the question opens: nobody deletes an
      account by clicking twice in the same place. */
  const [alsoServer, setAlsoServer] = useState(false);
  /** Which half waits for the secret. */
  const [identity, setIdentity] = useState<"forget" | "delete" | null>(null);
  const [failure, setFailure] = useState<unknown>(undefined);
  const busy = forget.isPending || erase.isPending;
  const deleting = allowDelete && alsoServer;

  // The core deletes on the server first and forgets here only once the
  // server confirmed, so a call that fails leaves the key where it was
  // and the note below says so.
  const go = () => {
    setFailure(undefined);
    if (deleting) {
      setIdentity("delete");
      return;
    }
    if (confirm) {
      setIdentity("forget");
      return;
    }
    forget.mutate(undefined, {
      onSuccess: () => {
        onClose();
        showToast("Key forgotten");
      },
      onError: (problem: unknown) => setFailure(problem),
    });
  };

  return (
    <>
      <Notice
        tone="info"
        role="status"
        action={
          <span className="flex items-center gap-2">
            {/* Cancel first, the destructive yes last, as everywhere
                else. */}
            <Button variant="ghost" className={GHOST_ON_TINT} disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant={deleting ? "danger" : "premium"}
              className="h-9"
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={go}
            >
              {deleting
                ? erase.isPending
                  ? "Deleting…"
                  : "Delete the account"
                : forget.isPending
                  ? "Forgetting…"
                  : "Forget the key"}
            </Button>
          </span>
        }
      >
        {deleting
          ? "Deleting the account removes from the server the wallets it watches, the channels it tells and its alert log, and the key stops working everywhere. This cannot be undone, and whatever paid time the key had left is not refunded."
          : "Forgetting the key disconnects this device from your Premium account. To use Premium here again, enter the key, then approve this device from another one or wait 10 days."}
        {allowDelete && (
          <label className="mt-2.5 flex cursor-pointer items-center gap-2 font-ui text-sm">
            <input
              type="checkbox"
              checked={alsoServer}
              disabled={busy}
              onChange={(event) => {
                setFailure(undefined);
                setAlsoServer(event.target.checked);
              }}
              className="accent-(--color-premium)"
            />
            Also delete everything on the server
          </label>
        )}
      </Notice>
      {failure !== undefined && <FailureNote error={failure} />}
      {identity === "delete" && (
        <IdentityModal
          action="Delete the account"
          busyLabel="Deleting…"
          tone="danger"
          run={(secret) => erase.mutateAsync(secret)}
          onDone={() => {
            setIdentity(null);
            onClose();
            showToast("Account deleted");
          }}
          onFailure={(problem) => {
            setIdentity(null);
            setFailure(problem);
          }}
          onCancel={() => setIdentity(null)}
        />
      )}
      {identity === "forget" && (
        <IdentityModal
          action="Forget the key"
          busyLabel="Forgetting…"
          tone="premium"
          run={(secret) => forget.mutateAsync(secret)}
          onDone={() => {
            setIdentity(null);
            onClose();
            showToast("Key forgotten");
          }}
          onFailure={(problem) => {
            setIdentity(null);
            setFailure(problem);
          }}
          onCancel={() => setIdentity(null)}
        />
      )}
    </>
  );
}
