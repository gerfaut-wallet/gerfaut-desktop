import { useEffect } from "react";
import type { WalletMeta } from "../../lib/ipc";
import { isCommandError } from "../../lib/ipc";
import { isDeviceDisconnected, isDevicePending, serverNetwork } from "../../lib/premium";
import { useLock } from "../../state/lock";
import {
  useForgetDevicesWhenDisconnected,
  usePremiumAccount,
  usePremiumChannels,
  usePremiumDevice,
  usePremiumDevices,
  usePremiumEvents,
  usePremiumStatus,
  usePremiumWallets,
} from "../../state/premiumQueries";
import { useWallets } from "../../state/queries";
import { useUi } from "../../state/store";
import { ChannelsCard } from "./premium/ChannelsCard";
import { DevicesCard } from "./premium/DevicesCard";
import { LicenceCard } from "./premium/LicenceCard";
import type { DeviceAccess } from "./premium/LicenceCard";
import { ProtectCard, fullyProtected } from "./premium/ProtectCard";
import { RecentAlertsCard } from "./premium/RecentAlertsCard";
import { WaitingCard } from "./premium/WaitingCard";
import { WatchedWalletsCard } from "./premium/WatchedWalletsCard";

/** The eighth section: the account key, the devices that entered it,
    the wallets the server watches, where it tells, and what it said
    lately. Without a key there is the licence card and nothing else,
    and no call leaves the machine. With one, the server is asked first
    what this device may see: a device waiting for approval gets one
    card that says so and until when; one with full access gets the
    rest. What the licence says comes from the vault, verified offline,
    so the first card never waits on the network. */
export function PremiumSection({ wallets: allWallets }: { wallets: WalletMeta[] }) {
  const status = usePremiumStatus();
  useForgetDevicesWhenDisconnected(status.data);
  const lock = useLock((state) => state.lock);
  const hasKey = status.data?.key != null;
  const connected = hasKey && status.data?.disconnected === false;
  const device = usePremiumDevice(connected);
  const pending = device.data?.access === "pending" || isDevicePending(device.error);
  const full = device.data?.access === "full";
  const account = usePremiumAccount(connected && full);
  const devices = usePremiumDevices(connected && full);
  // The server names its network; until it has, production is mainnet.
  const network = serverNetwork(account.data?.account.network ?? "bitcoin") ?? "mainnet";
  const networkWallets = useWallets(network);
  const ready = connected && full && account.isSuccess;
  const watched = usePremiumWallets(ready);
  const channels = usePremiumChannels(ready);
  const events = usePremiumEvents(ready);
  // The server could not be reached, about this device or about the
  // account: the note under the licence card says so with Retry; the
  // other cards only say they wait.
  const deviceUnreachable = connected && device.isError && !pending;
  const unreachable = deviceUnreachable || (full && account.isError);
  const access: DeviceAccess = full ? "full" : pending ? "pending" : null;

  // The server no longer knows this device, or no longer knows the key
  // it was about to connect with: the core recorded it on the way, and
  // the vault now says so.
  const refetchStatus = status.refetch;
  useEffect(() => {
    const disowned = (error: unknown) =>
      isDeviceDisconnected(error) || (isCommandError(error) && error.kind === "premium_unknown_key");
    if (disowned(device.error) || disowned(account.error)) {
      void refetchStatus();
    }
  }, [device.error, account.error, refetchStatus]);

  // "Review" sent Settings here for the Devices card; when this device
  // turns out to have no such card — waiting, disconnected, no key, or
  // the server out of reach — the errand is over rather than left to
  // fire later.
  const target = useUi((state) => state.settingsTarget);
  const clearTarget = useUi((state) => state.clearSettingsTarget);
  const devicesCardComing = connected && (full || device.isPending);
  const settled = !status.isPending;
  useEffect(() => {
    if (target === "devices" && settled && !devicesCardComing) clearTarget();
  }, [target, settled, devicesCardComing, clearTarget]);

  if (status.isPending) {
    return <p className="px-1 font-ui text-sm text-muted">Loading…</p>;
  }
  if (status.isError || !status.data) {
    return (
      <p className="px-1 font-ui text-sm text-muted">The premium state could not be read.</p>
    );
  }

  const fullDevices = (devices.data ?? []).filter((entry) => entry.access === "full").length;
  const protection = {
    secondDevice: fullDevices >= 2,
    appLock: lock !== null,
    keySaved: status.data.key_saved,
  };
  const licenceError = deviceUnreachable
    ? device.error
    : full && account.isError
      ? account.error
      : undefined;

  return (
    <>
      <LicenceCard
        status={status.data}
        access={access}
        accountError={licenceError}
        onRetryAccount={() => void (deviceUnreachable ? device.refetch() : account.refetch())}
      />
      {connected && device.isPending && (
        <p className="px-1 font-ui text-sm text-muted">Loading…</p>
      )}
      {connected && pending && device.data && (
        <WaitingCard
          device={device.data}
          checking={device.isFetching}
          error={device.isError && !isDevicePending(device.error) ? device.error : undefined}
          onCheck={() => void device.refetch()}
        />
      )}
      {connected && full && (
        <>
          <DevicesCard
            devices={devices.data}
            loading={devices.isPending}
            error={devices.isError ? devices.error : undefined}
            onRetry={() => void devices.refetch()}
          />
          {!status.data.checklist_hidden && devices.isSuccess && !fullyProtected(protection) && (
            <ProtectCard keyText={status.data.key ?? ""} protection={protection} />
          )}
        </>
      )}
      {connected && (full || unreachable) && (
        <>
          <WatchedWalletsCard
            wallets={networkWallets.data ?? []}
            network={network}
            watched={watched.data}
            consented={status.data.consented}
            ready={ready && watched.isSuccess}
            error={watched.isError ? watched.error : undefined}
            onRetry={() => void watched.refetch()}
          />
          <ChannelsCard
            channels={channels.data}
            loading={!unreachable && channels.isPending}
            unreachable={unreachable}
            error={channels.isError ? channels.error : undefined}
            onRetry={() => void channels.refetch()}
          />
          <RecentAlertsCard
            events={events.data}
            wallets={allWallets}
            loading={!unreachable && events.isPending}
            unreachable={unreachable}
            error={events.isError ? events.error : undefined}
            onRetry={() => void events.refetch()}
          />
        </>
      )}
    </>
  );
}
