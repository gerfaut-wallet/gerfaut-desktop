import { ExternalLink, KeyRound } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import type { FormEvent } from "react";
import { Button } from "../../../components/Button";
import { Notice } from "../../../components/Notice";
import { PremiumPill } from "../../../components/PremiumPill";
import type { PremiumStatus } from "../../../lib/ipc";
import { PREMIUM_URL, formatKeyInput, isWellFormedKey, renewUrl } from "../../../lib/premium";
import { useActivatePremium, useForgetPremium } from "../../../state/premiumQueries";
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
  const { showToast } = useUi();
  const [confirming, setConfirming] = useState(false);
  const key = status.key ?? "";
  const licence = status.licence;

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
        <Button variant="ghost" onClick={() => void openUrl(renewUrl(key))}>
          <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
          Renew
        </Button>
        <Button
          variant="ghost"
          disabled={confirming}
          aria-expanded={confirming}
          onClick={() => setConfirming(true)}
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
                disabled={forget.isPending}
                onClick={() =>
                  forget.mutate(undefined, {
                    onSuccess: () => {
                      setConfirming(false);
                      showToast("Key forgotten");
                    },
                  })
                }
              >
                {forget.isPending ? "Forgetting…" : "Forget the key"}
              </Button>
              <Button variant="ghost" className={GHOST_ON_TINT} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </span>
          }
        >
          Forgetting the key stops the watch on this device, not on the server: your wallets
          stay registered there until you remove them.
        </Notice>
      )}
    </div>
  );
}
