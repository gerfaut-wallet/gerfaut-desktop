// Words for a wallet's policy. Pure functions from the core's snapshot
// to sentences, states and figures: the page lays them out, the tests
// read them straight, and the two never disagree on a phrase.

import {
  durationWords,
  formatBlocks,
  formatDate,
  formatDuration,
  groupThousands,
} from "./format";
import type {
  BranchRole,
  Condition,
  PolicyBranch,
  PolicyKey,
  PolicySnapshot,
  Remaining,
  Timelock,
} from "./ipc";

/** Ten minutes a block: the basis of every block-to-time estimate. */
export const BLOCK_SECONDS = 600;

/** Under this much left a lock reads as approaching: amber rather than
    the neutral of a wait still far off. */
export const APPROACHING_SECONDS = 30 * 86_400;

// --- order ----------------------------------------------------------------

const ROLE_RANK: Record<BranchRole, number> = {
  primary: 0,
  recovery: 1,
  emergency: 2,
  other: 3,
};

/** The full duration of a relative lock, or the distance of an absolute
    one from the tip and the clock: how the core ranks timed branches. */
function lockSeconds(timelock: Timelock, snapshot: PolicySnapshot): number {
  const inner = timelock.lock.lock;
  switch (inner.kind) {
    case "blocks":
      return inner.blocks * BLOCK_SECONDS;
    case "seconds":
      return inner.seconds;
    case "height":
      return Math.max(0, inner.height - snapshot.tip_height) * BLOCK_SECONDS;
    case "time":
      return Math.max(0, inner.unix - snapshot.computed_at);
  }
}

function farthest(branch: PolicyBranch, snapshot: PolicySnapshot): number {
  return branch.timelocks
    .filter((timelock) => timelock.required)
    .reduce((worst, timelock) => Math.max(worst, lockSeconds(timelock, snapshot)), 0);
}

/** The longest required relative lock of a branch, in seconds: the
    wait that decides when one of its coins opens. Zero without one. */
function relativeWait(branch: PolicyBranch): number {
  let total = 0;
  for (const timelock of branch.timelocks) {
    if (!timelock.required || timelock.lock.kind !== "relative") continue;
    const inner = timelock.lock.lock;
    total = Math.max(total, inner.kind === "blocks" ? inner.blocks * BLOCK_SECONDS : inner.seconds);
  }
  return total;
}

/** Branches in reading order: the primary paths first, then the timed
    ones from the nearest lock to the farthest, the rest last. The core
    lists them as the policy wrote them; the page reads them by role. */
export function orderBranches(snapshot: PolicySnapshot): PolicyBranch[] {
  return snapshot.branches
    .map((branch, index) => ({
      branch,
      index,
      rank: ROLE_RANK[branch.role],
      far: farthest(branch, snapshot),
    }))
    .sort((a, b) => a.rank - b.rank || a.far - b.far || a.index - b.index)
    .map((entry) => entry.branch);
}

// --- keys -----------------------------------------------------------------

function visit(condition: Condition, see: (node: Condition) => void): void {
  see(condition);
  if (condition.kind === "thresh") {
    for (const item of condition.items) visit(item, see);
  }
}

/** The keys a condition names, in order of first appearance, one entry
    per key however many times it appears. */
export function conditionKeys(condition: Condition, keys: PolicyKey[]): PolicyKey[] {
  const ids: string[] = [];
  visit(condition, (node) => {
    if (node.kind === "key" && !ids.includes(node.key_id)) ids.push(node.key_id);
  });
  return ids.flatMap((id) => keys.filter((key) => key.id === id));
}

function labelOf(id: string, keys: PolicyKey[]): string {
  return keys.find((key) => key.id === id)?.label ?? id;
}

/** "Key A" -> "A": the letters alone read in a list. */
function letterOf(label: string): string {
  return label.startsWith("Key ") ? label.slice(4) : label;
}

/** The threshold of keys a condition comes down to, once its locks and
    secrets are set aside: `and(pk(A), older(N))` is one key of one,
    `and(thresh(2, A, B, C), older(N))` is two of three. Null when the
    keys and the rest are mixed in one threshold, which no short phrase
    says right. */
function keyThreshold(condition: Condition): { k: number; n: number } | null {
  if (condition.kind === "key") return { k: 1, n: 1 };
  if (condition.kind !== "thresh") return null;
  if (condition.items.every((item) => item.kind === "key")) {
    return { k: condition.k, n: condition.n };
  }
  if (condition.k !== condition.n) return null;
  const members = condition.items.filter(
    (item) => item.kind === "key" || item.kind === "thresh",
  );
  if (members.length === 1) return keyThreshold(members[0]);
  if (members.every((item) => item.kind === "key")) {
    return { k: members.length, n: members.length };
  }
  return null;
}

/** The keys of a branch as a subject: "Key A", "Keys A and B", "2 of 3
    keys". Null when no short phrase says it right. */
function keySubject(condition: Condition, keys: PolicyKey[]): string | null {
  const threshold = keyThreshold(condition);
  if (threshold === null) return null;
  const named = conditionKeys(condition, keys);
  if (threshold.n === 1) return named[0]?.label ?? null;
  if (threshold.k < threshold.n) return `${threshold.k} of ${threshold.n} keys`;
  return `Keys ${joinWords(named.map((key) => letterOf(key.label)), "and")}`;
}

// --- conditions -----------------------------------------------------------

/** A condition in words. Flat when every member is a key or a lock:
    "Any 2 of Key A, Key B, Key C", "Key B and a wait of 52 560 blocks".
    A threshold over thresholds gets a lead and one line per member,
    and anything deeper stays inline in parentheses: one level of
    indentation is all a card can carry. */
export interface ConditionOutline {
  text: string;
  items: string[];
}

export function conditionOutline(condition: Condition, keys: PolicyKey[]): ConditionOutline {
  if (condition.kind === "thresh" && condition.items.some((item) => item.kind === "thresh")) {
    return {
      text: `${lead(condition.k, condition.n)}:`,
      items: condition.items.map((item) => capitalize(phrase(item, keys))),
    };
  }
  return { text: capitalize(phrase(condition, keys)), items: [] };
}

function lead(k: number, n: number): string {
  if (k === n) return "All of";
  if (k === 1) return "One of";
  return `Any ${k} of`;
}

function phrase(condition: Condition, keys: PolicyKey[]): string {
  switch (condition.kind) {
    case "key":
      return labelOf(condition.key_id, keys);
    case "after":
      return condition.lock.kind === "height"
        ? `block ${groupThousands(String(condition.lock.height))} or later`
        : `${formatDate(condition.lock.unix)} or later`;
    case "older":
      return condition.lock.kind === "blocks"
        ? `a wait of ${formatBlocks(condition.lock.blocks)}`
        : `a wait of ${formatDuration(condition.lock.seconds)}`;
    case "preimage":
      return `the secret behind a ${condition.hash} hash`;
    case "thresh": {
      const parts = condition.items.map((item) =>
        item.kind === "thresh" ? `(${phrase(item, keys)})` : phrase(item, keys),
      );
      if (condition.k === condition.n) return joinWords(parts, "and");
      if (condition.k === 1) return joinWords(parts, "or");
      return `any ${condition.k} of ${parts.join(", ")}`;
    }
  }
}

/** "a", "a and b", "a, b and c". */
function joinWords(parts: string[], word: string): string {
  if (parts.length < 2) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} ${word} ${parts[parts.length - 1]}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// --- timelocks ------------------------------------------------------------

/** Whether a lock is judged by time rather than by blocks, and so
    against a clock the chain trails. */
export function isTimeBased(timelock: Timelock): boolean {
  const kind = timelock.lock.lock.kind;
  return kind === "time" || kind === "seconds";
}

export function hasTimeBasedLocks(snapshot: PolicySnapshot): boolean {
  return snapshot.branches.some((branch) => branch.timelocks.some(isTimeBased));
}

/** One lock as a line: what it counts, and what that comes to. An
    optional lock says so: the policy names it, but the branch can be
    spent without it. */
export function timelockText(timelock: Timelock): string {
  const inner = timelock.lock.lock;
  const { state } = timelock;
  let text: string;
  switch (inner.kind) {
    case "blocks":
      text = `${formatBlocks(inner.blocks)} after the coin arrives ≈ ${durationWords(
        inner.blocks * BLOCK_SECONDS,
      )}`;
      break;
    case "seconds":
      text = `${groupThousands(String(inner.seconds))} seconds after the coin arrives ≈ ${durationWords(
        inner.seconds,
      )}`;
      break;
    case "height":
      text = `Block ${groupThousands(String(inner.height))}`;
      if (state.kind === "locked" && state.remaining_seconds !== null) {
        text += ` ≈ in ${durationWords(state.remaining_seconds)}`;
      } else if (state.kind === "unlocked") {
        text += " · reached";
      }
      break;
    case "time":
      text = `After ${formatDate(inner.unix)}`;
      if (state.kind === "unlocked") text += " · reached";
      break;
  }
  return timelock.required ? text : `${text} (optional)`;
}

// --- state ----------------------------------------------------------------

export type StatusTone = "confirmed" | "pending" | "neutral";
export type StatusGlyph = "check" | "clock" | "coins" | "lock";

export interface BranchStatus {
  tone: StatusTone;
  glyph: StatusGlyph;
  text: string;
}

function approaching(remaining: Remaining): boolean {
  return remaining.remaining_seconds !== null && remaining.remaining_seconds <= APPROACHING_SECONDS;
}

/** "1 432 blocks ≈ 10 days" when the figure is in blocks, "10 days"
    when it is in time alone. */
export function remainingWords(remaining: Remaining): string {
  const time =
    remaining.remaining_seconds === null ? null : durationWords(remaining.remaining_seconds);
  if (remaining.remaining_blocks !== null) {
    const blocks = formatBlocks(remaining.remaining_blocks);
    return time === null ? blocks : `${blocks} ≈ ${time}`;
  }
  return time ?? "a while";
}

/** The time alone, for a clause: "10 days". */
function remainingTime(remaining: Remaining): string {
  if (remaining.remaining_seconds !== null) return durationWords(remaining.remaining_seconds);
  if (remaining.remaining_blocks !== null) return formatBlocks(remaining.remaining_blocks);
  return "a while";
}

function coinsPhrase(unlocked: number, total: number): string {
  return `${groupThousands(String(unlocked))} of ${groupThousands(String(total))} coin${
    total === 1 ? "" : "s"
  } unlocked`;
}

/** The state pill of a branch: tone, glyph and words. Colour arrives
    only at the thresholds — Lichen when open, Ambre under thirty days,
    neutral before — and the glyph and the words say it without it. */
export function branchStatus(branch: PolicyBranch): BranchStatus {
  const { state } = branch;
  switch (state.kind) {
    case "spendable_now":
      return { tone: "confirmed", glyph: "check", text: "Spendable now" };
    case "locked":
      return {
        tone: approaching(state.until) ? "pending" : "neutral",
        glyph: "clock",
        text: `In ${remainingWords(state.until)}`,
      };
    case "per_coin": {
      const total = state.unlocked + state.waiting + state.locked;
      const parts = [coinsPhrase(state.unlocked, total)];
      if (state.next) parts.push(`next in ${remainingTime(state.next)}`);
      if (state.waiting > 0) {
        parts.push(`${groupThousands(String(state.waiting))} waiting for a block`);
      }
      const text = parts.join(" · ");
      if (state.locked === 0 && state.waiting === 0 && state.unlocked > 0) {
        return { tone: "confirmed", glyph: "check", text };
      }
      return {
        tone: state.next && approaching(state.next) ? "pending" : "neutral",
        glyph: "clock",
        text,
      };
    }
    case "no_coins":
      return { tone: "neutral", glyph: "coins", text: "No coins yet" };
    case "needs_preimage":
      return { tone: "neutral", glyph: "lock", text: "Needs a secret" };
  }
}

/** What the countdown under a pill shows: the remaining figures and,
    for a relative lock, how much of the wait the nearest coin has done. */
export interface Countdown {
  remaining: Remaining;
  /** Elapsed share of the wait, 0 to 1; null for an absolute lock,
      which has no start to measure from. */
  progress: number | null;
  /** The figures are those of the coin that opens first. */
  perCoin: boolean;
}

export function countdown(branch: PolicyBranch): Countdown | null {
  const { state } = branch;
  if (state.kind === "locked") return { remaining: state.until, progress: null, perCoin: false };
  if (state.kind !== "per_coin" || state.next === null) return null;
  const total = relativeWait(branch);
  const progress =
    total === 0 || state.next.remaining_seconds === null
      ? null
      : Math.min(1, Math.max(0, (total - state.next.remaining_seconds) / total));
  return { remaining: state.next, progress, perCoin: true };
}

// --- sentences ------------------------------------------------------------

/** The policy in a sentence or two, for the head of the page. */
export function describePolicy(snapshot: PolicySnapshot): string {
  switch (snapshot.kind) {
    case "address":
      return "An address has no policy Gerfaut can read.";
    case "single_key":
      return "One key signs. Any coin is spendable now.";
    case "multisig": {
      const [branch] = snapshot.branches;
      const subject = branch ? keySubject(branch.condition, snapshot.keys) : null;
      return subject ? `${subject} sign.` : "";
    }
    case "miniscript":
      return orderBranches(snapshot)
        .map((branch) => branchSentence(branch, snapshot))
        .join(" ");
  }
}

const ROLE_WORD: Record<BranchRole, string> = {
  primary: "",
  recovery: "recovery",
  emergency: "emergency",
  other: "later",
};

/** One branch as a sentence: who can spend, then under what lock. */
function branchSentence(branch: PolicyBranch, snapshot: PolicySnapshot): string {
  const clauses = branch.timelocks.filter((timelock) => timelock.required).map(lockClause);
  if (branch.state.kind === "needs_preimage") clauses.push(...preimageClauses(branch.condition));
  const tail = clauses.length > 0 ? ` ${joinWords(clauses, "and")}` : "";
  if (branch.role === "primary") {
    const subject = keySubject(branch.condition, snapshot.keys);
    if (subject === null) return `${capitalize(branch.summary)} can spend${tail}.`;
    const verb = keyThreshold(branch.condition)?.n === 1 ? "signs" : "sign";
    return `${subject} ${verb}${tail}.`;
  }
  return `${timedSubject(branch, snapshot.keys)} can spend${tail}.`;
}

/** "A recovery key", "An emergency key", "Any 2 of 3 recovery keys",
    "Both emergency keys", "Anyone" for a path with no key at all. */
function timedSubject(branch: PolicyBranch, keys: PolicyKey[]): string {
  const role = ROLE_WORD[branch.role];
  const count = conditionKeys(branch.condition, keys).length;
  if (count === 0) return "Anyone";
  const threshold = keyThreshold(branch.condition);
  if (threshold === null) return `${capitalize(role)} keys`;
  if (threshold.n === 1) return `${role === "emergency" ? "An" : "A"} ${role} key`;
  if (threshold.k < threshold.n) return `Any ${threshold.k} of ${threshold.n} ${role} keys`;
  return threshold.n === 2 ? `Both ${role} keys` : `All ${threshold.n} ${role} keys`;
}

function lockClause(timelock: Timelock): string {
  const inner = timelock.lock.lock;
  const { state } = timelock;
  switch (inner.kind) {
    case "blocks":
      return `once a coin has waited ${formatDuration(inner.blocks * BLOCK_SECONDS)}`;
    case "seconds":
      return `once a coin has waited ${formatDuration(inner.seconds)}`;
    case "height":
    case "time": {
      const at =
        inner.kind === "height"
          ? `block ${groupThousands(String(inner.height))}`
          : formatDate(inner.unix);
      return state.kind === "locked" && state.remaining_seconds !== null
        ? `after ${at}, ${formatDuration(state.remaining_seconds)} from now`
        : `now that ${at} has passed`;
    }
  }
}

function preimageClauses(condition: Condition): string[] {
  const clauses: string[] = [];
  visit(condition, (node) => {
    if (node.kind === "preimage") clauses.push(`with the secret behind a ${node.hash} hash`);
  });
  return clauses;
}

// --- digest ---------------------------------------------------------------

/** The policy in as few words as a balance-card row can hold, in the
    grammar of the count rows above it: a lead figure and its tail.
    "1 key", "2 of 3 keys", "Recovery in 142 days", "1 address". */
export interface PolicyDigest {
  figure: string;
  label: string;
}

export function policyDigest(snapshot: PolicySnapshot): PolicyDigest {
  switch (snapshot.kind) {
    case "address":
      return { figure: "1", label: "address" };
    case "single_key":
      return { figure: "1", label: "key" };
    case "multisig":
      return keysDigest(snapshot);
    case "miniscript": {
      const branches = orderBranches(snapshot);
      const timed = branches.find(
        (branch) =>
          branch.role !== "primary" && conditionKeys(branch.condition, snapshot.keys).length > 0,
      );
      if (timed) return { figure: timed.label, label: stateWords(timed) };
      const [primary] = branches;
      if (primary && !primary.spendable_now) {
        if (primary.state.kind === "per_coin") {
          const { unlocked, waiting, locked } = primary.state;
          const total = unlocked + waiting + locked;
          return {
            figure: `${groupThousands(String(unlocked))} of ${groupThousands(String(total))}`,
            label: `coin${total === 1 ? "" : "s"} unlocked`,
          };
        }
        return { figure: "Spendable", label: stateWords(primary) };
      }
      return keysDigest(snapshot);
    }
  }
}

function keysDigest(snapshot: PolicySnapshot): PolicyDigest {
  const [branch] = snapshot.branches;
  const threshold = branch ? keyThreshold(branch.condition) : null;
  if (threshold && threshold.n > 1) {
    return { figure: `${threshold.k} of ${threshold.n}`, label: "keys" };
  }
  const count = snapshot.keys.length;
  return { figure: groupThousands(String(count)), label: count === 1 ? "key" : "keys" };
}

/** The tail after a branch's name: "in 142 days", "after 1 year",
    "unlocked", "waiting for a block", "needs a secret". */
function stateWords(branch: PolicyBranch): string {
  const { state } = branch;
  switch (state.kind) {
    case "spendable_now":
      return "unlocked";
    case "locked":
      return `in ${remainingTime(state.until)}`;
    case "per_coin":
      if (state.next) return `in ${remainingTime(state.next)}`;
      return state.locked === 0 && state.waiting === 0 ? "unlocked" : "waiting for a block";
    case "no_coins":
      return `after ${durationWords(relativeWait(branch))}`;
    case "needs_preimage":
      return "needs a secret";
  }
}

/** The digest as one string, for an accessible name or a test. */
export function digestText(digest: PolicyDigest): string {
  return `${digest.figure} ${digest.label}`.trim();
}
