import { Bell, CircleOff, Clock, Radio, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Button } from "../../components/Button";
import { ipc, isCommandError } from "../../lib/ipc";
import type { Settings, WatchState } from "../../lib/ipc";
import { liveStatusLine, useLiveStatus, usesAutomaticBackend } from "../../state/live";
import { notifier } from "../../state/notifications";
import { useUi } from "../../state/store";
import { SectionCard, SettingRow, Toggle } from "./primitives";

/** The state is never said by colour alone: a glyph, then the words. */
const STATE_ICON: Record<WatchState, ReactNode> = {
  connected: <Radio size={14} strokeWidth={1.5} aria-hidden className="text-confirmed" />,
  polling: <Clock size={14} strokeWidth={1.5} aria-hidden className="text-muted" />,
  connecting: <RefreshCw size={14} strokeWidth={1.5} aria-hidden className="text-muted" />,
  reconnecting: <RefreshCw size={14} strokeWidth={1.5} aria-hidden className="text-pending" />,
  off: <CircleOff size={14} strokeWidth={1.5} aria-hidden className="text-muted" />,
};

type TestResult = { ok: true } | { ok: false; message: string } | null;

/** The settings card for what Gerfaut says on its own: a notification
    when a transaction shows up and when it confirms. Off until asked
    for, because being told at once means a connection held open, and
    the card says what that connection tells the server. */
export function NotificationsSection({
  settings,
}: {
  settings: Pick<Settings, "backends" | "active_network">;
}) {
  const { notifyNewTx, notificationsRefused, setNotifyNewTx, setNotificationsRefused } = useUi();
  const live = useLiveStatus();
  const [test, setTest] = useState<TestResult>(null);
  const [testing, setTesting] = useState(false);

  // Turning it on asks the system first; a refusal is said rather than
  // pretended away.
  const toggle = async (on: boolean) => {
    if (!on) {
      setNotifyNewTx(false);
      return;
    }
    try {
      let granted = await notifier.isPermissionGranted();
      if (!granted) granted = (await notifier.requestPermission()) === "granted";
      setNotificationsRefused(!granted);
      if (granted) setNotifyNewTx(true);
    } catch {
      setNotificationsRefused(true);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      await ipc.sendTestNotification();
      setTest({ ok: true });
    } catch (error) {
      setTest({ ok: false, message: isCommandError(error) ? error.message : String(error) });
    } finally {
      setTesting(false);
    }
  };

  const status = live.data?.status;
  const automatic = usesAutomaticBackend(settings.backends, settings.active_network);

  return (
    <SectionCard icon={<Bell size={18} strokeWidth={1.5} />} title="Notifications">
      <div className="flex flex-col gap-5">
        <div>
          <SettingRow
            title="New transactions"
            hint="A notification when a transaction appears, incoming or outgoing, and again when it confirms, for as long as Gerfaut is open, minimised and locked included. Amounts follow the display unit and stay hidden while balances are masked. While Gerfaut is locked, a notification names no wallet and no amount."
          >
            <Toggle
              checked={notifyNewTx}
              onChange={(on) => void toggle(on)}
              label="Notify about new transactions"
            />
          </SettingRow>
          {notificationsRefused && (
            <p className="mt-1.5 font-ui text-xs text-muted">
              Notifications are off for Gerfaut in the system settings.
            </p>
          )}
        </div>

        <div>
          <p className="font-ui text-sm font-medium text-text">Live watch</p>
          <p
            role="status"
            aria-label="Live watch status"
            className="mt-1.5 flex items-center gap-2 font-ui text-sm text-text"
          >
            {STATE_ICON[notifyNewTx && status ? status.state : "off"]}
            <span className="min-w-0 break-words">
              {notifyNewTx && status ? liveStatusLine(status) : "Off"}
            </span>
          </p>
          {notifyNewTx && status?.state === "reconnecting" && status.detail && (
            <p className="mt-1 break-words font-ui text-xs text-muted">{status.detail}</p>
          )}
          <p className="mt-1.5 max-w-xl font-ui text-xs text-muted">
            While this is on, Gerfaut keeps one connection open to your backend. The server
            learns what a sync already tells it, and also how long Gerfaut stays connected.
            {automatic &&
              " With the Automatic backend, Gerfaut first tries an Electrum server run by one of the public operators already in the rotation, because Electrum is what pushes changes."}
          </p>
        </div>

        <div>
          <Button variant="ghost" disabled={testing} onClick={() => void sendTest()}>
            <Bell size={14} strokeWidth={1.5} aria-hidden />
            Send a test notification
          </Button>
          {test !== null && (
            <p role="status" className="mt-1.5 max-w-xl font-ui text-xs text-muted">
              {test.ok
                ? `Sent. If nothing appeared, allow notifications for Gerfaut in the system settings and check that Do Not Disturb is off.${
                    import.meta.env.DEV
                      ? " A development build on Windows posts under PowerShell's name."
                      : ""
                  }`
                : `The system refused the notification: ${test.message}`}
            </p>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
