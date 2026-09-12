import { Bell } from "lucide-react";
import { notifier } from "../../state/notifications";
import { useUi } from "../../state/store";
import { SectionCard, Segmented, SettingRow, Toggle } from "./primitives";

/** How often Gerfaut syncs on its own while it is open. */
const INTERVALS: { value: string; label: string }[] = [
  { value: "0", label: "Off" },
  { value: "300", label: "5 min" },
  { value: "900", label: "15 min" },
  { value: "3600", label: "1 hour" },
];

/** The settings card for what Gerfaut says on its own: a notice when a
    sync finds a transaction, and how often to look while it is open.
    Both are off until asked for. */
export function NotificationsSection() {
  const {
    notifyNewTx,
    notifyInterval,
    notificationsRefused,
    setNotifyNewTx,
    setNotifyInterval,
    setNotificationsRefused,
  } = useUi();

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

  return (
    <SectionCard icon={<Bell size={18} strokeWidth={1.5} />} title="Notifications">
      <div className="flex flex-col gap-5">
        <div>
          <SettingRow
            title="New transactions"
            hint="A notification when a sync finds a transaction you have not seen. Amounts follow the display unit and stay hidden while balances are masked. Notifications already shown stay in the system notification center after Gerfaut locks; Hide amounts is what keeps amounts out of them."
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
        <SettingRow
          title="Check while open"
          hint="Syncs every wallet with your configured backend on that rhythm while Gerfaut is open: the same servers, nothing else."
        >
          <Segmented
            label="Check while open"
            value={String(notifyInterval)}
            onChange={(value) => setNotifyInterval(Number(value))}
            options={INTERVALS.map((interval) => ({
              ...interval,
              // Nothing to schedule while nothing would be said.
              disabled: !notifyNewTx,
            }))}
          />
        </SettingRow>
      </div>
    </SectionCard>
  );
}
