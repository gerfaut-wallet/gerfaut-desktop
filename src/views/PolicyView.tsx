import { clsx } from "clsx";
import { Check, ChevronRight, Clock, Coins, Copy, Lock } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { AddressChip } from "../components/AddressChip";
import { IconButton } from "../components/Button";
import { Notice } from "../components/Notice";
import { Pill } from "../components/StatusPill";
import { formatTimestamp, groupThousands } from "../lib/format";
import type { PolicyBranch, PolicyKey, PolicySnapshot } from "../lib/ipc";
import { isCommandError } from "../lib/ipc";
import type { Countdown as CountdownFigures } from "../lib/policy";
import {
  branchStatus,
  conditionKeys,
  conditionOutline,
  countdown,
  describePolicy,
  hasTimeBasedLocks,
  orderBranches,
  remainingWords,
  timelockText,
} from "../lib/policy";
import { useSnapshot, useWalletPolicy } from "../state/queries";
import { useUi } from "../state/store";

/** The `label` style: section names, roles, the estimated date. */
const LABEL = "font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted";

const CARDS = "grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4";

/** What the descriptor says: who can spend, under which locks, and
    whether each path is open right now. One page for every wallet, a
    tap from the balance; the simple cases keep it short. */
export function PolicyView({ walletId }: { walletId: string }) {
  const snapshot = useSnapshot(walletId);
  const policy = useWalletPolicy(walletId);
  const name = snapshot.data?.meta.name;

  return (
    <div className="flex flex-col gap-6 pb-6">
      <header className="px-1 pt-2">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.01em] text-text">
          Policy
        </h1>
        {name && (
          <p className="mt-1 font-ui text-sm text-muted">
            {name}
            {policy.data && <ReadAt tip={policy.data.tip_height} />}
          </p>
        )}
      </header>

      {policy.isPending ? (
        <Placeholder />
      ) : policy.isError || !policy.data ? (
        <Notice tone="info">
          <span className="font-medium">The policy could not be read.</span>{" "}
          {isCommandError(policy.error) ? policy.error.message : "The core did not answer."}
        </Notice>
      ) : (
        <Body snapshot={policy.data} />
      )}
    </div>
  );
}

/** The tip the locks were read against, or the fact that there is none
    yet: a wallet that never synced has no block to measure from. */
function ReadAt({ tip }: { tip: number | null }) {
  if (tip === null || tip === 0) return <>{" · not synced yet"}</>;
  return (
    <>
      {" · read at block "}
      <span className="tabular">{groupThousands(String(tip))}</span>
    </>
  );
}

/** Quiet lines where the page will be: no motion, one card's worth. */
function Placeholder() {
  return (
    <div role="status" aria-label="Loading policy" aria-busy className="flex flex-col gap-6">
      <div className="mx-1 h-4 w-2/3 max-w-[480px] rounded-sm bg-sunken" />
      <div className={CARDS}>
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
          <div className="h-3 w-16 rounded-sm bg-sunken" />
          <div className="h-4 w-3/4 rounded-sm bg-sunken" />
          <div className="h-3 w-1/2 rounded-sm bg-sunken" />
        </div>
      </div>
    </div>
  );
}

function Body({ snapshot }: { snapshot: PolicySnapshot }) {
  const sentence = (
    <p className="max-w-[65ch] px-1 font-ui text-base text-pretty text-text">
      {describePolicy(snapshot)}
    </p>
  );

  if (snapshot.kind === "address") {
    return (
      <>
        {sentence}
        <div className="px-1">
          <AddressChip value={snapshot.descriptor} head={12} tail={8} label="address" />
        </div>
      </>
    );
  }

  return (
    <>
      {sentence}
      {/* One key needs no card: the sentence, the key and the descriptor
          say it all. */}
      {snapshot.kind !== "single_key" && (
        <div className={CARDS}>
          {orderBranches(snapshot).map((branch) => (
            <BranchCard key={branch.id} branch={branch} keys={snapshot.keys} />
          ))}
        </div>
      )}
      {hasTimeBasedLocks(snapshot) && (
        <p className="px-1 font-ui text-xs text-muted">
          Time locks compare against this device&apos;s clock; the chain can lag by up to two
          hours.
        </p>
      )}
      <KeysSection keys={snapshot.keys} />
      <DescriptorSection snapshot={snapshot} />
    </>
  );
}

// --- branches -------------------------------------------------------------

/** The glyph of each state: shapes that differ, so the state reads
    without its colour. */
const GLYPH = { check: Check, clock: Clock, coins: Coins, lock: Lock };

function BranchCard({ branch, keys }: { branch: PolicyBranch; keys: PolicyKey[] }) {
  const outline = conditionOutline(branch.condition, keys);
  const named = conditionKeys(branch.condition, keys);
  const timer = countdown(branch);
  const status = branchStatus(branch);
  const Glyph = GLYPH[status.glyph];
  return (
    <section
      aria-label={`${branch.label} path`}
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className={LABEL}>{branch.label}</h2>
        {/* A per-coin state can run long; at the narrowest window the
            card is 320px wide, and the pill wraps rather than overflow. */}
        <Pill
          tone={status.tone}
          icon={<Glyph size={12} strokeWidth={2} aria-hidden className="shrink-0" />}
          wrap
        >
          {status.text}
        </Pill>
      </div>

      <div>
        <p className="font-ui text-sm leading-snug text-text">{outline.text}</p>
        {outline.items.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 border-l border-border pl-3">
            {outline.items.map((item) => (
              <li key={item} className="font-ui text-sm text-text">
                {item}
              </li>
            ))}
          </ul>
        )}
      </div>

      {named.length > 0 && (
        <ul aria-label="Keys of this path" className="flex flex-wrap gap-1.5">
          {named.map((key) => (
            <li
              key={key.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5"
            >
              <span className="font-ui text-xs font-medium text-text">{key.label}</span>
              {key.fingerprint && (
                <span className="font-data text-xs text-muted">{key.fingerprint}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {branch.timelocks.length > 0 && (
        <ul aria-label="Locks" className="flex flex-col gap-1.5">
          {branch.timelocks.map((timelock, index) => (
            <li key={index} className="flex items-start gap-2 font-ui text-[13px] text-text">
              <span className="flex h-5 shrink-0 items-center text-muted">
                <Clock size={14} strokeWidth={1.5} aria-hidden />
              </span>
              <span className="tabular leading-5">{timelockText(timelock)}</span>
            </li>
          ))}
        </ul>
      )}

      {timer && <CountdownBlock timer={timer} />}
    </section>
  );
}

/** What is left before the path opens: the blocks and the time they
    come to, the date that makes, and for a relative lock how far the
    nearest coin has come. Neutral throughout; the pill holds the tone. */
function CountdownBlock({ timer }: { timer: CountdownFigures }) {
  const { remaining, progress, perCoin } = timer;
  return (
    <div className="flex flex-col gap-1">
      {perCoin && (
        <p className="tabular text-[13px] font-medium text-text">
          <span className={clsx(LABEL, "mr-2")}>Next coin</span>
          {remainingWords(remaining)}
        </p>
      )}
      {remaining.unlocks_at_unix !== null && (
        <p className={clsx(LABEL, "tabular")}>≈ {formatTimestamp(remaining.unlocks_at_unix)}</p>
      )}
      {progress !== null && (
        <div
          role="progressbar"
          aria-label="Wait done"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          aria-valuetext={`${Math.round(progress * 100)}% of the wait`}
          className="mt-1 h-1 overflow-hidden rounded-full bg-sunken"
        >
          <div className="h-full rounded-full bg-border" style={{ width: `${progress * 100}%` }} />
        </div>
      )}
    </div>
  );
}

// --- footer ---------------------------------------------------------------

/** Every key of the policy, read-only and selectable: the label, the
    fingerprint, the origin, the key shortened around its middle. */
function KeysSection({ keys }: { keys: PolicyKey[] }) {
  return (
    <section aria-label="Keys" className="px-1">
      <h2 className={clsx(LABEL, "mb-2")}>Keys</h2>
      <ul className="selectable flex flex-col divide-y divide-border/60 rounded-lg border border-border bg-surface">
        {keys.map((key) => (
          <li key={key.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 px-4 py-2.5">
            <span className="w-14 shrink-0 font-ui text-[13px] font-medium text-text">
              {key.label}
            </span>
            <span className="font-data text-[13px] text-text">{key.fingerprint ?? "—"}</span>
            {key.origin_path && (
              <span className="font-data text-[13px] text-muted">{key.origin_path}</span>
            )}
            <span className="ml-auto font-data text-[13px] text-muted">{key.key_short}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The descriptor as imported, folded by default, with the normalized
    policy under it: the keys named, the locks as consensus values. */
function DescriptorSection({ snapshot }: { snapshot: PolicySnapshot }) {
  const [copied, setCopied] = useState(false);
  const showToast = useUi((s) => s.showToast);

  const copy = async () => {
    await navigator.clipboard.writeText(snapshot.descriptor);
    setCopied(true);
    showToast("Copied");
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <details className="group px-1">
      <summary
        className={clsx(
          LABEL,
          "inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md py-1 pr-1 transition-colors duration-150 hover:text-text [&::-webkit-details-marker]:hidden",
        )}
      >
        <ChevronRight
          size={14}
          strokeWidth={1.75}
          aria-hidden
          className="transition-transform duration-150 group-open:rotate-90"
        />
        Descriptor
      </summary>
      <div className="mt-2 flex flex-col gap-3">
        <div className="relative">
          <Mono className="pr-12 text-text">{snapshot.descriptor}</Mono>
          <IconButton
            label="Copy descriptor"
            className="absolute right-2 top-2"
            onClick={() => void copy()}
          >
            {copied ? (
              <Check size={14} strokeWidth={1.5} aria-hidden className="text-confirmed" />
            ) : (
              <Copy size={14} strokeWidth={1.5} aria-hidden />
            )}
          </IconButton>
        </div>
        <div>
          <p className={clsx(LABEL, "mb-1")}>Normalized policy</p>
          <Mono className="text-muted">{snapshot.policy}</Mono>
        </div>
      </div>
    </details>
  );
}

function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={clsx(
        "selectable break-all rounded-md bg-sunken p-3 font-data text-[12px] leading-relaxed",
        className,
      )}
    >
      {children}
    </p>
  );
}
