import { ExternalLink, KeyRound } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import type { FormEvent } from "react";
import { Button } from "../../../components/Button";
import { Notice } from "../../../components/Notice";
import { PremiumPill } from "../../../components/PremiumPill";
import type { PremiumStatus } from "../../../lib/ipc";
import { PREMIUM_URL, RENEW_URL, formatKeyInput, isWellFormedKey } from "../../../lib/premium";
import {
  useActivatePremium,
  useDeleteAccount,
  useForgetPremium,
} from "../../../state/premiumQueries";
import { useUi } from "../../../state/store";
import { FieldLabel, SectionCard } from "../primitives";
import { FailureNote, GHOST_ON_TINT, longDate } from "./shared";

/** The account key and what it is worth right now.
 *
 *  Without a key: the field, formatted as it is typed, and Activate.
 *  With one: the paid-until date read from the certificate the vault
 *  holds, verified offline by the core, so it shows the same with no
 *  network and never waits on the server. Nothing here sells: no price,
 *  no countdown, one link to the site. */
export function LicenceCard({
  status,
  accountError,
  onRetryAccount,
}: {
  status: PremiumStatus;
  /** What the account call left behind, shown here because this card
      is where the key lives. */
  accountError?: unknown;
  onRetryAccount?: () => void;
}) {
  const activate = useActivatePremium();
  const [key, setKey] = useState("");
  const [failure, setFailure] = useState<unknown>(undefined);
  const ready = isWellFormedKey(key);

  const run = () => {
    if (!ready || activate.isPending) return;
    setFailure(undefined);
    activate.mutate(key, { onError: (error) => setFailure(error) });
  };

  // A note never lives in the card it comments: what the server said
  // about the key, or about the account, goes under it.
  return (
    <>
      <SectionCard icon={<KeyRound size={18} strokeWidth={1.5} />} title="Licence">
        {status.key === null ? (
          <KeyForm
            value={key}
            ready={ready}
            pending={activate.isPending}
            onChange={(next) => {
              setFailure(undefined);
              setKey(next);
            }}
            onSubmit={run}
          />
        ) : (
          <KeyInPlace status={status} />
        )}
      </SectionCard>
      {status.key === null && failure !== undefined && (
        <FailureNote error={failure} onRetry={run} />
      )}
      {status.key !== null && accountError !== undefined && (
        <FailureNote error={accountError} onRetry={onRetryAccount} />
      )}
    </>
  );
}

/** The field a key is typed or pasted into: lower case, sixteen symbols,
    a dash between each four, placed as they come. Activate waits for a
    well-formed key; the server then says whether it is one. */
function KeyForm({
  value,
  ready,
  pending,
  onChange,
  onSubmit,
}: {
  value: string;
  ready: boolean;
  pending: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <FieldLabel htmlFor="premium-key">Account key</FieldLabel>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="premium-key"
              value={value}
              onChange={(event) => onChange(formatKeyInput(event.target.value))}
              placeholder="xxxx-xxxx-xxxx-xxxx"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              inputMode="text"
              aria-invalid={value.length > 0 && !ready ? true : undefined}
              aria-describedby="premium-key-hint"
              readOnly={pending}
              className="field-focus selectable h-11 w-64 max-w-full rounded-sm border border-transparent bg-sunken px-3 font-data text-[15px] tracking-[0.04em] text-text placeholder:text-muted/60"
            />
            <Button
              type="submit"
              variant="primary"
              disabled={!ready || pending}
              aria-busy={pending || undefined}
            >
              {pending ? "Activating…" : "Activate"}
            </Button>
          </div>
          <p id="premium-key-hint" className="mt-2 max-w-xl font-ui text-xs text-muted">
            Bought on gerfaut-wallet.com. The key is shown once at purchase; there is no
            account to recover it from.
          </p>
        </div>
        <div>
          <Button variant="ghost" className="-ml-3" onClick={() => void openUrl(PREMIUM_URL)}>
            <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
            Get Premium
          </Button>
        </div>
    </form>
  );
}

/** The key is set: what the certificate says, and the two ways out of
    it. Forgetting is confirmed in amber under the card: nothing is at
    risk, but the consequence is worth reading first. */
function KeyInPlace({ status }: { status: PremiumStatus }) {
  const forget = useForgetPremium();
  const erase = useDeleteAccount();
  const { showToast } = useUi();
  const [confirming, setConfirming] = useState(false);
  /** Whether the server is asked to drop the account too, not only this
      device. Off every time the confirmation opens: nobody deletes an
      account by clicking twice in the same place. */
  const [alsoServer, setAlsoServer] = useState(false);
  const [failure, setFailure] = useState<unknown>(undefined);
  const busy = forget.isPending || erase.isPending;

  const open = () => {
    setAlsoServer(false);
    setFailure(undefined);
    setConfirming(true);
  };

  // The core deletes on the server first and forgets here only once the
  // server confirmed, so a call that fails leaves the key where it was
  // and the note below says so.
  const go = () => {
    setFailure(undefined);
    const done = (words: string) => ({
      onSuccess: () => {
        setConfirming(false);
        showToast(words);
      },
      onError: (problem: unknown) => setFailure(problem),
    });
    if (alsoServer) erase.mutate(undefined, done("Account deleted"));
    else forget.mutate(undefined, done("Key forgotten"));
  };
  const key = status.key ?? "";
  const licence = status.licence;

  // The key goes to the clipboard, not into the address: see RENEW_URL.
  // The page opens either way — someone who has the key in hand can
  // still type it — and the toast says which of the two happened.
  const renew = async () => {
    const copied = await navigator.clipboard
      .writeText(key)
      .then(() => true)
      .catch(() => false);
    showToast(copied ? "Key copied, paste it on the renewal page" : "Could not copy the key");
    await openUrl(RENEW_URL);
  };

  return (
    <div className="flex flex-col gap-4">
      {licence?.status === "active" && (
        <div className="flex flex-wrap items-center gap-3">
          <PremiumPill />
          <p className="font-ui text-base text-text">
            Active until <span className="tabular font-medium">{longDate(licence.until)}</span>
          </p>
        </div>
      )}
      {licence?.status === "expired" && (
        <Notice tone="info">
          Expired on {longDate(licence.since)} · alerts stop 7 days after expiry.
        </Notice>
      )}
      {licence === null && (
        <Notice tone="info">
          The stored licence could not be verified. Renew, or forget this key and enter it
          again.
        </Notice>
      )}
      <div className="-ml-3 flex flex-wrap items-center gap-1">
        <Button variant="ghost" onClick={() => void renew()}>
          <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
          Renew
        </Button>
        <Button
          variant="ghost"
          disabled={confirming}
          aria-expanded={confirming}
          onClick={open}
        >
          Forget this key
        </Button>
      </div>
      {confirming && (
        <Notice
          tone="info"
          role="status"
          action={
            <span className="flex items-center gap-2">
              <Button
                variant="primary"
                className="h-9"
                disabled={busy}
                aria-busy={busy || undefined}
                onClick={go}
              >
                {alsoServer
                  ? erase.isPending
                    ? "Deleting…"
                    : "Delete the account"
                  : forget.isPending
                    ? "Forgetting…"
                    : "Forget the key"}
              </Button>
              <Button
                variant="ghost"
                className={GHOST_ON_TINT}
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
            </span>
          }
        >
          {alsoServer
            ? "Deleting the account removes the wallets it watches, the channels it tells and the key itself from the server. This cannot be undone, and whatever paid time the key had left goes with it."
            : "Forgetting the key stops the watch on this device, not on the server: your wallets stay registered there until you remove them."}
          <label className="mt-2.5 flex cursor-pointer items-center gap-2 font-ui text-sm">
            <input
              type="checkbox"
              checked={alsoServer}
              disabled={busy}
              onChange={(event) => {
                setFailure(undefined);
                setAlsoServer(event.target.checked);
              }}
              className="accent-(--color-primary)"
            />
            Also delete everything on the server
          </label>
        </Notice>
      )}
      {confirming && failure !== undefined && <FailureNote error={failure} />}
    </div>
  );
}
