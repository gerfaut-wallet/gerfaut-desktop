// Typed bridge to the Rust commands. The shapes mirror gerfaut-core's
// serde DTOs one to one; if a field changes there, it changes here.

import { invoke } from "@tauri-apps/api/core";

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
  | "non_standard_derivation";

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
  /** First receive address on the first candidate network, when derivable. */
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
}

export interface SyncStamp {
  at: number;
  tip_height: number;
  backend: string;
}

export interface WalletMeta {
  id: string;
  name: string;
  network: Network;
  kind: WalletKind;
  recognized_as: RecognizedKind;
  created_at: number;
  gap_limit: number;
  scan_gap: number;
  labels: Record<string, string>;
  last_sync: SyncStamp | null;
  cached: { balance: BalanceSnapshot; tx_count: number };
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

/** Recommended fee rates in sat/vB (mempool.space). */
export interface FeeEstimates {
  fastest: number;
  half_hour: number;
  hour: number;
  economy: number;
  minimum: number;
  at: number;
}

export interface WalletSnapshot {
  meta: WalletMeta;
  balance: BalanceSnapshot;
  txs: TxSummary[];
  tip_height: number;
  /** True when the tx list is partial (busy watched address). */
  truncated: boolean;
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

export interface SyncAllReport {
  reports: SyncReport[];
  failures: { wallet_id: string; message: string }[];
}

export type BackendConfig =
  /** `server` names one public operator; absent, every public Esplora
      instance is tried in order. */
  | { type: "public_esplora"; server?: string }
  | { type: "custom_esplora"; url: string }
  | { type: "custom_electrum"; url: string };

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

/** The app lock as the apps see it: kind and timing, never the hash. */
export interface AppLock {
  kind: LockKind;
  /** Seconds away before locking again; null means only at launch. */
  auto_lock_secs: number | null;
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

export interface BackupWalletPreview {
  index: number;
  name: string;
  network: Network;
  kind: WalletKind;
  already_watched: boolean;
}

export interface BackupPreview {
  created_at: number;
  wallets: BackupWalletPreview[];
  has_settings: boolean;
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

export type PriceSource = "coingecko" | "kraken" | "mempool_space";

/** Mirror of `FiatCurrency` in gerfaut-core, in the same order: the
    seven every source quotes, then the ones CoinGecko alone publishes. */
export const SHARED_CURRENCIES = ["eur", "usd", "gbp", "chf", "jpy", "cad", "aud"] as const;

export const COINGECKO_ONLY_CURRENCIES = [
  "inr",
  "cny",
  "brl",
  "ngn",
  "idr",
  "pkr",
  "bdt",
  "rub",
  "mxn",
  "php",
  "vnd",
  "try",
  "ars",
  "krw",
  "zar",
  "thb",
  "uah",
  "pln",
  "sek",
  "sgd",
  "hkd",
  "aed",
  "nzd",
] as const;

export type FiatCurrency =
  | (typeof SHARED_CURRENCIES)[number]
  | (typeof COINGECKO_ONLY_CURRENCIES)[number];

export const ALL_CURRENCIES: readonly FiatCurrency[] = [
  ...SHARED_CURRENCIES,
  ...COINGECKO_ONLY_CURRENCIES,
];

/** Mirror of `PriceSource::supports_currency`: Kraken lists seven fiat
    pairs against XBT and the mempool projects publish the same seven. */
export function quotesCurrency(source: PriceSource, currency: FiatCurrency): boolean {
  return (
    source === "coingecko" ||
    (SHARED_CURRENCIES as readonly string[]).includes(currency)
  );
}

export interface PriceQuote {
  /** Price of 1 BTC in the currency. */
  rate: number;
  currency: FiatCurrency;
  source: PriceSource;
  at: number;
}

export type PriceRange = "day" | "week" | "month" | "year" | "max";

/** Mirror of `PriceSource::supports` in gerfaut-core: the ranges each
    keyless endpoint can actually serve. The UI hides the rest. */
export const SUPPORTED_RANGES: Record<PriceSource, PriceRange[]> = {
  kraken: ["day", "week", "month", "year", "max"],
  coingecko: ["day", "week", "month", "year"],
  mempool_space: ["month", "year", "max"],
};

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
  | "fee_unknown"
  | "dust_output"
  | "spends_watched";

export interface TxWarning {
  kind: TxWarningKind;
  message: string;
}

/** Everything shown before a transaction is broadcast. */
export interface TxPreview {
  txid: string;
  source: TxSource;
  network: Network;
  inputs: TxInputPreview[];
  outputs: TxOutputPreview[];
  fee_sats: number | null;
  fee_rate_sat_vb: number | null;
  vsize: number;
  weight: number;
  size: number;
  version: number;
  locktime: number;
  rbf: boolean;
  /** Every input signed: the transaction can be sent. */
  ready: boolean;
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

export interface UpdateCheck {
  latest: string;
  url: string;
  update_available: boolean;
}

export interface CommandError {
  kind:
    | "unrecognized_input"
    | "private_material"
    | "invalid_input"
    | "network_mismatch"
    | "wallet_not_found"
    | "duplicate_wallet"
    | "vault"
    | "sync"
    | "backend_unavailable"
    | "descriptor"
    | "tor"
    | "internal";
  message: string;
}

/** Type guard for errors thrown by commands. */
export function isCommandError(error: unknown): error is CommandError {
  return (
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    "message" in error
  );
}

// --- commands ----------------------------------------------------------

export const ipc = {
  parseInput: (input: string, script?: ScriptKind, derivation?: DerivationChoice) =>
    invoke<ParsedInput>("parse_input", {
      input,
      script: script ?? null,
      derivation: derivation ?? null,
    }),
  assembleQr: (frames: string[]) => invoke<QrProgress>("assemble_qr", { frames }),
  parseBackend: (input: string) => invoke<ScannedBackend>("parse_backend", { input }),
  addWallet: (name: string, parsed: ParsedInput, network: Network) =>
    invoke<WalletMeta>("add_wallet", { name, parsed, network }),
  listWallets: (network?: Network) =>
    invoke<WalletMeta[]>("list_wallets", { network: network ?? null }),
  walletSnapshot: (id: string) => invoke<WalletSnapshot>("wallet_snapshot", { id }),
  txDetail: (id: string, txid: string) => invoke<TxDetail>("tx_detail", { id, txid }),
  utxos: (id: string) => invoke<UtxoInfo[]>("utxos", { id }),
  receiveAddresses: (id: string, lookahead: number) =>
    invoke<AddressEntry[]>("receive_addresses", { id, lookahead }),
  addressList: (id: string) => invoke<AddressList>("address_list", { id }),
  exportTransactionsCsv: (id: string, options: ExportOptions, path: string) =>
    invoke<number>("export_transactions_csv", { id, options, path }),
  fetchFees: (network: Network) => invoke<FeeEstimates>("fetch_fees", { network }),
  syncWallet: (id: string) => invoke<SyncReport>("sync_wallet", { id }),
  rescanWallet: (id: string) => invoke<SyncReport>("rescan_wallet", { id }),
  loadMoreHistory: (id: string) => invoke<number>("load_more_history", { id }),
  syncAll: (network?: Network) =>
    invoke<SyncAllReport>("sync_all", { network: network ?? null }),
  renameWallet: (id: string, name: string) => invoke<void>("rename_wallet", { id, name }),
  removeWallet: (id: string) => invoke<void>("remove_wallet", { id }),
  getSettings: () => invoke<Settings>("get_settings"),
  publicServers: (network: Network) =>
    invoke<PublicServer[]>("public_servers", { network }),
  previewTransaction: (input: string, network: Network) =>
    invoke<TxPreview>("preview_transaction", { input, network }),
  broadcastTransaction: (network: Network, hex: string) =>
    invoke<BroadcastReport>("broadcast_transaction", { network, hex }),
  transactionStatus: (network: Network, hex: string) =>
    invoke<BroadcastStatus>("transaction_status", { network, hex }),
  setActiveNetwork: (network: Network) => invoke<void>("set_active_network", { network }),
  setBackend: (network: Network, config: BackendConfig) =>
    invoke<void>("set_backend", { network, config }),
  setGapLimit: (gapLimit: number) => invoke<void>("set_gap_limit", { gapLimit }),
  inspectCertificate: (url: string) => invoke<CertificateReport>("inspect_certificate", { url }),
  trustCertificate: (url: string, fingerprint: string) =>
    invoke<void>("trust_certificate", { url, fingerprint }),
  forgetCertificate: (host: string) => invoke<void>("forget_certificate", { host }),
  setAppPref: (key: string, value: string) => invoke<void>("set_app_pref", { key, value }),
  fetchPrice: (source: PriceSource, currency: FiatCurrency) =>
    invoke<PriceQuote>("fetch_price", { source, currency }),
  fetchPriceHistory: (source: PriceSource, currency: FiatCurrency, range: PriceRange) =>
    invoke<PriceHistory>("fetch_price_history", { source, currency, range }),
  checkUpdate: () => invoke<UpdateCheck>("check_update"),
  appLock: () => invoke<AppLock | null>("app_lock"),
  setAppLock: (kind: LockKind, secret: string, current?: string) =>
    invoke<void>("set_app_lock", { kind, secret, current: current ?? null }),
  clearAppLock: (current: string) => invoke<void>("clear_app_lock", { current }),
  verifyAppLock: (secret: string) => invoke<LockVerdict>("verify_app_lock", { secret }),
  setAutoLock: (secs: number | null, current: string) =>
    invoke<void>("set_auto_lock", { secs, current }),
  exportBackup: (options: BackupOptions, password: string) =>
    invoke<BackupBundle>("export_backup", { options, password }),
  saveBackupFile: (path: string, data: string) =>
    invoke<void>("save_backup_file", { path, data }),
  readBackupFile: (path: string) => invoke<string>("read_backup_file", { path }),
  previewBackup: (source: string, password: string) =>
    invoke<BackupPreview>("preview_backup", { source, password }),
  importBackup: (source: string, password: string, choices: ImportChoices) =>
    invoke<ImportReport>("import_backup", { source, password, choices }),
  torStatus: () => invoke<TorStatus>("tor_status"),
  setTorSettings: (settings: TorSettings) => invoke<void>("set_tor_settings", { settings }),
  torConnect: () => invoke<TorRoute>("tor_connect"),
};
