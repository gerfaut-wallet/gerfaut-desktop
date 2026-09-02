import { Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, IconButton } from "../components/Button";
import { Mark } from "../components/Mark";
import { isCommandError } from "../lib/ipc";
import { useLock } from "../state/lock";

/** The screen that stands in front of everything while the app is
    locked. Nothing of a wallet is behind it: it replaces the shell,
    it does not cover it.

    It is the shell with an empty canvas — the invariant dark base and
    the floating sheet every page of the app already sits on. The sheet
    takes the theme's ramp, so this reads light in light and dark in
    dark: it is Gerfaut with nothing in it, not a screen of its own. */
export function LockScreen() {
  const lock = useLock((state) => state.lock);
  const unlock = useLock((state) => state.unlock);
  const [secret, setSecret] = useState("");
  const [hidden, setHidden] = useState(true);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const field = useRef<HTMLInputElement>(null);

  const pin = lock?.kind === "pin";

  // The field takes the focus on arrival and takes it back the moment
  // the core's delay runs out: the next try is a keystroke away rather
  // than a hunt for the caret.
  useEffect(() => {
    if (wait === 0) field.current?.focus();
  }, [wait]);

  // The core will not even look at a secret while the delay runs.
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setInterval(() => setWait((left) => Math.max(0, left - 1)), 1000);
    return () => clearInterval(timer);
  }, [wait]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (checking || wait > 0 || secret.length === 0) return;
    setChecking(true);
    setMessage(null);
    try {
      const verdict = await unlock(secret);
      if (verdict.unlocked) return;
      setSecret("");
      if (verdict.retry_after_secs > 0) {
        setWait(verdict.retry_after_secs);
      } else {
        setMessage(pin ? "Wrong PIN" : "Wrong password");
      }
    } catch (error) {
      setMessage(isCommandError(error) ? error.message : String(error));
    } finally {
      setChecking(false);
      // Submitting took the focus to the button; a refused secret is
      // retyped straight away, so the caret goes back to the field.
      field.current?.focus();
    }
  };

  return (
    <div className="h-full bg-shell p-2">
      <main className="h-full overflow-hidden rounded-[var(--radius-canvas)] bg-background shadow-canvas">
        <div className="h-full overflow-y-auto">
          <div className="flex min-h-full items-center justify-center px-6 py-10">
            <form
              onSubmit={submit}
              aria-busy={checking}
              className="flex w-80 max-w-full flex-col items-center"
            >
              <Mark className="h-10 w-auto text-primary" />
              <h1 className="mt-4 font-display text-lg font-semibold text-text">
                Locked
              </h1>

              {/* A field reads as a field because a sunken surface sits on
                  a raised one. This one sits straight on the canvas, a
                  single step away in the ramp, so it takes the hairline
                  the system gives anything holding its own edge on the
                  sheet. Focus turns that hairline Glacier and nothing
                  more: one thin line, the weight of everything else here. */}
              <div className="relative mt-7 w-full">
                <input
                  ref={field}
                  type={hidden || pin ? "password" : "text"}
                  value={secret}
                  disabled={wait > 0}
                  aria-label={pin ? "PIN" : "Password"}
                  placeholder={pin ? "PIN" : "Password"}
                  inputMode={pin ? "numeric" : undefined}
                  pattern={pin ? "[0-9]*" : undefined}
                  maxLength={pin ? 12 : undefined}
                  autoComplete="off"
                  onChange={(event) => {
                    const next = event.target.value;
                    setSecret(pin ? next.replace(/\D/g, "") : next);
                    setMessage(null);
                  }}
                  className="field-focus h-11 w-full rounded-sm border border-border bg-sunken px-3 pr-11 font-ui text-sm text-text placeholder:text-muted disabled:opacity-60"
                />
                {!pin && (
                  <span className="absolute right-1 top-1/2 -translate-y-1/2">
                    <IconButton
                      label={hidden ? "Show password" : "Hide password"}
                      type="button"
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

              {/* A refused secret is a fact, not an alarm: Alerte is kept
                  for coins moving. The line holds its height whether it
                  speaks or not, so nothing under it moves. It is a live
                  region — the seconds inside it are not, or a screen
                  reader would read the whole sentence again every one. */}
              <p
                role="status"
                className="mt-2 min-h-5 w-full text-center font-ui text-sm text-muted"
              >
                {wait > 0 ? (
                  <>
                    Too many attempts. Try again in{" "}
                    <span aria-live="off">{wait}</span> s
                  </>
                ) : (
                  message
                )}
              </p>

              <Button
                type="submit"
                variant="primary"
                className="mt-2 w-full"
                disabled={checking || wait > 0 || secret.length === 0}
              >
                {checking ? "Unlocking…" : "Unlock"}
              </Button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
