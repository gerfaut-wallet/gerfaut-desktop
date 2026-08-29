import { Lock } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/Button";
import { Modal } from "../../components/Modal";
import type { AppLock, LockKind } from "../../lib/ipc";
import { isCommandError } from "../../lib/ipc";
import { useLock } from "../../state/lock";
import {
  useClearAppLock,
  useSetAppLock,
  useSetAutoLock,
} from "../../state/queries";
import { useUi } from "../../state/store";
import { FieldLabel, SectionCard, Segmented, SettingRow, Toggle } from "./primitives";

/** How long Gerfaut may sit idle before it asks again. */
const DELAYS: { value: string; label: string }[] = [
  { value: "0", label: "Immediately" },
  { value: "60", label: "1 min" },
  { value: "300", label: "5 min" },
  { value: "900", label: "15 min" },
  { value: "never", label: "Never" },
];

/** A secret field, hidden as it is typed. */
function SecretField({
  id,
  label,
  value,
  onChange,
  autoFocus,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <input
        id={id}
        type="password"
        value={value}
        autoFocus={autoFocus}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-sm bg-sunken px-3 font-ui text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />
    </div>
  );
}

/** The settings card that turns the lock on, changes its secret, and
    says when it comes back. */
export function SecuritySection({ lock }: { lock: AppLock | null }) {
  const { showToast } = useUi();
  const refresh = useLock((state) => state.refresh);
  const lockNow = useLock((state) => state.lockNow);
  const setAppLock = useSetAppLock();
  const clearAppLock = useClearAppLock();
  const setAutoLock = useSetAutoLock();

  const [dialog, setDialog] = useState<"on" | "off" | "change" | null>(null);
  const [kind, setKind] = useState<LockKind>("pin");
  const [current, setCurrent] = useState("");
  const [secret, setSecret] = useState("");
  const [confirm, setConfirm] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const close = () => {
    setDialog(null);
    setCurrent("");
    setSecret("");
    setConfirm("");
    setProblem(null);
  };

  /** What is wrong with the pair, in the core's own terms so the screen
      never promises something the core would refuse. */
  const check = (): string | null => {
    if (kind === "pin" && !/^\d{4,12}$/.test(secret)) {
      return "A PIN is 4 to 12 digits.";
    }
    if (kind === "password" && secret.length < 8) {
      return "A password is at least 8 characters.";
    }
    if (confirm !== secret) return "The two entries differ.";
    return null;
  };

  const save = async () => {
    const wrong = check();
    if (wrong) {
      setProblem(wrong);
      return;
    }
    try {
      await setAppLock.mutateAsync({
        kind,
        secret,
        // Replacing a secret needs the one in place: an unlocked
        // computer must not be enough to set a new PIN.
        current: dialog === "change" ? current : undefined,
      });
      await refresh();
      showToast(dialog === "change" ? "Setting saved" : "App lock on");
      close();
    } catch (error) {
      setProblem(isCommandError(error) ? error.message : String(error));
    }
  };

  const turnOff = async () => {
    try {
      await clearAppLock.mutateAsync(current);
      await refresh();
      showToast("App lock off");
      close();
    } catch (error) {
      setProblem(isCommandError(error) ? error.message : String(error));
    }
  };

  const chooseDelay = async (value: string) => {
    await setAutoLock.mutateAsync(value === "never" ? null : Number(value));
    await refresh();
  };

  return (
    <SectionCard icon={<Lock size={18} strokeWidth={1.5} />} title="Security">
      <div className="flex flex-col gap-5">
        <SettingRow
          title="App lock"
          hint="Asked when Gerfaut opens and after it stays idle for a while. The vault is encrypted either way; the lock is what stops someone at your unlocked computer."
        >
          <Toggle
            checked={lock !== null}
            label="App lock"
            onChange={(on) => {
              setProblem(null);
              if (on) {
                setKind("pin");
                setDialog("on");
              } else {
                setDialog("off");
              }
            }}
          />
        </SettingRow>

        {lock && (
          <>
            <SettingRow title="Lock after" hint="Never still asks at launch.">
              <Segmented
                label="Lock after"
                value={lock.auto_lock_secs === null ? "never" : String(lock.auto_lock_secs)}
                onChange={(value) => void chooseDelay(value)}
                options={DELAYS}
              />
            </SettingRow>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setKind(lock.kind);
                  setProblem(null);
                  setDialog("change");
                }}
              >
                {lock.kind === "pin" ? "Change PIN" : "Change password"}
              </Button>
              <Button variant="ghost" onClick={lockNow}>
                Lock now
              </Button>
            </div>
          </>
        )}
      </div>

      <Modal
        open={dialog === "on" || dialog === "change"}
        onClose={close}
        centered
        width={440}
        title={dialog === "change" ? "Change the app lock" : "Turn on the app lock"}
      >
        <div className="flex flex-col gap-4">
          {dialog === "on" && (
            <div>
              <FieldLabel>Kind</FieldLabel>
              <Segmented
                label="Kind"
                value={kind}
                onChange={(value) => {
                  setKind(value as LockKind);
                  setProblem(null);
                }}
                options={[
                  { value: "pin", label: "PIN" },
                  { value: "password", label: "Password" },
                ]}
              />
              <p className="mt-1.5 font-ui text-xs text-muted">
                {kind === "pin" ? "4 to 12 digits" : "At least 8 characters"}
              </p>
            </div>
          )}
          {dialog === "change" && (
            <SecretField
              id="lock-current"
              label={kind === "pin" ? "Current PIN" : "Current password"}
              value={current}
              onChange={setCurrent}
              autoFocus
            />
          )}
          <SecretField
            id="lock-secret"
            label={kind === "pin" ? "New PIN" : "New password"}
            value={secret}
            onChange={(value) => {
              setSecret(value);
              setProblem(null);
            }}
          />
          <SecretField
            id="lock-confirm"
            label="Confirm"
            value={confirm}
            onChange={(value) => {
              setConfirm(value);
              setProblem(null);
            }}
          />
          {problem && <p className="font-ui text-xs text-muted">{problem}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void save()}>
              {dialog === "change" ? "Change" : "Turn on"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={dialog === "off"}
        onClose={close}
        centered
        width={440}
        title="Turn off the app lock"
      >
        <div className="flex flex-col gap-4">
          <SecretField
            id="lock-current-off"
            label={lock?.kind === "pin" ? "PIN" : "Password"}
            value={current}
            onChange={(value) => {
              setCurrent(value);
              setProblem(null);
            }}
            autoFocus
          />
          {problem && <p className="font-ui text-xs text-muted">{problem}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void turnOff()}>
              Turn off
            </Button>
          </div>
        </div>
      </Modal>
    </SectionCard>
  );
}
