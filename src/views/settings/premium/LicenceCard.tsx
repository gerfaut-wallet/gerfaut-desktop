import { Copy, ExternalLink, KeyRound } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Button } from "../../../components/Button";
import { Notice } from "../../../components/Notice";
import { PremiumPill } from "../../../components/PremiumPill";
import type { PremiumStatus } from "../../../lib/ipc";
import { isCommandError } from "../../../lib/ipc";
import {
  KEY_CHANGE_UNFINISHED_WORDS,
  PREMIUM_URL,
  RENEW_URL,
  disconnectedWords,
  formatKeyInput,
  isWellFormedKey,
} from "../../../lib/premium";
import {
  useActivatePremium,
  useChangeKey,
  useReconnectPremium,
} from "../../../state/premiumQueries";
import { useUi } from "../../../state/store";
import { FieldLabel, SectionCard } from "../primitives";
import { ChangeKeyModal } from "./ChangeKeyModal";
import { ForgetKey } from "./ForgetKey";
import { IdentityModal } from "./IdentityModal";
import { FailureNote, longDate } from "./shared";

/** What the server says about this device, once it has: full access,
    waiting for approval, or not known yet — offline, say. */
export type DeviceAccess = "full" | "pending" | null;

/** The key a reconnection used is not one the server knows any more:
    it was changed on another device. */
const KEY_CHANGED_WORDS = "This key no longer works. Enter the new one.";

/** The account key and what it is worth right now.
 *
 *  Without a key: the field, formatted as it is typed, and Activate,
 *  which connects this device. With one: the paid-until date read from
 *  the certificate the vault holds, verified offline by the core, so it
 *  shows the same with no network and never waits on the server. A
 *  device with full access can change the key; one the server
 *  disconnected says so under the card, in the server's words when it
 *  gave some, and connects again with the key it kept. A key change
 *  whose answer was lost says so too, and is finished from there.
 *  Nothing here sells: no price, no countdown, one link to the site. */
export function LicenceCard({
  status,
  access,
  accountError,
  onRetryAccount,
}: {
  status: PremiumStatus;
  access: DeviceAccess;
  /** What the account call left behind, shown here because this card
      is where the key lives. */
  accountError?: unknown;
  onRetryAccount?: () => void;
}) {
  const activate = useActivatePremium();
  const reconnect = useReconnectPremium();
  const [key, setKey] = useState("");
  const [failure, setFailure] = useState<unknown>(undefined);
  /** "Connect again" was refused for the key itself: the field comes
      back for the new one. Local to this visit; the key stays in the
      vault until a new one works. */
  const [keyChanged, setKeyChanged] = useState(false);
  const [reconnectFailure, setReconnectFailure] = useState<unknown>(undefined);
  // What "Connect again" met belongs to the connection it was pressed
  // for: once this device connects, forgets the key or holds another,
  // it goes, rather than turn up under the next disconnection.
  const connection = `${status.key ?? ""}|${status.disconnected}`;
  const [failedFor, setFailedFor] = useState(connection);
  if (failedFor !== connection) {
    setFailedFor(connection);
    setReconnectFailure(undefined);
  }
  const ready = isWellFormedKey(key);
  const asking = status.key === null || keyChanged;

  // The field comes back in place of "Connect again", which is gone:
  // the caret goes where the new key is typed.
  useEffect(() => {
    if (keyChanged) document.getElementById("premium-key")?.focus();
  }, [keyChanged]);

  const run = () => {
    if (!ready || activate.isPending) return;
    setFailure(undefined);
    activate.mutate(key, {
      onSuccess: () => {
        setKey("");
        setKeyChanged(false);
      },
      onError: (error) => setFailure(error),
    });
  };

  const connectAgain = () => {
    if (reconnect.isPending) return;
    setReconnectFailure(undefined);
    reconnect.mutate(undefined, {
      onError: (error) => {
        if (isCommandError(error) && error.kind === "premium_unknown_key") {
          setKeyChanged(true);
        } else {
          setReconnectFailure(error);
        }
      },
    });
  };

  // A note never lives in the card it comments: what the server said
  // about the key, or about the account, goes under it.
  return (
    <>
      <SectionCard icon={<KeyRound size={18} strokeWidth={1.5} />} title="Licence" premium>
        {asking ? (
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
          <KeyInPlace status={status} access={access} />
        )}
      </SectionCard>
      {keyChanged && failure === undefined && (
        <Notice tone="info" role="alert">
          {KEY_CHANGED_WORDS}
        </Notice>
      )}
      {asking && failure !== undefined && <FailureNote error={failure} onRetry={run} />}
      {!asking && status.disconnected && (
        <Notice
          tone="info"
          role="status"
          action={
            <Button
              variant="premium"
              className="h-9"
              disabled={reconnect.isPending}
              aria-busy={reconnect.isPending || undefined}
              onClick={connectAgain}
            >
              {reconnect.isPending ? "Connecting…" : "Connect again"}
            </Button>
          }
        >
          {disconnectedWords(status.disconnected_reason)}
        </Notice>
      )}
      {!asking && reconnectFailure !== undefined && (
        <FailureNote error={reconnectFailure} onRetry={connectAgain} />
      )}
      <UnfinishedKeyChange
        unfinished={!asking && status.key_change_pending && !status.disconnected}
      />
      {!asking && !status.disconnected && accountError !== undefined && (
        <FailureNote error={accountError} onRetry={onRetryAccount} />
      )}
    </>
  );
}

/** A key change sent and not answered: the server may have made the
 *  new key the account's, and the one this card holds may be dead.
 *  Amber, under the card, with "Try again", which asks the secret the
 *  change always asks and sends the same new key; once the server has
 *  answered, the key is shown the way a change shows it, and the note
 *  goes. Always mounted, so the key outlives the note it came from. */
function UnfinishedKeyChange({ unfinished }: { unfinished: boolean }) {
  const change = useChangeKey();
  const [identity, setIdentity] = useState(false);
  const [failure, setFailure] = useState<unknown>(undefined);
  const [finished, setFinished] = useState<string | null>(null);

  return (
    <>
      {unfinished && (
        <Notice
          tone="info"
          role="status"
          action={
            <Button
              variant="premium"
              className="h-9"
              aria-haspopup="dialog"
              disabled={change.isPending}
              aria-busy={change.isPending || undefined}
              onClick={() => {
                setFailure(undefined);
                setIdentity(true);
              }}
            >
              {change.isPending ? "Changing…" : "Try again"}
            </Button>
          }
        >
          {KEY_CHANGE_UNFINISHED_WORDS}
        </Notice>
      )}
      {unfinished && failure !== undefined && <FailureNote error={failure} />}
      {identity && (
        <IdentityModal
          action="Change key"
          busyLabel="Changing…"
          tone="danger"
          run={(secret) => change.mutateAsync(secret).then(setFinished)}
          onDone={() => setIdentity(false)}
          onFailure={(problem) => {
            setIdentity(false);
            setFailure(problem);
          }}
          onCancel={() => setIdentity(false)}
        />
      )}
      {finished !== null && (
        <ChangeKeyModal finished={finished} onClose={() => setFinished(null)} />
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
            variant="premium"
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
        <Button variant="premium-ghost" className="-ml-3" onClick={() => void openUrl(PREMIUM_URL)}>
          <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
          Get Premium
        </Button>
      </div>
    </form>
  );
}

/** The key is set: what the certificate says, and what can be done
    with it from here. Changing it takes full access; forgetting it
    lives in the waiting card while this device waits for approval. */
function KeyInPlace({ status, access }: { status: PremiumStatus; access: DeviceAccess }) {
  const { showToast } = useUi();
  const [changing, setChanging] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  /** The clipboard refused the key: said under the buttons, where it
      was asked, and not in a toast that would be gone before it is
      read. */
  const [copyFailed, setCopyFailed] = useState(false);
  const key = status.key ?? "";
  const licence = status.licence;
  const connected = status.device !== null && !status.disconnected;
  const full = access === "full" && connected;
  // A key change that did not finish: the key here may be dead, so it
  // is not offered, and the change is finished from the note under the
  // card rather than started again. Leaving would lose the new key, and
  // the core refuses it while this device can still finish the change.
  const unfinished = status.key_change_pending;
  const canForget = access !== "pending" && !(unfinished && connected);

  const copy = async (): Promise<boolean> => {
    const copied = await navigator.clipboard
      .writeText(key)
      .then(() => true)
      .catch(() => false);
    setCopyFailed(!copied);
    return copied;
  };

  // The key goes to the clipboard, not into the address: see RENEW_URL.
  // The page opens either way — someone who has the key in hand can
  // still type it. Not a key that may be dead, though.
  const renew = async () => {
    if (!unfinished && (await copy())) showToast("Key copied, paste it on the renewal page");
    await openUrl(RENEW_URL);
  };

  const copyKey = async () => {
    if (await copy()) showToast("Key copied");
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
        <Button variant="premium-ghost" onClick={() => void renew()}>
          <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
          Renew
        </Button>
        {/* Until its owner says it is saved: nothing else can hand it
            back to them. */}
        {!status.key_saved && !unfinished && (
          <Button variant="ghost" onClick={() => void copyKey()}>
            <Copy size={14} strokeWidth={1.5} aria-hidden />
            Copy key
          </Button>
        )}
        {full && !unfinished && (
          <Button variant="ghost" aria-haspopup="dialog" onClick={() => setChanging(true)}>
            Change key
          </Button>
        )}
        {canForget && (
          <Button
            variant="ghost"
            disabled={forgetting}
            aria-expanded={forgetting}
            onClick={() => setForgetting(true)}
          >
            Forget this key
          </Button>
        )}
      </div>
      {copyFailed && !unfinished && (
        <Notice tone="info" role="alert">
          Could not copy the key.
        </Notice>
      )}
      {forgetting && canForget && (
        <ForgetKey
          allowDelete={full}
          confirm={connected}
          onClose={() => setForgetting(false)}
        />
      )}
      {changing && <ChangeKeyModal onClose={() => setChanging(false)} />}
    </div>
  );
}
