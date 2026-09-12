import { clsx } from "clsx";
import { Eye } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/Button";
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
    once; "off" takes effect at once, since it can be undone as fast.
    Under them, the wallets the server still watches that this device
    no longer has, with the one thing left to do about them. */
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
  // Watched by the server, gone from this device: removed while the
  // server could not be told, or added from another device on the same
  // key. Without a descriptor here there is nothing to turn back on,
  // only the server's side to close. Nothing until the server answered.
  const local = new Set(wallets.map((wallet) => wallet.id));
  const gone = (watched ?? []).filter((wallet) => !local.has(wallet.id));
  const GoneGlyph = walletGlyph("wallet");

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

  const stop = (id: string) => {
    setFailure(undefined);
    setPending(id);
    unwatch.mutate(id, {
      onError: (problem) => setFailure(problem),
      onSettled: () => setPending(null),
    });
  };

  const toggle = (wallet: WalletMeta, on: boolean) => {
    if (!on) {
      stop(wallet.id);
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
        {wallets.length === 0 && (
          <p className={clsx("font-ui text-sm text-muted", gone.length > 0 && "mb-3")}>
            No wallets on {NETWORK_WORD[network]} yet.
          </p>
        )}
        {(wallets.length > 0 || gone.length > 0) && (
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
                          // The server has not finished its first pass
                          // over this wallet: the counts it would show
                          // are not the wallet's yet. "Scanning…" read
                          // as work happening right now — a queue of an
                          // hour reads as a scan stuck for an hour.
                          <span role="status">First scan pending</span>
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
            {gone.map((server) => {
              const busy = pending === server.id;
              return (
                <li key={server.id} className="flex min-h-[56px] items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className={GLYPH_CHIP}>
                    <GoneGlyph size={16} strokeWidth={1.5} aria-hidden />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-ui text-sm font-medium text-text">
                      {server.name}
                    </span>
                    <span className="font-ui text-xs text-muted">
                      Removed from this device, still watched by the server.
                    </span>
                  </span>
                  <WatchedPill />
                  <Button
                    className="h-9"
                    disabled={!ready || busy}
                    aria-busy={busy || undefined}
                    aria-label={`Unwatch ${server.name}`}
                    onClick={() => stop(server.id)}
                  >
                    Unwatch
                  </Button>
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
