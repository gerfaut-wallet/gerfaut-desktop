import { clsx } from "clsx";
import { Circle, CircleCheck, Copy, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Button } from "../../../components/Button";
import { Notice } from "../../../components/Notice";
import { useHideChecklist, useSetKeySaved } from "../../../state/premiumQueries";
import { useUi } from "../../../state/store";
import { SectionCard } from "../primitives";
import { FailureNote } from "./shared";

/** Where each of the three gestures stands. */
export interface Protection {
  /** At least two devices have full access. */
  secondDevice: boolean;
  /** The app lock is on. */
  appLock: boolean;
  /** "Mark as done" was pressed for the key in place. */
  keySaved: boolean;
}

/** Whether nothing is left to suggest: the card then goes on its own. */
export function fullyProtected(protection: Protection): boolean {
  return protection.secondDevice && protection.appLock && protection.keySaved;
}

/** Three gestures that keep the account out of reach of someone who
 *  gets the key or this device, each ticked from what is true rather
 *  than from a click where the app can tell: a second device with full
 *  access, the app lock, the key kept somewhere safe. The last is the
 *  one only its owner can vouch for. Not a sequence, so no numbers: a
 *  ring that closes into a tick, and the words say it too. */
export function ProtectCard({ keyText, protection }: { keyText: string; protection: Protection }) {
  const { showToast, openSettings } = useUi();
  const hide = useHideChecklist();
  const saved = useSetKeySaved();
  const [failure, setFailure] = useState<unknown>(undefined);

  /** The clipboard refused the key: said under the step, not in a
      toast gone before it is read. */
  const [copyFailed, setCopyFailed] = useState(false);

  const copyKey = async () => {
    const copied = await navigator.clipboard
      .writeText(keyText)
      .then(() => true)
      .catch(() => false);
    setCopyFailed(!copied);
    if (copied) showToast("Key copied");
  };

  return (
    <>
      <SectionCard
        icon={<ShieldCheck size={18} strokeWidth={1.5} />}
        title="Protect your Premium account"
        premium
      >
        <ul className="flex flex-col divide-y divide-border">
          <Step
            done={protection.secondDevice}
            title="Connect a second device"
            hint="Enter this key in Gerfaut on your computer or another phone, then approve it here. If this device is lost, the other keeps full access."
          />
          <Step
            done={protection.appLock}
            title="Turn on the app lock"
            hint="Anyone holding this device unlocked could approve a stranger's device. A PIN stops them."
          >
            <Button variant="ghost" className="h-9" onClick={() => openSettings("security")}>
              Set up
            </Button>
          </Step>
          <Step
            done={protection.keySaved}
            title="Save your key in a password manager"
            hint="Your key is the whole account. Nobody can send it to you again."
            note={
              copyFailed && (
                <Notice tone="info" role="alert">
                  Could not copy the key.
                </Notice>
              )
            }
          >
            <Button variant="ghost" className="h-9" onClick={() => void copyKey()}>
              <Copy size={14} strokeWidth={1.5} aria-hidden />
              Copy key
            </Button>
            <Button
              variant="ghost"
              className="h-9"
              disabled={saved.isPending}
              aria-busy={saved.isPending || undefined}
              onClick={() => {
                setFailure(undefined);
                saved.mutate(true, { onError: setFailure });
              }}
            >
              Mark as done
            </Button>
          </Step>
        </ul>
        <div className="-ml-3 mt-3">
          <Button
            variant="ghost"
            disabled={hide.isPending}
            aria-busy={hide.isPending || undefined}
            onClick={() => {
              setFailure(undefined);
              hide.mutate(undefined, { onError: setFailure });
            }}
          >
            Hide
          </Button>
        </div>
      </SectionCard>
      {failure !== undefined && <FailureNote error={failure} />}
    </>
  );
}

/** One gesture: its state as a shape and as words, what it is, why,
    and the way to do it while it is not done. */
function Step({
  done,
  title,
  hint,
  note,
  children,
}: {
  done: boolean;
  title: string;
  hint: string;
  /** What the step's own action left behind, under it. */
  note?: ReactNode;
  children?: ReactNode;
}) {
  const Glyph = done ? CircleCheck : Circle;
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
      <span className="flex h-5 shrink-0 items-center">
        <Glyph
          size={18}
          strokeWidth={1.5}
          aria-hidden
          data-done={done || undefined}
          className={done ? "text-text" : "text-muted"}
        />
      </span>
      <span className="flex min-w-[12rem] flex-1 flex-col gap-0.5">
        <span
          className={clsx(
            "font-ui text-sm font-medium leading-5",
            done ? "text-muted" : "text-text",
          )}
        >
          <span className="sr-only">{done ? "Done: " : "To do: "}</span>
          {title}
        </span>
        <span className="max-w-xl font-ui text-xs text-muted">{hint}</span>
      </span>
      {!done && children && (
        <span className="ml-auto flex items-center gap-1 self-center">{children}</span>
      )}
      {!done && note && <div className="basis-full pl-[30px]">{note}</div>}
    </li>
  );
}
