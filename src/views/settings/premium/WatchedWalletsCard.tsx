import { Eye } from "lucide-react";
import { useState } from "react";
import { WatchedPill } from "../../../components/PremiumPill";
import type { Network, WalletMeta, WalletWatch } from "../../../lib/ipc";
import { NETWORK_WORD, coinsWord, shortDay } from "../../../lib/premium";
import { walletGlyph } from "../../../lib/walletIcons";
import { useUnwatchWallet, useWatchWallet } from "../../../state/premiumQueries";
import { SectionCard, Toggle } from "../primitives";
import { ConsentModal } from "./ConsentModal";
import { FailureNote, GLYPH_CHIP } from "./shared";

/** The wallets of the server's network, each with the switch that sends
    it there or takes it back. The first "on" of a wallet asks first,
    once; "off" takes effect at once, since it can be undone as fast. */
export function WatchedWalletsCard({
  wallets,
  network,
  watched,
  consented,
  ready,
  error,
  onRetry,
}: {
  /** The app's wallets on the server's network. */
  wallets: WalletMeta[];
  network: Network;
  /** What the server says it watches; undefined until it answered. */
  watched: WalletWatch[] | undefined;
  /** The wallets the user already agreed to send. */
  consented: string[];
  /** The server answered, so the switches mean something. */
  ready: boolean;
  error?: unknown;
  onRetry?: () => void;
}) {
  const watch = useWatchWallet();
  const unwatch = useUnwatchWallet();
  const [asking, setAsking] = useState<WalletMeta | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(undefined);
  const byId = new Map((watched ?? []).map((wallet) => [wallet.id, wallet]));

  const start = (wallet: WalletMeta) => {
    setFailure(undefined);
    setPending(wallet.id);
    watch.mutate(wallet.id, {
      onError: (problem) => setFailure(problem),
      onSettled: () => {
        setPending(null);
        setAsking(null);
      },
    });
  };

  const stop = (wallet: WalletMeta) => {
    setFailure(undefined);
    setPending(wallet.id);
    unwatch.mutate(wallet.id, {
      onError: (problem) => setFailure(problem),
      onSettled: () => setPending(null),
    });
  };

  const toggle = (wallet: WalletMeta, on: boolean) => {
    if (!on) {
      stop(wallet);
      return;
    }
    if (consented.includes(wallet.id)) {
      start(wallet);
    } else {
      setAsking(wallet);
    }
  };

  return (
    <>
      <SectionCard icon={<Eye size={18} strokeWidth={1.5} />} title="Watched wallets">
        {wallets.length === 0 ? (
          <p className="font-ui text-sm text-muted">No wallets on {NETWORK_WORD[network]} yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {wallets.map((wallet) => {
              const single = wallet.kind.type === "single_address";
              const server = byId.get(wallet.id);
              const Glyph = walletGlyph(wallet.icon);
              const busy = pending === wallet.id;
              return (
                <li key={wallet.id} className="flex min-h-[56px] items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className={GLYPH_CHIP}>
                    <Glyph size={16} strokeWidth={1.5} aria-hidden />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-ui text-sm font-medium text-text">
                      {wallet.name}
                    </span>
                    <span className="font-ui text-xs text-muted">
                      {single ? (
                        "Single addresses cannot be watched yet."
                      ) : server ? (
                        server.baseline_at === null ? (
                          <span role="status">Scanning…</span>
                        ) : (
                          <span className="tabular">
                            Watched since {shortDay(server.watched_since)} · {coinsWord(server.coins)}
                          </span>
                        )
                      ) : (
                        "Descriptor wallet"
                      )}
                    </span>
                  </span>
                  {server && <WatchedPill />}
                  <Toggle
                    checked={server !== undefined}
                    disabled={single || !ready}
                    busy={busy}
                    label={`Watch ${wallet.name} from the server`}
                    onChange={(on) => toggle(wallet, on)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
      {error !== undefined && <FailureNote error={error} onRetry={onRetry} />}
      {failure !== undefined && (
        <FailureNote
          error={failure}
          onRetry={() => {
            setFailure(undefined);
            onRetry?.();
          }}
        />
      )}
      <ConsentModal
        open={asking !== null}
        walletName={asking?.name ?? ""}
        busy={asking !== null && pending === asking.id}
        onConfirm={() => asking && start(asking)}
        onCancel={() => setAsking(null)}
      />
    </>
  );
}
