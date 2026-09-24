// What the premium section can decide on its own, without the core:
// how a key looks while it is typed, which network the server names,
// how a failure reads. Nothing here verifies anything.

import type { CommandError, Device, DevicePlatform, EventKind, Network } from "./ipc";
import { isCommandError } from "./ipc";
import { MONTHS } from "./format";

/** The site, and where a key is bought or topped up. */
export const PREMIUM_URL = "https://gerfaut-wallet.com/premium";

/** The renewal form, with no key in the address.
 *
 *  The key used to travel as `?key=…`. A query string is not a private
 *  channel: it is written to the browser's history and omnibox, synced
 *  with the profile, recorded in the site's own access logs and sent on
 *  in the `Referer` of whatever the page loads next — and that key is
 *  the account. The site's `replaceState` was taken for a cure; it is
 *  not one. It rewrites the entry after the address has already been
 *  recorded, requested and logged, and it cannot touch any of those.
 *  The key goes to the clipboard instead, and its owner pastes it. */
export const RENEW_URL = `${PREMIUM_URL}#renew`;

/** The core's alphabet: no `l`, `o`, `0` or `1`, nothing to misread. */
const KEY_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const KEY_SYMBOLS = 16;
const GROUP = 4;

/** What a key field shows for what was typed or pasted into it: lower
    case, letters and digits only, sixteen at most, a dash between each
    group of four. Dashes and spaces already there are dropped and put
    back where they go, so a key pasted with or without them formats the
    same. Letters outside the alphabet are kept for the eye to catch:
    `isWellFormedKey` refuses them. */
export function formatKeyInput(raw: string): string {
  const compact = raw
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, KEY_SYMBOLS);
  const groups: string[] = [];
  for (let i = 0; i < compact.length; i += GROUP) groups.push(compact.slice(i, i + GROUP));
  return groups.join("-");
}

/** Whether a typed key has the shape of one; not whether it exists. */
export function isWellFormedKey(shown: string): boolean {
  const compact = shown.replace(/-/g, "");
  return (
    compact.length === KEY_SYMBOLS && [...compact].every((c) => KEY_ALPHABET.includes(c))
  );
}

/** The app's name for the network the server says it watches; null for
    one the app does not know. */
export function serverNetwork(name: string): Network | null {
  switch (name) {
    case "bitcoin":
    case "mainnet":
      return "mainnet";
    case "signet":
      return "signet";
    case "testnet":
    case "testnet4":
      return "testnet4";
    case "regtest":
      return "regtest";
    default:
      return null;
  }
}

/** How a network is named in a sentence. */
export const NETWORK_WORD: Record<Network, string> = {
  mainnet: "mainnet",
  signet: "signet",
  testnet4: "testnet4",
  regtest: "regtest",
};

/** The server did not answer, or something else answered for it. */
const UNREACHABLE_WORDS = "Could not reach the Gerfaut server.";

/** A refusal that came with no words of the server's: the core keeps
    the status alone, "HTTP 404", which is what a proxy without a route
    or a captive portal answers. */
const BARE_STATUS = /^HTTP \d{3}$/;

/** How a failure of the premium server reads under a card: one
    sentence, and whether offering "Retry" makes sense. The kind comes
    from the core; the words are the section's. */
export function premiumFailure(error: unknown): { message: string; retry: boolean } {
  if (isCommandError(error)) {
    switch ((error as CommandError).kind) {
      case "premium_unknown_key":
        return { message: "Unknown key.", retry: false };
      case "premium_no_paid_time":
        return { message: "This key has no paid time.", retry: false };
      case "premium_unreachable": {
        // A 5xx carries the server's own sentence: it answered, it just
        // could not do the thing — the e-mail that would not send, say.
        // "Could not reach" would make a refusal read as an outage.
        const words = /HTTP \d{3}: (.+)$/.exec(error.message)?.[1];
        return {
          message: words ? sentence(words) : UNREACHABLE_WORDS,
          retry: true,
        };
      }
      case "premium_rejected":
        // A status with none of the server's words did not come from
        // it: whatever answered in its place is out of the way later.
        return BARE_STATUS.test(error.message.trim())
          ? { message: UNREACHABLE_WORDS, retry: true }
          : { message: sentence(error.message), retry: false };
      case "premium_no_key":
        return { message: "Enter an account key first.", retry: false };
      case "premium_device_disconnected":
        return { message: DISCONNECTED_WORDS, retry: false };
      case "premium_no_device":
        return { message: "Connect this device with the Premium key first.", retry: false };
      case "premium_key_change_pending":
        // What was asked would lose the new key: the change comes first.
        return { message: KEY_CHANGE_UNFINISHED_WORDS, retry: false };
      case "app_lock_required":
        return { message: LOCK_REQUIRED_WORDS, retry: false };
      case "premium_rate_limited":
        // Not a failure of what was asked: the Rust side words the
        // wait ("Try again in 42 s."), and the same request may pass.
        return { message: `The server asks to wait. ${error.message}`, retry: true };
      case "tor":
        // The server is a clearnet address, but an onion backend sends
        // everything through Tor, this included. Raw, this read
        // "tor: no proxy answers on 127.0.0.1:9050".
        return {
          message:
            "Tor is not reachable. While your backend is an onion address, Gerfaut sends these requests through Tor too.",
          retry: true,
        };
      default:
        return { message: sentence(error.message), retry: false };
    }
  }
  return { message: UNREACHABLE_WORDS, retry: true };
}

/** The server writes its refusals in lower case; a note starts with a
    capital and ends with a full stop. */
function sentence(words: string): string {
  const trimmed = words.trim();
  if (trimmed.length === 0) return "The Gerfaut server refused.";
  const capital = trimmed[0].toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}

/** "Sep 5": a day close enough not to need its year. */
export function shortDay(unixSeconds: number): string {
  const local = new Date(unixSeconds * 1000);
  return `${MONTHS[local.getMonth()]} ${local.getDate()}`;
}

/** "14:02" the same day, "Sep 5, 14:02" another one: when the watch
    went quiet, as the banner says it. */
export function offlineSinceLabel(unixSeconds: number, nowMs = Date.now()): string {
  const local = new Date(unixSeconds * 1000);
  const now = new Date(nowMs);
  const time = `${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}`;
  const sameDay =
    local.getFullYear() === now.getFullYear() &&
    local.getMonth() === now.getMonth() &&
    local.getDate() === now.getDate();
  return sameDay ? time : `${shortDay(unixSeconds)}, ${time}`;
}

/** "3 coins", "1 coin". */
export function coinsWord(count: number): string {
  return `${count} coin${count === 1 ? "" : "s"}`;
}

/** What an event says after the wallet's name: a state, never an amount
    or an address, the same restraint as the notification itself. */
export function eventWords(kind: EventKind): string {
  switch (kind) {
    case "spend_detected":
      return "coins are moving";
    case "spend_confirmed":
      return "a spend confirmed";
    case "coins_gone":
      return "coins are gone";
    case "receive_detected":
      return "coins are arriving";
    case "receive_confirmed":
      return "a payment confirmed";
    case "timelock_due":
      return "a timelock is due";
    case "wallet_registered":
      return "watch started";
    case "wallet_refused":
      return "no longer watched";
    default:
      return "something happened";
  }
}

/** How long the section keeps asking the server on its own: five
    seconds apart while a wallet scans, three while a Telegram code
    waits for the bot, both for two minutes and then by hand. Mutable so
    a test can shorten the wait. */
export const TIMING = {
  walletPollMs: 5_000,
  telegramPollMs: 3_000,
  pollWindowMs: 120_000,
  heartbeatMs: 15 * 60_000,
  /** How old the device list may be before the window coming back to
      the front asks for it again. The Rust side asks every five
      minutes on its own. */
  devicesFocusMs: 60_000,
};

/** What the section says once the server stopped knowing this device. */
export const DISCONNECTED_WORDS = "This device was disconnected from your Premium account.";

/** Why this device is disconnected: the server's own sentence when it
    gave one, a key with every device it takes, and the section's
    otherwise, a bare status included. */
export function disconnectedWords(reason: string | null): string {
  const words = reason?.trim() ?? "";
  return words === "" || BARE_STATUS.test(words) ? DISCONNECTED_WORDS : sentence(words);
}

/** A key change sent and not answered: the server may already hold the
    new key, and this device is the only other place that does. */
export const KEY_CHANGE_UNFINISHED_WORDS =
  "The key change did not finish. Try again to complete it.";

/** Why a change to the account asks for an app lock first. */
export const LOCK_REQUIRED_WORDS =
  "Changing who can use your Premium account needs an app lock on this device, so that nobody holding it unlocked can do it.";

/** How a platform is named, in a row and in a notification. The server
    only ever sends one of these five: no name chosen by whoever
    connected reaches the screen. */
export const PLATFORM_LABEL: Record<DevicePlatform, string> = {
  android: "Android phone",
  ios: "iPhone",
  windows: "Windows computer",
  macos: "Mac",
  linux: "Linux computer",
};

/** A platform's name, with a plain word for one this build does not know. */
export function platformLabel(platform: string): string {
  return PLATFORM_LABEL[platform as DevicePlatform] ?? "device";
}

/** "24 Sep 2026": the day a device connected, or will get full access. */
export function dayMonthYear(unixSeconds: number): string {
  const local = new Date(unixSeconds * 1000);
  return `${local.getDate()} ${MONTHS[local.getMonth()]} ${local.getFullYear()}`;
}

const DAY_SECONDS = 86_400;

/** How long a new device waits without an approval. */
export const PENDING_DAYS = 10;

/** Whole days until `until`, counting a day begun as one: a device with
    three hours left still has "1 day left", never "0". */
export function daysLeft(until: number, nowMs = Date.now()): number {
  return Math.max(1, Math.ceil((until - nowMs / 1000) / DAY_SECONDS));
}

/** "Waiting · 3 days left". */
export function waitingWords(until: number, nowMs = Date.now()): string {
  const days = daysLeft(until, nowMs);
  return `Waiting · ${days} ${days === 1 ? "day" : "days"} left`;
}

/** The devices still waiting for approval, oldest first. */
export function pendingDevices(devices: Device[] | undefined): Device[] {
  return (devices ?? []).filter((device) => device.access === "pending");
}

/** Whether a failure is the server saying this device waits for
    approval: the section then shows the waiting card, not a note. */
export function isDevicePending(error: unknown): boolean {
  return isCommandError(error) && error.kind === "premium_device_pending";
}

/** Whether a failure is the server no longer knowing this device. */
export function isDeviceDisconnected(error: unknown): boolean {
  return isCommandError(error) && error.kind === "premium_device_disconnected";
}
