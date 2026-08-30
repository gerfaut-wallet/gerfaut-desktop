// Display formatting. Mirrors gerfaut-core's rules: 8 decimals in BTC,
// never silently rounded; identifiers truncated in the middle only.

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

/** Block timestamp -> local date/time, unambiguous and compact. */
export function formatTimestamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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

/** Fiat value of an amount at a given BTC rate, in the user's locale. */
export function formatFiat(sats: number, rate: number, currency: string): string {
  const value = (sats / 100_000_000) * rate;
  // Each currency sets its own precision: yen, won and dong carry no
  // decimals, and forcing two on them reads as an error. Under one unit
  // the ceiling is raised to four so a small amount does not collapse
  // to zero, whatever the currency.
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
    ...(Math.abs(value) < 1 ? { maximumFractionDigits: 4 } : {}),
  }).format(value);
}
