//! Tauri layer of the Gerfaut desktop app.
//!
//! Thin by design: every command delegates to `gerfaut_core`'s
//! `WalletManager`. The only desktop-specific logic is where the vault
//! lives (the app data directory) and where its key comes from (the OS
//! credential store).

use gerfaut_core::WalletManager;
use gerfaut_core::backup::{BackupBundle, BackupOptions, BackupPreview, ImportChoices, ImportReport};
use gerfaut_core::chain::BackendConfig;
use gerfaut_core::chain::connect::ScannedBackend;
use gerfaut_core::chain::tor::{TorRoute, TorSettings, TorStatus};
use gerfaut_core::error::CoreError;
use gerfaut_core::input::qr::QrProgress;
use gerfaut_core::input::{DerivationChoice, ImportOptions, ParsedInput, ScriptKind};
use gerfaut_core::lock::{AppLock, LockKind, LockVerdict};
use gerfaut_core::manager::SyncAllReport;
use gerfaut_core::network::Network;
use gerfaut_core::store::{Settings, VaultKey};
use gerfaut_core::wallet::meta::WalletMeta;
use gerfaut_core::wallet::policy::PolicySnapshot;
use gerfaut_core::wallet::snapshot::{
    AddressEntry, AddressList, SyncReport, TxDetail, UtxoInfo, WalletSnapshot,
};
use serde::Serialize;
use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, FileDialogBuilder};

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
            CoreError::Broadcast { .. } => "broadcast",
            CoreError::BackendUnavailable(_) => "backend_unavailable",
            CoreError::Descriptor(_) => "descriptor",
            CoreError::Tor(_) => "tor",
            CoreError::Internal(_) => "internal",
        };
        CommandError {
            kind,
            message: error.to_string(),
        }
    }
}

type CommandResult<T> = Result<T, CommandError>;

fn internal(message: String) -> CommandError {
    CommandError {
        kind: "internal",
        message,
    }
}

struct AppState {
    manager: WalletManager,
}

// --- file dialogs ------------------------------------------------------

/// The renderer never sees a path. It asks for a file to be read or
/// written, the native dialog opens here, and what goes back is what
/// the file held or the fact that it was written. A name it suggests
/// is only a name.
fn file_dialog(app: &tauri::AppHandle) -> FileDialogBuilder<tauri::Wry> {
    let dialog = app.dialog().file();
    match app.get_webview_window("main") {
        Some(window) => dialog.set_parent(&window),
        None => dialog,
    }
}

enum DialogKind {
    Open,
    Save,
}

/// Shows the dialog off the async runtime and returns the path the
/// person settled on; `None` when they closed it instead.
async fn show_dialog(
    dialog: FileDialogBuilder<tauri::Wry>,
    kind: DialogKind,
) -> CommandResult<Option<PathBuf>> {
    let picked = tauri::async_runtime::spawn_blocking(move || match kind {
        DialogKind::Open => dialog.blocking_pick_file(),
        DialogKind::Save => dialog.blocking_save_file(),
    })
    .await
    .map_err(|e| internal(format!("the file dialog did not answer: {e}")))?;
    picked
        .map(|file| {
            file.into_path()
                .map_err(|e| internal(format!("the file dialog gave no usable path: {e}")))
        })
        .transpose()
}

/// Reduces a suggested file name to a bare name: anything before a
/// separator goes, so do the characters no file system accepts, and an
/// empty result falls back rather than naming a file after nothing.
fn bare_file_name(suggested: &str, fallback: &str) -> String {
    let name: String = suggested
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
        .collect();
    let name = name.trim().trim_end_matches(['.', ' ']);
    if name.is_empty() {
        fallback.to_owned()
    } else {
        name.to_owned()
    }
}

/// A backup file the person picked: its name for the screen, its bytes
/// as the base64 the core opens.
#[derive(Debug, Clone, Serialize)]
pub struct PickedBackup {
    pub name: String,
    pub data: String,
}

// --- commands ----------------------------------------------------------

/// Classifies pasted or scanned material. `script` and `derivation`
/// only apply to a lone extended key; everything else fixes its own.
#[tauri::command]
fn parse_input(
    input: String,
    script: Option<ScriptKind>,
    derivation: Option<DerivationChoice>,
) -> CommandResult<ParsedInput> {
    let options = ImportOptions { script, derivation };
    Ok(gerfaut_core::input::parse_input_with_options(&input, &options)?)
}

/// Reads a server address scanned or pasted into the backend settings:
/// the Electrum one-liner `host:port:s|t`, an `ssl://`/`tcp://` address,
/// or an `http(s)://` Esplora endpoint.
#[tauri::command]
fn parse_backend(input: String) -> CommandResult<ScannedBackend> {
    Ok(gerfaut_core::chain::connect::parse_backend(&input)?)
}

/// Assembles the QR frames scanned so far (plain, UR, BBQr).
#[tauri::command]
fn assemble_qr(frames: Vec<String>) -> CommandResult<QrProgress> {
    Ok(gerfaut_core::input::qr::assemble(&frames)?)
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
async fn wallet_policy(
    state: tauri::State<'_, AppState>,
    id: String,
) -> CommandResult<PolicySnapshot> {
    Ok(state.manager.policy(&id).await?)
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

/// Scans a wallet again from its first address with the current gap
/// limit, for funds an incremental sync can no longer see.
#[tauri::command]
async fn rescan_wallet(state: tauri::State<'_, AppState>, id: String) -> CommandResult<SyncReport> {
    Ok(state.manager.rescan_wallet(&id).await?)
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
async fn set_gap_limit(state: tauri::State<'_, AppState>, gap_limit: u32) -> CommandResult<()> {
    Ok(state.manager.set_gap_limit(gap_limit).await?)
}

/// What an Electrum server's certificate amounts to right now. Reads
/// only: accepting one is a separate, explicit call.
#[tauri::command]
async fn inspect_certificate(
    state: tauri::State<'_, AppState>,
    url: String,
) -> CommandResult<gerfaut_core::chain::CertificateReport> {
    Ok(state.manager.inspect_certificate(&url).await?)
}

#[tauri::command]
async fn trust_certificate(
    state: tauri::State<'_, AppState>,
    url: String,
    fingerprint: String,
) -> CommandResult<()> {
    Ok(state.manager.trust_certificate(&url, &fingerprint).await?)
}

#[tauri::command]
async fn forget_certificate(state: tauri::State<'_, AppState>, host: String) -> CommandResult<()> {
    Ok(state.manager.forget_certificate(&host).await?)
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
async fn address_list(state: tauri::State<'_, AppState>, id: String) -> CommandResult<AddressList> {
    Ok(state.manager.address_list(&id).await?)
}

/// Builds the filtered CSV, then asks where it should go and writes it
/// there. The file comes first: an export that fails should not have
/// cost a trip through the dialog. Answers with the number of rows
/// written; null when the dialog was closed instead.
#[tauri::command]
async fn export_transactions_csv(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    id: String,
    options: gerfaut_core::export::ExportOptions,
    suggested_name: String,
) -> CommandResult<Option<u32>> {
    let result = state.manager.export_transactions(&id, &options).await?;
    let dialog = file_dialog(&app)
        .add_filter("CSV", &["csv"])
        .set_file_name(bare_file_name(&suggested_name, "transactions.csv"));
    let Some(path) = show_dialog(dialog, DialogKind::Save).await? else {
        return Ok(None);
    };
    std::fs::write(&path, result.csv.as_bytes())
        .map_err(|e| internal(format!("could not write {}: {e}", path.display())))?;
    Ok(Some(result.rows))
}

/// Fee estimates come from the backend configured for the network: the
/// host that already serves this wallet, or the public rotation.
#[tauri::command]
async fn fetch_fees(
    state: tauri::State<'_, AppState>,
    network: Network,
) -> CommandResult<gerfaut_core::fees::FeeEstimates> {
    Ok(state.manager.fetch_fees(network).await?)
}

/// Decodes a transaction (PSBT or raw, any text form) and shows what it
/// does before anything leaves the machine.
#[tauri::command]
async fn preview_transaction(
    state: tauri::State<'_, AppState>,
    input: String,
    network: Network,
) -> CommandResult<gerfaut_core::broadcast::TxPreview> {
    Ok(state.manager.preview_transaction(&input, network).await?)
}

/// Hands a fully signed transaction to the configured backend.
#[tauri::command]
async fn broadcast_transaction(
    state: tauri::State<'_, AppState>,
    network: Network,
    hex: String,
) -> CommandResult<gerfaut_core::broadcast::BroadcastReport> {
    Ok(state.manager.broadcast_transaction(network, &hex).await?)
}

/// Where a broadcast transaction stands now.
#[tauri::command]
async fn transaction_status(
    state: tauri::State<'_, AppState>,
    network: Network,
    hex: String,
) -> CommandResult<gerfaut_core::broadcast::BroadcastStatus> {
    Ok(state.manager.transaction_status(network, &hex).await?)
}

/// The public servers offered for a network, in settings order.
#[tauri::command]
fn public_servers(network: Network) -> Vec<gerfaut_core::chain::public::PublicServer> {
    gerfaut_core::chain::public::public_servers(network)
}

#[tauri::command]
async fn fetch_price(
    source: gerfaut_core::price::PriceSource,
    currency: gerfaut_core::price::FiatCurrency,
) -> CommandResult<gerfaut_core::price::PriceQuote> {
    Ok(gerfaut_core::price::fetch_price(source, currency).await?)
}

#[tauri::command]
async fn fetch_price_history(
    source: gerfaut_core::price::PriceSource,
    currency: gerfaut_core::price::FiatCurrency,
    range: gerfaut_core::price::PriceRange,
) -> CommandResult<gerfaut_core::price::PriceHistory> {
    Ok(gerfaut_core::price::fetch_price_history(source, currency, range).await?)
}

#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> CommandResult<gerfaut_core::updates::UpdateCheck> {
    let current = app.package_info().version.to_string();
    Ok(gerfaut_core::updates::check_update("gerfaut-wallet/gerfaut-desktop", &current).await?)
}

// --- tor ---------------------------------------------------------------

/// Where Tor stands for `.onion` backends: the mode, the route in use,
/// and how far the built-in client has bootstrapped.
#[tauri::command]
async fn tor_status(state: tauri::State<'_, AppState>) -> CommandResult<TorStatus> {
    Ok(state.manager.tor_status().await)
}

#[tauri::command]
async fn set_tor_settings(
    state: tauri::State<'_, AppState>,
    settings: TorSettings,
) -> CommandResult<()> {
    Ok(state.manager.set_tor_settings(settings).await?)
}

/// Resolves the route now, bootstrapping the built-in client if that is
/// the path: a warm-up from the settings, which can take up to a minute
/// and a half on a first run.
#[tauri::command]
async fn tor_connect(state: tauri::State<'_, AppState>) -> CommandResult<TorRoute> {
    Ok(state.manager.tor_connect().await?)
}

// --- app lock ----------------------------------------------------------

/// The lock in place, without its hash; null when there is none.
#[tauri::command]
async fn app_lock(state: tauri::State<'_, AppState>) -> CommandResult<Option<AppLock>> {
    Ok(state.manager.app_lock().await)
}

/// Sets a lock, or replaces its secret; replacing needs the current one.
#[tauri::command]
async fn set_app_lock(
    state: tauri::State<'_, AppState>,
    kind: LockKind,
    secret: String,
    current: Option<String>,
) -> CommandResult<()> {
    Ok(state
        .manager
        .set_app_lock(kind, &secret, current.as_deref())
        .await?)
}

#[tauri::command]
async fn clear_app_lock(state: tauri::State<'_, AppState>, current: String) -> CommandResult<()> {
    Ok(state.manager.clear_app_lock(&current).await?)
}

/// Tries a secret; the verdict carries the delay after repeated failures.
#[tauri::command]
async fn verify_app_lock(
    state: tauri::State<'_, AppState>,
    secret: String,
) -> CommandResult<LockVerdict> {
    Ok(state.manager.verify_app_lock(&secret).await?)
}

// --- backup ------------------------------------------------------------

/// Seals the chosen wallets under a password: base64 for a file, UR
/// frames for an animated QR.
#[tauri::command]
async fn export_backup(
    state: tauri::State<'_, AppState>,
    options: BackupOptions,
    password: String,
) -> CommandResult<BackupBundle> {
    Ok(state.manager.export_backup(&options, &password).await?)
}

/// Asks where a sealed backup (base64 from `export_backup`) should go
/// and writes it there. The bytes are already encrypted: this is plain
/// I/O. True once the file is written, false when the dialog was
/// closed instead.
#[tauri::command]
async fn save_backup_file(
    app: tauri::AppHandle,
    data: String,
    suggested_name: String,
) -> CommandResult<bool> {
    let bytes = gerfaut_core::backup::decode_source(&data)?;
    let dialog = file_dialog(&app)
        .add_filter("Gerfaut backup", &["gerfaut"])
        .set_file_name(bare_file_name(&suggested_name, "gerfaut-backup.gerfaut"));
    let Some(path) = show_dialog(dialog, DialogKind::Save).await? else {
        return Ok(false);
    };
    std::fs::write(&path, bytes)
        .map_err(|e| internal(format!("could not write {}: {e}", path.display())))?;
    Ok(true)
}

/// Asks for a backup file and reads it into the base64 form the core
/// opens. Any file is read; the core says whether it is a backup. The
/// size is checked first, so picking a disc image by mistake costs
/// nothing. Null when the dialog was closed instead.
#[tauri::command]
async fn pick_backup_file(app: tauri::AppHandle) -> CommandResult<Option<PickedBackup>> {
    let dialog = file_dialog(&app)
        .add_filter("Gerfaut backup", &["gerfaut"])
        .add_filter("All files", &["*"]);
    let Some(path) = show_dialog(dialog, DialogKind::Open).await? else {
        return Ok(None);
    };
    let unreadable =
        |e: std::io::Error| internal(format!("could not read {}: {e}", path.display()));
    let size = std::fs::metadata(&path).map_err(unreadable)?.len();
    if size > gerfaut_core::backup::MAX_BACKUP_TEXT as u64 {
        return Err(CommandError {
            kind: "invalid_input",
            message: "this file is far too large to be a Gerfaut backup".to_owned(),
        });
    }
    let bytes = std::fs::read(&path).map_err(unreadable)?;
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string());
    Ok(Some(PickedBackup {
        name,
        data: data_encoding::BASE64.encode(&bytes),
    }))
}

/// Opens a backup and lists what it holds, before anything is added.
#[tauri::command]
async fn preview_backup(
    state: tauri::State<'_, AppState>,
    source: String,
    password: String,
) -> CommandResult<BackupPreview> {
    Ok(state.manager.preview_backup(&source, &password).await?)
}

#[tauri::command]
async fn import_backup(
    state: tauri::State<'_, AppState>,
    source: String,
    password: String,
    choices: ImportChoices,
) -> CommandResult<ImportReport> {
    Ok(state
        .manager
        .import_backup(&source, &password, &choices)
        .await?)
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
            let bytes =
                hex::decode(&stored).map_err(|_| "stored vault key is not valid hex".to_owned())?;
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

/// Where the vault lives. Development builds honour `GERFAUT_DATA_DIR`
/// so that a test instance never opens the vault of an app already
/// running on the machine; release builds always use the app data dir.
fn data_dir(app: &tauri::App) -> tauri::Result<std::path::PathBuf> {
    #[cfg(debug_assertions)]
    if let Some(dir) = std::env::var_os("GERFAUT_DATA_DIR") {
        return Ok(std::path::PathBuf::from(dir));
    }
    app.path().app_data_dir()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let data_dir = data_dir(app)?;
            let key = vault_key().map_err(std::io::Error::other)?;
            let manager = WalletManager::open(&data_dir, key)
                .map_err(|e| std::io::Error::other(e.to_string()))?;
            app.manage(AppState { manager });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            parse_input,
            parse_backend,
            assemble_qr,
            add_wallet,
            list_wallets,
            wallet_snapshot,
            tx_detail,
            utxos,
            wallet_policy,
            receive_addresses,
            address_list,
            export_transactions_csv,
            fetch_fees,
            public_servers,
            preview_transaction,
            broadcast_transaction,
            transaction_status,
            sync_wallet,
            rescan_wallet,
            load_more_history,
            sync_all,
            rename_wallet,
            remove_wallet,
            get_settings,
            set_active_network,
            set_backend,
            set_gap_limit,
            inspect_certificate,
            trust_certificate,
            forget_certificate,
            set_app_pref,
            fetch_price,
            fetch_price_history,
            check_update,
            app_lock,
            set_app_lock,
            clear_app_lock,
            verify_app_lock,
            export_backup,
            save_backup_file,
            pick_backup_file,
            preview_backup,
            import_backup,
            tor_status,
            set_tor_settings,
            tor_connect
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::bare_file_name;

    #[test]
    fn a_suggested_name_keeps_only_its_last_component() {
        assert_eq!(bare_file_name("wallet-transactions.csv", "x"), "wallet-transactions.csv");
        assert_eq!(bare_file_name("../../etc/passwd", "x"), "passwd");
        assert_eq!(bare_file_name("C:\\Users\\me\\a.gerfaut", "x"), "a.gerfaut");
    }

    #[test]
    fn characters_no_file_system_takes_are_dropped() {
        assert_eq!(bare_file_name("a:b*c?d\"e<f>g|h.csv", "x"), "abcdefgh.csv");
        assert_eq!(bare_file_name("trailing dots... ", "x"), "trailing dots");
    }

    #[test]
    fn nothing_left_falls_back() {
        assert_eq!(bare_file_name("", "backup.gerfaut"), "backup.gerfaut");
        assert_eq!(bare_file_name("///", "backup.gerfaut"), "backup.gerfaut");
        assert_eq!(bare_file_name("...", "backup.gerfaut"), "backup.gerfaut");
    }
}
