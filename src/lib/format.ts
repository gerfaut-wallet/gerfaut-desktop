// Display formatting. Mirrors gerfaut-core's rules: 8 decimals in BTC,
// never silently rounded; identifiers truncated in the middle only.

import type { Network } from "./ipc";

const SATS_PER_BTC = 100_000_000;
/** No-break space for digit grouping: in the UI face a narrow space
    collapses and "1 000 000" reads as one blob. */
const GROUP = " ";

/** `123456` -> `"0.00123456"` — always 8 decimals. */
export function formatBtc(sats: number): string {
  const negative = sats < 0;
  const abs = Math.abs(sats);
  const whole = Math.floor(abs / SATS_PER_BTC);
  const frac = String(abs % SATS_PER_BTC).padStart(8, "0");
  return `${negative ? "-" : ""}${groupThousands(String(whole))}.${frac}`;
}

/** Signed variant with an explicit `+` for incoming amounts. */
export function formatBtcSigned(sats: number): string {
  return sats < 0 ? formatBtc(sats) : `+${formatBtc(sats)}`;
}

/** `1234567` -> `"1 234 567"` (narrow no-break spaces). */
export function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP);
}

export function formatSats(sats: number): string {
  const sign = sats < 0 ? "-" : "";
  return `${sign}${groupThousands(String(Math.abs(sats)))} sats`;
}

/** Middle truncation, ends preserved: `bc1qxy...k9fz`. */
export function truncateMiddle(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

/** Preview text for an OP_RETURN payload: the recognized protocol name
    when there is one, then decoded text, then a short hex excerpt. */
export function opReturnPreview(data: {
  hex: string;
  text: string | null;
  label: string | null;
}): string {
  if (data.label) return data.label;
  if (data.text) return truncateMiddle(data.text, 22, 6);
  return truncateMiddle(data.hex, 12, 6);
}

/** Relative freshness for sync stamps: "just now", "2 min ago", ... */
export function relativeTime(unixSeconds: number, nowMs = Date.now()): string {
  const seconds = Math.max(0, Math.floor(nowMs / 1000) - unixSeconds);
  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}

/** The one locale the app prints in. Gerfaut exists in English only,
    and asking the host for its locale put a French date under an
    English label on a French machine. Pinned here so no call site can
    drift back to the system's — every `Intl` and `toLocale*` in the app
    passes this. */
export const LOCALE = "en-US";

/** Month names spelled out rather than asked of the platform: the
    mobile app carries the same table, and a block's date has to read
    the same on both. The chart axis borrows it for the same reason. */
export const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Block timestamp -> local date/time, unambiguous and compact. The
    clock is 24-hour: reading when a block landed has no use for AM and
    PM, and the mobile app states it the same way. */
export function formatTimestamp(unixSeconds: number): string {
  const local = new Date(unixSeconds * 1000);
  const day = String(local.getDate()).padStart(2, "0");
  const hour = String(local.getHours()).padStart(2, "0");
  const minute = String(local.getMinutes()).padStart(2, "0");
  return `${MONTHS[local.getMonth()]} ${day}, ${local.getFullYear()}, ${hour}:${minute}`;
}

/** A day alone, local time, in the same voice as `formatTimestamp`:
    "Mar 17, 2030". For a lock that names a date rather than a moment. */
export function formatDate(unixSeconds: number): string {
  const local = new Date(unixSeconds * 1000);
  const day = String(local.getDate()).padStart(2, "0");
  return `${MONTHS[local.getMonth()]} ${day}, ${local.getFullYear()}`;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** `3` + `"block"` -> "3 blocks", `1` -> "1 block". */
function counted(count: number, unit: string): string {
  return `${groupThousands(String(count))} ${unit}${count === 1 ? "" : "s"}`;
}

/** A duration in plain words, never finer than the reader needs: days
    up to a year, then years and months, two units at most. Days and
    hours round, minutes floor, and under a minute it says so. Every
    figure here rests on ten minutes a block or on a clock the chain
    trails, so `formatDuration` puts the "about" in front; the bare
    words serve where a "≈" or an "in" already carries the doubt. */
export function durationWords(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total < MINUTE) return "under a minute";
  if (total < HOUR) return counted(Math.floor(total / MINUTE), "minute");
  if (total < DAY) {
    const hours = Math.round(total / HOUR);
    return hours === 24 ? "1 day" : counted(hours, "hour");
  }
  if (total < YEAR) {
    const days = Math.round(total / DAY);
    return days === 365 ? "1 year" : counted(days, "day");
  }
  let years = Math.floor(total / YEAR);
  let months = Math.round((total - years * YEAR) / MONTH);
  if (months === 12) {
    years += 1;
    months = 0;
  }
  const head = counted(years, "year");
  return months === 0 ? head : `${head} ${counted(months, "month")}`;
}

/** "about 10 days", "about 1 year 2 months": an estimate, said as one.
    "Under a minute" already is one. */
export function formatDuration(seconds: number): string {
  const words = durationWords(seconds);
  return words.startsWith("under") ? words : `about ${words}`;
}

/** A count of blocks: "1 432 blocks", "1 block". */
export function formatBlocks(blocks: number): string {
  return counted(blocks, "block");
}

/** The total one side of a transaction carries. A single value nobody
    knows poisons the sum: better no figure than a wrong one. */
export function sumSats(values: (number | null)[]): number | null {
  let total = 0;
  for (const value of values) {
    if (value === null) return null;
    total += value;
  }
  return total;
}

/** Block heights and unix times share the locktime field: at or above
    this value it is a time, below it a height (BIP-65). */
export const LOCKTIME_THRESHOLD = 500_000_000;

/** True when a locktime names a moment rather than a block. */
export function locktimeIsTime(locktime: number): boolean {
  return locktime >= LOCKTIME_THRESHOLD;
}

/** A locktime in the terms it was written in. Printed raw, a time-based
    lock reads as a block height a thousand centuries out of reach. */
export function formatLocktime(locktime: number): string {
  if (locktime <= 0) return "none";
  if (locktimeIsTime(locktime)) return formatTimestamp(locktime);
  return `block ${groupThousands(String(locktime))}`;
}

/** Network names as the interface says them, in one place: the sidebar
    badge and the transaction facts must not spell them two ways. */
export const NETWORK_LABEL: Record<Network, string> = {
  mainnet: "Mainnet",
  signet: "Signet",
  testnet4: "Testnet 4",
  regtest: "Regtest",
};

/** Masked replacement for any amount. */
export const MASKED = "•••••";

export type Unit = "btc" | "sats";

/** Primary amount in the chosen display unit. */
export function formatAmount(sats: number, unit: Unit): string {
  return unit === "btc" ? `${formatBtc(sats)} BTC` : formatSats(sats);
}

/** Signed primary amount in the chosen display unit. */
export function formatAmountSigned(sats: number, unit: Unit): string {
  if (unit === "btc") return `${formatBtcSigned(sats)} BTC`;
  return sats < 0 ? formatSats(sats) : `+${formatSats(sats)}`;
}

/** Fiat value of an amount at a given BTC rate. */
export function formatFiat(sats: number, rate: number, currency: string): string {
  const value = (sats / 100_000_000) * rate;
  // Each currency sets its own precision: yen, won and dong carry no
  // decimals, and forcing two on them reads as an error. Under one unit
  // the ceiling is raised to four so a small amount does not collapse
  // to zero, whatever the currency.
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency: currency.toUpperCase(),
    ...(Math.abs(value) < 1 ? { maximumFractionDigits: 4 } : {}),
  }).format(value);
}
