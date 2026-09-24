import { clsx } from "clsx";
import {
  AlertTriangle,
  Bell,
  BellRing,
  Check,
  Clock,
  Copy,
  ExternalLink,
  Mail,
  Plus,
  Send,
  Trash2,
  Webhook,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Button } from "../../../components/Button";
import { Modal } from "../../../components/Modal";
import { Notice } from "../../../components/Notice";
import { Pill } from "../../../components/StatusPill";
import type { Channel, ChannelKind, NewChannel } from "../../../lib/ipc";
import {
  useAddChannel,
  useConfirmChannel,
  useDeleteChannel,
  useTestChannel,
} from "../../../state/premiumQueries";
import { useUi } from "../../../state/store";
import { FieldLabel, SectionCard } from "../primitives";
import { IdentityModal } from "./IdentityModal";
import { RowMenu } from "./RowMenu";
import { FailureNote, GHOST_ON_TINT, useFocusAfterRender } from "./shared";

/** Each kind of channel: its glyph, its name, and the one line that
    says what adding it means. */
const KINDS: { kind: ChannelKind; icon: LucideIcon; label: string; hint: string }[] = [
  {
    kind: "ntfy",
    icon: Bell,
    label: "ntfy",
    hint: "A private topic on Gerfaut's ntfy server, for the ntfy app.",
  },
  {
    kind: "telegram",
    icon: Send,
    label: "Telegram",
    hint: "Messages from @GerfautAlertsBot.",
  },
  {
    kind: "email",
    icon: Mail,
    label: "E-mail",
    hint: "One short e-mail per alert.",
  },
  {
    kind: "webhook",
    icon: Webhook,
    label: "Webhook",
    hint: "A signed POST to a URL you run.",
  },
];

function kindOf(kind: ChannelKind) {
  return KINDS.find((entry) => entry.kind === kind) ?? KINDS[0];
}

/** What the row shows for a channel's target: who it is linked to when
    the server knows a name for it — the Telegram chat that sent the
    code, so the owner sees whose screen the alerts land on and not only
    that someone's does — then the masked address, then the kind's name.
    */
function targetOf(channel: Channel): string {
  if (channel.linked && channel.linked_name !== null && channel.linked_name.length > 0) {
    return `Linked to ${channel.linked_name}`;
  }
  if (channel.target.length > 0) return channel.target;
  return channel.kind === "telegram" ? "Telegram" : kindOf(channel.kind).label;
}

/** A channel the server will not write to yet, and what it is waiting
    for: the bot to be sent the code, or the code to be sent back. */
function waitingWord(channel: Channel): string | null {
  if (channel.linked) return null;
  if (channel.kind === "telegram") return "Waiting for the bot";
  if (channel.kind === "email") return "Waiting for the code";
  return null;
}

/** What happened to a channel the server turned off, and the way back.
    Only a webhook goes this way today — one written to a private or
    local address, which the server refuses to post to and disables
    rather than keep trying — but the flag belongs to every kind, so
    every kind has a sentence rather than a silence. */
function offReason(channel: Channel): string {
  return channel.kind === "webhook"
    ? "This webhook points at an address that is not reachable from the internet, so nothing is delivered to it. Point it at a public address and add it again."
    : "The server turned this channel off, so nothing is delivered to it. Remove it and add it again.";
}

/** Why a test on this channel would not go through, or null when it
    would. The server writes nothing to a channel it has no target for
    and answers "this channel is not linked yet", and nothing at all to
    one it has turned off, so the menu says so itself instead of
    offering an action whose only outcome is that error. */
function testBlocked(channel: Channel): string | null {
  if (!channel.enabled) return "Nothing is delivered";
  return channel.linked ? null : "Not linked yet";
}

/** How many digits the server sends. */
const CODE_LENGTH = 6;

/** The six digits the server e-mails, typed back.

    An address is not a channel until its owner proves they read it:
    anyone can type someone else's e-mail into this field, and without
    the round trip that someone else starts receiving alerts about a
    wallet they never heard of. */
function CodeForm({
  channel,
  sentTo,
  onDone,
}: {
  channel: Channel;
  /** The address as it was typed, when this follows the creation; the
      server hands the list a masked one. */
  sentTo: string;
  onDone: () => void;
}) {
  const confirm = useConfirmChannel();
  const { showToast } = useUi();
  const [code, setCode] = useState("");
  const [failure, setFailure] = useState<unknown>(undefined);
  const ready = code.length === CODE_LENGTH;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready || confirm.isPending) return;
    setFailure(undefined);
    confirm.mutate(
      { id: channel.id, code },
      {
        onSuccess: () => {
          showToast("Channel confirmed");
          onDone();
        },
        onError: (problem) => setFailure(problem),
      },
    );
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {/* An address has no space to break at: left alone, a long one
          runs out of a narrow dialog. It breaks where it must and
          nowhere else, so a short one still reads in one piece. */}
      <p className="font-ui text-sm text-text">
        Confirmation sent to <span className="font-medium wrap-anywhere">{sentTo}</span>.
        Enter the six-digit code from that e-mail; it expires in an hour.
      </p>
      <div>
        <FieldLabel htmlFor="channel-code">Code</FieldLabel>
        <input
          id="channel-code"
          value={code}
          onChange={(event) => {
            setFailure(undefined);
            setCode(event.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH));
          }}
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={CODE_LENGTH}
          autoComplete="one-time-code"
          autoFocus
          placeholder="000000"
          className="field-focus selectable h-11 w-40 rounded-sm border border-transparent bg-sunken px-3 text-center font-data text-[20px] tracking-[0.24em] text-text placeholder:text-muted/50"
        />
      </div>
      <div className="mt-1 flex items-center justify-end gap-3">
        <Button variant="ghost" onClick={onDone} disabled={confirm.isPending}>
          Later
        </Button>
        <Button
          type="submit"
          variant="premium"
          disabled={!ready || confirm.isPending}
          aria-busy={confirm.isPending || undefined}
        >
          {confirm.isPending ? "Confirming…" : "Confirm"}
        </Button>
      </div>
      {failure !== undefined && <FailureNote error={failure} />}
    </form>
  );
}

/** Where alerts go: one row per channel, the way to add one, and the
    test that proves a channel out. The first channel created is tested
    on its own; the others on request. */
export function ChannelsCard({
  channels,
  loading,
  unreachable = false,
  error,
  onRetry,
}: {
  channels: Channel[] | undefined;
  loading: boolean;
  /** The server could not be reached at all; the licence card says so. */
  unreachable?: boolean;
  error?: unknown;
  onRetry?: () => void;
}) {
  const { showToast } = useUi();
  const test = useTestChannel();
  const remove = useDeleteChannel();
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<Channel | null>(null);
  const [failure, setFailure] = useState<unknown>(undefined);
  const [testing, setTesting] = useState<string | null>(null);
  /** The channel whose removal waits for a yes under its row, by id. */
  const [removing, setRemoving] = useState<string | null>(null);
  /** The yes was given: the secret is asked before it goes. */
  const [identity, setIdentity] = useState<Channel | null>(null);
  /** Where the focus lands once a row, and the button that removed it,
      are gone. */
  const heading = useRef<HTMLHeadingElement>(null);
  const focusHeading = useFocusAfterRender(heading);
  /** Each row, to hand the focus back to its menu on Cancel. */
  const rows = useRef(new Map<string, HTMLElement>());

  const sendTest = (channel: Channel) => {
    setFailure(undefined);
    setTesting(channel.id);
    test.mutate(channel.id, {
      onSuccess: () => showToast("Test sent"),
      onError: (problem) => setFailure(problem),
      onSettled: () => setTesting(null),
    });
  };

  const askRemoval = (channel: Channel) => {
    setFailure(undefined);
    setRemoving(channel.id);
  };

  const cancelRemoval = (id: string) => {
    setRemoving(null);
    rows.current.get(id)?.querySelector<HTMLElement>("[aria-haspopup]")?.focus();
  };

  return (
    <>
      <SectionCard
        icon={<BellRing size={18} strokeWidth={1.5} />}
        title="Channels"
        headingRef={heading}
        premium
      >
        {unreachable && channels === undefined ? (
          <p className="font-ui text-sm text-muted">Waiting for the server.</p>
        ) : loading && channels === undefined ? (
          <p className="font-ui text-sm text-muted">Loading…</p>
        ) : (channels ?? []).length === 0 ? (
          <p className="font-ui text-sm text-muted">
            No channels yet. An alert needs somewhere to go.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {(channels ?? []).map((channel) => {
              const entry = kindOf(channel.kind);
              const Glyph = entry.icon;
              const waiting = waitingWord(channel);
              // The server turned this one off and delivers nothing to
              // it, whatever else the row would have said: that state
              // comes first, and the way back is not the one it was
              // waiting for.
              const off = !channel.enabled;
              return (
                <li
                  key={channel.id}
                  ref={(element) => {
                    if (element) rows.current.set(channel.id, element);
                    else rows.current.delete(channel.id);
                  }}
                  className="py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="flex min-h-[56px] items-center gap-3">
                    <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-sunken text-text">
                      <Glyph size={16} strokeWidth={1.5} aria-hidden />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-ui text-sm font-medium text-text">{entry.label}</span>
                      <span
                        className={clsx(
                          "truncate text-xs text-muted",
                          channel.kind === "webhook" || channel.kind === "ntfy" ? "font-data" : "font-ui",
                        )}
                        title={targetOf(channel)}
                      >
                        {targetOf(channel)}
                      </span>
                    </span>
                    {off ? (
                      <Pill
                        tone="pending"
                        icon={<AlertTriangle size={12} strokeWidth={2} aria-hidden className="shrink-0" />}
                      >
                        Not delivering
                      </Pill>
                    ) : waiting !== null ? (
                      <Pill tone="pending" icon={<Clock size={12} strokeWidth={2} aria-hidden className="shrink-0" />}>
                        {waiting}
                      </Pill>
                    ) : (
                      <Pill tone="neutral" icon={<Check size={12} strokeWidth={2} aria-hidden className="shrink-0" />}>
                        Linked
                      </Pill>
                    )}
                    {!off && waiting !== null && channel.telegram_url && (
                      <Button
                        variant="ghost"
                        className="h-9"
                        onClick={() => void openUrl(channel.telegram_url!)}
                      >
                        <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
                        Open Telegram
                      </Button>
                    )}
                    {!off && waiting !== null && channel.kind === "email" && (
                      <Button variant="ghost" className="h-9" onClick={() => setConfirming(channel)}>
                        Enter code
                      </Button>
                    )}
                    <RowMenu
                      label={`${entry.label} ${targetOf(channel)}`}
                      busy={testing === channel.id || remove.isPending}
                      items={[
                        {
                          icon: Send,
                          label: "Send a test",
                          blocked: testBlocked(channel),
                          onSelect: () => sendTest(channel),
                        },
                        { icon: Trash2, label: "Remove", onSelect: () => askRemoval(channel) },
                      ]}
                    />
                  </div>
                  {removing === channel.id && (
                    <RemoveNote
                      busy={remove.isPending}
                      onConfirm={() => setIdentity(channel)}
                      onCancel={() => cancelRemoval(channel.id)}
                    />
                  )}
                  {off && (
                    // Amber, and the words say it on their own: nothing
                    // is at risk on chain, something has to be done for
                    // the alerts to arrive again.
                    <Notice tone="info" role="status" className="mt-2">
                      {offReason(channel)}
                    </Notice>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className={clsx("-ml-3", (channels ?? []).length > 0 ? "mt-3" : "mt-2")}>
          <Button variant="ghost" onClick={() => setAdding(true)} disabled={channels === undefined}>
            <Plus size={14} strokeWidth={1.5} aria-hidden />
            Add a channel
          </Button>
        </div>
      </SectionCard>
      {error !== undefined && <FailureNote error={error} onRetry={onRetry} />}
      {failure !== undefined && <FailureNote error={failure} />}
      {identity !== null && (
        <IdentityModal
          action="Remove"
          busyLabel="Removing…"
          tone="danger"
          run={(secret) => remove.mutateAsync({ id: identity.id, secret })}
          onDone={() => {
            const id = identity.id;
            setIdentity(null);
            setRemoving((current) => (current === id ? null : current));
            showToast("Channel removed");
            focusHeading();
          }}
          onFailure={(problem) => {
            setIdentity(null);
            setFailure(problem);
          }}
          onCancel={() => setIdentity(null)}
        />
      )}
      {confirming !== null && (
        <Modal
          open
          onClose={() => setConfirming(null)}
          centered
          width={520}
          title="Confirm this e-mail address"
        >
          <CodeForm
            channel={confirming}
            sentTo={targetOf(confirming)}
            onDone={() => setConfirming(null)}
          />
        </Modal>
      )}
      {adding && (
        <AddChannelModal
          channels={channels ?? []}
          onClose={() => setAdding(false)}
          onCreated={(created, first) => {
            // The first channel is proved out on the spot: nobody wants
            // to learn at the first alert that nothing arrives. A
            // Telegram channel waits for its bot first.
            if (first && created.channel.linked) sendTest(created.channel);
          }}
        />
      )}
    </>
  );
}

/** The question before a channel goes, under its row. Amber: nothing
    on chain is at stake, but the alerts that went there stop at once,
    and the way back is to add it again. Cancel first, the destructive
    yes last. */
function RemoveNote({
  busy,
  onConfirm,
  onCancel,
}: {
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Notice
      tone="info"
      role="status"
      className="mt-2.5"
      action={
        <span className="flex items-center gap-2">
          <Button variant="ghost" className={GHOST_ON_TINT} disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="danger"
            className="h-9"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={onConfirm}
          >
            Remove
          </Button>
        </span>
      }
    >
      Remove this channel? Gerfaut stops sending alerts to it at once.
    </Notice>
  );
}

type Step =
  | { kind: "pick" }
  | { kind: "email" }
  | { kind: "webhook" }
  | { kind: "code"; created: NewChannel; address: string }
  | { kind: "ntfy"; created: NewChannel }
  | { kind: "telegram"; created: NewChannel };

/** Adding a channel: the four kinds, then what each needs. ntfy and
    Telegram need nothing typed and are created on the spot, then show
    what to do with them; e-mail and webhook take a form first. */
function AddChannelModal({
  channels,
  onClose,
  onCreated,
}: {
  channels: Channel[];
  onClose: () => void;
  onCreated: (created: NewChannel, first: boolean) => void;
}) {
  const add = useAddChannel();
  const { showToast } = useUi();
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [failure, setFailure] = useState<unknown>(undefined);
  const [target, setTarget] = useState("");
  const [secret, setSecret] = useState("");
  const [copied, setCopied] = useState(false);
  const first = channels.length === 0;

  const create = (kind: ChannelKind, fields?: { target?: string; secret?: string }) => {
    setFailure(undefined);
    add.mutate(
      { kind, ...fields },
      {
        onSuccess: (created) => {
          onCreated(created, first);
          if (kind === "ntfy" || kind === "telegram") {
            setStep({ kind, created });
          } else if (kind === "email") {
            // Created, but silent: the server wrote once, to send the
            // code, and writes nothing else until it comes back.
            setStep({ kind: "code", created, address: fields?.target ?? "" });
          } else {
            showToast("Channel added");
            onClose();
          }
        },
        onError: (problem) => setFailure(problem),
      },
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (add.isPending) return;
    if (step.kind === "email") create("email", { target: target.trim() });
    if (step.kind === "webhook")
      create("webhook", {
        target: target.trim(),
        secret: secret.length > 0 ? secret : undefined,
      });
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      showToast("Copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The clipboard refused; the URL stays selectable on screen.
    }
  };

  // A channel is complete once made: closing the summary keeps it.
  const title =
    step.kind === "pick"
      ? "Add a channel"
      : step.kind === "email"
        ? "Add an e-mail channel"
        : step.kind === "webhook"
          ? "Add a webhook"
          : step.kind === "code"
            ? "Confirm this e-mail address"
            : step.kind === "ntfy"
              ? "Subscribe to this topic in the ntfy app"
              : "Link Telegram";

  const linked =
    step.kind === "telegram" &&
    (channels.find((channel) => channel.id === step.created.channel.id)?.linked ?? false);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target.trim());
  const webhookValid = /^https:\/\/\S+$/.test(target.trim());

  return (
    <Modal open onClose={onClose} centered width={520} title={title}>
      <div className="flex flex-col gap-4">
        {step.kind === "pick" && (
          <ul className="-mx-2 flex flex-col gap-1">
            {KINDS.map(({ kind, icon: Icon, label, hint }) => (
              <li key={kind}>
                <button
                  type="button"
                  disabled={add.isPending}
                  aria-busy={add.isPending && add.variables?.kind === kind ? true : undefined}
                  onClick={() => {
                    setTarget("");
                    setSecret("");
                    if (kind === "email" || kind === "webhook") setStep({ kind });
                    else create(kind);
                  }}
                  className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-left transition-colors duration-100 hover:bg-sunken/70 disabled:cursor-default disabled:opacity-60"
                >
                  <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-sunken text-text">
                    <Icon size={18} strokeWidth={1.5} aria-hidden />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-ui text-sm font-medium text-text">{label}</span>
                    <span className="font-ui text-xs text-muted">{hint}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {(step.kind === "email" || step.kind === "webhook") && (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div>
              <FieldLabel htmlFor="channel-target">
                {step.kind === "email" ? "E-mail address" : "URL"}
              </FieldLabel>
              <input
                id="channel-target"
                type={step.kind === "email" ? "email" : "url"}
                value={target}
                onChange={(event) => {
                  setFailure(undefined);
                  setTarget(event.target.value);
                }}
                placeholder={step.kind === "email" ? "you@example.org" : "https://"}
                autoComplete="off"
                spellCheck={false}
                className={clsx(
                  "field-focus selectable h-11 w-full rounded-sm border border-transparent bg-sunken px-3 text-text",
                  step.kind === "webhook" ? "font-data text-[13px]" : "font-ui text-sm",
                )}
              />
            </div>
            {step.kind === "webhook" && (
              <div>
                <FieldLabel htmlFor="channel-secret">Secret (optional)</FieldLabel>
                <input
                  id="channel-secret"
                  type="password"
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  autoComplete="off"
                  className="field-focus h-11 w-full rounded-sm border border-transparent bg-sunken px-3 font-data text-[13px] text-text"
                />
              </div>
            )}
            <p className="font-ui text-xs text-muted">
              {step.kind === "email"
                ? "Alerts say which wallet moved, never an address or an amount."
                : "Signed with HMAC-SHA256. See the docs."}
            </p>
            <div className="mt-1 flex items-center justify-end gap-3">
              <Button variant="ghost" onClick={() => setStep({ kind: "pick" })} disabled={add.isPending}>
                Back
              </Button>
              <Button
                type="submit"
                variant="premium"
                disabled={add.isPending || (step.kind === "email" ? !emailValid : !webhookValid)}
                aria-busy={add.isPending || undefined}
              >
                {add.isPending ? "Adding…" : "Add channel"}
              </Button>
            </div>
          </form>
        )}

        {step.kind === "code" && (
          <CodeForm
            channel={step.created.channel}
            sentTo={step.address}
            onDone={onClose}
          />
        )}

        {step.kind === "ntfy" && step.created.subscribe_url && (
          <>
            <p className="font-ui text-sm text-text">
              Add this address as a subscription in the ntfy app. Anyone who has it can read
              the alerts, so keep it to yourself.
            </p>
            <p className="selectable break-all rounded-sm bg-sunken px-3 py-2 font-data text-[13px] leading-6 text-text">
              {step.created.subscribe_url}
            </p>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => void copy(step.created.subscribe_url!)}>
                {copied ? (
                  <Check size={14} strokeWidth={2} aria-hidden />
                ) : (
                  <Copy size={14} strokeWidth={1.5} aria-hidden />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  void openUrl(step.created.subscribe_url!.replace(/^https?:\/\//, "ntfy://"))
                }
              >
                <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
                Open in ntfy
              </Button>
              <Button variant="premium" onClick={onClose}>
                Done
              </Button>
            </div>
          </>
        )}

        {step.kind === "telegram" && (
          <>
            <p className="font-ui text-sm text-text">
              Send this to <span className="font-medium">@GerfautAlertsBot</span>, or open
              Telegram with the code already in place.
            </p>
            <p className="selectable rounded-sm bg-sunken px-3 py-3 text-center font-data text-[22px] tracking-[0.12em] text-text">
              {step.created.channel.link_code ?? "—"}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-3">
              {linked ? (
                <Pill tone="neutral" icon={<Check size={12} strokeWidth={2} aria-hidden className="shrink-0" />}>
                  Linked
                </Pill>
              ) : (
                <p role="status" className="font-ui text-xs text-muted">
                  Waiting for the bot…
                </p>
              )}
              <span className="flex items-center gap-2">
                {!linked && step.created.channel.telegram_url && (
                  <Button
                    variant="secondary"
                    onClick={() => void openUrl(step.created.channel.telegram_url!)}
                  >
                    <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
                    Open Telegram
                  </Button>
                )}
                <Button variant="premium" onClick={onClose}>
                  Done
                </Button>
              </span>
            </div>
          </>
        )}

        {failure !== undefined && <FailureNote error={failure} />}
      </div>
    </Modal>
  );
}
