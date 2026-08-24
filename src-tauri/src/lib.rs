//! Tauri layer of the Gerfaut desktop app.
//!
//! Thin by design: every command delegates to `gerfaut_core`'s
//! `WalletManager`. The only desktop-specific logic is where the vault
//! lives (the app data directory) and where its key comes from (the OS
//! credential store).

use gerfaut_core::WalletManager;
use gerfaut_core::chain::BackendConfig;
use gerfaut_core::error::CoreError;
use gerfaut_core::input::ParsedInput;
use gerfaut_core::manager::SyncAllReport;
use gerfaut_core::network::Network;
use gerfaut_core::store::{Settings, VaultKey};
use gerfaut_core::wallet::meta::WalletMeta;
use gerfaut_core::wallet::snapshot::{
    AddressEntry, SyncReport, TxDetail, UtxoInfo, WalletSnapshot,
};
use serde::Serialize;
use tauri::Manager;

/// Error shape every command returns; the frontend matches on `kind`.
#[derive(Debug, Clone, Serialize)]
pub struct CommandError {
    pub kind: &'static str,
    pub message: String,
}

impl From<CoreError> for CommandError {
    fn from(error: CoreError) -> Self {
        let kind = match &error {
            CoreError::UnrecognizedInput(_) => "unrecognized_input",
            CoreError::PrivateMaterialRejected => "private_material",
            CoreError::InvalidInput { .. } => "invalid_input",
            CoreError::NetworkMismatch { .. } => "network_mismatch",
            CoreError::WalletNotFound(_) => "wallet_not_found",
            CoreError::DuplicateWallet(_) => "duplicate_wallet",
            CoreError::Vault(_) => "vault",
            CoreError::Sync { .. } => "sync",
            CoreError::BackendUnavailable(_) => "backend_unavailable",
            CoreError::Descriptor(_) => "descriptor",
            CoreError::Internal(_) => "internal",
        };
        CommandError {
            kind,
            message: error.to_string(),
        }
    }
}

type CommandResult<T> = Result<T, CommandError>;

struct AppState {
    manager: WalletManager,
}

// --- commands ----------------------------------------------------------

#[tauri::command]
fn parse_input(input: String) -> CommandResult<ParsedInput> {
    Ok(gerfaut_core::input::parse_input(&input)?)
}

#[tauri::command]
async fn add_wallet(
    state: tauri::State<'_, AppState>,
    name: String,
    parsed: ParsedInput,
    network: Network,
) -> CommandResult<WalletMeta> {
    Ok(state.manager.add_wallet(&name, &parsed, network).await?)
}

#[tauri::command]
async fn list_wallets(
    state: tauri::State<'_, AppState>,
    network: Option<Network>,
) -> CommandResult<Vec<WalletMeta>> {
    Ok(state.manager.list_wallets(network).await)
}

#[tauri::command]
async fn wallet_snapshot(
    state: tauri::State<'_, AppState>,
    id: String,
) -> CommandResult<WalletSnapshot> {
    Ok(state.manager.wallet_snapshot(&id).await?)
}

#[tauri::command]
async fn tx_detail(
    state: tauri::State<'_, AppState>,
    id: String,
    txid: String,
) -> CommandResult<TxDetail> {
    Ok(state.manager.tx_detail(&id, &txid).await?)
}

#[tauri::command]
async fn utxos(state: tauri::State<'_, AppState>, id: String) -> CommandResult<Vec<UtxoInfo>> {
    Ok(state.manager.utxos(&id).await?)
}

#[tauri::command]
async fn receive_addresses(
    state: tauri::State<'_, AppState>,
    id: String,
    lookahead: u32,
) -> CommandResult<Vec<AddressEntry>> {
    Ok(state.manager.receive_addresses(&id, lookahead).await?)
}

#[tauri::command]
async fn sync_wallet(state: tauri::State<'_, AppState>, id: String) -> CommandResult<SyncReport> {
    Ok(state.manager.sync_wallet(&id).await?)
}

/// Fetches an older round of history for a watched address. Returns how
/// many transactions were added; zero means nothing older remains.
#[tauri::command]
async fn load_more_history(state: tauri::State<'_, AppState>, id: String) -> CommandResult<u32> {
    Ok(state.manager.load_more_history(&id).await?)
}

#[tauri::command]
async fn sync_all(
    state: tauri::State<'_, AppState>,
    network: Option<Network>,
) -> CommandResult<SyncAllReport> {
    Ok(state.manager.sync_all(network).await)
}

#[tauri::command]
async fn rename_wallet(
    state: tauri::State<'_, AppState>,
    id: String,
    name: String,
) -> CommandResult<()> {
    Ok(state.manager.rename_wallet(&id, &name).await?)
}

#[tauri::command]
async fn remove_wallet(state: tauri::State<'_, AppState>, id: String) -> CommandResult<()> {
    Ok(state.manager.remove_wallet(&id).await?)
}

#[tauri::command]
async fn get_settings(state: tauri::State<'_, AppState>) -> CommandResult<Settings> {
    Ok(state.manager.settings().await)
}

#[tauri::command]
async fn set_active_network(
    state: tauri::State<'_, AppState>,
    network: Network,
) -> CommandResult<()> {
    Ok(state.manager.set_active_network(network).await?)
}

#[tauri::command]
async fn set_backend(
    state: tauri::State<'_, AppState>,
    network: Network,
    config: BackendConfig,
) -> CommandResult<()> {
    Ok(state.manager.set_backend(network, config).await?)
}

#[tauri::command]
async fn set_app_pref(
    state: tauri::State<'_, AppState>,
    key: String,
    value: String,
) -> CommandResult<()> {
    Ok(state.manager.set_app_pref(key, value).await?)
}

#[tauri::command]
async fn fetch_price(
    source: gerfaut_core::price::PriceSource,
    currency: gerfaut_core::price::FiatCurrency,
) -> CommandResult<gerfaut_core::price::PriceQuote> {
    Ok(gerfaut_core::price::fetch_price(source, currency).await?)
}

#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> CommandResult<gerfaut_core::updates::UpdateCheck> {
    let current = app.package_info().version.to_string();
    Ok(gerfaut_core::updates::check_update("gerfaut-wallet/gerfaut-desktop", &current).await?)
}

// --- vault key ---------------------------------------------------------

const KEYRING_SERVICE: &str = "Gerfaut";
const KEYRING_ACCOUNT: &str = "vault-key";

/// Fetches the vault key from the OS credential store, creating and
/// storing a fresh random one on first launch.
fn vault_key() -> Result<VaultKey, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| format!("credential store unavailable: {e}"))?;
    match entry.get_password() {
        Ok(stored) => {
            let bytes = hex::decode(&stored)
                .map_err(|_| "stored vault key is not valid hex".to_owned())?;
            let key: [u8; 32] = bytes
                .try_into()
                .map_err(|_| "stored vault key has the wrong length".to_owned())?;
            Ok(VaultKey::Raw(key))
        }
        Err(keyring::Error::NoEntry) => {
            let mut key = [0u8; 32];
            use rand::RngCore;
            rand::rng().fill_bytes(&mut key);
            entry
                .set_password(&hex::encode(key))
                .map_err(|e| format!("cannot store vault key: {e}"))?;
            Ok(VaultKey::Raw(key))
        }
        Err(e) => Err(format!("cannot read vault key: {e}")),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let key = vault_key().map_err(std::io::Error::other)?;
            let manager = WalletManager::open(&data_dir, key)
                .map_err(|e| std::io::Error::other(e.to_string()))?;
            app.manage(AppState { manager });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            parse_input,
            add_wallet,
            list_wallets,
            wallet_snapshot,
            tx_detail,
            utxos,
            receive_addresses,
            sync_wallet,
            load_more_history,
            sync_all,
            rename_wallet,
            remove_wallet,
            get_settings,
            set_active_network,
            set_backend,
            set_app_pref,
            fetch_price,
            check_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
