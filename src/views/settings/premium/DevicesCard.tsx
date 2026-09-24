import { Check, Clock, Laptop, Monitor, MonitorSmartphone, Smartphone, Unplug } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/Button";
import { Notice } from "../../../components/Notice";
import { Pill } from "../../../components/StatusPill";
import type { Device } from "../../../lib/ipc";
import {
  PENDING_DAYS,
  dayMonthYear,
  platformLabel,
  waitingWords,
} from "../../../lib/premium";
import { useApproveDevice, useRemoveDevice } from "../../../state/premiumQueries";
import { useUi } from "../../../state/store";
import { SectionCard } from "../primitives";
import { IdentityModal } from "./IdentityModal";
import { RowMenu } from "./RowMenu";
import { FailureNote, GHOST_ON_TINT, GLYPH_CHIP, useFocusAfterRender } from "./shared";

/** A phone is a phone, a Mac a laptop, the rest a screen. */
function glyphOf(platform: string): LucideIcon {
  switch (platform) {
    case "android":
    case "ios":
      return Smartphone;
    case "macos":
      return Laptop;
    default:
      return Monitor;
  }
}

type Question = "approve" | "refuse" | "disconnect";

/** What each question says, how its yes reads, and what it does. The
    notes are amber: no coin is at stake, but each of these changes who
    can use the account, and the sentence says how before the yes. */
const QUESTIONS: Record<
  Question,
  { words: string; yes: string; busy: string; tone: "premium" | "danger"; done: string }
> = {
  approve: {
    words:
      "Approve only a device you just connected yourself. Once approved, it sees your watched wallets, channels and alerts, and can change them.",
    yes: "Approve",
    busy: "Approving…",
    tone: "premium",
    done: "Device approved",
  },
  refuse: {
    words:
      "Refuse this device? It is disconnected at once and sees nothing. If you did not connect it, someone has your key: change it in Licence above.",
    yes: "Refuse",
    busy: "Refusing…",
    tone: "danger",
    done: "Device refused",
  },
  disconnect: {
    words:
      "Disconnect this device? It loses access at once. To use Premium there again, enter the key on it and approve it here.",
    yes: "Disconnect",
    busy: "Disconnecting…",
    tone: "danger",
    done: "Device disconnected",
  },
};

/** Every device that entered the key, oldest first, and what a device
 *  with full access can do about each: approve or refuse one that
 *  waits, disconnect one that has access. Each asks under its row
 *  first, then for the app lock's secret; nothing leaves before both.
 *  This device is marked and has no action here: it leaves through
 *  "Forget this key". */
export function DevicesCard({
  devices,
  loading,
  error,
  onRetry,
}: {
  devices: Device[] | undefined;
  loading: boolean;
  error?: unknown;
  onRetry?: () => void;
}) {
  const approve = useApproveDevice();
  const remove = useRemoveDevice();
  const { showToast } = useUi();
  const target = useUi((state) => state.settingsTarget);
  const clearTarget = useUi((state) => state.clearSettingsTarget);
  /** The row whose question is open, and which question. */
  const [open, setOpen] = useState<{ id: string; question: Question } | null>(null);
  /** The yes was given: the secret is asked before it goes. */
  const [identity, setIdentity] = useState<{ id: string; question: Question } | null>(null);
  const [failure, setFailure] = useState<unknown>(undefined);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusHeading = useFocusAfterRender(heading);
  /** Each row, to hand the focus back to what asked on Cancel. */
  const rows = useRef(new Map<string, HTMLElement>());
  const busy = approve.isPending || remove.isPending;

  // "Review" on the Overview lands here: the card comes into view and
  // its heading takes the focus, so the next Tab is the first row.
  useEffect(() => {
    if (target !== "devices") return;
    const node = heading.current;
    node?.closest("section")?.scrollIntoView({ block: "start" });
    node?.focus({ preventScroll: true });
    clearTarget();
  }, [target, clearTarget]);

  const ask = (id: string, question: Question) => {
    setFailure(undefined);
    setOpen({ id, question });
  };

  const cancel = (id: string, question: Question) => {
    setOpen(null);
    const row = rows.current.get(id);
    const back =
      question === "disconnect"
        ? row?.querySelector<HTMLElement>("[aria-haspopup]")
        : row?.querySelector<HTMLElement>(`[data-question="${question}"]`);
    back?.focus();
  };

  const run = (id: string, question: Question, secret: string) =>
    question === "approve"
      ? approve.mutateAsync({ id, secret })
      : remove.mutateAsync({ id, secret });

  return (
    <>
      <SectionCard
        icon={<MonitorSmartphone size={18} strokeWidth={1.5} />}
        title="Devices"
        headingRef={heading}
        className="scroll-mt-4"
        premium
      >
        <p className="-mt-2 mb-4 max-w-2xl font-ui text-sm text-muted">
          Every device that entered your key. A new one waits 10 days, or until you approve it
          here.
        </p>
        {devices === undefined ? (
          <p className="font-ui text-sm text-muted">
            {loading ? "Loading…" : "Waiting for the server."}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {devices.map((device) => {
              const Glyph = glyphOf(device.platform);
              const label = platformLabel(device.platform);
              const pending = device.access === "pending";
              const question = open?.id === device.id ? open.question : null;
              return (
                <li
                  key={device.id}
                  ref={(element) => {
                    if (element) rows.current.set(device.id, element);
                    else rows.current.delete(device.id);
                  }}
                  className="flex flex-col py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="flex min-h-[56px] flex-wrap items-center gap-x-3 gap-y-2">
                    <span className={GLYPH_CHIP}>
                      <Glyph size={16} strokeWidth={1.5} aria-hidden />
                    </span>
                    <span className="flex min-w-[10rem] flex-1 flex-col">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-ui text-sm font-medium text-text">{label}</span>
                        {device.this_device && <Pill tone="neutral">This device</Pill>}
                      </span>
                      <span className="tabular font-ui text-xs text-muted">
                        Connected {dayMonthYear(device.connected_at)}
                      </span>
                    </span>
                    <span className="ml-auto flex items-center gap-2">
                      {pending ? (
                        <Pill
                          tone="pending"
                          icon={<Clock size={12} strokeWidth={2} aria-hidden className="shrink-0" />}
                        >
                          {waitingWords(
                            device.pending_until ?? device.connected_at + PENDING_DAYS * 86_400,
                          )}
                        </Pill>
                      ) : (
                        <Pill
                          tone="neutral"
                          icon={<Check size={12} strokeWidth={2} aria-hidden className="shrink-0" />}
                        >
                          Full access
                        </Pill>
                      )}
                      {pending && (
                        <>
                          <Button
                            variant="danger"
                            className="h-9"
                            data-question="refuse"
                            disabled={busy}
                            aria-expanded={question === "refuse"}
                            aria-label={`Refuse the ${label} connected ${dayMonthYear(device.connected_at)}`}
                            onClick={() => ask(device.id, "refuse")}
                          >
                            Refuse
                          </Button>
                          <Button
                            variant="premium"
                            className="h-9"
                            data-question="approve"
                            disabled={busy}
                            aria-expanded={question === "approve"}
                            aria-label={`Approve the ${label} connected ${dayMonthYear(device.connected_at)}`}
                            onClick={() => ask(device.id, "approve")}
                          >
                            Approve
                          </Button>
                        </>
                      )}
                      {!pending && !device.this_device && (
                        <RowMenu
                          label={`${label} connected ${dayMonthYear(device.connected_at)}`}
                          busy={busy}
                          items={[
                            {
                              icon: Unplug,
                              label: "Disconnect",
                              onSelect: () => ask(device.id, "disconnect"),
                            },
                          ]}
                        />
                      )}
                    </span>
                  </div>
                  {question !== null && (
                    <DeviceQuestion
                      question={question}
                      busy={busy}
                      onConfirm={() => setIdentity({ id: device.id, question })}
                      onCancel={() => cancel(device.id, question)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
      {error !== undefined && <FailureNote error={error} onRetry={onRetry} />}
      {failure !== undefined && <FailureNote error={failure} />}
      {identity !== null && (
        <IdentityModal
          action={QUESTIONS[identity.question].yes}
          busyLabel={QUESTIONS[identity.question].busy}
          tone={QUESTIONS[identity.question].tone}
          run={(secret) => run(identity.id, identity.question, secret)}
          onDone={() => {
            const { id, question } = identity;
            setIdentity(null);
            setOpen((current) => (current?.id === id ? null : current));
            showToast(QUESTIONS[question].done);
            focusHeading();
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

/** The question under a row: the sentence, then Cancel and the yes,
    Cancel first. It answers a click, so a screen reader hears it as
    it appears. */
function DeviceQuestion({
  question,
  busy,
  onConfirm,
  onCancel,
}: {
  question: Question;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { words, yes, tone } = QUESTIONS[question];
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
            variant={tone}
            className="h-9"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={onConfirm}
          >
            {yes}
          </Button>
        </span>
      }
    >
      {words}
    </Notice>
  );
}
