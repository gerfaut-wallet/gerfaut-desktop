import { clsx } from "clsx";
import { ShieldAlert } from "lucide-react";
import { useEffect } from "react";
import { Button } from "./Button";
import { pendingDevices } from "../lib/premium";
import {
  useForgetDevicesWhenDisconnected,
  usePremiumDevice,
  usePremiumDevices,
  usePremiumStatus,
} from "../state/premiumQueries";
import { useUi } from "../state/store";

/** The waiting devices the banner last announced, by id: the ones a
    screen reader has already been told of in this session. */
let lastAnnounced = "";

/** Forgets what was announced; for the tests, which start fresh. */
export function resetBannerAnnouncement(): void {
  lastAnnounced = "";
}

/** The alert banner shown while a device waits for approval on the
    account. Someone connected with the key: if it was not the owner,
    the key is out, and this is the moment to act. Red, at the head of
    the Overview, with the one way to act; it has no dismissal and goes
    on its own once nothing waits — approved, refused, or past its ten
    days. Only a device with full access sees it: one still waiting
    could do nothing about another. */
export function NewDeviceBanner({ className }: { className?: string }) {
  const status = usePremiumStatus();
  useForgetDevicesWhenDisconnected(status.data);
  const connected = status.data?.key != null && status.data.disconnected === false;
  const device = usePremiumDevice(connected);
  const full = connected && device.data?.access === "full";
  const devices = usePremiumDevices(full);
  const waiting = full ? pendingDevices(devices.data) : [];
  const which = waiting.map((entry) => entry.id).join(" ");
  // Said out loud once for a given set of waiting devices, not again
  // each time the Overview opens: the banner stays, the alarm does not
  // repeat itself.
  const fresh = which !== "" && which !== lastAnnounced;
  useEffect(() => {
    if (which !== "") lastAnnounced = which;
  }, [which]);
  if (waiting.length === 0) return null;

  // Keyed on the set: another device joining the wait arrives as a new
  // alert, which is what a screen reader announces.
  return (
    <div
      key={which}
      role={fresh ? "alert" : undefined}
      className={clsx(
        "flex flex-wrap items-center gap-3 rounded-md border border-alert/25 bg-alert-surface px-4 py-3 text-alert",
        className,
      )}
    >
      <ShieldAlert size={18} strokeWidth={1.75} aria-hidden className="shrink-0" />
      <p className="min-w-0 flex-1 font-ui text-sm leading-5">
        A new device asks for access to your Premium account. If it is not yours, refuse it and
        change your key.
      </p>
      <Button
        variant="ghost"
        className="h-9 hover:bg-surface hover:shadow-[inset_0_0_0_1px_var(--color-border)] dark:hover:bg-sunken dark:hover:shadow-none"
        onClick={() => useUi.getState().openSettings("premium", "devices")}
      >
        Review
      </Button>
    </div>
  );
}
