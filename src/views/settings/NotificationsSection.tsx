import { Bell, CircleOff, Clock, Radio, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";
import { Button } from "../../components/Button";
import { Notice } from "../../components/Notice";
import { ipc, isCommandError } from "../../lib/ipc";
import type { Settings, WatchState, WatchStatus } from "../../lib/ipc";
import {
  isOwnNode,
  liveStatusKey,
  liveStatusLine,
  shortOfRoom,
  shortOfRoomWords,
  useLiveStatus,
  usesAutomaticBackend,
} from "../../state/live";
import { useUi } from "../../state/store";
import { GHOST_ON_TINT } from "./premium/shared";
import { SaveFailure, SectionCard, SettingRow, Toggle } from "./primitives";

/** What the live watch leaves to the syncs when it is short of room, and
    the way out: a node of one's own, where it follows ten times more,
    or on it, the node's own setting. Amber, under the status: nothing
    is at risk, a payment to those addresses only shows later. Which
    wallets, the badges in Settings › Wallets and on each Overview say. */
function ShortOfRoomNote({ status, ownNode }: { status: WatchStatus; ownNode: boolean }) {
  const openSettings = useUi((state) => state.openSettings);
  const words = shortOfRoomWords(status, ownNode);
  return (
    <Notice
      tone="info"
      className="mt-2.5 max-w-2xl"
      action={
        // The node settings are the way out only off one's own node: on
        // it, what is left to change is in the node's configuration.
        !ownNode && words.remedy !== null ? (
          <Button
            variant="ghost"
            className={GHOST_ON_TINT}
            onClick={() => openSettings("network")}
          >
            Node settings
          </Button>
        ) : undefined
      }
    >
      {words.limits} {words.waiting}
      {words.remedy !== null && ` ${words.remedy}`}
    </Notice>
  );
}

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
  const { notifyNewTx, setNotifyNewTx } = useUi();
  /** The vault refused the switch: it went back, and this says why. */
  const [saveFailure, setSaveFailure] = useState<unknown>(null);
  const live = useLiveStatus();
  const client = useQueryClient();
  /** The switch was just turned on, and the watch is on its way: the
      vault writes the preference and the Rust side starts the watch
      before either answers, a second or more on a remote server, and
      the line said "Off" under a switch that said on all that time. */
  const [turningOn, setTurningOn] = useState(false);
  const [test, setTest] = useState<TestResult>(null);
  const [testing, setTesting] = useState(false);

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
  const starting = notifyNewTx && turningOn && (!status || status.state === "off");
  const automatic = usesAutomaticBackend(settings.backends, settings.active_network);
  const ownNode = isOwnNode(settings.backends[settings.active_network]);

  return (
    <SectionCard icon={<Bell size={18} strokeWidth={1.5} />} title="Notifications">
      <div className="flex flex-col gap-5">
        <div>
          <SettingRow
            title="New transactions"
            hint="A notification when a transaction appears and again when it confirms, while Gerfaut is open, minimised or locked."
          >
            <Toggle
              checked={notifyNewTx}
              onChange={(on) => {
                setSaveFailure(null);
                setTurningOn(on);
                setNotifyNewTx(on)
                  // The status read once the watch has started, so the
                  // line goes from "Connecting…" to where it stands.
                  .then(() => client.refetchQueries({ queryKey: liveStatusKey }))
                  .catch(setSaveFailure)
                  .finally(() => setTurningOn(false));
              }}
              label="Notify about new transactions"
            />
          </SettingRow>
          <SaveFailure error={saveFailure} />
        </div>

        <div>
          <p className="font-ui text-sm font-medium text-text">Live watch</p>
          <p
            role="status"
            aria-label="Live watch status"
            className="mt-1.5 flex items-center gap-2 font-ui text-sm text-text"
          >
            {STATE_ICON[starting ? "connecting" : notifyNewTx && status ? status.state : "off"]}
            <span className="min-w-0 break-words">
              {starting ? "Connecting…" : notifyNewTx && status ? liveStatusLine(status) : "Off"}
            </span>
          </p>
          {notifyNewTx && status?.state === "reconnecting" && status.detail && (
            <p className="mt-1 break-words font-ui text-xs text-muted">{status.detail}</p>
          )}
          {notifyNewTx && status && shortOfRoom(status) && (
            <ShortOfRoomNote status={status} ownNode={ownNode} />
          )}
          <p className="mt-1.5 max-w-xl font-ui text-xs text-muted">
            While this is on, Gerfaut keeps one connection open to your backend, which learns
            what a sync already tells it and how long Gerfaut stays connected.
            {automatic &&
              " With the Automatic backend, that is an Electrum server of an operator already in the rotation: Electrum is what pushes changes."}
          </p>
        </div>

        <div>
          <Button
            variant="ghost"
            className="-ml-4"
            disabled={testing}
            onClick={() => void sendTest()}
          >
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
