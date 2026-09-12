//! Tauri layer of the Gerfaut desktop app.
//!
//! Thin by design: every command delegates to `gerfaut_core`'s
//! `WalletManager`. The only desktop-specific logic is where the vault
//! lives (the app data directory) and where its key comes from (the OS
//! credential store).

use gerfaut_core::WalletManager;
use gerfaut_core::backup::{
    BackupBundle, BackupOptions, BackupPreview, ImportChoices, ImportReport,
};
use gerfaut_core::chain::BackendConfig;
use gerfaut_core::chain::connect::ScannedBackend;
use gerfaut_core::chain::tor::{TorRoute, TorSettings, TorStatus};
use gerfaut_core::error::{CoreError, PremiumError};
use gerfaut_core::input::qr::QrProgress;
use gerfaut_core::input::{DerivationChoice, ImportOptions, ParsedInput, ScriptKind};
use gerfaut_core::lock::{AppLock, LockKind, LockVerdict};
use gerfaut_core::manager::SyncAllReport;
use gerfaut_core::network::Network;
use gerfaut_core::store::{Settings, VaultKey};
use gerfaut_core::wallet::meta::{WalletIcon, WalletMeta};
use gerfaut_core::wallet::policy::PolicySnapshot;
use gerfaut_core::wallet::snapshot::{
    AddressEntry, AddressList, SyncReport, TxDetail, UtxoInfo, WalletSnapshot,
};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, FileDialogBuilder};

mod premium;

/// Error shape every command returns; the frontend matches on `kind`.
#[derive(Debug, Clone, Serialize)]
pub struct CommandError {
    pub kind: &'static str,
    pub message: String,
}

/// What the screen does about a premium failure: back to the key field,
/// to the renewal page, a note in the server's words, or the "watch is
/// offline" banner.
fn premium_kind(error: &PremiumError) -> &'static str {
    match error {
        PremiumError::NoKey => "premium_no_key",
        PremiumError::UnknownKey => "premium_unknown_key",
        PremiumError::NoPaidTime => "premium_no_paid_time",
        PremiumError::Rejected(_) => "premium_rejected",
        PremiumError::Unreachable(_) | PremiumError::UnexpectedResponse(_) => "premium_unreachable",
        PremiumError::InvalidCertificate(_)
        | PremiumError::InvalidHeartbeat(_)
        | PremiumError::StaleHeartbeat { .. } => "premium_invalid",
    }
}

impl From<CoreError> for CommandError {
    fn from(error: CoreError) -> Self {
        // A refusal is shown in the server's own sentence, without the
        // prefix the error type wraps it in.
        if let CoreError::Premium(PremiumError::Rejected(words)) = &error {
            return CommandError {
                kind: "premium_rejected",
                message: words.clone(),
            };
        }
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
            CoreError::Premium(error) => premium_kind(error),
            CoreError::Internal(_) => "internal",
        };
        CommandError {
            kind,
            message: error.to_string(),
        }
    }
}

pub(crate) type CommandResult<T> = Result<T, CommandError>;

fn internal(message: String) -> CommandError {
    CommandError {
        kind: "internal",
        message,
    }
}

pub(crate) struct AppState {
    pub(crate) manager: WalletManager,
    /// Whether the lock screen stands in front of the vault.
    ///
    /// The curtain used to be drawn in the webview alone: every command
    /// still answered behind it, so anything that reached the bridge —
    /// a renderer gone wrong, a page left open on a screen nobody
    /// watches — read descriptors, balances and the account key out of
    /// a locked app. Set here at startup from the lock the vault holds,
    /// raised again by [`lock_app`], and taken down by one thing only:
    /// a secret the core verified.
    pub(crate) locked: AtomicBool,
}

impl AppState {
    /// The line every command that reads or writes the vault begins
    /// with. Four pass: the two that read the lock itself, the one that
    /// draws it, and the settings, redacted to what the lock screen is
    /// painted with.
    pub(crate) fn unlocked(&self) -> CommandResult<()> {
        if self.locked.load(Ordering::SeqCst) {
            return Err(CommandError {
                kind: "locked",
                message: "Gerfaut is locked.".to_owned(),
            });
        }
        Ok(())
    }
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

/// Longest stem a suggested name keeps. File systems stop a name at 255
/// bytes; this leaves room for the extension and for characters that
/// take more than one byte.
const MAX_STEM_CHARS: usize = 200;
/// Longest tail after the last dot that still counts as an extension.
const MAX_EXTENSION_CHARS: usize = 16;

/// Reduces a suggested file name to a bare name: anything before a
/// separator goes, so do the characters no file system accepts, an
/// overlong stem is cut, and what is left falls back when it is empty
/// or when Windows would read it as a device rather than a file.
fn bare_file_name(suggested: &str, fallback: &str) -> String {
    let name: String = suggested
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
        .collect();
    let name = capped(name.trim().trim_end_matches(['.', ' ']));
    if name.is_empty() || is_device_name(&name) {
        fallback.to_owned()
    } else {
        name
    }
}

/// The name with its stem cut to `MAX_STEM_CHARS`, its extension kept.
fn capped(name: &str) -> String {
    let (stem, extension) = match name.rfind('.') {
        Some(dot) if dot > 0 && name[dot..].chars().count() <= MAX_EXTENSION_CHARS => {
            name.split_at(dot)
        }
        _ => (name, ""),
    };
    let stem: String = stem.chars().take(MAX_STEM_CHARS).collect();
    format!("{stem}{extension}")
}

/// Whether Windows reads the name as a device: `CON`, `PRN`, `AUX`,
/// `NUL`, `COM0` to `COM9` and `LPT0` to `LPT9`, in any case and with
/// any extension after them. Such a file cannot be created, and on
/// older systems the write would go to the device instead.
fn is_device_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or(name).trim_end();
    let upper = stem.to_ascii_uppercase();
    if matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL") {
        return true;
    }
    let mut chars = upper.chars();
    let port: String = chars.by_ref().take(3).collect();
    matches!(port.as_str(), "COM" | "LPT")
        && matches!(
            chars.next(),
            Some('0'..='9' | '\u{b9}' | '\u{b2}' | '\u{b3}')
        )
        && chars.next().is_none()
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
    Ok(gerfaut_core::input::parse_input_with_options(
        &input, &options,
    )?)
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
    state.unlocked()?;
    Ok(state.manager.add_wallet(&name, &parsed, network).await?)
}

#[tauri::command]
async fn list_wallets(
    state: tauri::State<'_, AppState>,
    network: Option<Network>,
) -> CommandResult<Vec<WalletMeta>> {
    state.unlocked()?;
    Ok(state.manager.list_wallets(network).await)
}

#[tauri::command]
async fn wallet_snapshot(
    state: tauri::State<'_, AppState>,
    id: String,
) -> CommandResult<WalletSnapshot> {
    state.unlocked()?;
    Ok(state.manager.wallet_snapshot(&id).await?)
}

#[tauri::command]
async fn tx_detail(
    state: tauri::State<'_, AppState>,
    id: String,
    txid: String,
) -> CommandResult<TxDetail> {
    state.unlocked()?;
    Ok(state.manager.tx_detail(&id, &txid).await?)
}

#[tauri::command]
async fn utxos(state: tauri::State<'_, AppState>, id: String) -> CommandResult<Vec<UtxoInfo>> {
    state.unlocked()?;
    Ok(state.manager.utxos(&id).await?)
}

#[tauri::command]
async fn wallet_policy(
    state: tauri::State<'_, AppState>,
    id: String,
) -> CommandResult<PolicySnapshot> {
    state.unlocked()?;
    Ok(state.manager.policy(&id).await?)
}

#[tauri::command]
async fn receive_addresses(
    state: tauri::State<'_, AppState>,
    id: String,
    lookahead: u32,
) -> CommandResult<Vec<AddressEntry>> {
    state.unlocked()?;
    Ok(state.manager.receive_addresses(&id, lookahead).await?)
}

#[tauri::command]
async fn sync_wallet(state: tauri::State<'_, AppState>, id: String) -> CommandResult<SyncReport> {
    state.unlocked()?;
    Ok(state.manager.sync_wallet(&id).await?)
}

/// Scans a wallet again from its first address with the current gap
/// limit, for funds an incremental sync can no longer see.
#[tauri::command]
async fn rescan_wallet(state: tauri::State<'_, AppState>, id: String) -> CommandResult<SyncReport> {
    state.unlocked()?;
    Ok(state.manager.rescan_wallet(&id).await?)
}

/// Fetches an older round of history for a watched address. Returns how
/// many transactions were added; zero means nothing older remains.
#[tauri::command]
async fn load_more_history(state: tauri::State<'_, AppState>, id: String) -> CommandResult<u32> {
    state.unlocked()?;
    Ok(state.manager.load_more_history(&id).await?)
}

#[tauri::command]
async fn sync_all(
    state: tauri::State<'_, AppState>,
    network: Option<Network>,
) -> CommandResult<SyncAllReport> {
    state.unlocked()?;
    Ok(state.manager.sync_all(network).await)
}

#[tauri::command]
async fn rename_wallet(
    state: tauri::State<'_, AppState>,
    id: String,
    name: String,
) -> CommandResult<()> {
    state.unlocked()?;
    Ok(state.manager.rename_wallet(&id, &name).await?)
}

/// Removes the wallet here, then tells the premium server on the side.
/// The core queued the wallet for unwatching in the same write that
/// removed it, so the answer does not wait for the network: a server
/// out of reach now is told at the next heartbeat.
#[tauri::command]
async fn remove_wallet(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    id: String,
) -> CommandResult<()> {
    state.unlocked()?;
    state.manager.remove_wallet(&id).await?;
    tauri::async_runtime::spawn(async move {
        premium::flush_unwatch(&app.state::<AppState>()).await;
    });
    Ok(())
}

#[tauri::command]
async fn set_wallet_icon(
    state: tauri::State<'_, AppState>,
    id: String,
    icon: WalletIcon,
) -> CommandResult<()> {
    state.unlocked()?;
    Ok(state.manager.set_wallet_icon(&id, icon).await?)
}

/// Puts the listed wallets in that order; wallets not listed keep
/// their slots, so one network's list reorders without the others.
#[tauri::command]
async fn reorder_wallets(state: tauri::State<'_, AppState>, ids: Vec<String>) -> CommandResult<()> {
    state.unlocked()?;
    Ok(state.manager.reorder_wallets(&ids).await?)
}

/// The settings, and behind the lock a copy cut down to what the lock
/// screen needs to draw itself: the theme it is painted in and the kind
/// of secret it must ask for. No backend, no accepted certificate, no
/// account key — none of it is read until someone comes back, and a
/// copy sitting in the webview's cache is a copy that can be read.
#[tauri::command]
async fn get_settings(state: tauri::State<'_, AppState>) -> CommandResult<Settings> {
    Ok(settings_of(&state).await)
}

async fn settings_of(state: &AppState) -> Settings {
    let settings = state.manager.settings().await;
    if state.locked.load(Ordering::SeqCst) {
        return locked_settings(settings);
    }
    settings
}

/// The one preference the lock screen is drawn from. The rest of them
/// say what the shell remembers — the unit, the masked amounts, the
/// transactions last broadcast — and wait for the unlock.
const THEME_PREF: &str = "desktop.theme";
/// Whether the welcome tour has been through. Behind the lock this has
/// to survive with the theme: without it the app reads as a vault with
/// no wallets and no tour seen, and shows the tour again at every
/// unlock. It says nothing about what is watched.
const ONBOARDING_PREF: &str = "onboarding.seen";

fn locked_settings(settings: Settings) -> Settings {
    let kept = [THEME_PREF, ONBOARDING_PREF]
        .into_iter()
        .filter_map(|key| {
            settings
                .app_prefs
                .get(key)
                .map(|value| (key.to_owned(), value.clone()))
        })
        .collect();
    Settings {
        app_prefs: kept,
        app_lock: settings.app_lock,
        // The network is not the vault's business either, and filling it
        // from the defaults would answer "mainnet" for a signet vault --
        // which is the network the app then asks the open vault about.
        active_network: settings.active_network,
        ..Settings::default()
    }
}

#[tauri::command]
async fn set_active_network(
    state: tauri::State<'_, AppState>,
    network: Network,
) -> CommandResult<()> {
    state.unlocked()?;
    Ok(state.manager.set_active_network(network).await?)
}

#[tauri::command]
async fn set_backend(
    state: tauri::State<'_, AppState>,
    network: Network,
    config: BackendConfig,
) -> CommandResult<()> {
    state.unlocked()?;
    Ok(state.manager.set_backend(network, config).await?)
}

#[tauri::command]
async fn set_gap_limit(state: tauri::State<'_, AppState>, gap_limit: u32) -> CommandResult<()> {
    state.unlocked()?;
    Ok(state.manager.set_gap_limit(gap_limit).await?)
}

/// What an Electrum server's certificate amounts to right now. Reads
/// only: accepting one is a separate, explicit call.
#[tauri::command]
async fn inspect_certificate(
    state: tauri::State<'_, AppState>,
    url: String,
) -> CommandResult<gerfaut_core::chain::CertificateReport> {
    state.unlocked()?;
    Ok(state.manager.inspect_certificate(&url).await?)
}

#[tauri::command]
async fn trust_certificate(
    state: tauri::State<'_, AppState>,
    url: String,
    fingerprint: String,
) -> CommandResult<()> {
    state.unlocked()?;
    Ok(state.manager.trust_certificate(&url, &fingerprint).await?)
}

#[tauri::command]
async fn forget_certificate(state: tauri::State<'_, AppState>, host: String) -> CommandResult<()> {
    state.unlocked()?;
    Ok(state.manager.forget_certificate(&host).await?)
}

#[tauri::command]
async fn set_app_pref(
    state: tauri::State<'_, AppState>,
    key: String,
    value: String,
) -> CommandResult<()> {
    state.unlocked()?;
    Ok(state.manager.set_app_pref(key, value).await?)
}

#[tauri::command]
async fn address_list(state: tauri::State<'_, AppState>, id: String) -> CommandResult<AddressList> {
    state.unlocked()?;
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
    state.unlocked()?;
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

/// Decodes a transaction (PSBT or raw, any text form) and shows what it
/// does before anything leaves the machine.
#[tauri::command]
async fn preview_transaction(
    state: tauri::State<'_, AppState>,
    input: String,
    network: Network,
) -> CommandResult<gerfaut_core::broadcast::TxPreview> {
    state.unlocked()?;
    Ok(state.manager.preview_transaction(&input, network).await?)
}

/// Hands a fully signed transaction to the configured backend.
#[tauri::command]
async fn broadcast_transaction(
    state: tauri::State<'_, AppState>,
    network: Network,
    hex: String,
) -> CommandResult<gerfaut_core::broadcast::BroadcastReport> {
    state.unlocked()?;
    Ok(state.manager.broadcast_transaction(network, &hex).await?)
}

/// Where a broadcast transaction stands now.
#[tauri::command]
async fn transaction_status(
    state: tauri::State<'_, AppState>,
    network: Network,
    hex: String,
) -> CommandResult<gerfaut_core::broadcast::BroadcastStatus> {
    state.unlocked()?;
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
    state.unlocked()?;
    Ok(state.manager.tor_status().await)
}

#[tauri::command]
async fn set_tor_settings(
    state: tauri::State<'_, AppState>,
    settings: TorSettings,
) -> CommandResult<()> {
    state.unlocked()?;
    Ok(state.manager.set_tor_settings(settings).await?)
}

/// Resolves the route now, bootstrapping the built-in client if that is
/// the path: a warm-up from the settings, which can take up to a minute
/// and a half on a first run.
#[tauri::command]
async fn tor_connect(state: tauri::State<'_, AppState>) -> CommandResult<TorRoute> {
    state.unlocked()?;
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
    state.unlocked()?;
    Ok(state
        .manager
        .set_app_lock(kind, &secret, current.as_deref())
        .await?)
}

#[tauri::command]
async fn clear_app_lock(state: tauri::State<'_, AppState>, current: String) -> CommandResult<()> {
    state.unlocked()?;
    Ok(state.manager.clear_app_lock(&current).await?)
}

/// Tries a secret; the verdict carries the delay after repeated failures.
/// A secret the core accepted is the only way the vault opens again.
#[tauri::command]
async fn verify_app_lock(
    state: tauri::State<'_, AppState>,
    secret: String,
) -> CommandResult<LockVerdict> {
    verify_lock(&state, &secret).await
}

async fn verify_lock(state: &AppState, secret: &str) -> CommandResult<LockVerdict> {
    let verdict = state.manager.verify_app_lock(secret).await?;
    if verdict.unlocked {
        state.locked.store(false, Ordering::SeqCst);
    }
    Ok(verdict)
}

/// Draws the curtain on this side too. The webview calls it when it
/// locks, so the two never disagree about whether the app is open.
///
/// A vault with no lock is left alone: there would be no secret to come
/// back with, and the app would stay shut until the window is closed.
#[tauri::command]
async fn lock_app(state: tauri::State<'_, AppState>) -> CommandResult<()> {
    lock_vault(&state).await
}

async fn lock_vault(state: &AppState) -> CommandResult<()> {
    if state.manager.app_lock().await.is_some() {
        state.locked.store(true, Ordering::SeqCst);
    }
    Ok(())
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
    state.unlocked()?;
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
/// read stops one byte past the largest backup the core accepts, so
/// picking a disc image by mistake costs nothing, and the file is
/// judged by what was read rather than by a size it may have outgrown
/// since. Null when the dialog was closed instead.
#[tauri::command]
async fn pick_backup_file(app: tauri::AppHandle) -> CommandResult<Option<PickedBackup>> {
    use std::io::Read;

    let dialog = file_dialog(&app)
        .add_filter("Gerfaut backup", &["gerfaut"])
        .add_filter("All files", &["*"]);
    let Some(path) = show_dialog(dialog, DialogKind::Open).await? else {
        return Ok(None);
    };
    let unreadable =
        |e: std::io::Error| internal(format!("could not read {}: {e}", path.display()));
    let limit = gerfaut_core::backup::MAX_BACKUP_TEXT;
    let mut bytes = Vec::new();
    std::fs::File::open(&path)
        .map_err(unreadable)?
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(unreadable)?;
    if bytes.len() > limit {
        return Err(CommandError {
            kind: "invalid_input",
            message: "this file is far too large to be a Gerfaut backup".to_owned(),
        });
    }
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
    state.unlocked()?;
    Ok(state.manager.preview_backup(&source, &password).await?)
}

#[tauri::command]
async fn import_backup(
    state: tauri::State<'_, AppState>,
    source: String,
    password: String,
    choices: ImportChoices,
) -> CommandResult<ImportReport> {
    state.unlocked()?;
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
            // A vault that holds a lock opens shut: the first frame the
            // webview draws is the lock screen, and until a secret goes
            // through, the commands below answer nothing about it.
            let locked = tauri::async_runtime::block_on(manager.app_lock()).is_some();
            app.manage(AppState {
                manager,
                locked: AtomicBool::new(locked),
            });
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
            set_wallet_icon,
            reorder_wallets,
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
            lock_app,
            export_backup,
            save_backup_file,
            pick_backup_file,
            preview_backup,
            import_backup,
            tor_status,
            set_tor_settings,
            tor_connect,
            premium::premium_status,
            premium::premium_activate,
            premium::premium_forget,
            premium::premium_account,
            premium::premium_wallets,
            premium::premium_watch_wallet,
            premium::premium_unwatch_wallet,
            premium::premium_channels,
            premium::premium_add_channel,
            premium::premium_delete_channel,
            premium::premium_confirm_channel,
            premium::premium_delete_account,
            premium::premium_test_channel,
            premium::premium_events,
            premium::premium_heartbeat,
            premium::premium_acknowledge_offline
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{CommandError, bare_file_name};
    use gerfaut_core::error::{CoreError, PremiumError};

    #[test]
    fn premium_failures_are_named_for_the_screen() {
        let kind = |error: PremiumError| CommandError::from(CoreError::Premium(error)).kind;
        assert_eq!(kind(PremiumError::UnknownKey), "premium_unknown_key");
        assert_eq!(kind(PremiumError::NoPaidTime), "premium_no_paid_time");
        assert_eq!(kind(PremiumError::NoKey), "premium_no_key");
        assert_eq!(
            kind(PremiumError::Unreachable("timed out".to_owned())),
            "premium_unreachable"
        );
        assert_eq!(
            kind(PremiumError::UnexpectedResponse("html".to_owned())),
            "premium_unreachable"
        );
        assert_eq!(
            kind(PremiumError::StaleHeartbeat { skew: 900 }),
            "premium_invalid"
        );
        assert_eq!(
            kind(PremiumError::InvalidCertificate("no".to_owned())),
            "premium_invalid"
        );
    }

    /// The server's sentence reaches the screen as it was written.
    #[test]
    fn a_refusal_keeps_the_servers_own_words() {
        let error = CommandError::from(CoreError::Premium(PremiumError::Rejected(
            "a single address cannot be watched yet; send a descriptor".to_owned(),
        )));
        assert_eq!(error.kind, "premium_rejected");
        assert_eq!(
            error.message,
            "a single address cannot be watched yet; send a descriptor"
        );
    }

    #[test]
    fn a_suggested_name_keeps_only_its_last_component() {
        assert_eq!(
            bare_file_name("wallet-transactions.csv", "x"),
            "wallet-transactions.csv"
        );
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

    #[test]
    fn a_name_windows_reads_as_a_device_falls_back() {
        for name in [
            "CON",
            "con",
            "Con.csv",
            "PRN.gerfaut",
            "AUX",
            "NUL.tar.gz",
            "nul .csv",
            "COM1",
            "com9.csv",
            "LPT1.csv",
            "LPT9",
            "COM\u{b9}.csv",
        ] {
            assert_eq!(bare_file_name(name, "x.csv"), "x.csv", "{name}");
        }
        // Lookalikes are ordinary names.
        for name in [
            "console.csv",
            "COM10.csv",
            "COMA.csv",
            "LPT.csv",
            "nulls.csv",
            "config.gerfaut",
        ] {
            assert_eq!(bare_file_name(name, "x.csv"), name, "{name}");
        }
    }

    #[test]
    fn an_overlong_stem_is_cut_and_keeps_its_extension() {
        let long = format!("{}.csv", "a".repeat(300));
        assert_eq!(
            bare_file_name(&long, "x"),
            format!("{}.csv", "a".repeat(200))
        );
        // Characters, not bytes: an accent is one character cut or kept.
        let accents = format!("{}.gerfaut", "\u{e9}".repeat(250));
        assert_eq!(
            bare_file_name(&accents, "x"),
            format!("{}.gerfaut", "\u{e9}".repeat(200))
        );
        assert_eq!(bare_file_name(&"b".repeat(400), "x"), "b".repeat(200));
        // A tail too long to be an extension is part of the stem.
        let odd = format!("a.{}", "x".repeat(300));
        assert_eq!(bare_file_name(&odd, "x").chars().count(), 200);
        // Short names pass untouched.
        assert_eq!(
            bare_file_name("wallet-transactions.csv", "x"),
            "wallet-transactions.csv"
        );
    }

    // --- the lock guard ---------------------------------------------
    //
    // The curtain falls in two places and they have to agree: the
    // webview stops drawing, and the vault stops answering. These cover
    // the second one, which is the one anything reaching the bridge
    // gets to skip when it is not there.

    use std::sync::atomic::AtomicBool;

    use gerfaut_core::WalletManager;
    use gerfaut_core::lock::LockKind;
    use gerfaut_core::network::Network;
    use gerfaut_core::premium::PremiumState;
    use gerfaut_core::store::VaultKey;

    use super::AppState;

    /// A vault with a PIN on it, shut the way the app starts it.
    fn locked_state(dir: &std::path::Path) -> (AppState, tokio::runtime::Runtime) {
        let manager = WalletManager::open(dir, VaultKey::Raw([9u8; 32])).unwrap();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime
            .block_on(manager.set_app_lock(LockKind::Pin, "246813", None))
            .unwrap();
        let locked = runtime.block_on(manager.app_lock()).is_some();
        (
            AppState {
                manager,
                locked: AtomicBool::new(locked),
            },
            runtime,
        )
    }

    #[test]
    fn a_vault_with_a_lock_opens_shut_and_only_a_secret_opens_it() {
        let dir = tempfile::tempdir().unwrap();
        let (state, runtime) = locked_state(dir.path());

        // Shut on arrival, under the kind the screen reads it by.
        assert_eq!(state.unlocked().unwrap_err().kind, "locked");

        // A wrong secret changes nothing.
        let verdict = runtime
            .block_on(super::verify_lock(&state, "000000"))
            .unwrap();
        assert!(!verdict.unlocked);
        assert!(state.unlocked().is_err());

        // The right one opens it.
        let verdict = runtime
            .block_on(super::verify_lock(&state, "246813"))
            .unwrap();
        assert!(verdict.unlocked);
        assert!(state.unlocked().is_ok());

        // And Ctrl+L shuts it again.
        runtime.block_on(super::lock_vault(&state)).unwrap();
        assert_eq!(state.unlocked().unwrap_err().kind, "locked");
    }

    /// Shutting a vault with no lock on it would leave no secret to
    /// come back with: the window would have to be closed.
    #[test]
    fn a_vault_with_no_lock_cannot_be_shut() {
        let dir = tempfile::tempdir().unwrap();
        let manager = WalletManager::open(dir.path(), VaultKey::Raw([9u8; 32])).unwrap();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let state = AppState {
            manager,
            locked: AtomicBool::new(false),
        };

        runtime.block_on(super::lock_vault(&state)).unwrap();
        assert!(state.unlocked().is_ok());
    }

    /// Behind the lock the settings answer the theme and the kind of
    /// secret to ask for. A backend, an accepted certificate, an
    /// account key or the last transactions broadcast, sitting in the
    /// webview's cache, are there to be read.
    #[test]
    fn the_settings_read_behind_the_lock_carry_nothing_of_the_vault() {
        let dir = tempfile::tempdir().unwrap();
        let (state, runtime) = locked_state(dir.path());
        let pref = |key: &str, value: &str| {
            runtime
                .block_on(state.manager.set_app_pref(key.to_owned(), value.to_owned()))
                .unwrap();
        };
        pref("desktop.theme", "dark");
        pref("onboarding.seen", "1");
        pref("broadcast.recent", "[{\"txid\":\"ab\"}]");
        runtime
            .block_on(state.manager.set_active_network(Network::Signet))
            .unwrap();
        runtime
            .block_on(state.manager.set_premium_state(PremiumState {
                key: Some("abcdefghijkmnpqr".to_owned()),
                ..PremiumState::default()
            }))
            .unwrap();
        runtime
            .block_on(
                state
                    .manager
                    .trust_certificate("ssl://node.example:50002", &["AB"; 32].join(":")),
            )
            .unwrap();

        let shut = runtime.block_on(super::settings_of(&state));
        assert_eq!(
            shut.app_prefs.get("desktop.theme").map(String::as_str),
            Some("dark")
        );
        // The welcome tour is shown once, not at every unlock: without
        // this the app reopens on a vault that looks empty and untoured.
        assert_eq!(
            shut.app_prefs.get("onboarding.seen").map(String::as_str),
            Some("1")
        );
        assert_eq!(shut.app_prefs.len(), 2, "{:?}", shut.app_prefs);
        // And the network is the vault's own, not the default: answering
        // mainnet here sends the app to ask the open vault for mainnet
        // wallets it does not have.
        assert_eq!(shut.active_network, Network::Signet);
        assert_eq!(shut.app_lock.map(|lock| lock.kind), Some(LockKind::Pin));
        assert!(shut.backends.is_empty());
        assert!(shut.electrum_certs.is_empty());
        assert_eq!(shut.premium, PremiumState::default());

        // And in full once a secret went through.
        runtime
            .block_on(super::verify_lock(&state, "246813"))
            .unwrap();
        let open = runtime.block_on(super::settings_of(&state));
        assert_eq!(open.premium.key.as_deref(), Some("abcdefghijkmnpqr"));
        assert_eq!(open.electrum_certs.len(), 1);
        assert!(open.app_prefs.contains_key("broadcast.recent"));
    }

    /// The guard is one line at the top of a function: the day a command
    /// is added without it, this is the only thing that notices.
    ///
    /// Four commands answer behind the lock, and only four: the two that
    /// read the lock itself, the one that draws it, and the settings,
    /// which go through the redaction above instead.
    #[test]
    fn every_command_that_reaches_the_vault_begins_with_the_guard() {
        const PASSES_LOCKED: [&str; 4] =
            ["app_lock", "verify_app_lock", "lock_app", "get_settings"];
        let sources = [
            ("lib.rs", include_str!("lib.rs")),
            ("premium.rs", include_str!("premium.rs")),
        ];

        let mut checked = 0;
        for (file, source) in sources {
            let lines: Vec<&str> = source.lines().collect();
            for (index, line) in lines.iter().enumerate() {
                let Some(rest) = line
                    .strip_prefix("pub async fn ")
                    .or_else(|| line.strip_prefix("async fn "))
                else {
                    continue;
                };
                let name = rest.split('(').next().unwrap_or_default();
                // Commands only. The plain helpers next to them take a
                // `&AppState` and are called from a guarded command.
                let command = lines[..index]
                    .iter()
                    .rev()
                    .take_while(|above| {
                        let above = above.trim_start();
                        above.starts_with("///")
                            || above.starts_with("//")
                            || above.starts_with("#[")
                    })
                    .any(|above| above.trim() == "#[tauri::command]");
                if !command {
                    continue;
                }
                // The body opens at the first line ending in `{`.
                let Some(offset) = lines[index..]
                    .iter()
                    .position(|line| line.trim_end().ends_with('{'))
                else {
                    continue;
                };
                let body = index + offset;
                // A command handed no state never reaches the vault.
                if !lines[index..=body]
                    .iter()
                    .any(|line| line.contains("tauri::State<'_, AppState>"))
                {
                    continue;
                }
                checked += 1;
                let guarded = lines[body + 1].trim() == "state.unlocked()?;";
                assert_eq!(
                    guarded,
                    !PASSES_LOCKED.contains(&name),
                    "{file}: {name} reaches the vault, so it begins with \
                     `state.unlocked()?;` unless it is one of {PASSES_LOCKED:?}"
                );
            }
        }
        // A count, so an empty scan cannot pass for a clean one.
        assert!(checked >= 50, "only {checked} commands scanned");
    }
}
