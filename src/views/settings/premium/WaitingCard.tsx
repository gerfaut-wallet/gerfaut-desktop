import { Hourglass } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/Button";
import type { Device } from "../../../lib/ipc";
import { dayMonthYear } from "../../../lib/premium";
import { SectionCard } from "../primitives";
import { ForgetKey } from "./ForgetKey";
import { FailureNote } from "./shared";

/** What a device waiting for approval sees in place of the account.
 *
 *  For ten days, or until a device with full access approves it, the
 *  server shows it nothing: no wallets, no channels, no alerts. The
 *  card says when that ends and how to end it sooner, and why the wait
 *  is there at all — it is what stands between a stolen key and the
 *  account. "Check again" asks the server now; the key can leave this
 *  device the usual way. */
export function WaitingCard({
  device,
  checking,
  error,
  onCheck,
}: {
  device: Device;
  /** "Check again" is in flight. */
  checking: boolean;
  /** What the last check left behind. */
  error?: unknown;
  onCheck: () => void;
}) {
  const [forgetting, setForgetting] = useState(false);
  const until = device.pending_until ?? device.connected_at;

  return (
    <>
      <SectionCard
        icon={<Hourglass size={18} strokeWidth={1.5} />}
        title="Waiting for approval"
        premium
      >
        <div className="flex max-w-2xl flex-col gap-2 font-ui text-sm leading-5 text-text">
          <p className="text-pretty">
            This device connected to your Premium account on{" "}
            <span className="tabular font-medium">{dayMonthYear(device.connected_at)}</span>. It
            shows your watched wallets, channels and alerts once one of your other devices
            approves it, or on <span className="tabular font-medium">{dayMonthYear(until)}</span>{" "}
            without approval.
          </p>
          <p>Approve it in Gerfaut on another device: Settings › Premium › Devices.</p>
          <p className="text-xs text-muted">
            The wait protects you if someone else gets your key: they see nothing and can change
            nothing while you are warned.
          </p>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            disabled={checking}
            aria-busy={checking || undefined}
            onClick={onCheck}
          >
            {checking ? "Checking…" : "Check again"}
          </Button>
          <Button
            variant="ghost"
            disabled={forgetting}
            aria-expanded={forgetting}
            onClick={() => setForgetting(true)}
          >
            Forget this key
          </Button>
        </div>
        {forgetting && (
          <div className="mt-4">
            <ForgetKey allowDelete={false} confirm={false} onClose={() => setForgetting(false)} />
          </div>
        )}
      </SectionCard>
      {error !== undefined && <FailureNote error={error} onRetry={onCheck} />}
    </>
  );
}
