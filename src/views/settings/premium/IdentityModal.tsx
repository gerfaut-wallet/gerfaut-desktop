import { Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Button, IconButton } from "../../../components/Button";
import { Modal } from "../../../components/Modal";
import { isCommandError } from "../../../lib/ipc";
import { LOCK_REQUIRED_WORDS } from "../../../lib/premium";
import { useLock } from "../../../state/lock";
import { useUi } from "../../../state/store";
import { FieldLabel } from "../primitives";

/** "Confirm it's you": the app lock's secret, asked again before a
 *  change to who can use the account or to what it watches and where
 *  it tells.
 *
 *  The secret goes with the action itself, and the Rust side checks it
 *  the way the lock screen does — the same failures counted, the same
 *  wait after three — before anything reaches the server. This dialog
 *  only collects it and says what came back: "Wrong PIN" in the lock
 *  screen's words, the wait while it runs, or, with no lock on this
 *  device, why one is needed and the way to set it.
 *
 *  A failure that has nothing to do with the secret closes the dialog
 *  and goes to the caller, which says it under its card. */
export function IdentityModal({
  action,
  busyLabel,
  tone,
  run,
  onDone,
  onFailure,
  onCancel,
  z,
}: {
  /** The verb on the button that confirms, the one the action had
      under its row: "Approve", "Refuse", "Change key". */
  action: string;
  /** The same while it runs: "Approving…". */
  busyLabel: string;
  tone: "premium" | "danger";
  /** Does the action with the secret; rejects with the command's error. */
  run: (secret: string) => Promise<unknown>;
  onDone: () => void;
  onFailure: (error: unknown) => void;
  onCancel: () => void;
  /** Above another dialog, when it is asked from one. */
  z?: number;
}) {
  const lock = useLock((state) => state.lock);
  const [noLock, setNoLock] = useState(false);
  const [secret, setSecret] = useState("");
  const [hidden, setHidden] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const pin = lock?.kind === "pin";
  const missing = lock === null || noLock;

  // The core looks at no secret while its wait runs; the field comes
  // back with the caret in it the moment the wait is over.
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setInterval(() => setWait((left) => Math.max(0, left - 1)), 1000);
    return () => clearInterval(timer);
  }, [wait]);
  useEffect(() => {
    if (wait === 0) field.current?.focus();
  }, [wait]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || wait > 0 || secret.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      await run(secret);
      setSecret("");
      onDone();
    } catch (error) {
      setSecret("");
      const kind = isCommandError(error) ? error.kind : null;
      if (kind === "identity_refused") {
        const after = isCommandError(error) ? (error.retry_after_secs ?? 0) : 0;
        if (after > 0) setWait(after);
        else setMessage(pin ? "Wrong PIN" : "Wrong password");
        field.current?.focus();
      } else if (kind === "app_lock_required") {
        setNoLock(true);
      } else {
        onFailure(error);
      }
    } finally {
      setBusy(false);
    }
  };

  const setUp = () => {
    onCancel();
    useUi.getState().openSettings("security");
  };

  return (
    <Modal
      open
      onClose={onCancel}
      dismissible={!busy}
      centered
      width={420}
      title="Confirm it's you"
      z={z}
    >
      {missing ? (
        <div className="flex flex-col gap-5">
          <p className="font-ui text-sm leading-5 text-text">{LOCK_REQUIRED_WORDS}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" onClick={setUp}>
              Set an app lock
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={(event) => void submit(event)} aria-busy={busy} className="flex flex-col">
          <FieldLabel htmlFor="identity-secret">{pin ? "PIN" : "Password"}</FieldLabel>
          <div className="relative">
            <input
              ref={field}
              id="identity-secret"
              type={hidden || pin ? "password" : "text"}
              value={secret}
              disabled={wait > 0}
              readOnly={busy}
              inputMode={pin ? "numeric" : undefined}
              pattern={pin ? "[0-9]*" : undefined}
              maxLength={pin ? 12 : undefined}
              autoComplete="off"
              aria-describedby="identity-status"
              onChange={(event) => {
                const next = event.target.value;
                setSecret(pin ? next.replace(/\D/g, "") : next);
                setMessage(null);
              }}
              className="field-focus h-11 w-full rounded-sm border border-transparent bg-sunken px-3 pr-11 font-ui text-sm text-text disabled:opacity-60"
            />
            {!pin && (
              <span className="absolute right-1 top-1/2 -translate-y-1/2">
                <IconButton
                  label={hidden ? "Show password" : "Hide password"}
                  onClick={() => setHidden(!hidden)}
                >
                  {hidden ? (
                    <Eye size={16} strokeWidth={1.5} aria-hidden />
                  ) : (
                    <EyeOff size={16} strokeWidth={1.5} aria-hidden />
                  )}
                </IconButton>
              </span>
            )}
          </div>
          {/* The lock screen's line, in its words and its colour: a
              refused secret is a fact, not an alarm. It keeps its
              height, so nothing under it moves; the seconds inside it
              are not read out one by one. */}
          <p id="identity-status" role="status" className="mt-2 min-h-5 font-ui text-sm text-muted">
            {wait > 0 ? (
              <>
                Too many attempts. Try again in <span aria-live="off">{wait}</span> s
              </>
            ) : (
              message
            )}
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={tone}
              disabled={busy || wait > 0 || secret.length === 0}
              aria-busy={busy || undefined}
            >
              {busy ? busyLabel : action}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
