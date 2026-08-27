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
  | "multiple_accounts_in_file";

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

export interface SyncReport {
  wallet_id: string;
  new_tx_count: number;
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
  | { type: "public_esplora" }
  | { type: "custom_esplora"; url: string }
  | { type: "custom_electrum"; url: string };

export interface Settings {
  active_network: Network;
  backends: Partial<Record<Network, BackendConfig>>;
  /** Gap limit shared by every wallet. */
  gap_limit: number;
  app_prefs: Record<string, string>;
}

export type PriceSource = "coingecko" | "kraken" | "mempool_space";
export type FiatCurrency = "eur" | "usd" | "gbp" | "chf";

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
  parseInput: (input: string, script?: ScriptKind) =>
    invoke<ParsedInput>("parse_input", { input, script: script ?? null }),
  assembleQr: (frames: string[]) => invoke<QrProgress>("assemble_qr", { frames }),
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
  loadMoreHistory: (id: string) => invoke<number>("load_more_history", { id }),
  syncAll: (network?: Network) =>
    invoke<SyncAllReport>("sync_all", { network: network ?? null }),
  renameWallet: (id: string, name: string) => invoke<void>("rename_wallet", { id, name }),
  removeWallet: (id: string) => invoke<void>("remove_wallet", { id }),
  getSettings: () => invoke<Settings>("get_settings"),
  setActiveNetwork: (network: Network) => invoke<void>("set_active_network", { network }),
  setBackend: (network: Network, config: BackendConfig) =>
    invoke<void>("set_backend", { network, config }),
  setGapLimit: (gapLimit: number) => invoke<void>("set_gap_limit", { gapLimit }),
  setAppPref: (key: string, value: string) => invoke<void>("set_app_pref", { key, value }),
  fetchPrice: (source: PriceSource, currency: FiatCurrency) =>
    invoke<PriceQuote>("fetch_price", { source, currency }),
  fetchPriceHistory: (source: PriceSource, currency: FiatCurrency, range: PriceRange) =>
    invoke<PriceHistory>("fetch_price_history", { source, currency, range }),
  checkUpdate: () => invoke<UpdateCheck>("check_update"),
};
