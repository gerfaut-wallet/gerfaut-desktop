import { clsx } from "clsx";
import { Eye } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "../../../components/Button";
import { Notice } from "../../../components/Notice";
import { WatchedPill } from "../../../components/PremiumPill";
import type { Network, WalletMeta, WalletWatch } from "../../../lib/ipc";
import { NETWORK_WORD, coinsWord, shortDay } from "../../../lib/premium";
import { walletGlyph } from "../../../lib/walletIcons";
import { useUnwatchWallet, useWatchWallet } from "../../../state/premiumQueries";
import { SectionCard, Toggle } from "../primitives";
import { ConsentModal } from "./ConsentModal";
import { IdentityModal } from "./IdentityModal";
import { FailureNote, GHOST_ON_TINT, GLYPH_CHIP, useFocusAfterRender } from "./shared";

/** The wallets of the server's network, each with the switch that sends
    it there or takes it back. Both directions ask first: "on" before
    the descriptor leaves the device, once per yes — an unwatch takes
    the yes back with it; "off" every time, since the server deletes
    the wallet's alert history with it, and nothing brings that back.
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
  /** The wallet whose unwatch waits for a yes, by id. */
  const [leaving, setLeaving] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  /** The wallet whose unwatch waits for the secret, by id. */
  const [identity, setIdentity] = useState<{ id: string; name: string } | null>(null);
  const [failure, setFailure] = useState<unknown>(undefined);
  /** The card's heading: where the focus lands once a question, and
      the button that answered it, are gone. */
  const heading = useRef<HTMLHeadingElement>(null);
  const focusHeading = useFocusAfterRender(heading);
  /** The switch or button each question is asked from, by wallet id,
      so a Cancel can put the focus back on it. */
  const triggers = useRef(new Map<string, HTMLElement>());
  const remember = (id: string) => (element: HTMLElement | null) => {
    if (element) triggers.current.set(id, element);
    else triggers.current.delete(id);
  };
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

  /** The yes under the row was given: the secret is asked, and the
      server told once it went through. On a failure the question
      stays up: the retry is one click, and what it would do is still
      in front of the reader. On success this row's question goes, and
      with it the button that answered: the heading takes the focus, so
      it is not dropped on the body. A question opened on another row in
      the meantime is not this answer's to close, and keeps the focus. */
  const stop = (id: string, secret: string) => {
    setFailure(undefined);
    setPending(id);
    return unwatch
      .mutateAsync({ id, secret })
      .then(() => {
        setLeaving((current) => (current === id ? null : current));
      })
      .finally(() => setPending(null));
  };

  /** Closes the question and puts the focus back where it was asked. */
  const cancel = (id: string) => {
    setLeaving(null);
    triggers.current.get(id)?.focus();
  };

  const toggle = (wallet: WalletMeta, on: boolean) => {
    if (!on) {
      setLeaving(wallet.id);
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
      <SectionCard
        icon={<Eye size={18} strokeWidth={1.5} />}
        title="Watched wallets"
        headingRef={heading}
        premium
      >
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
                <li key={wallet.id} className="flex flex-col py-2.5 first:pt-0 last:pb-0">
                  <div className="flex min-h-[56px] items-center gap-3">
                    <span className={GLYPH_CHIP}>
                      <Glyph size={16} strokeWidth={1.5} aria-hidden />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-ui text-sm font-medium text-text">
                        {wallet.name}
                      </span>
                      <span className="font-ui text-xs text-muted">
                        {server ? (
                          refused(server) ? (
                            "Not watched by the server"
                          ) : server.baseline_at === null ? (
                            // The server has not finished its first pass
                            // over this wallet: the counts it would show
                            // are not the wallet's yet. "Scanning…" read
                            // as work happening right now — a queue of an
                            // hour reads as a scan stuck for an hour.
                            <span role="status">First scan pending</span>
                          ) : (
                            <span className="tabular">
                              Watched since {shortDay(server.watched_since)} ·{" "}
                              {coinsWord(server.coins)}
                            </span>
                          )
                        ) : single ? (
                          "Single address"
                        ) : (
                          "Descriptor wallet"
                        )}
                      </span>
                    </span>
                    {server && !refused(server) && <WatchedPill />}
                    <Toggle
                      ref={remember(wallet.id)}
                      tone="premium"
                      checked={server !== undefined}
                      disabled={!ready}
                      busy={busy}
                      label={`Watch ${wallet.name} from the server`}
                      onChange={(on) => toggle(wallet, on)}
                    />
                  </div>
                  {server && refused(server) && <RefusalNote server={server} />}
                  {leaving === wallet.id && (
                    <UnwatchNote
                      name={wallet.name}
                      local
                      busy={busy}
                      onConfirm={() => setIdentity({ id: wallet.id, name: wallet.name })}
                      onCancel={() => cancel(wallet.id)}
                    />
                  )}
                </li>
              );
            })}
            {gone.map((server) => {
              const busy = pending === server.id;
              return (
                <li key={server.id} className="flex flex-col py-2.5 first:pt-0 last:pb-0">
                  <div className="flex min-h-[56px] items-center gap-3">
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
                    {!refused(server) && <WatchedPill />}
                    <Button
                      ref={remember(server.id)}
                      className="h-9"
                      disabled={!ready || busy}
                      aria-busy={busy || undefined}
                      aria-expanded={leaving === server.id}
                      aria-label={`Unwatch ${server.name}`}
                      onClick={() => setLeaving(server.id)}
                    >
                      Unwatch
                    </Button>
                  </div>
                  {refused(server) && <RefusalNote server={server} />}
                  {leaving === server.id && (
                    <UnwatchNote
                      name={server.name}
                      local={false}
                      busy={busy}
                      onConfirm={() => setIdentity({ id: server.id, name: server.name })}
                      onCancel={() => cancel(server.id)}
                    />
                  )}
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
      {identity !== null && (
        <IdentityModal
          action="Unwatch"
          busyLabel="Unwatching…"
          tone="danger"
          run={(secret) => stop(identity.id, secret)}
          onDone={() => {
            setIdentity(null);
            focusHeading();
          }}
          onFailure={(problem) => {
            setIdentity(null);
            setFailure(problem);
          }}
          onCancel={() => setIdentity(null)}
        />
      )}
      <ConsentModal
        open={asking !== null}
        walletName={asking?.name ?? ""}
        singleAddress={asking?.kind.type === "single_address"}
        busy={asking !== null && pending === asking.id}
        onConfirm={() => asking && start(asking)}
        onCancel={() => setAsking(null)}
      />
    </>
  );
}

/** The server keeps the row of a wallet it refused, to say why, and
    watches nothing under it. */
function refused(server: WalletWatch): boolean {
  return server.watching === false;
}

/** Why the server does not watch a wallet, in the server's own
    sentence, under the row. Amber, not red: nothing is lost and nothing
    leaked, the wallet is simply not covered, and the person should
    know before they rely on it. */
function RefusalNote({ server }: { server: WalletWatch }) {
  return (
    <div className="mt-2">
      <Notice tone="info" role="status">
        {server.refusal?.message ?? "The server does not watch this wallet."}
      </Notice>
    </div>
  );
}

/** The question before the server forgets a wallet, under its row.
    Amber, not red: no coin and nothing private is at stake, but the
    server deletes the alert history along with the wallet, and that
    does not come back — so it is said where the decision is made, in
    one sentence, and the yes waits for the answer before it can be
    given twice. It answers a click, so a screen reader hears it as it
    appears. */
function UnwatchNote({
  name,
  local,
  busy,
  onConfirm,
  onCancel,
}: {
  name: string;
  /** This device still holds the wallet: only the server's side ends. */
  local: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Notice
      tone="info"
      role="status"
      className="mt-2.5"
      // Cancel first, the destructive yes last: the way out comes
      // before the way through, here as on the mobile.
      action={
        <span className="flex items-center gap-2">
          <Button variant="ghost" className={GHOST_ON_TINT} disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="danger"
            className="h-9"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={onConfirm}
          >
            {busy ? "Unwatching…" : "Unwatch"}
          </Button>
        </span>
      }
    >
      Unwatching "{name}" also deletes its alert history on the server
      {local ? "; the wallet stays on this device." : "."}
    </Notice>
  );
}
