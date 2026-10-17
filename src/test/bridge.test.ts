// The contract of the bridge, from this side: every reference JSON of
// gerfaut-core (src/test/core.ts) read against the type of
// src/lib/ipc.ts that receives or sends it. A key the core sends and
// the type leaves out fails here, as does a field the type requires and
// the core leaves out, a value of the wrong kind, a variant this app
// does not know, and a field or variant of this app the core never
// sends. The type checker holds each schema below to its type in
// ipc.ts (src/test/contract.ts), so a change to a type there is a
// change here too.
//
// The list of types is this test's, not the folder's: a type the core
// starts to write fails here until it is given a schema or a reason to
// stay out, and a type it stops writing fails too.

import { describe, expect, it } from "vitest";
import type { Unit } from "../lib/format";
import type * as ipc from "../lib/ipc";
import {
  Reading,
  type AnySchema,
  type Schema,
  array,
  bool,
  either,
  lazy,
  literal,
  nullable,
  num,
  object,
  offerAll,
  optional,
  partialRecord,
  record,
  str,
  tagged,
} from "./contract";
import { CORE_FIXTURES_DIR, coreFixtures } from "./core";

// --- input -----------------------------------------------------------------

const network: Schema<ipc.Network> = literal("Network", "mainnet", "signet", "testnet4", "regtest");
const scriptKind: Schema<ipc.ScriptKind> = literal(
  "ScriptKind",
  "legacy",
  "nested_segwit",
  "segwit",
  "taproot",
  "witness_script",
  "legacy_script",
  "bare",
);
const recognizedKind: Schema<ipc.RecognizedKind> = literal(
  "RecognizedKind",
  "descriptor",
  "descriptor_pair",
  "multipath_descriptor",
  "extended_key",
  "address",
  "wallet_export",
  "bsms",
);
const inputWarning: Schema<ipc.InputWarning> = literal(
  "InputWarning",
  "assumed_segwit",
  "slip132_converted",
  "change_not_tracked",
  "multiple_accounts_in_file",
  "non_standard_derivation",
  "assumed_branches",
);
const derivationChoice = object<ipc.DerivationChoice>("DerivationChoice")({
  receive: str,
  change: nullable(str),
  origin: nullable(str),
});
const parsedPayload = tagged<ipc.ParsedPayload>("ParsedPayload")("type", {
  descriptors: { external: str, internal: nullable(str), script: scriptKind },
  address: { address: str },
});
const parsedInput = object<ipc.ParsedInput>("ParsedInput")({
  kind: recognizedKind,
  networks: array(network),
  payload: parsedPayload,
  warnings: array(inputWarning),
  script_options: array(scriptKind),
  preview_address: nullable(str),
  derivation: nullable(derivationChoice),
  derivation_editable: bool,
});
const qrFormat: Schema<ipc.QrFormat> = literal("QrFormat", "plain", "ur", "bbqr");
const qrProgress = object<ipc.QrProgress>("QrProgress")({
  format: qrFormat,
  received: num,
  total: num,
  complete: bool,
  text: nullable(str),
  warnings: array(inputWarning),
});

// --- wallets ---------------------------------------------------------------

const walletKind = tagged<ipc.WalletKind>("WalletKind")("type", {
  descriptors: { external: str, internal: nullable(str), script: scriptKind },
  single_address: { address: str },
});
const balanceSnapshot = object<ipc.BalanceSnapshot>("BalanceSnapshot")({
  confirmed: num,
  trusted_pending: num,
  untrusted_pending: num,
  immature: num,
  total: num,
  pending_net_sats: nullable(num),
});
const syncStamp = object<ipc.SyncStamp>("SyncStamp")({ at: num, tip_height: num, backend: str });
const walletIcon: Schema<ipc.WalletIconId> = literal(
  "WalletIcon",
  "wallet",
  "key",
  "shield",
  "map_pin",
  "snowflake",
  "landmark",
  "piggy_bank",
);
const cachedTotals = object<ipc.WalletMeta["cached"]>("CachedTotals")({ balance: balanceSnapshot, tx_count: num });
const walletMeta = object<ipc.WalletMeta>("WalletMeta")({
  id: str,
  name: str,
  icon: walletIcon,
  network,
  kind: walletKind,
  recognized_as: recognizedKind,
  created_at: num,
  gap_limit: num,
  scan_gap: num,
  labels: record(str),
  last_sync: nullable(syncStamp),
  cached: cachedTotals,
  live_pinned: optional(bool),
});
const txStatus = tagged<ipc.TxStatus>("TxStatus")("state", {
  confirmed: { height: num, timestamp: nullable(num) },
  pending: {},
});
const txSummary = object<ipc.TxSummary>("TxSummary")({
  txid: str,
  net_sats: num,
  fee_sats: nullable(num),
  status: txStatus,
  confirmations: num,
});
const opReturnData = object<ipc.OpReturnData>("OpReturnData")({ hex: str, text: nullable(str), label: nullable(str) });
const txIo = object<ipc.TxIo>("TxIo")({
  address: nullable(str),
  value_sats: nullable(num),
  is_mine: bool,
  change: bool,
  op_return: nullable(opReturnData),
  prev_txid: nullable(str),
  prev_vout: nullable(num),
});
const scannedBackendKind: Schema<ipc.ScannedBackend["kind"]> = literal("ScannedBackendKind", "electrum", "esplora");
const scannedBackend = object<ipc.ScannedBackend>("ScannedBackend")({
  kind: scannedBackendKind,
  url: str,
  host: str,
  port: nullable(num),
  tls: bool,
  onion: bool,
});
const txExtras = object<ipc.TxExtras>("TxExtras")({
  size_bytes: num,
  vsize: num,
  weight_wu: num,
  version: num,
  locktime: num,
  rbf_signaled: bool,
  segwit: bool,
  taproot: bool,
  is_coinbase: bool,
  coinbase_pool: nullable(str),
  coinbase_height: nullable(num),
  coinbase_tag: nullable(str),
  sigops: num,
  raw_hex: str,
});
const txDetail = object<ipc.TxDetail>("TxDetail")({
  summary: txSummary,
  inputs: array(txIo),
  outputs: array(txIo),
  vsize: num,
  fee_rate_sat_vb: nullable(num),
  extras: nullable(txExtras),
});
const keychain: Schema<NonNullable<ipc.UtxoInfo["keychain"]>> = literal("Keychain", "external", "internal");
const utxoInfo = object<ipc.UtxoInfo>("UtxoInfo")({
  txid: str,
  vout: num,
  address: nullable(str),
  value_sats: num,
  status: txStatus,
  keychain: nullable(keychain),
  derivation_index: nullable(num),
});
const addressEntry = object<ipc.AddressEntry>("AddressEntry")({
  index: num,
  address: str,
  used: bool,
  derivation: nullable(str),
});
const addressRow = object<ipc.AddressRow>("AddressRow")({ index: num, address: str, used: bool, balance_sats: num });
const addressList = object<ipc.AddressList>("AddressList")({
  external: array(addressRow),
  internal: array(addressRow),
  truncated: bool,
});
const exportDirection: Schema<ipc.ExportDirection> = literal("ExportDirection", "incoming", "outgoing");
const exportOptions = object<ipc.ExportOptions>("ExportOptions")({
  from: nullable(num),
  to: nullable(num),
  direction: nullable(exportDirection),
  include_pending: bool,
});
const walletSnapshot = object<ipc.WalletSnapshot>("WalletSnapshot")({
  meta: walletMeta,
  balance: balanceSnapshot,
  txs: array(txSummary),
  tip_height: num,
  truncated: bool,
});
const newTx = object<ipc.NewTx>("NewTx")({ txid: str, net_sats: num, confirmed: bool });
const syncReport = object<ipc.SyncReport>("SyncReport")({
  wallet_id: str,
  new_tx_count: num,
  new_txs: array(newTx),
  balance: balanceSnapshot,
  tip_height: num,
  took_ms: num,
  backend: str,
});
const syncFailure = object<ipc.SyncAllReport["failures"][number]>("SyncFailure")({ wallet_id: str, message: str });
const syncAllReport = object<ipc.SyncAllReport>("SyncAllReport")({
  reports: array(syncReport),
  failures: array(syncFailure),
});

// --- policy ----------------------------------------------------------------

const policyKind: Schema<ipc.PolicyKind> = literal("PolicyKind", "single_key", "multisig", "miniscript", "address");
const branchRole: Schema<ipc.BranchRole> = literal("BranchRole", "primary", "recovery", "emergency", "other");
const policyKey = object<ipc.PolicyKey>("PolicyKey")({
  id: str,
  label: str,
  fingerprint: nullable(str),
  origin_path: nullable(str),
  key_short: str,
});
const absoluteLock = tagged<ipc.AbsoluteLock>("AbsoluteLock")("kind", {
  height: { height: num },
  time: { unix: num },
});
const relativeLock = tagged<ipc.RelativeLock>("RelativeLock")("kind", {
  blocks: { blocks: num },
  seconds: { seconds: num },
});
const condition: Schema<ipc.Condition> = tagged<ipc.Condition>("Condition")("kind", {
  key: { key_id: str },
  thresh: { k: num, n: num, items: array(lazy(() => condition)) },
  after: { lock: absoluteLock },
  older: { lock: relativeLock },
  preimage: { hash: str },
});
const timelockRef = tagged<ipc.TimelockRef>("TimelockRef")("kind", {
  absolute: { lock: absoluteLock },
  relative: { lock: relativeLock },
});
const remaining = object<ipc.Remaining>("Remaining")({
  remaining_blocks: nullable(num),
  remaining_seconds: nullable(num),
  unlocks_at_unix: nullable(num),
});
const perCoin = { unlocked: num, waiting: num, locked: num, next: nullable(remaining) };
const lockState = tagged<ipc.LockState>("LockState")("kind", {
  unlocked: {},
  locked: { until: remaining },
  per_coin: perCoin,
  no_coins: { blocks: nullable(num), seconds: nullable(num) },
});
const timelock = object<ipc.Timelock>("Timelock")({ lock: timelockRef, required: bool, state: lockState });
const branchState = tagged<ipc.BranchState>("BranchState")("kind", {
  spendable_now: {},
  locked: { until: remaining },
  per_coin: perCoin,
  no_coins: {},
  needs_preimage: {},
});
const branchTone: Schema<ipc.BranchTone> = literal("BranchTone", "confirmed", "pending", "neutral");
const policyBranch = object<ipc.PolicyBranch>("PolicyBranch")({
  id: str,
  role: branchRole,
  label: str,
  summary: str,
  condition,
  timelocks: array(timelock),
  state: branchState,
  spendable_now: bool,
  tone: branchTone,
});
const timeBasis: Schema<ipc.PolicySnapshot["time_basis"]> = literal("TimeBasis", "wall_clock");
const policySnapshot = object<ipc.PolicySnapshot>("PolicySnapshot")({
  kind: policyKind,
  script: scriptKind,
  descriptor: str,
  policy: str,
  keys: array(policyKey),
  branches: array(policyBranch),
  tip_height: nullable(num),
  computed_at: num,
  time_basis: timeBasis,
  coins: num,
  has_timelocks: bool,
});

// --- servers, Tor, lock ------------------------------------------------------

const backendConfig = tagged<ipc.BackendConfig>("BackendConfig")("type", {
  public_esplora: { server: optional(str) },
  custom_esplora: { url: str, own_node: optional(bool) },
  custom_electrum: { url: str, own_node: optional(bool) },
});
const serverProtocol: Schema<ipc.ServerProtocol> = literal("ServerProtocol", "esplora", "electrum");
const publicServer = object<ipc.PublicServer>("PublicServer")({
  id: str,
  label: str,
  protocol: serverProtocol,
  url: str,
  self_signed: bool,
});
const torMode: Schema<ipc.TorMode> = literal("TorMode", "auto", "system", "embedded");
const torSettings = object<ipc.TorSettings>("TorSettings")({ mode: torMode, socks_proxy: nullable(str) });
const torVia: Schema<ipc.TorVia> = literal("TorVia", "system", "embedded");
const torRoute = object<ipc.TorRoute>("TorRoute")({ socks: str, via: torVia });
const torStatus = object<ipc.TorStatus>("TorStatus")({
  mode: torMode,
  socks_proxy: str,
  via: nullable(torVia),
  socks: nullable(str),
  running: bool,
  bootstrapped: bool,
  bootstrap_percent: num,
  error: nullable(str),
  embedded_available: bool,
});
const lockKind: Schema<ipc.LockKind> = literal("LockKind", "pin", "password");
const appLock = object<ipc.AppLock>("AppLock")({ kind: lockKind, biometric: bool });
const lockVerdict = object<ipc.LockVerdict>("LockVerdict")({ unlocked: bool, failures: num, retry_after_secs: num });

/** The certificate statuses, which this app reads flattened into
    `CertificateReport`, beside the host. */
type CertificateStatus = ipc.CertificateReport extends infer Report
  ? Report extends unknown
    ? Omit<Report, "host">
    : never
  : never;
const certificateStatus = tagged<CertificateStatus>("CertificateStatus")("status", {
  not_tls: {},
  tor: {},
  trusted: {},
  pinned: { fingerprint: str },
  unknown: { fingerprint: str, reason: str, subject: nullable(str), expires: nullable(num) },
  changed: { stored: str, presented: str },
  unreachable: { detail: str },
});
const certificateReport = tagged<ipc.CertificateReport>("CertificateReport")("status", {
  not_tls: { host: str },
  tor: { host: str },
  trusted: { host: str },
  pinned: { host: str, fingerprint: str },
  unknown: { host: str, fingerprint: str, reason: str, subject: nullable(str), expires: nullable(num) },
  changed: { host: str, stored: str, presented: str },
  unreachable: { host: str, detail: str },
});

// --- prices and preferences ------------------------------------------------

const priceSource: Schema<ipc.PriceSource> = literal("PriceSource", "mempool_space", "coingecko");
/** A plain string here: the list of currencies is the core's alone. */
const fiatCurrency: Schema<ipc.FiatCurrency> = str;
const currencyReach: Schema<ipc.CurrencyReach> = literal("CurrencyReach", "every", "coingecko_only");
const currencyEntry = object<ipc.CurrencyEntry>("CurrencyEntry")({
  currency: fiatCurrency,
  code: str,
  name: str,
  reach: currencyReach,
  sources: array(priceSource),
});
const priceRange: Schema<ipc.PriceRange> = literal("PriceRange", "day", "week", "month", "year", "max");
const credit = object<ipc.Credit>("Credit")({ text: str, url: str });
const sourceEntry = object<ipc.SourceEntry>("SourceEntry")({
  source: priceSource,
  label: str,
  ranges: array(priceRange),
  credit: nullable(credit),
});
const priceTable = object<ipc.PriceTable>("PriceTable")({
  currencies: array(currencyEntry),
  sources: array(sourceEntry),
  refresh_secs: num,
});
const unit: Schema<Unit> = literal("Unit", "btc", "sats");
const preferences = object<ipc.Preferences>("Preferences")({
  unit,
  masked: bool,
  fiat: bool,
  fiat_currency: fiatCurrency,
  price_source: priceSource,
  notify_new_tx: bool,
  explorer_ack: bool,
});
const preferencesChange = object<ipc.PreferencesChange>("PreferencesChange")({
  unit: optional(unit),
  masked: optional(bool),
  fiat: optional(bool),
  fiat_currency: optional(fiatCurrency),
  price_source: optional(priceSource),
  notify_new_tx: optional(bool),
  explorer_ack: optional(bool),
});
const priceQuote = object<ipc.PriceQuote>("PriceQuote")({
  rate: num,
  currency: fiatCurrency,
  source: priceSource,
  at: num,
});
const pricePoint = object<ipc.PricePoint>("PricePoint")({ t: num, rate: num });
const priceHistory = object<ipc.PriceHistory>("PriceHistory")({
  points: array(pricePoint),
  currency: fiatCurrency,
  source: priceSource,
  range: priceRange,
  at: num,
});
const settings = object<ipc.Settings>("Settings")({
  active_network: network,
  backends: partialRecord(network, backendConfig),
  gap_limit: num,
  app_prefs: record(str),
  electrum_certs: record(str),
  app_lock: nullable(appLock),
  tor: torSettings,
  preferences,
});
const updateStatus = object<ipc.UpdateStatus>("UpdateStatus")({
  automatic: bool,
  announce: nullable(str),
  available: nullable(str),
  tor_unavailable: bool,
});

// --- backup ----------------------------------------------------------------

const backupOptions = object<ipc.BackupOptions>("BackupOptions")({
  wallet_ids: nullable(array(str)),
  include_settings: bool,
});
const backupBundle = object<ipc.BackupBundle>("BackupBundle")({
  data: str,
  frames: array(str),
  wallet_count: num,
  size_bytes: num,
});
const backupWalletPreview = object<ipc.BackupWalletPreview>("BackupWalletPreview")({
  index: num,
  name: str,
  network,
  kind: walletKind,
  already_watched: bool,
  refused: nullable(str),
});
const backupBackendPreview = object<ipc.BackupBackendPreview>("BackupBackendPreview")({ network, backend: str });
const backupPreview = object<ipc.BackupPreview>("BackupPreview")({
  created_at: num,
  wallets: array(backupWalletPreview),
  has_settings: bool,
  backends: array(backupBackendPreview),
  electrum_hosts: array(str),
});
const importChoices = object<ipc.ImportChoices>("ImportChoices")({
  indexes: nullable(array(num)),
  apply_settings: bool,
});
const refusedWallet = object<ipc.RefusedWallet>("RefusedWallet")({
  index: num,
  name: str,
  reason: str,
});
const importReport = object<ipc.ImportReport>("ImportReport")({
  added: array(walletMeta),
  skipped: num,
  settings_applied: bool,
  refused: array(refusedWallet),
});

// --- broadcast -------------------------------------------------------------

const txSource: Schema<ipc.TxSource> = literal("TxSource", "raw_transaction", "psbt");
const walletRef = object<ipc.WalletRef>("WalletRef")({ id: str, name: str });
const txInputPreview = object<ipc.TxInputPreview>("TxInputPreview")({
  txid: str,
  vout: num,
  value_sats: nullable(num),
  address: nullable(str),
  signed: bool,
  wallet: nullable(walletRef),
});
const txOutputPreview = object<ipc.TxOutputPreview>("TxOutputPreview")({
  index: num,
  value_sats: num,
  address: nullable(str),
  op_return: nullable(opReturnData),
  wallet: nullable(walletRef),
  change: bool,
});
const txWarningKind: Schema<ipc.TxWarningKind> = literal(
  "TxWarningKind",
  "unsigned",
  "high_fee_rate",
  "high_fee_share",
  "locked",
  "input_unknown",
  "input_spent",
  "input_mismatch",
  "fee_unknown",
  "dust_output",
  "spends_watched",
  "uncommitted_outputs",
);
const txSeverity: Schema<ipc.TxSeverity> = literal("TxSeverity", "alert", "info");
const txWarning = object<ipc.TxWarning>("TxWarning")({
  kind: txWarningKind,
  message: str,
  severity: txSeverity,
  blocking: bool,
});
const txReadiness: Schema<ipc.TxReadiness> = literal("TxReadiness", "ready", "refused", "unsigned");
const txPreview = object<ipc.TxPreview>("TxPreview")({
  txid: str,
  source: txSource,
  network,
  inputs: array(txInputPreview),
  outputs: array(txOutputPreview),
  fee_sats: nullable(num),
  fee_rate_sat_vb: nullable(num),
  fee_unknown_reason: nullable(str),
  amounts_declared: bool,
  vsize: num,
  weight: num,
  size: num,
  version: num,
  locktime: num,
  rbf: bool,
  readiness: txReadiness,
  warnings: array(txWarning),
  hex: nullable(str),
});
const broadcastReport = object<ipc.BroadcastReport>("BroadcastReport")({ txid: str, backend: str, at: num });
const broadcastStatus = object<ipc.BroadcastStatus>("BroadcastStatus")({
  txid: str,
  found: bool,
  confirmed: bool,
  block_height: nullable(num),
  confirmations: num,
  backend: str,
  at: num,
});
const recentBroadcast = object<ipc.RecentBroadcast>("RecentBroadcast")({
  txid: str,
  network,
  hex: str,
  backend: str,
  at: num,
});

// --- live ------------------------------------------------------------------

const watchState: Schema<ipc.WatchState> = literal(
  "WatchState",
  "off",
  "connecting",
  "connected",
  "reconnecting",
  "polling",
);
const watchTransport: Schema<ipc.WatchTransport> = literal(
  "WatchTransport",
  "electrum",
  "mempool_websocket",
  "esplora_polling",
);
const watchLimits = object<ipc.WatchLimits>("WatchLimits")({ per_wallet: num, total: num });
const watchLimitsChoice = object<ipc.WatchLimitsChoice>("WatchLimitsChoice")({ any: watchLimits, own_node: watchLimits });
const leftOutReason: Schema<ipc.LeftOut["reason"]> = literal("LeftOutReason", "live_limit", "server_refused");
const serverSoftware: Schema<ipc.ServerSoftware> = literal(
  "ServerSoftware",
  "fulcrum",
  "electrumx",
  "electrs_esplora",
  "mempool_electrs",
);
const remedy = tagged<ipc.Remedy>("Remedy")("type", {
  own_node: { limits: watchLimits },
  raise_server_limit: { server: nullable(serverSoftware), settings: array(str) },
});
const leftOut = object<ipc.LeftOut>("LeftOut")({
  reason: leftOutReason,
  limits: watchLimits,
  own_node: bool,
  remedy: nullable(remedy),
});
const coverage: Schema<ipc.Coverage> = literal("Coverage", "live", "partial", "sync_only");
const walletCoverage = object<ipc.WalletCoverage>("WalletCoverage")({
  wallet_id: str,
  coverage,
  watched_scripts: num,
  left_out_scripts: num,
  refused_scripts: optional(num),
});
const watchStatus = object<ipc.WatchStatus>("WatchStatus")({
  state: watchState,
  transport: nullable(watchTransport),
  server: nullable(str),
  detail: nullable(str),
  watched_scripts: num,
  pushed_scripts: num,
  left_out_scripts: num,
  left_out_wallets: num,
  wallets: array(walletCoverage),
  server_software: optional(nullable(str)),
  left_out: optional(nullable(leftOut)),
});

// --- errors ----------------------------------------------------------------

/** The codes of the core: the kinds of a failed command, but the two
    this app adds itself. */
type ErrorCode = Exclude<ipc.CommandError["kind"], "locked" | "notification">;
const errorCode: Schema<ErrorCode> = literal(
  "ErrorCode",
  "unrecognized_input",
  "private_material",
  "invalid_input",
  "too_many_parts",
  "network_mismatch",
  "wallet_not_found",
  "duplicate_wallet",
  "vault",
  "wrong_key",
  "unreadable_backup",
  "newer_format",
  "vault_in_use",
  "sync",
  "broadcast",
  "backend_unavailable",
  "descriptor",
  "tor",
  "internal",
);
const commandError = object<ipc.CommandError>("CommandError")({
  kind: either(errorCode, literal("CommandError.kind", "locked", "notification")),
  message: str,
});

// --- the contract ------------------------------------------------------------

/** A type of the core this app never receives nor sends, and why. */
interface Away {
  away: string;
}

const LIVE_STAYS_IN_RUST =
  "the live watch runs on the Rust side of this app (src-tauri/src/live.rs), which posts the notifications; the window hears its status only";

/** Every type the core writes a reference file for, by its name in the
    core, and the schema of the type of this app that reads it. */
const CONTRACT: Record<string, AnySchema | Away> = {
  AbsoluteLock: absoluteLock,
  AddressEntry: addressEntry,
  AddressList: addressList,
  AddressRow: addressRow,
  AppLock: appLock,
  BackendConfig: backendConfig,
  BackupBackendPreview: backupBackendPreview,
  BackupBundle: backupBundle,
  BackupOptions: backupOptions,
  BackupPreview: backupPreview,
  BackupWalletPreview: backupWalletPreview,
  BalanceSnapshot: balanceSnapshot,
  BranchRole: branchRole,
  BranchState: branchState,
  BranchTone: branchTone,
  BroadcastReport: broadcastReport,
  BroadcastStatus: broadcastStatus,
  CachedTotals: cachedTotals,
  CertificateReport: certificateReport,
  CertificateStatus: certificateStatus,
  Condition: condition,
  Context: { away: LIVE_STAYS_IN_RUST },
  CoreError: commandError,
  Coverage: coverage,
  Credit: credit,
  CurrencyEntry: currencyEntry,
  CurrencyReach: currencyReach,
  DerivationChoice: derivationChoice,
  ErrorCode: errorCode,
  ExportDirection: exportDirection,
  ExportOptions: exportOptions,
  ExportResult: {
    away: "the CSV is written to its file on the Rust side (export_transactions_csv); the window hears the row count",
  },
  FiatCurrency: fiatCurrency,
  ImportChoices: importChoices,
  ImportOptions: {
    away: "parse_input takes the script, the derivation and the network as arguments of their own, and builds the options on the Rust side",
  },
  ImportReport: importReport,
  InputWarning: inputWarning,
  Keychain: keychain,
  LeftOut: leftOut,
  LeftOutReason: leftOutReason,
  LiveEvent: { away: LIVE_STAYS_IN_RUST },
  LiveTx: { away: LIVE_STAYS_IN_RUST },
  LockKind: lockKind,
  LockState: lockState,
  LockVerdict: lockVerdict,
  Network: network,
  NewTx: newTx,
  Notice: { away: LIVE_STAYS_IN_RUST },
  NoticeId: { away: LIVE_STAYS_IN_RUST },
  NoticeKind: { away: LIVE_STAYS_IN_RUST },
  OpReturnData: opReturnData,
  ParsedInput: parsedInput,
  ParsedPayload: parsedPayload,
  PolicyBranch: policyBranch,
  PolicyKey: policyKey,
  PolicyKind: policyKind,
  PolicySnapshot: policySnapshot,
  Preferences: preferences,
  PreferencesChange: preferencesChange,
  PriceHistory: priceHistory,
  PricePoint: pricePoint,
  PriceQuote: priceQuote,
  PriceRange: priceRange,
  PriceSource: priceSource,
  PriceTable: priceTable,
  PublicServer: publicServer,
  QrFormat: qrFormat,
  QrProgress: qrProgress,
  RecentBroadcast: recentBroadcast,
  RecognizedKind: recognizedKind,
  RefusedWallet: refusedWallet,
  RelativeLock: relativeLock,
  Remaining: remaining,
  Remedy: remedy,
  ScannedBackend: scannedBackend,
  ScannedBackendKind: scannedBackendKind,
  ScriptKind: scriptKind,
  ServerProtocol: serverProtocol,
  ServerSoftware: serverSoftware,
  Settings: settings,
  SourceEntry: sourceEntry,
  SyncAllReport: syncAllReport,
  SyncFailure: syncFailure,
  SyncReport: syncReport,
  SyncStamp: syncStamp,
  TimeBasis: timeBasis,
  Timelock: timelock,
  TimelockRef: timelockRef,
  TorMode: torMode,
  TorRoute: torRoute,
  TorSettings: torSettings,
  TorStatus: torStatus,
  TorVia: torVia,
  TxDetail: txDetail,
  TxExtras: txExtras,
  TxInputPreview: txInputPreview,
  TxIo: txIo,
  TxOutputPreview: txOutputPreview,
  TxPreview: txPreview,
  TxReadiness: txReadiness,
  TxSeverity: txSeverity,
  TxSource: txSource,
  TxStage: { away: LIVE_STAYS_IN_RUST },
  TxStatus: txStatus,
  TxSummary: txSummary,
  TxWarning: txWarning,
  TxWarningKind: txWarningKind,
  Unit: unit,
  UpdateStatus: updateStatus,
  UtxoInfo: utxoInfo,
  WalletCoverage: walletCoverage,
  WalletIcon: walletIcon,
  WalletKind: walletKind,
  WalletMeta: walletMeta,
  WalletRef: walletRef,
  WalletSnapshot: walletSnapshot,
  WatchLimits: watchLimits,
  WatchLimitsChoice: watchLimitsChoice,
  WatchState: watchState,
  WatchStatus: watchStatus,
  WatchTransport: watchTransport,
};

/** Keys the core sends that a type of this app leaves out on purpose,
    as `Type.key`, with the reason. */
const IGNORED: Record<string, string> = {
  "SyncStamp.server":
    "where the core starts the next sync of the wallet; the screens name the backend, which the stamp carries too",
  "WalletMeta.complete_at": "when a sync last read every script: the core's own schedule of full reads",
  "SyncReport.confirmed_txs":
    "a sync started from the window says what it found; payments confirming are announced by the live watch, on the Rust side",
  "TorStatus.system_socks_trusted":
    "true in every desktop build, which the hints of the Tor card assume: a Tor on this machine is the user's own",
  "TxPreview.ready": "the same as `readiness` being ready, which the page reads",
};

/** Fields and variants of this app that no reference file holds, on
    purpose, as `Type.key` or `Type=variant`, with the reason. */
const NOT_SENT: Record<string, string> = {
  "CommandError.kind=locked": "this app's own failure: the vault answers nothing behind the lock screen",
  "CommandError.kind=notification": "this app's own failure: the system refused a notification",
};

function isAway(entry: AnySchema | Away): entry is Away {
  return "away" in entry;
}

describe("the contract of the bridge with gerfaut-core", () => {
  it("finds the reference files of the core", () => {
    expect(
      coreFixtures.size,
      `no reference JSON in ${CORE_FIXTURES_DIR}: check out gerfaut-core beside this repository, at .github/gerfaut-core.rev`,
    ).toBeGreaterThan(0);
  });

  it("knows every type the core writes, and only those", () => {
    const written = [...coreFixtures.keys()].sort();
    const known = Object.keys(CONTRACT).sort();
    expect(
      written.filter((name) => !(name in CONTRACT)),
      "types the core writes and this app does not list: give each a schema, or a reason to stay away",
    ).toEqual([]);
    expect(
      known.filter((name) => !coreFixtures.has(name)),
      "types this app lists and the core no longer writes",
    ).toEqual([]);
    for (const [name, entry] of Object.entries(CONTRACT)) {
      if (isAway(entry)) expect(entry.away, `${name} stays away without a reason`).not.toBe("");
    }
  });

  it("reads every case the core writes with the type of this app", () => {
    const reading = new Reading(IGNORED);
    const schemas = Object.values(CONTRACT).filter((entry) => !isAway(entry)) as AnySchema[];
    offerAll(schemas, reading);
    for (const [name, cases] of coreFixtures) {
      const entry = CONTRACT[name];
      if (!entry || isAway(entry)) continue;
      for (const [label, value] of Object.entries(cases)) entry.check(value, `${name}.json#${label}`, reading);
    }
    expect(reading.issues, "what the core sends and this app reads differently").toEqual([]);
    expect(reading.unusedIgnores(), "IGNORED names keys the core no longer sends").toEqual([]);
    const neverSent = reading.neverSent();
    expect(
      neverSent.filter((id) => !(id in NOT_SENT)),
      "fields and variants of this app that the core never sends",
    ).toEqual([]);
    expect(
      Object.keys(NOT_SENT).filter((id) => !neverSent.includes(id)),
      "NOT_SENT names what the core does send",
    ).toEqual([]);
  });
});
