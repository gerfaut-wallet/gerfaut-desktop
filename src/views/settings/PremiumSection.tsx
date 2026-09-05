import type { WalletMeta } from "../../lib/ipc";
import { serverNetwork } from "../../lib/premium";
import {
  usePremiumAccount,
  usePremiumChannels,
  usePremiumEvents,
  usePremiumStatus,
  usePremiumWallets,
} from "../../state/premiumQueries";
import { useWallets } from "../../state/queries";
import { ChannelsCard } from "./premium/ChannelsCard";
import { LicenceCard } from "./premium/LicenceCard";
import { RecentAlertsCard } from "./premium/RecentAlertsCard";
import { WatchedWalletsCard } from "./premium/WatchedWalletsCard";

/** The eighth section: the account key, the wallets the server watches,
    where it tells, and what it said lately. Without a key there is the
    licence card and nothing else, and no call leaves the machine; with
    one, the server is asked for the rest. What the licence says comes
    from the vault, verified offline, so the first card never waits on
    the network. */
export function PremiumSection({ wallets: allWallets }: { wallets: WalletMeta[] }) {
  const status = usePremiumStatus();
  const hasKey = status.data?.key != null;
  const account = usePremiumAccount(hasKey);
  // The server names its network; until it has, production is mainnet.
  const network = serverNetwork(account.data?.account.network ?? "bitcoin") ?? "mainnet";
  const networkWallets = useWallets(network);
  const ready = hasKey && account.isSuccess;
  const watched = usePremiumWallets(ready);
  const channels = usePremiumChannels(ready);
  const events = usePremiumEvents(ready);
  // The account call failed: the note under the licence card says so
  // with Retry; the other cards only say they wait.
  const unreachable = hasKey && account.isError;

  if (status.isPending) {
    return <p className="px-1 font-ui text-sm text-muted">Loading…</p>;
  }
  if (status.isError || !status.data) {
    return (
      <p className="px-1 font-ui text-sm text-muted">The premium state could not be read.</p>
    );
  }

  return (
    <>
      <LicenceCard
        status={status.data}
        accountError={account.isError ? account.error : undefined}
        onRetryAccount={() => void account.refetch()}
      />
      {hasKey && (
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
