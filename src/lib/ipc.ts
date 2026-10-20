// Typed bridge to the Rust commands. The shapes mirror gerfaut-core's
// serde DTOs one to one; if a field changes there, it changes here.

import { invoke } from "@tauri-apps/api/core";
import type { Unit } from "./format";

export type Network = "mainnet" | "signet" | "testnet4" | "regtest";

export type ScriptKind =
  | "legacy"
  | "nested_segwit"
  | "segwit"
  | "taproot"
  | "witness_script"
  | "legacy_script"
  | "bare";

export type RecognizedKind =
  | "descriptor"
  | "descriptor_pair"
  | "multipath_descriptor"
  | "extended_key"
  | "address"
  | "wallet_export"
  | "bsms";

export type InputWarning =
  | "assumed_segwit"
  | "slip132_converted"
  | "change_not_tracked"
  | "multiple_accounts_in_file"
  | "non_standard_derivation"
  | "assumed_branches";

/** Where a lone extended key derives its addresses: receive and change
    branches under the key (`0/*`, `1/*`), and the key origin. */
export interface DerivationChoice {
  receive: string;
  /** Null leaves change untracked. */
  change: string | null;
  /** `[fingerprint/path]`; null keeps the one the input carried. */
  origin: string | null;
}

export type ParsedPayload =
  | { type: "descriptors"; external: string; internal: string | null; script: ScriptKind }
  | { type: "address"; address: string };

export interface ParsedInput {
  kind: RecognizedKind;
  networks: Network[];
  payload: ParsedPayload;
  warnings: InputWarning[];
  /** Script types the user may switch to; empty when the input fixes it. */
  script_options: ScriptKind[];
  /** First receive address, when derivable: on the network asked for
      when the input allows it, on the first candidate otherwise. */
  preview_address: string | null;
  /** The derivation in effect; set only for a lone extended key. */
  derivation: DerivationChoice | null;
  /** True when the input leaves the derivation open (a lone key). */
  derivation_editable: boolean;
}

export type QrFormat = "plain" | "ur" | "bbqr";

/** Where a camera scan stands after the frames seen so far. */
export interface QrProgress {
  format: QrFormat;
  received: number;
  total: number;
  complete: boolean;
  text: string | null;
  /** What the core assumed reading the code, which `text` no longer
      shows: said with the warnings of that text. */
  warnings: InputWarning[];
}

export type WalletKind =
  | { type: "descriptors"; external: string; internal: string | null; script: ScriptKind }
  | { type: "single_address"; address: string };

export interface BalanceSnapshot {
  confirmed: number;
  trusted_pending: number;
  untrusted_pending: number;
  immature: number;
  total: number;
  /** Signed sum of the transactions not yet in a block: what of `total`
      is still arriving, or has left without the chain having taken it
      yet. Null once everything is settled. */
  pending_net_sats: number | null;
}

export interface SyncStamp {
  at: number;
  tip_height: number;
  backend: string;
}

/** The glyph a wallet shows next to its name: Lucide names, one fixed
    set shared with the mobile app. */
export type WalletIconId =
  | "wallet"
  | "key"
  | "shield"
  | "map_pin"
  | "snowflake"
  | "landmark"
  | "piggy_bank";

/** Every icon, in the order the picker shows them. */
export const WALLET_ICONS = [
  "wallet",
  "key",
  "shield",
  "map_pin",
  "snowflake",
  "landmark",
  "piggy_bank",
] as const satisfies readonly WalletIconId[];

export interface WalletMeta {
  id: string;
  name: string;
  icon: WalletIconId;
  network: Network;
  kind: WalletKind;
  recognized_as: RecognizedKind;
  created_at: number;
  gap_limit: number;
  scan_gap: number;
  labels: Record<string, string>;
  last_sync: SyncStamp | null;
  cached: { balance: BalanceSnapshot; tx_count: number };
  /** Watched live before any other wallet when Live cannot follow every
      address. Absent while off. */
  live_pinned?: boolean;
}

export type TxStatus =
  | { state: "confirmed"; height: number; timestamp: number | null }
  | { state: "pending" };

export interface TxSummary {
  txid: string;
  net_sats: number;
  fee_sats: number | null;
  status: TxStatus;
  confirmations: number;
}

export interface OpReturnData {
  /** Payload bytes in hex. */
  hex: string;
  /** The payload as text, when printable UTF-8. */
  text: string | null;
  /** Name of a recognized protocol payload (witness commitment...). */
  label: string | null;
}

export interface TxIo {
  address: string | null;
  value_sats: number | null;
  is_mine: boolean;
  /** Output on the wallet's change keychain. */
  change: boolean;
  op_return: OpReturnData | null;
  /** For an input, the transaction of the output it spends. Two inputs
      can share an address; only the outpoint names one of them. */
  prev_txid: string | null;
  /** For an input, the index of the output it spends. */
  prev_vout: number | null;
}

/** A server address read out of a scan or a paste. Fills the backend
    form; nothing is saved until the person presses Save. */
export interface ScannedBackend {
  kind: "electrum" | "esplora";
  /** The address in the form the backend configuration stores. */
  url: string;
  host: string;
  port: number | null;
  tls: boolean;
  onion: boolean;
}

/** Deep transaction facts; null only for watched-address entries synced
    by older app versions. */
export interface TxExtras {
  size_bytes: number;
  vsize: number;
  weight_wu: number;
  version: number;
  locktime: number;
  rbf_signaled: boolean;
  segwit: boolean;
  taproot: boolean;
  is_coinbase: boolean;
  coinbase_pool: string | null;
  coinbase_height: number | null;
  coinbase_tag: string | null;
  sigops: number;
  raw_hex: string;
}

export interface TxDetail {
  summary: TxSummary;
  inputs: TxIo[];
  outputs: TxIo[];
  vsize: number;
  fee_rate_sat_vb: number | null;
  extras: TxExtras | null;
}

export interface UtxoInfo {
  txid: string;
  vout: number;
  address: string | null;
  value_sats: number;
  status: TxStatus;
  keychain: "external" | "internal" | null;
  derivation_index: number | null;
}

export interface AddressEntry {
  index: number;
  address: string;
  used: boolean;
  /** Derivation path: absolute (`m/84'/1'/0'/0/5`) when unambiguous,
      keychain-relative otherwise; null for watched single addresses. */
  derivation: string | null;
}

/** One row of the address audit list. */
export interface AddressRow {
  index: number;
  address: string;
  used: boolean;
  balance_sats: number;
}

/** Revealed addresses by keychain, capped server-side (audit view). */
export interface AddressList {
  external: AddressRow[];
  internal: AddressRow[];
  truncated: boolean;
}

export type ExportDirection = "incoming" | "outgoing";

/** Filters for a CSV export; empty means everything. */
export interface ExportOptions {
  from: number | null;
  to: number | null;
  direction: ExportDirection | null;
  include_pending: boolean;
}

export interface WalletSnapshot {
  meta: WalletMeta;
  balance: BalanceSnapshot;
  txs: TxSummary[];
  tip_height: number;
  /** True when the tx list is partial (busy watched address). */
  truncated: boolean;
}

// --- policy ---------------------------------------------------------------

/** The shape of a wallet's policy, at a glance. */
export type PolicyKind = "single_key" | "multisig" | "miniscript" | "address";

/** What a spending branch is for, guessed from its timelocks. */
export type BranchRole = "primary" | "recovery" | "emergency" | "other";

/** One key of the policy; the same extended key on two paths is one key. */
export interface PolicyKey {
  /** Stable within the snapshot: `k0`, `k1`... */
  id: string;
  /** `Key A`, `Key B`... */
  label: string;
  /** Eight lowercase hex digits; null when nothing identifies the key. */
  fingerprint: string | null;
  /** `m/48'/1'/0'/2'` when the key carries an origin. */
  origin_path: string | null;
  /** The key as written, shortened around an ellipsis. */
  key_short: string;
}

/** `after(n)`: a height below 500,000,000, a unix time at or above it. */
export type AbsoluteLock = { kind: "height"; height: number } | { kind: "time"; unix: number };

/** `older(n)`, counted from each coin's confirmation; `seconds` is
    already multiplied out of its 512-second units. */
export type RelativeLock =
  | { kind: "blocks"; blocks: number }
  | { kind: "seconds"; seconds: number };

/** A spending condition as the policy states it. A threshold with
    `k === n` is an "and", one with `k === 1` an "or". */
export type Condition =
  | { kind: "key"; key_id: string }
  | { kind: "thresh"; k: number; n: number; items: Condition[] }
  | { kind: "after"; lock: AbsoluteLock }
  | { kind: "older"; lock: RelativeLock }
  | { kind: "preimage"; hash: string };

export type TimelockRef =
  | { kind: "absolute"; lock: AbsoluteLock }
  | { kind: "relative"; lock: RelativeLock };

/** What still separates a lock from opening. Block figures come with
    their ten-minute estimate; a time figure has no block count. */
export interface Remaining {
  remaining_blocks: number | null;
  remaining_seconds: number | null;
  unlocks_at_unix: number | null;
}

/** Coins sorted against a relative lock: `waiting` ones are not
    confirmed yet, `next` is the locked coin that opens first. */
export interface PerCoin {
  unlocked: number;
  waiting: number;
  locked: number;
  next: Remaining | null;
}

/** An absolute lock still ahead. What is left sits under `until`, as it
    does in the branch state. Every figure is null when the wallet has
    never synced: there is no tip to measure from, and the lock holds
    for an unknown time. */
export type LockedLock = { kind: "locked"; until: Remaining };

/** Where one lock stands against the chain and the coins. */
export type LockState =
  | { kind: "unlocked" }
  | LockedLock
  | ({ kind: "per_coin" } & PerCoin)
  | { kind: "no_coins"; blocks: number | null; seconds: number | null };

export interface Timelock {
  lock: TimelockRef;
  /** False under a threshold that can be met without it: the lock is
      listed, but never holds the branch back. */
  required: boolean;
  state: LockState;
}

/** Whether a branch can be spent from right now. */
export type BranchState =
  | { kind: "spendable_now" }
  | { kind: "locked"; until: Remaining }
  | ({ kind: "per_coin" } & PerCoin)
  | { kind: "no_coins" }
  | { kind: "needs_preimage" };

/** The tone the core shows a branch's state in: confirmed when it is
    open, pending when it opens in under thirty days, neutral otherwise. */
export type BranchTone = "confirmed" | "pending" | "neutral";

/** One way to spend: a top-level alternative of the policy. */
export interface PolicyBranch {
  /** Stable within the snapshot: `b0`, `b1`... */
  id: string;
  role: BranchRole;
  /** `Primary`, `Recovery`, `Emergency`, `Primary B`, `Recovery 3`... */
  label: string;
  /** One sentence from the core: "Key B, once a coin has waited 52,560 blocks". */
  summary: string;
  condition: Condition;
  /** Every lock of the branch, optional ones included, in policy order. */
  timelocks: Timelock[];
  state: BranchState;
  spendable_now: boolean;
  tone: BranchTone;
}

/** A wallet's policy read against the chain. A watched address has no
    keys and no branches; its descriptor field holds the address. */
export interface PolicySnapshot {
  kind: PolicyKind;
  script: ScriptKind;
  descriptor: string;
  /** The normalized policy with key labels: `or(pk(Key A),and(pk(Key B),older(52560)))`. */
  policy: string;
  keys: PolicyKey[];
  /** In reading order: the primary paths, then recovery, emergency and
      the rest, each from the nearest lock to the farthest. */
  branches: PolicyBranch[];
  /** Chain tip at the last sync; null when the wallet never synced, in
      which case every absolute lock is locked with nothing left to
      say. */
  tip_height: number | null;
  /** When the snapshot was computed, unix seconds. */
  computed_at: number;
  /** Time locks are judged against the device clock, which the chain's
      median time trails by up to a couple of hours. */
  time_basis: "wall_clock";
  /** Number of coins the relative locks were counted over. */
  coins: number;
  has_timelocks: boolean;
}

/** A transaction a sync brought in for the first time. */
export interface NewTx {
  txid: string;
  net_sats: number;
  confirmed: boolean;
}

export interface SyncReport {
  wallet_id: string;
  new_tx_count: number;
  new_txs: NewTx[];
  balance: BalanceSnapshot;
  tip_height: number;
  took_ms: number;
  backend: string;
}

/** One wallet a sync of all of them could not sync: the core's words,
    and the code the app picks its sentence on ({@link failureMessage}). */
export interface SyncFailure {
  wallet_id: string;
  message: string;
  kind: CoreErrorCode;
}

export interface SyncAllReport {
  reports: SyncReport[];
  failures: SyncFailure[];
}

export type BackendConfig =
  /** `server` names one public operator; absent, every public Esplora
      instance is tried in order. */
  | { type: "public_esplora"; server?: string }
  /** `own_node`: the user said the server is their own node, and Live
      asks more of it. The core leaves it out while false, so it is sent
      back with every save of a custom server, or saving would turn it
      off. */
  | { type: "custom_esplora"; url: string; own_node?: boolean }
  | { type: "custom_electrum"; url: string; own_node?: boolean };

export type ServerProtocol = "esplora" | "electrum";

/** One public server offered for a network. */
export interface PublicServer {
  id: string;
  label: string;
  protocol: ServerProtocol;
  url: string;
  /** Whether the server signs its own certificate, so the picker says it
      before it is chosen rather than after. */
  self_signed: boolean;
}

export type TorMode = "auto" | "system" | "embedded";

/** How `.onion` backends reach Tor: a system daemon found on the
    SOCKS port, the client built into Gerfaut, or whichever answers. */
export interface TorSettings {
  mode: TorMode;
  /** `host:port` of the system SOCKS proxy; null means 127.0.0.1:9050. */
  socks_proxy: string | null;
}

export type TorVia = "system" | "embedded";

export interface TorRoute {
  socks: string;
  via: TorVia;
}

/** Where Tor stands right now, mirroring `TorStatus` in gerfaut-core. */
export interface TorStatus {
  mode: TorMode;
  /** The effective system proxy address. */
  socks_proxy: string;
  via: TorVia | null;
  /** The SOCKS address in use, once a route was resolved. */
  socks: string | null;
  running: boolean;
  bootstrapped: boolean;
  bootstrap_percent: number;
  error: string | null;
  /** Whether this build carries the built-in client. */
  embedded_available: boolean;
}

export type LockKind = "pin" | "password";

/** The app lock as the apps see it: kind, never the hash. */
export interface AppLock {
  kind: LockKind;
  biometric: boolean;
}

export interface LockVerdict {
  unlocked: boolean;
  failures: number;
  /** Seconds before the next attempt is looked at; 0 when it can be. */
  retry_after_secs: number;
}

export interface Settings {
  active_network: Network;
  backends: Partial<Record<Network, BackendConfig>>;
  /** Gap limit shared by every wallet. */
  gap_limit: number;
  app_prefs: Record<string, string>;
  /** Electrum certificates the user accepted, by `host:port`. */
  electrum_certs: Record<string, string>;
  /** The lock in place, without its hash; null when there is none. */
  app_lock: AppLock | null;
  /** How `.onion` backends reach Tor. */
  tor: TorSettings;
  /** What both apps keep with the same meaning; `app_prefs` holds what
      is this app's alone. */
  preferences: Preferences;
}

// --- backup ---------------------------------------------------------------

export interface BackupOptions {
  /** Null exports every wallet on every network. */
  wallet_ids: string[] | null;
  include_settings: boolean;
}

/** A sealed backup in both transport forms. */
export interface BackupBundle {
  /** Base64 of the encrypted file bytes. */
  data: string;
  /** UR frames to loop as an animated QR. */
  frames: string[];
  wallet_count: number;
  size_bytes: number;
}

/** A backup file picked in the native open dialog: its name for the
    screen, its bytes as the base64 the core opens. The path stays on
    the Rust side. */
export interface PickedBackup {
  name: string;
  data: string;
}

export interface BackupWalletPreview {
  index: number;
  name: string;
  network: Network;
  kind: WalletKind;
  already_watched: boolean;
  /** Why a restore cannot take this wallet, in the core's words: its
      material does not read as a wallet to watch, or its two
      descriptors are not one wallet. Null for one it takes. */
  refused: string | null;
}

/** One backend the settings of a backup would put in place. */
export interface BackupBackendPreview {
  network: Network;
  /** The host as a sync report names it, never a URL: one may carry
      credentials. */
  backend: string;
}

export interface BackupPreview {
  created_at: number;
  wallets: BackupWalletPreview[];
  has_settings: boolean;
  /** What "apply node settings" would put in place, one entry per
      network. Empty when the backup carries no settings. */
  backends: BackupBackendPreview[];
  /** The `host:port` of every Electrum certificate a restore would pin.
      Empty when the backup carries no settings. */
  electrum_hosts: string[];
}

export interface ImportChoices {
  /** Null imports every wallet of the backup. */
  indexes: number[] | null;
  apply_settings: boolean;
}

export interface ImportReport {
  added: WalletMeta[];
  skipped: number;
  settings_applied: boolean;
  /** Wallets a restore of every wallet left out because the core cannot
      watch them, as the preview marked them. */
  refused: RefusedWallet[];
}

/** A wallet of a backup a restore left out, mirroring `RefusedWallet`
    in gerfaut-core. */
export interface RefusedWallet {
  index: number;
  name: string;
  /** Why, in the core's words. */
  reason: string;
}

/** What a server's certificate amounts to, mirroring `CertificateStatus`
    in gerfaut-core. `host` is `host:port`, the key an acceptance is
    recorded against. */
export type CertificateReport = { host: string } & (
  | { status: "not_tls" }
  | { status: "tor" }
  | { status: "trusted" }
  | { status: "pinned"; fingerprint: string }
  | {
      status: "unknown";
      fingerprint: string;
      reason: string;
      subject: string | null;
      expires: number | null;
    }
  | { status: "changed"; stored: string; presented: string }
  | { status: "unreachable"; detail: string }
);

export type PriceSource = "mempool_space" | "coingecko";

/** A display currency, by the identifier gerfaut-core names it with
    (`eur`, `try`...): the list on offer, its order, the names and which
    source quotes what are the core's, in `PriceTable`. Its ISO code is
    the identifier in capitals. */
export type FiatCurrency = string;

/** How many sources quote a currency, mirroring `CurrencyReach`. */
export type CurrencyReach = "every" | "coingecko_only";

/** One currency of the table, mirroring `CurrencyEntry`. */
export interface CurrencyEntry {
  currency: FiatCurrency;
  /** ISO 4217 code: the identifier, in capitals. */
  code: string;
  /** Its English name, read beside the code. */
  name: string;
  reach: CurrencyReach;
  /** The sources that quote it, in display order. */
  sources: PriceSource[];
}

/** One price source of the table, mirroring `SourceEntry`. */
export interface SourceEntry {
  source: PriceSource;
  label: string;
  /** The chart ranges it serves without a key, shortest first. */
  ranges: PriceRange[];
  /** What its terms ask to be shown with its data, or null: once on
      each screen that shows a price or an amount it priced. */
  credit: Credit | null;
}

/** The credit a price source asks for, mirroring `Credit`: its words,
    and the page they link to. */
export interface Credit {
  text: string;
  url: string;
}

/** What the settings offer for the fiat value, and how often its price
    is asked, mirroring `PriceTable` in gerfaut-core. */
export interface PriceTable {
  /** In display order: the ones every source quotes first. */
  currencies: CurrencyEntry[];
  sources: SourceEntry[];
  /** Seconds from one price to the next while the fiat value is on. */
  refresh_secs: number;
}

/** The preferences both apps keep, mirroring `Preferences` in
    gerfaut-core. A vault that never stored one answers its default. */
export interface Preferences {
  unit: Unit;
  masked: boolean;
  fiat: boolean;
  fiat_currency: FiatCurrency;
  /** Always one that quotes `fiat_currency`: the core sees to it. */
  price_source: PriceSource;
  notify_new_tx: boolean;
  explorer_ack: boolean;
}

/** A change to some of the preferences; what is left out keeps its
    value. */
export type PreferencesChange = Partial<Preferences>;

export interface PriceQuote {
  /** Price of 1 BTC in the currency. */
  rate: number;
  currency: FiatCurrency;
  source: PriceSource;
  at: number;
}

export type PriceRange = "day" | "week" | "month" | "year" | "max";

export interface PricePoint {
  /** Unix timestamp, seconds. */
  t: number;
  rate: number;
}

export interface PriceHistory {
  points: PricePoint[];
  currency: FiatCurrency;
  source: PriceSource;
  range: PriceRange;
  at: number;
}

// --- broadcast ------------------------------------------------------------

export type TxSource = "raw_transaction" | "psbt";

export interface WalletRef {
  id: string;
  name: string;
}

export interface TxInputPreview {
  txid: string;
  vout: number;
  value_sats: number | null;
  address: string | null;
  signed: boolean;
  wallet: WalletRef | null;
}

export interface TxOutputPreview {
  index: number;
  value_sats: number;
  address: string | null;
  op_return: OpReturnData | null;
  wallet: WalletRef | null;
  change: boolean;
}

export type TxWarningKind =
  | "unsigned"
  | "high_fee_rate"
  | "high_fee_share"
  | "locked"
  | "input_unknown"
  | "input_spent"
  /** This very transaction is already waiting in the mempool: sending it
      again does no harm. */
  | "in_mempool"
  | "input_mismatch"
  | "fee_unknown"
  | "dust_output"
  | "spends_watched"
  /** An input signed with SIGHASH_NONE or SIGHASH_SINGLE: its signature
      leaves some or all of the outputs open, and whoever relays the
      transaction can send that money elsewhere. */
  | "uncommitted_outputs";

/** How loudly a caution is read. The core answers the one question —
    can the person lose funds or lose privacy? — so the two applications
    cannot drift into two tables. */
export type TxSeverity = "alert" | "info";

export interface TxWarning {
  kind: TxWarningKind;
  message: string;
  /** The tone to read it in, derived from `kind` by the core. A screen
      takes it as given: a kind added later must not fall through a
      hand-written table into a tone nobody chose. */
  severity: TxSeverity;
  /** The network is sure to refuse the transaction while this holds: a
      signature missing, a coin spent in a block, outputs past all the
      bitcoin there will ever be, or outputs over inputs whose every
      amount is proven. The core sets it, and a preview with one is not
      ready. */
  blocking: boolean;
}

/** Where a transaction stands before it is sent, decided by the core:
    the words of the readiness pill. `refused` comes before `unsigned`
    when both hold, since a signature does not bring back a spent coin.
    `in_mempool`: signed, and already waiting to be mined; it can be sent
    again, which does no harm. */
export type TxReadiness = "ready" | "refused" | "unsigned" | "in_mempool";

/** What the fee rate is measured on: the transaction as it will be sent
    (`exact`), an estimate of it once the missing signatures are in
    (`estimated`), or, their weight unknown, the most it can be
    (`upper_bound`). */
export type FeeRateBasis = "exact" | "estimated" | "upper_bound";

/** Everything shown before a transaction is broadcast. */
export interface TxPreview {
  txid: string;
  source: TxSource;
  network: Network;
  inputs: TxInputPreview[];
  outputs: TxOutputPreview[];
  fee_sats: number | null;
  /** The fee over the size the transaction has once signed: see
      `fee_rate_basis`. */
  fee_rate_sat_vb: number | null;
  fee_rate_basis: FeeRateBasis;
  /** Why there is no fee, in the words of the core's caution: what the
      confirmation repeats. Null when there is a fee. */
  fee_unknown_reason: string | null;
  /** A value shown for an input is only what the PSBT declares: no
      watched wallet, no backend and no previous transaction proves it.
      The inputs total and the fee rest on that word then. */
  amounts_declared: boolean;
  /** One of those values is a watched address's listing, the server's
      figure, rather than the PSBT's word: the mark says it neutrally. */
  amounts_listed: boolean;
  vsize: number;
  weight: number;
  size: number;
  version: number;
  locktime: number;
  rbf: boolean;
  /** Where it stands: the one thing the pill and the Broadcast button
      both read. The core also sends `ready`, derived from this, which
      the page leaves alone. */
  readiness: TxReadiness;
  warnings: TxWarning[];
  /** The transaction as the network takes it; present only when ready. */
  hex: string | null;
}

export interface BroadcastReport {
  txid: string;
  backend: string;
  at: number;
}

export interface BroadcastStatus {
  txid: string;
  found: boolean;
  confirmed: boolean;
  block_height: number | null;
  confirmations: number;
  backend: string;
  at: number;
}

/** A transaction handed to the network from this app, kept by the
    vault so the broadcast page can show where it stands after a
    restart. */
export interface RecentBroadcast {
  txid: string;
  network: Network;
  hex: string;
  backend: string;
  at: number;
}

/** What to say about releases: all of it decided by the core, which
    keeps the state of the check in the vault. */
export interface UpdateStatus {
  /** The daily check is on. */
  automatic: boolean;
  /** The release the notice announces; null when it has nothing to say. */
  announce: string | null;
  /** The newer release known, closed or not: what About offers. */
  available: string | null;
  /** The last check that was to go out did not: Tor is needed and could
      not be had. */
  tor_unavailable: boolean;
}

/** Where the live watch stands, as the core reports it. */
export type WatchState = "off" | "connecting" | "connected" | "reconnecting" | "polling";
export type WatchTransport = "electrum" | "mempool_websocket" | "esplora_polling";

export interface WatchStatus {
  state: WatchState;
  transport: WatchTransport | null;
  /** The host in use or being tried, never a full address. */
  server: string | null;
  /** Why the last connection failed, while reconnecting. */
  detail: string | null;
  watched_scripts: number;
  /** Scripts the server pushes changes for; the rest are polled. */
  pushed_scripts: number;
  /** Scripts worth watching that Live leaves to the regular syncs, past
      what it takes of one wallet or of all of them. */
  left_out_scripts: number;
  /** The wallets those scripts belong to. */
  left_out_wallets: number;
  /** How much of each wallet of the list Live hears, in list order;
      empty while it is off. */
  wallets: WalletCoverage[];
  /** What an Electrum server says it runs ("Fulcrum 1.12.0"); null over
      the other transports, and from a core that predates it. */
  server_software?: string | null;
  /** Why Live leaves addresses to the syncs and the way out, as the core
      decides it: present exactly while it runs and leaves some out. */
  left_out?: LeftOut | null;
}

/** What the live watch takes of one wallet and in all. */
export interface WatchLimits {
  per_wallet: number;
  total: number;
}

/** The two sets of limits "This is my node" chooses between. */
export interface WatchLimitsChoice {
  any: WatchLimits;
  own_node: WatchLimits;
}

/** The core's verdict on what Live leaves to the syncs. */
export interface LeftOut {
  /** The server, as soon as it refused any address; Live's limits
      otherwise. */
  reason: "live_limit" | "server_refused";
  /** What Live takes under the backend in use. */
  limits: WatchLimits;
  /** The backend is the user's own node. */
  own_node: boolean;
  /** Null when nothing the user can do takes more. */
  remedy: Remedy | null;
}

/** An Electrum server whose subscription limit the core can name. */
export type ServerSoftware = "fulcrum" | "electrumx" | "electrs_esplora" | "mempool_electrs";

export type Remedy =
  /** A node of one's own, marked "This is my node": Live takes `limits`. */
  | { type: "own_node"; limits: WatchLimits }
  /** The setting of the user's node to raise: none named when the core
      does not know its software. */
  | { type: "raise_server_limit"; server: ServerSoftware | null; settings: string[] };

/** Whether Live hears a wallet whole, in part, or not at all. */
export type Coverage = "live" | "partial" | "sync_only";

export interface WalletCoverage {
  wallet_id: string;
  coverage: Coverage;
  /** Scripts of the wallet Live hears. */
  watched_scripts: number;
  /** Scripts of the wallet left to the regular syncs. */
  left_out_scripts: number;
  /** Of those, the ones the server refused; the rest are past Live's
      limits. */
  refused_scripts?: number;
}

export interface LiveStatus {
  /** The alerts are on, so a watch should be running. */
  enabled: boolean;
  status: WatchStatus;
}

/** A failed command. A failure of the core comes under the core's own
    code (`ErrorCode` in gerfaut-core), the same one the Android app
    reads; `locked`, `notification` and `link` are this app's. */
export interface CommandError {
  kind:
    | "unrecognized_input"
    | "private_material"
    | "invalid_input"
    /** An animated QR code announces more parts than Gerfaut reads. */
    | "too_many_parts"
    | "network_mismatch"
    | "wallet_not_found"
    | "duplicate_wallet"
    | "vault"
    /** The vault, or a backup, would not open with the key given: the
        password is wrong or the file is damaged. Nothing else comes
        under this kind. */
    | "wrong_key"
    /** What was handed over as a backup is not a Gerfaut backup, or is
        damaged outside what the password guards. */
    | "unreadable_backup"
    /** A vault or backup written by a newer Gerfaut. */
    | "newer_format"
    /** Another Gerfaut holds the vault: a second copy running on the
        same data directory. Only ever met at startup. */
    | "vault_in_use"
    | "sync"
    /** A server answered with a proof of a confirmation that does not
        hold, and no other server answered in its place. */
    | "false_proof"
    | "broadcast"
    | "backend_unavailable"
    | "descriptor"
    | "tor"
    /** The app is locked: the vault answers nothing until a secret
        goes through. */
    | "locked"
    /** The system refused to post a notification. */
    | "notification"
    /** A page the browser was asked to open: an address Gerfaut does
        not link to, or one nothing on the computer opened. */
    | "link"
    | "internal";
  message: string;
}

/** The codes of the core, the kinds of a failed command but the three
    this app adds itself. */
export type CoreErrorCode = Exclude<CommandError["kind"], "locked" | "notification" | "link">;

/** Type guard for errors thrown by commands. */
export function isCommandError(error: unknown): error is CommandError {
  return (
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    "message" in error
  );
}

/** What the app says when a server sent a false proof: the core's own
    words name the server and the check that failed, which tells a
    person nothing they can act on. */
export const FALSE_PROOF =
  "A server sent a false proof of a confirmation, so Gerfaut stopped trusting its answer. No other server answered in its place. Try again later, or use your own node.";

/** What the app says when the core refuses wallet material for a
    private key, wherever it came from: pasted, opened, scanned. The
    core's words name the check; these say what to bring instead, in
    the words of the Android app. */
export const PRIVATE_MATERIAL =
  "This holds a private key, and Gerfaut only watches: nothing was saved. Bring the public descriptor or extended public key instead.";

/** What a refusal of wallet material says: the core's own words, which
    are written for the person, except for a private key, said in the
    app's. */
export function materialRefusal(error: unknown): string {
  if (isCommandError(error) && error.kind === "private_material") return PRIVATE_MATERIAL;
  return isCommandError(error) ? error.message : String(error);
}

/** What a failed call says: the command's own message, or the error as
    text when it did not come from a command. A false proof is said in
    the app's words. */
export function errorMessage(error: unknown): string {
  if (isFalseProof(error)) return FALSE_PROOF;
  return isCommandError(error) ? error.message : String(error);
}

/** Whether a call failed on a server's false proof, by the core's code. */
export function isFalseProof(error: unknown): boolean {
  return isCommandError(error) && error.kind === "false_proof";
}

/** What a failure the core hands over as data says: a wallet a sync of
    all of them could not sync, or a sync the live watch ran. Read by its
    code, as {@link errorMessage} reads a failed call: a false proof in
    the app's words, anything else in the core's. */
export function failureMessage(failure: { kind?: unknown; message: string }): string {
  return failure.kind === "false_proof" ? FALSE_PROOF : failure.message;
}

// --- commands ----------------------------------------------------------

export const ipc = {
  /** What kept the vault shut at startup; null when it opened. */
  startupFailure: () => invoke<CommandError | null>("startup_failure"),
  /** Tries the open again after a startup failure. */
  retryOpen: () => invoke<void>("retry_open"),
  /** `network` is the one the wallet is about to be added on: the
      first address comes back derived for it when the input allows it. */
  parseInput: (
    input: string,
    script?: ScriptKind,
    derivation?: DerivationChoice,
    network?: Network,
  ) =>
    invoke<ParsedInput>("parse_input", {
      input,
      script: script ?? null,
      derivation: derivation ?? null,
      network: network ?? null,
    }),
  assembleQr: (frames: string[]) => invoke<QrProgress>("assemble_qr", { frames }),
  /** Opens a scan the core holds, for frames sent one at a time. */
  openQrScan: () => invoke<number>("open_qr_scan"),
  /** One new frame of an open scan; where the scan stands after it. */
  pushQrFrame: (scan: number, frame: string) =>
    invoke<QrProgress>("push_qr_frame", { scan, frame }),
  /** Lets the core drop a scan. */
  closeQrScan: (scan: number) => invoke<void>("close_qr_scan", { scan }),
  parseBackend: (input: string) => invoke<ScannedBackend>("parse_backend", { input }),
  addWallet: (name: string, parsed: ParsedInput, network: Network) =>
    invoke<WalletMeta>("add_wallet", { name, parsed, network }),
  listWallets: (network?: Network) =>
    invoke<WalletMeta[]>("list_wallets", { network: network ?? null }),
  walletSnapshot: (id: string) => invoke<WalletSnapshot>("wallet_snapshot", { id }),
  txDetail: (id: string, txid: string) => invoke<TxDetail>("tx_detail", { id, txid }),
  utxos: (id: string) => invoke<UtxoInfo[]>("utxos", { id }),
  walletPolicy: (id: string) => invoke<PolicySnapshot>("wallet_policy", { id }),
  receiveAddresses: (id: string, lookahead: number) =>
    invoke<AddressEntry[]>("receive_addresses", { id, lookahead }),
  addressList: (id: string) => invoke<AddressList>("address_list", { id }),
  /** Opens the save dialog itself; the rows written, or null when it
      was closed. */
  exportTransactionsCsv: (id: string, options: ExportOptions, suggestedName: string) =>
    invoke<number | null>("export_transactions_csv", { id, options, suggestedName }),
  syncWallet: (id: string) => invoke<SyncReport>("sync_wallet", { id }),
  rescanWallet: (id: string) => invoke<SyncReport>("rescan_wallet", { id }),
  loadMoreHistory: (id: string) => invoke<number>("load_more_history", { id }),
  syncAll: (network?: Network) =>
    invoke<SyncAllReport>("sync_all", { network: network ?? null }),
  renameWallet: (id: string, name: string) => invoke<void>("rename_wallet", { id, name }),
  removeWallet: (id: string) => invoke<void>("remove_wallet", { id }),
  setWalletIcon: (id: string, icon: WalletIconId) =>
    invoke<void>("set_wallet_icon", { id, icon }),
  /** Pinned wallets are watched live before the others when the live
      watch cannot follow every address. */
  setWalletLivePinned: (id: string, pinned: boolean) =>
    invoke<void>("set_wallet_live_pinned", { id, pinned }),
  /** The listed wallets take that order; unlisted ones keep their slots. */
  reorderWallets: (ids: string[]) => invoke<void>("reorder_wallets", { ids }),
  getSettings: () => invoke<Settings>("get_settings"),
  publicServers: (network: Network) =>
    invoke<PublicServer[]>("public_servers", { network }),
  previewTransaction: (input: string, network: Network) =>
    invoke<TxPreview>("preview_transaction", { input, network }),
  broadcastTransaction: (network: Network, hex: string) =>
    invoke<BroadcastReport>("broadcast_transaction", { network, hex }),
  transactionStatus: (network: Network, hex: string) =>
    invoke<BroadcastStatus>("transaction_status", { network, hex }),
  /** The last transactions sent on this network, newest first. */
  recentBroadcasts: (network: Network) =>
    invoke<RecentBroadcast[]>("recent_broadcasts", { network }),
  forgetBroadcast: (txid: string) => invoke<void>("forget_broadcast", { txid }),
  setActiveNetwork: (network: Network) => invoke<void>("set_active_network", { network }),
  setBackend: (network: Network, config: BackendConfig) =>
    invoke<void>("set_backend", { network, config }),
  setGapLimit: (gapLimit: number) => invoke<void>("set_gap_limit", { gapLimit }),
  inspectCertificate: (url: string) => invoke<CertificateReport>("inspect_certificate", { url }),
  /** The backend and the certificate accepted for its Electrum server,
      stored in one write: both or neither. */
  setBackendTrusting: (network: Network, config: BackendConfig, url: string, fingerprint: string) =>
    invoke<void>("set_backend_trusting", { network, config, url, fingerprint }),
  forgetCertificate: (host: string) => invoke<void>("forget_certificate", { host }),
  setAppPref: (key: string, value: string) => invoke<void>("set_app_pref", { key, value }),
  /** Answers every preference as stored, the change applied. */
  setPreferences: (change: PreferencesChange) =>
    invoke<Preferences>("set_preferences", { change }),
  priceTable: () => invoke<PriceTable>("price_table"),
  /** In the currency and from the source of the preferences. */
  fetchPrice: () => invoke<PriceQuote>("fetch_price"),
  fetchPriceHistory: (range: PriceRange) =>
    invoke<PriceHistory>("fetch_price_history", { range }),
  updateStatus: () => invoke<UpdateStatus>("update_status"),
  /** The window is unlocked: the core checks if a check is due. */
  updateSession: () => invoke<UpdateStatus>("update_session"),
  /** The button in About: checks now, due or not. */
  checkUpdate: () => invoke<UpdateStatus>("check_update"),
  dismissUpdate: (version: string) => invoke<void>("dismiss_update", { version }),
  setUpdateAutomatic: (automatic: boolean) => invoke<void>("set_update_automatic", { automatic }),
  liveStatus: () => invoke<LiveStatus>("live_status"),
  liveLimits: () => invoke<WatchLimitsChoice>("live_limits"),
  sendTestNotification: () => invoke<void>("send_test_notification"),
  /** Copies a secret out of sight of the clipboard history, and takes
      it off the clipboard later unless something else was copied
      since; the seconds it stays. */
  copySensitive: (text: string) => invoke<number>("copy_sensitive", { text }),
  appLock: () => invoke<AppLock | null>("app_lock"),
  setAppLock: (kind: LockKind, secret: string, current?: string) =>
    invoke<void>("set_app_lock", { kind, secret, current: current ?? null }),
  clearAppLock: (current: string) => invoke<void>("clear_app_lock", { current }),
  verifyAppLock: (secret: string) => invoke<LockVerdict>("verify_app_lock", { secret }),
  lockApp: () => invoke<void>("lock_app"),
  exportBackup: (options: BackupOptions, password: string) =>
    invoke<BackupBundle>("export_backup", { options, password }),
  /** Opens the save dialog itself; true once the file is written, false
      when it was closed. */
  saveBackupFile: (data: string, suggestedName: string) =>
    invoke<boolean>("save_backup_file", { data, suggestedName }),
  /** Opens the file dialog itself; null when it was closed. */
  pickBackupFile: () => invoke<PickedBackup | null>("pick_backup_file"),
  previewBackup: (source: string, password: string) =>
    invoke<BackupPreview>("preview_backup", { source, password }),
  importBackup: (source: string, password: string, choices: ImportChoices) =>
    invoke<ImportReport>("import_backup", { source, password, choices }),
  torStatus: () => invoke<TorStatus>("tor_status"),
  setTorSettings: (settings: TorSettings) => invoke<void>("set_tor_settings", { settings }),
  torConnect: () => invoke<TorRoute>("tor_connect"),
};
