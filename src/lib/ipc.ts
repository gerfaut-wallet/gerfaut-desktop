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
  | "wallet_export";

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

export interface TxIo {
  address: string | null;
  value_sats: number | null;
  is_mine: boolean;
}

export interface TxDetail {
  summary: TxSummary;
  inputs: TxIo[];
  outputs: TxIo[];
  vsize: number;
  fee_rate_sat_vb: number | null;
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
  parseInput: (input: string) => invoke<ParsedInput>("parse_input", { input }),
  addWallet: (name: string, parsed: ParsedInput, network: Network) =>
    invoke<WalletMeta>("add_wallet", { name, parsed, network }),
  listWallets: (network?: Network) =>
    invoke<WalletMeta[]>("list_wallets", { network: network ?? null }),
  walletSnapshot: (id: string) => invoke<WalletSnapshot>("wallet_snapshot", { id }),
  txDetail: (id: string, txid: string) => invoke<TxDetail>("tx_detail", { id, txid }),
  utxos: (id: string) => invoke<UtxoInfo[]>("utxos", { id }),
  receiveAddresses: (id: string, lookahead: number) =>
    invoke<AddressEntry[]>("receive_addresses", { id, lookahead }),
  syncWallet: (id: string) => invoke<SyncReport>("sync_wallet", { id }),
  syncAll: (network?: Network) =>
    invoke<SyncAllReport>("sync_all", { network: network ?? null }),
  renameWallet: (id: string, name: string) => invoke<void>("rename_wallet", { id, name }),
  removeWallet: (id: string) => invoke<void>("remove_wallet", { id }),
  getSettings: () => invoke<Settings>("get_settings"),
  setActiveNetwork: (network: Network) => invoke<void>("set_active_network", { network }),
  setBackend: (network: Network, config: BackendConfig) =>
    invoke<void>("set_backend", { network, config }),
  setAppPref: (key: string, value: string) => invoke<void>("set_app_pref", { key, value }),
  fetchPrice: (source: PriceSource, currency: FiatCurrency) =>
    invoke<PriceQuote>("fetch_price", { source, currency }),
  checkUpdate: () => invoke<UpdateCheck>("check_update"),
};
