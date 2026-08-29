import { Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, IconButton } from "../components/Button";
import { useLock } from "../state/lock";
import mark from "../assets/gerfaut-mark-accent-dark.svg";

/** The screen that stands in front of everything while the app is
    locked. Nothing of a wallet is behind it: it replaces the shell,
    it does not cover it. */
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

  useEffect(() => {
    field.current?.focus();
  }, []);

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
      setMessage(String(error));
    } finally {
      setChecking(false);
    }
  };

  const note =
    wait > 0 ? `Too many attempts. Try again in ${wait} s` : message;

  return (
    // The shell base, as a dark island: the lock belongs to the app's
    // frame, not to the page it hides.
    <div className="shell-rail flex h-full items-center justify-center bg-shell">
      <form onSubmit={submit} className="flex w-72 flex-col items-center gap-5">
        <img src={mark} alt="Gerfaut" className="h-10 w-10" />
        <h1 className="font-display text-lg font-semibold text-text">Locked</h1>
        <div className="relative w-full">
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
            className="h-11 w-full rounded-sm bg-sunken px-3 pr-11 font-ui text-sm text-text outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
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
        {/* A refused secret is a fact, not an alarm: Alerte is kept for
            coins moving. */}
        {note && <p className="font-ui text-xs text-muted">{note}</p>}
        <Button
          type="submit"
          variant="primary"
          className="w-full"
          disabled={checking || wait > 0}
        >
          {checking ? "Unlocking…" : "Unlock"}
        </Button>
      </form>
    </div>
  );
}
