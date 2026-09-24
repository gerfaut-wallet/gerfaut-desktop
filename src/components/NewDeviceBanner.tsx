import { clsx } from "clsx";
import { ShieldAlert } from "lucide-react";
import { Button } from "./Button";
import { pendingDevices } from "../lib/premium";
import { usePremiumDevice, usePremiumDevices, usePremiumStatus } from "../state/premiumQueries";
import { useUi } from "../state/store";

/** The alert banner shown while a device waits for approval on the
    account. Someone connected with the key: if it was not the owner,
    the key is out, and this is the moment to act. Red, at the head of
    the Overview, with the one way to act; it has no dismissal and goes
    on its own once nothing waits — approved, refused, or past its ten
    days. Only a device with full access sees it: one still waiting
    could do nothing about another. */
export function NewDeviceBanner({ className }: { className?: string }) {
  const status = usePremiumStatus();
  const connected = status.data?.key != null && status.data.disconnected === false;
  const device = usePremiumDevice(connected);
  const devices = usePremiumDevices(connected && device.data?.access === "full");
  if (pendingDevices(devices.data).length === 0) return null;

  return (
    <div
      role="alert"
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
