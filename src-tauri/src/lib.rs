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
use gerfaut_core::error::CoreError;
use gerfaut_core::input::qr::{QrProgress, QrScans};
use gerfaut_core::input::{DerivationChoice, ImportOptions, ParsedInput, ScriptKind};
use gerfaut_core::lock::{AppLock, LockKind, LockVerdict};
use gerfaut_core::manager::SyncAllReport;
use gerfaut_core::network::Network;
use gerfaut_core::prefs::{Preferences, PreferencesChange};
use gerfaut_core::store::{Settings, VaultKey};
use gerfaut_core::wallet::meta::{WalletIcon, WalletMeta};
use gerfaut_core::wallet::policy::PolicySnapshot;
use gerfaut_core::wallet::snapshot::{
    AddressEntry, AddressList, SyncReport, TxDetail, UtxoInfo, WalletSnapshot,
};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, FileDialogBuilder};

mod clipboard;
mod live;
// Compiled on Linux for its tests too, where nothing else calls it.
#[cfg(any(target_os = "macos", all(unix, test)))]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod single_instance;
#[cfg(any(windows, test))]
mod toast;

/// Error shape every command returns; the frontend matches on `kind`.
#[derive(Debug, Clone, Serialize)]
pub struct CommandError {
    pub kind: &'static str,
    pub message: String,
}

impl CommandError {
    pub(crate) fn new(kind: &'static str, message: impl Into<String>) -> Self {
        CommandError {
            kind,
            message: message.into(),
        }
    }
}

/// The core names its failures, and the name goes through as it is:
/// the screens decide on it, the way the Android app does on the same
/// name.
impl From<CoreError> for CommandError {
    fn from(error: CoreError) -> Self {
        CommandError::new(error.code().as_str(), error.to_string())
    }
}

pub(crate) type CommandResult<T> = Result<T, CommandError>;

fn internal(message: String) -> CommandError {
    CommandError::new("internal", message)
}

pub(crate) struct AppState {
    pub(crate) manager: WalletManager,
    /// Whether the lock screen stands in front of the vault.
    ///
    /// The curtain used to be drawn in the webview alone: every command
    /// still answered behind it, so anything that reached the bridge —
    /// a renderer gone wrong, a page left open on a screen nobody
    /// watches — read descriptors, balances and addresses out of
    /// a locked app. Set here at startup from the lock the vault holds,
    /// raised again by [`lock_app`], and taken down by one thing only:
    /// a secret the core verified.
    pub(crate) locked: AtomicBool,
    /// The live watch and what it posts. It runs on this side, behind
    /// the lock included: see [`live`].
    pub(crate) live: live::LiveAlerts,
}

impl AppState {
    /// The line every command that reads or writes the vault begins
    /// with. Four pass: the two that read the lock itself, the one that
    /// draws it, and the settings, redacted to what the lock screen is
    /// painted with.
    pub(crate) fn unlocked(&self) -> CommandResult<()> {
        if self.locked.load(Ordering::SeqCst) {
            return Err(CommandError::new("locked", "Gerfaut is locked."));
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

/// Writes a file the person asked for in a save dialog: a transaction
/// history, a sealed backup. Under the core's rule for every file about
/// the wallets: on Unix a file created here is theirs alone, where the
/// usual umask would have let every account of the machine read it, and
/// a file it replaces keeps the mode it had, which is the person's
/// choice.
fn write_owner_only(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    gerfaut_core::store::owner_only(
        std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true),
    )
    .open(path)?
    .write_all(bytes)
}

/// Closes the vault's directory to other accounts on Unix. The core
/// creates it that way, but the webview, or an earlier build, may have
/// made it first with the usual mode, and the directory is the app's
/// own: its data directory, or in a development build the one
/// `GERFAUT_DATA_DIR` names for a test instance.
#[cfg(unix)]
fn restrict_data_dir(dir: &std::path::Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mode = std::fs::metadata(dir)?.permissions().mode();
    if mode & 0o077 != 0 {
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(mode & 0o700))?;
    }
    Ok(())
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
/// `network` is the one the wallet is about to be added on, which the
/// first address shown is derived for.
///
/// On a worker thread, like [`assemble_qr`]: a synchronous command runs
/// on the main thread, which also draws the window, and the input is
/// whatever was pasted, a file of 64 KiB or a descriptor of a hundred
/// keys among it. Reading it there froze the window for as long as the
/// core took, and a panic in the parser took the whole app down.
#[tauri::command]
async fn parse_input(
    input: String,
    script: Option<ScriptKind>,
    derivation: Option<DerivationChoice>,
    network: Option<Network>,
) -> CommandResult<ParsedInput> {
    let options = ImportOptions {
        script,
        derivation,
        network,
    };
    tauri::async_runtime::spawn_blocking(move || {
        gerfaut_core::input::parse_input_with_options(&input, &options)
    })
    .await
    .map_err(|e| internal(format!("the input could not be read: {e}")))?
    .map_err(CommandError::from)
}

/// Reads a server address scanned or pasted into the backend settings:
/// the Electrum one-liner `host:port:s|t`, an `ssl://`/`tcp://` address,
/// or an `http(s)://` Esplora endpoint. On a worker thread, for the
/// same reason as [`parse_input`].
#[tauri::command]
async fn parse_backend(input: String) -> CommandResult<ScannedBackend> {
    tauri::async_runtime::spawn_blocking(move || {
        gerfaut_core::chain::connect::parse_backend(&input)
    })
    .await
    .map_err(|e| internal(format!("the address could not be read: {e}")))?
    .map_err(CommandError::from)
}

/// Assembles the QR frames scanned so far (plain, UR, BBQr). The core
/// decodes every frame again at each call, and a synchronous command
/// runs on the main thread: a code of a hundred parts made the window
/// stutter while it was scanned. On a worker thread instead. The
/// scanner itself sends each frame once to a scan the core holds
/// ([`push_qr_frame`]); this one stays for scripts and tests.
#[tauri::command]
async fn assemble_qr(frames: Vec<String>) -> CommandResult<QrProgress> {
    tauri::async_runtime::spawn_blocking(move || gerfaut_core::input::qr::assemble(&frames))
        .await
        .map_err(|e| internal(format!("the QR assembly did not finish: {e}")))?
        .map_err(CommandError::from)
}

/// Opens a scan the core holds while the scanner is open, and gives the
/// number its frames go under. The core bounds how many stay open, and
/// lets the oldest go past them: on a worker thread, like
/// [`close_qr_scan`].
#[tauri::command]
async fn open_qr_scan(scans: tauri::State<'_, Arc<QrScans>>) -> CommandResult<u32> {
    let scans = Arc::clone(&scans);
    tauri::async_runtime::spawn_blocking(move || scans.open())
        .await
        .map_err(|e| internal(format!("the QR scan did not open: {e}")))
}

/// One new frame of an open scan; where the scan stands after it, as
/// [`assemble_qr`] says of every frame so far. On a worker thread, for
/// the reason given there.
#[tauri::command]
async fn push_qr_frame(
    scans: tauri::State<'_, Arc<QrScans>>,
    scan: u32,
    frame: String,
) -> CommandResult<QrProgress> {
    push_frame(Arc::clone(&scans), scan, frame).await
}

async fn push_frame(scans: Arc<QrScans>, scan: u32, frame: String) -> CommandResult<QrProgress> {
    tauri::async_runtime::spawn_blocking(move || scans.push(scan, &frame))
        .await
        .map_err(|e| internal(format!("the QR assembly did not finish: {e}")))?
        .map_err(CommandError::from)
}

/// Lets the core drop a scan: the scanner closed, done or not. On a
/// worker thread: what a long animated scan held, tens of megabytes of
/// fountain-code state, is freed there, never on the main thread.
#[tauri::command]
async fn close_qr_scan(scans: tauri::State<'_, Arc<QrScans>>, scan: u32) -> CommandResult<()> {
    let scans = Arc::clone(&scans);
    tauri::async_runtime::spawn_blocking(move || scans.close(scan))
        .await
        .map_err(|e| internal(format!("the QR scan did not close: {e}")))
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

/// The furthest the Receive page looks past the next unused address,
/// the most the core hands out in one call. Skipping past the gap limit
/// already warns: this only keeps a window gone wrong from asking for
/// more than the core would give.
const MAX_LOOKAHEAD: u32 = 200;

/// The next unused address and the `lookahead` after it, within
/// [`MAX_LOOKAHEAD`].
#[tauri::command]
async fn receive_addresses(
    state: tauri::State<'_, AppState>,
    id: String,
    lookahead: u32,
) -> CommandResult<Vec<AddressEntry>> {
    state.unlocked()?;
    Ok(state
        .manager
        .receive_addresses(&id, lookahead.min(MAX_LOOKAHEAD))
        .await?)
}

/// A sync asked for by hand. What it found is claimed and announced
/// from here, through the record the live watch uses, so nothing is
/// said twice.
#[tauri::command]
async fn sync_wallet(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    id: String,
) -> CommandResult<SyncReport> {
    state.unlocked()?;
    let report = state.manager.sync_wallet(&id).await?;
    live::announce_report(&app, &report).await;
    Ok(report)
}

/// Scans a wallet again from its first address with the current gap
/// limit, for funds an incremental sync can no longer see.
#[tauri::command]
async fn rescan_wallet(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    id: String,
) -> CommandResult<SyncReport> {
    state.unlocked()?;
    let report = state.manager.rescan_wallet(&id).await?;
    live::announce_report(&app, &report).await;
    Ok(report)
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
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    network: Option<Network>,
) -> CommandResult<SyncAllReport> {
    state.unlocked()?;
    let all = state.manager.sync_all(network).await;
    for report in &all.reports {
        live::announce_report(&app, report).await;
    }
    Ok(all)
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

#[tauri::command]
async fn remove_wallet(state: tauri::State<'_, AppState>, id: String) -> CommandResult<()> {
    state.unlocked()?;
    Ok(state.manager.remove_wallet(&id).await?)
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

/// Pins a wallet to the live watch, or unpins it: when the watch cannot
/// follow every address, the pinned wallets are followed first. The core
/// hands a running watch its new list itself.
#[tauri::command]
async fn set_wallet_live_pinned(
    state: tauri::State<'_, AppState>,
    id: String,
    pinned: bool,
) -> CommandResult<()> {
    state.unlocked()?;
    Ok(state.manager.set_wallet_live_pinned(&id, pinned).await?)
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
/// of secret it must ask for. No backend, no accepted certificate —
/// none of it is read until someone comes back, and a copy sitting in
/// the webview's cache is a copy that can be read.
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
/// say what the shell remembers — the sidebar, the range of the price
/// chart — and wait for the unlock: the shared preferences read as
/// their defaults until then.
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

/// Writes one preference of this app alone: the theme, the sidebar.
#[tauri::command]
async fn set_app_pref(
    state: tauri::State<'_, AppState>,
    key: String,
    value: String,
) -> CommandResult<()> {
    state.unlocked()?;
    Ok(state.manager.set_app_pref(key, value).await?)
}

/// Changes some of the preferences both apps keep, and answers them all
/// as stored. A change of the alerts starts or stops the live watch in
/// the same breath, so the window has no second call to forget.
#[tauri::command]
async fn set_preferences(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    change: PreferencesChange,
) -> CommandResult<Preferences> {
    state.unlocked()?;
    let stored = state.manager.set_preferences(change).await?;
    if change.notify_new_tx.is_some() {
        live::apply(&app).await;
    }
    Ok(stored)
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
    write_owner_only(&path, result.csv.as_bytes())
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

/// The last transactions broadcast on this network, newest first, as
/// the vault keeps them.
#[tauri::command]
async fn recent_broadcasts(
    state: tauri::State<'_, AppState>,
    network: Network,
) -> CommandResult<Vec<gerfaut_core::broadcast::RecentBroadcast>> {
    state.unlocked()?;
    Ok(state.manager.recent_broadcasts(network).await)
}

/// Drops the vault's record of a broadcast; the transaction itself is
/// on the network and untouched.
#[tauri::command]
async fn forget_broadcast(state: tauri::State<'_, AppState>, txid: String) -> CommandResult<()> {
    state.unlocked()?;
    Ok(state.manager.forget_broadcast(&txid).await?)
}

/// The public servers offered for a network, in settings order.
#[tauri::command]
fn public_servers(network: Network) -> Vec<gerfaut_core::chain::public::PublicServer> {
    gerfaut_core::chain::public::public_servers(network)
}

/// The currencies and price sources the settings offer, and how often
/// the price is asked. A fixed table: it only changes with the core.
#[tauri::command]
fn price_table() -> gerfaut_core::price::PriceTable {
    gerfaut_core::price::price_table()
}

/// The current BTC price, in the currency and from the source of the
/// preferences. By the route the syncs take: through Tor when a backend
/// is an onion address, and not at all when Tor is required and cannot
/// be had. That case answers `tor`.
#[tauri::command]
async fn fetch_price(
    state: tauri::State<'_, AppState>,
) -> CommandResult<gerfaut_core::price::PriceQuote> {
    state.unlocked()?;
    Ok(state.manager.fetch_price().await?)
}

/// A BTC price series, by the same preferences and the same route as
/// [`fetch_price`].
#[tauri::command]
async fn fetch_price_history(
    state: tauri::State<'_, AppState>,
    range: gerfaut_core::price::PriceRange,
) -> CommandResult<gerfaut_core::price::PriceHistory> {
    state.unlocked()?;
    Ok(state.manager.fetch_price_history(range).await?)
}

/// The repository whose releases the app compares itself with.
const RELEASES_REPO: &str = "gerfaut-wallet/gerfaut-desktop";

/// The version this build runs, the one the core compares releases with.
fn running_version(app: &tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

/// What to say about releases, as the core decides it. Reads only.
#[tauri::command]
async fn update_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> CommandResult<gerfaut_core::updates::UpdateStatus> {
    state.unlocked()?;
    Ok(state.manager.update_status(&running_version(&app)).await)
}

/// The window is unlocked and on its way: the core asks for the latest
/// release if a check is due, and says what to announce. Never behind
/// the lock, which refuses it here.
#[tauri::command]
async fn update_session(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> CommandResult<gerfaut_core::updates::UpdateStatus> {
    state.unlocked()?;
    Ok(state
        .manager
        .update_session(RELEASES_REPO, &running_version(&app))
        .await)
}

/// Asks for the latest release now, by the route the syncs take:
/// through Tor when a backend is an onion address, and not at all when
/// Tor is required and cannot be had. That case answers `tor`, which
/// the screen words apart from "could not check".
#[tauri::command]
async fn check_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> CommandResult<gerfaut_core::updates::UpdateStatus> {
    state.unlocked()?;
    Ok(state
        .manager
        .check_update(RELEASES_REPO, &running_version(&app))
        .await?)
}

/// Closes the notice on the release it announced.
#[tauri::command]
async fn dismiss_update(state: tauri::State<'_, AppState>, version: String) -> CommandResult<()> {
    state.unlocked()?;
    Ok(state.manager.dismiss_update(&version).await?)
}

/// Turns the daily check on or off.
#[tauri::command]
async fn set_update_automatic(
    state: tauri::State<'_, AppState>,
    automatic: bool,
) -> CommandResult<()> {
    state.unlocked()?;
    Ok(state.manager.set_update_automatic(automatic).await?)
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
/// closed instead. Behind the lock no dialog opens: nothing a locked
/// app does asks the person to pick a file.
#[tauri::command]
async fn save_backup_file(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    data: String,
    suggested_name: String,
) -> CommandResult<bool> {
    state.unlocked()?;
    let bytes = gerfaut_core::backup::decode_source(&data)?;
    let dialog = file_dialog(&app)
        .add_filter("Gerfaut backup", &["gerfaut"])
        .set_file_name(bare_file_name(&suggested_name, "gerfaut-backup.gerfaut"));
    let Some(path) = show_dialog(dialog, DialogKind::Save).await? else {
        return Ok(false);
    };
    write_owner_only(&path, &bytes)
        .map_err(|e| internal(format!("could not write {}: {e}", path.display())))?;
    Ok(true)
}

/// Asks for a backup file and reads it into the base64 form the core
/// opens. Any file is read; the core says whether it is a backup. The
/// read stops one byte past the largest backup the core accepts, so
/// picking a disc image by mistake costs nothing, and the file is
/// judged by what was read rather than by a size it may have outgrown
/// since. Null when the dialog was closed instead, and nothing opens
/// behind the lock.
#[tauri::command]
async fn pick_backup_file(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> CommandResult<Option<PickedBackup>> {
    state.unlocked()?;
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
        return Err(CommandError::new(
            "invalid_input",
            "this file is far too large to be a Gerfaut backup",
        ));
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
    // A backup carries no preference, so the alerts stay as they were;
    // the backends it may bring, the core's watch follows by itself.
    Ok(state
        .manager
        .import_backup(&source, &password, &choices)
        .await?)
}

// --- vault key ---------------------------------------------------------

const KEYRING_SERVICE: &str = "Gerfaut";
const KEYRING_ACCOUNT: &str = "vault-key";

/// The credential store account that holds the vault key. A development
/// build on a data directory of its own keeps a key of its own there
/// too, so a test instance never reads the key of the vault already on
/// the machine, nor creates it; release builds always use the shipped
/// account.
fn vault_key_account() -> String {
    #[cfg(debug_assertions)]
    if let Some(dir) = std::env::var_os("GERFAUT_DATA_DIR") {
        return isolated_account(&dir);
    }
    KEYRING_ACCOUNT.to_owned()
}

/// The key account of a development build on `dir`: the shipped one,
/// followed by the same suffix as its identifier.
#[cfg(debug_assertions)]
fn isolated_account(dir: &std::ffi::OsStr) -> String {
    format!("{KEYRING_ACCOUNT}.{}", dev_suffix(dir))
}

/// The vault file inside the data directory, as the core names it.
const VAULT_FILE: &str = "gerfaut.vault";

/// Fetches the vault key from the OS credential store, creating and
/// storing a fresh random one on first launch.
fn vault_key(data_dir: &std::path::Path) -> Result<VaultKey, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &vault_key_account())
        .map_err(|e| format!("credential store unavailable: {e}"))?;
    // A vault that cannot be looked at counts as there, as the core
    // has it.
    let vault_present = data_dir.join(VAULT_FILE).try_exists().unwrap_or(true);
    key_from(&entry, vault_present)
}

/// The key `entry` holds, or a fresh one stored there when it holds
/// none and no vault exists yet. With a vault already on disk, a new
/// key could never open it, and would take the place of the right one
/// should the store have answered "none" by mistake: the open fails
/// instead, and the store is left as it was.
fn key_from(entry: &keyring::Entry, vault_present: bool) -> Result<VaultKey, String> {
    match entry.get_password() {
        Ok(stored) => {
            let bytes = data_encoding::HEXLOWER_PERMISSIVE
                .decode(stored.as_bytes())
                .map_err(|_| "stored vault key is not valid hex".to_owned())?;
            let key: [u8; 32] = bytes
                .try_into()
                .map_err(|_| "stored vault key has the wrong length".to_owned())?;
            Ok(VaultKey::Raw(key))
        }
        Err(keyring::Error::NoEntry) if vault_present => Err(
            "the credential store holds no key for the vault already here, and a new key would not open it"
                .to_owned(),
        ),
        Err(keyring::Error::NoEntry) => {
            let mut key = [0u8; 32];
            use rand::RngCore;
            rand::rng().fill_bytes(&mut key);
            entry
                .set_password(&data_encoding::HEXLOWER.encode(&key))
                .map_err(|e| format!("cannot store vault key: {e}"))?;
            Ok(VaultKey::Raw(key))
        }
        Err(e) => Err(format!("cannot read vault key: {e}")),
    }
}

/// Where the vault lives. Development builds honour `GERFAUT_DATA_DIR`
/// so that a test instance never opens the vault of an app already
/// running on the machine; release builds always use the app data dir.
fn data_dir(app: &tauri::AppHandle) -> tauri::Result<std::path::PathBuf> {
    #[cfg(debug_assertions)]
    if let Some(dir) = std::env::var_os("GERFAUT_DATA_DIR") {
        return Ok(std::path::PathBuf::from(dir));
    }
    app.path().app_data_dir()
}

/// Why the vault did not open at startup; `None` once it is open.
///
/// A failed open used to end the app before a window existed, which
/// read as a crash. The window now opens on a screen that says what
/// happened, and [`retry_open`] tries again from there: the usual case
/// is a vault another Gerfaut holds, which the second launch of this
/// build never reaches (it hands over to the first), but two builds
/// under different names on one data directory, or a platform where
/// the hand-over cannot run, still do.
pub(crate) struct Startup(std::sync::Mutex<Option<CommandError>>);

/// Opens the vault and starts what runs beside it. Called at startup,
/// then by [`retry_open`] as long as it has not succeeded.
fn open_vault(app: &tauri::AppHandle) -> CommandResult<()> {
    let data_dir =
        data_dir(app).map_err(|e| internal(format!("no data directory for the vault: {e}")))?;
    let key = vault_key(&data_dir).map_err(|e| CommandError::new("vault", e))?;
    let manager = WalletManager::open(&data_dir, key)?;
    #[cfg(unix)]
    if let Err(error) = restrict_data_dir(&data_dir) {
        eprintln!(
            "gerfaut: the data directory {} stays open to other accounts: {error}",
            data_dir.display()
        );
    }
    // A vault that holds a lock opens shut: the first frame the
    // webview draws is the lock screen, and until a secret goes
    // through, the commands below answer nothing about it.
    let locked = tauri::async_runtime::block_on(manager.app_lock()).is_some();
    app.manage(AppState {
        manager,
        locked: AtomicBool::new(locked),
        live: live::LiveAlerts::default(),
    });
    // The watch starts with the app when the alerts are on,
    // locked or not, and before the opening sync so nothing
    // falls between the two.
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        live::apply(&handle).await;
        live::keep_time(handle).await;
    });
    Ok(())
}

/// What kept the vault shut at startup; null when it opened. The
/// window asks before anything else, and a failure here is the whole
/// screen.
#[tauri::command]
fn startup_failure(startup: tauri::State<'_, Startup>) -> Option<CommandError> {
    startup.0.lock().ok().and_then(|failure| failure.clone())
}

/// Tries the open again, from the screen that said why it failed: the
/// other Gerfaut was closed, the credential store answers now. Nothing
/// happens once the vault is open. Runs on the main thread, like the
/// first open did.
#[tauri::command]
fn retry_open(app: tauri::AppHandle, startup: tauri::State<'_, Startup>) -> CommandResult<()> {
    let mut failure = startup
        .0
        .lock()
        .map_err(|_| internal("the startup state is poisoned".to_owned()))?;
    if failure.is_none() {
        return Ok(());
    }
    let result = open_vault(&app);
    *failure = result.clone().err();
    result
}

/// Keeps the webview on the pages the app ships. Nothing in them goes
/// anywhere else: an outside link opens in the browser, through the
/// opener. A navigation to any other page, a link dropped on the
/// window or one a page of the app was tricked into following, would
/// show that page in the app's own window, where it could pass for the
/// app.
fn navigation_guard<R: tauri::Runtime>(pages: AppPages) -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("navigation-guard")
        .on_navigation(move |_, url| pages.hold(url))
        .build()
}

/// Where the app's own pages are, read once from the configuration.
#[derive(Debug, Clone, PartialEq, Eq)]
struct AppPages {
    /// The scheme the Windows webview serves the embedded pages under,
    /// `http` unless the window sets `useHttpsScheme`. It intercepts
    /// that one only: the other goes to whatever answers on this
    /// machine under the name `tauri.localhost`.
    windows_scheme: &'static str,
    /// The server of the pages under `tauri dev`.
    dev: Option<tauri::Url>,
}

impl AppPages {
    fn of(config: &tauri::Config) -> Self {
        let https = config
            .app
            .windows
            .iter()
            .find(|window| window.label == "main")
            .is_some_and(|window| window.use_https_scheme);
        AppPages {
            windows_scheme: if https { "https" } else { "http" },
            dev: if cfg!(dev) {
                config.build.dev_url.clone()
            } else {
                None
            },
        }
    }

    /// Whether `url` is one of the app's pages: those of the embedded
    /// assets, at `tauri://localhost`, or on Windows at
    /// `tauri.localhost` under the one scheme the webview intercepts;
    /// or the server of the pages under `tauri dev`. Elsewhere
    /// `tauri.localhost` is only a name for this machine, where any
    /// local server may answer.
    fn hold(&self, url: &tauri::Url) -> bool {
        let shipped = match (url.scheme(), url.host_str()) {
            ("tauri", Some("localhost")) => !cfg!(windows),
            (scheme, Some("tauri.localhost")) => {
                cfg!(windows) && scheme == self.windows_scheme && url.port().is_none()
            }
            _ => false,
        };
        shipped
            || self
                .dev
                .as_ref()
                .is_some_and(|dev| dev.origin() == url.origin())
    }
}

/// Brings the window back to the front: unminimised, shown, focused.
/// This is what a second launch asks for, and all it gets.
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// The identifier of a development build on a data directory of its
/// own. One launch per identifier is let through, so under the shipped
/// one a test instance would hand over to the Gerfaut already running
/// and quit; each directory gets an identifier of its own instead, and
/// two launches on the same directory still meet.
#[cfg(debug_assertions)]
fn isolated_identifier(identifier: &str, dir: &std::ffi::OsStr) -> String {
    format!("{identifier}.{}", dev_suffix(dir))
}

/// `dev` and eight hex digits naming a data directory, the same from
/// one build and one toolchain to the next: the vault key of a test
/// instance is filed under it. FNV-1a, since the standard hasher may
/// change between Rust releases.
#[cfg(debug_assertions)]
fn dev_suffix(dir: &std::ffi::OsStr) -> String {
    let hash = dir
        .as_encoded_bytes()
        .iter()
        .fold(0x811c_9dc5_u32, |hash, byte| {
            (hash ^ u32::from(*byte)).wrapping_mul(0x0100_0193)
        });
    format!("dev{hash:08x}")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut context = tauri::generate_context!();
    #[cfg(debug_assertions)]
    if let Some(dir) = std::env::var_os("GERFAUT_DATA_DIR") {
        let config = context.config_mut();
        config.identifier = isolated_identifier(&config.identifier, &dir);
    }
    let pages = AppPages::of(context.config());
    // On macOS, before anything else starts: a second launch leaves
    // before the vault is opened, before a window exists. See
    // `single_instance` for why not the plugin there.
    #[cfg(target_os = "macos")]
    let first = match single_instance::claim(&context.config().identifier) {
        single_instance::Claim::Second => return,
        single_instance::Claim::First(listener) => Some(listener),
        single_instance::Claim::Unavailable => None,
    };
    #[cfg(target_os = "macos")]
    let socket = first.as_ref().map(|listener| listener.path().to_owned());

    let builder = tauri::Builder::default();
    // First, so that a second launch leaves before anything else
    // starts: before the vault is opened, before a window exists. Its
    // arguments and working directory are not read: a launch only ever
    // brings the open window forward.
    #[cfg(not(target_os = "macos"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        show_main_window(app);
    }));
    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(navigation_guard(pages))
        .manage(clipboard::SensitiveClipboard::default())
        .manage(Arc::new(QrScans::default()))
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            if let Some(listener) = first {
                let handle = app.handle().clone();
                listener.serve(move || show_main_window(&handle));
            }
            // A vault that would not open leaves the window to say why,
            // and every command that needs it answers an error until it
            // does: no state is managed for them to reach.
            let failure = open_vault(app.handle()).err();
            if let Some(failure) = &failure {
                eprintln!("gerfaut: the vault did not open: {}", failure.message);
            }
            app.manage(Startup(std::sync::Mutex::new(failure)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            startup_failure,
            retry_open,
            parse_input,
            parse_backend,
            assemble_qr,
            open_qr_scan,
            push_qr_frame,
            close_qr_scan,
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
            recent_broadcasts,
            forget_broadcast,
            sync_wallet,
            rescan_wallet,
            load_more_history,
            sync_all,
            rename_wallet,
            remove_wallet,
            set_wallet_icon,
            set_wallet_live_pinned,
            reorder_wallets,
            get_settings,
            set_active_network,
            set_backend,
            set_gap_limit,
            inspect_certificate,
            trust_certificate,
            forget_certificate,
            set_app_pref,
            set_preferences,
            price_table,
            fetch_price,
            fetch_price_history,
            check_update,
            update_status,
            update_session,
            dismiss_update,
            set_update_automatic,
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
            live::live_status,
            live::live_limits,
            live::send_test_notification,
            clipboard::copy_sensitive
        ])
        .build(context)
        .expect("error while running tauri application")
        .run(move |app, event| {
            // The window is gone: stop the watch, and leave within
            // `live::EXIT_GRACE` whatever is still in flight.
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                live::shutdown(app);
            }
            // A secret copied less than a minute ago does not outlive
            // the app.
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<clipboard::SensitiveClipboard>().expire_now();
                #[cfg(target_os = "macos")]
                if let Some(path) = &socket {
                    single_instance::release(path);
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{
        AppPages, CommandError, assemble_qr, bare_file_name, parse_backend, parse_input, push_frame,
    };
    use gerfaut_core::error::CoreError;

    /// The webview goes to the app's own pages, under the scheme each
    /// platform serves them with, and to the page server in `tauri dev`;
    /// anywhere else is refused, a look-alike host among them.
    #[test]
    fn the_webview_stays_on_the_apps_pages() {
        let url = |text: &str| tauri::Url::parse(text).unwrap();
        let pages = |windows_scheme, dev: Option<&str>| AppPages {
            windows_scheme,
            dev: dev.map(url),
        };
        let shipped = pages("http", None);
        let (held, elsewhere) = if cfg!(windows) {
            (
                vec![
                    "http://tauri.localhost/",
                    "http://tauri.localhost/assets/index.js",
                ],
                vec!["https://tauri.localhost/", "tauri://localhost"],
            )
        } else {
            (
                vec![
                    "tauri://localhost",
                    "tauri://localhost/index.html#/settings",
                ],
                vec!["http://tauri.localhost/", "https://tauri.localhost/"],
            )
        };
        for page in held {
            assert!(shipped.hold(&url(page)), "{page}");
        }
        for page in elsewhere {
            assert!(!shipped.hold(&url(page)), "{page}");
        }
        // Under `useHttpsScheme`, the other scheme of Windows.
        let https = pages("https", None);
        assert_eq!(https.hold(&url("https://tauri.localhost/")), cfg!(windows));
        assert!(!https.hold(&url("http://tauri.localhost/")));
        for page in [
            "http://localhost:1420/",
            "https://mempool.space/",
            "http://tauri.localhost.example.org/",
            "http://tauri.localhost:8080/",
            "tauri://example.org",
            "file:///etc/passwd",
            "data:text/html,<p>hi</p>",
            "about:blank",
        ] {
            assert!(!shipped.hold(&url(page)), "{page}");
        }
        let dev = pages("http", Some("http://localhost:1420"));
        assert!(dev.hold(&url("http://localhost:1420/")));
        assert!(!dev.hold(&url("http://localhost:1421/")));
    }

    /// The configuration of this app: the Windows webview serves its
    /// pages over `http`.
    #[test]
    fn the_shipped_configuration_serves_the_pages_over_http() {
        let config: tauri::Config =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(AppPages::of(&config).windows_scheme, "http");
    }

    /// On Unix a file written from a save dialog is its owner's alone
    /// when it is created, and one it replaces keeps its mode; the
    /// vault's directory is closed to other accounts.
    #[cfg(unix)]
    #[test]
    fn saved_files_and_the_data_directory_are_their_owners_alone() {
        use std::os::unix::fs::PermissionsExt;
        let mode =
            |path: &std::path::Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
        let dir = tempfile::tempdir().unwrap();
        let fresh = dir.path().join("transactions.csv");
        super::write_owner_only(&fresh, b"date,amount\n").unwrap();
        assert_eq!(mode(&fresh), 0o600);
        assert_eq!(std::fs::read(&fresh).unwrap(), b"date,amount\n");

        let theirs = dir.path().join("shared.csv");
        std::fs::write(&theirs, b"a much longer file than the export").unwrap();
        std::fs::set_permissions(&theirs, std::fs::Permissions::from_mode(0o644)).unwrap();
        super::write_owner_only(&theirs, b"short").unwrap();
        assert_eq!(mode(&theirs), 0o644);
        assert_eq!(std::fs::read(&theirs).unwrap(), b"short");

        let data = dir.path().join("data");
        std::fs::create_dir(&data).unwrap();
        std::fs::set_permissions(&data, std::fs::Permissions::from_mode(0o755)).unwrap();
        super::restrict_data_dir(&data).unwrap();
        assert_eq!(mode(&data), 0o700);
    }

    /// Pasted material and a server address are read off the main
    /// thread and answer as before; what the core refuses comes back
    /// in its words, a descriptor miniscript would have panicked on
    /// among it.
    #[test]
    fn pasted_text_is_read_on_a_worker() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let address = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";
        let parsed = runtime
            .block_on(parse_input(address.to_owned(), None, None, None))
            .unwrap();
        assert!(
            parsed
                .networks
                .contains(&gerfaut_core::network::Network::Signet)
        );
        let hardened = "wpkh(tpubDDnGNapGEY6AZAdQbfRJgMg9fvz8pUBrLwvyvUqEgcUfgzM6zc2eVK4vY9x9L5FJWdX8WumXuLEDV5zDZnTfbn87vLe9XceCFwTu9so9Kks/84h/0/*)";
        let refused = runtime
            .block_on(parse_input(hardened.to_owned(), None, None, None))
            .unwrap_err();
        assert_eq!(refused.kind, "invalid_input");
        assert!(
            refused.message.contains("key origin"),
            "{}",
            refused.message
        );

        let backend = runtime
            .block_on(parse_backend("node.example.org:50002:s".to_owned()))
            .unwrap();
        assert_eq!(backend.url, "ssl://node.example.org:50002");
        let refused = runtime
            .block_on(parse_backend(format!("ssl://{address}:50002")))
            .unwrap_err();
        assert_eq!(refused.kind, "invalid_input");
    }

    /// The assembly runs off the main thread and answers as before.
    #[test]
    fn a_scanned_frame_is_assembled_on_a_worker() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let plain = runtime
            .block_on(assemble_qr(vec![
                "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx".to_owned(),
            ]))
            .unwrap();
        assert!(plain.complete);
        assert_eq!(
            plain.text.as_deref(),
            Some("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx")
        );
        let refused = runtime.block_on(assemble_qr(Vec::new())).unwrap_err();
        assert_eq!(refused.kind, "invalid_input");
    }

    /// A scan the core holds takes one frame at a time, off the main
    /// thread, and answers what the assembly of every frame does; a
    /// scan closed takes none.
    #[test]
    fn a_held_scan_takes_one_frame_at_a_time() {
        use gerfaut_core::input::qr::QrScans;
        use std::sync::Arc;

        let runtime = tokio::runtime::Runtime::new().unwrap();
        let scans = Arc::new(QrScans::default());
        let scan = scans.open();
        let frame = |text: &str| push_frame(Arc::clone(&scans), scan, text.to_owned());
        // Two parts of a BBQr of hex text, "ab" and "cd".
        let first = runtime.block_on(frame("B$HU02006162")).unwrap();
        assert_eq!((first.received, first.total, first.complete), (1, 2, false));
        let done = runtime.block_on(frame("B$HU02016364")).unwrap();
        assert_eq!(done.text.as_deref(), Some("abcd"));
        assert_eq!(
            runtime
                .block_on(assemble_qr(vec![
                    "B$HU02006162".to_owned(),
                    "B$HU02016364".to_owned()
                ]))
                .unwrap(),
            done
        );
        scans.close(scan);
        let refused = runtime.block_on(frame("B$HU02006162")).unwrap_err();
        assert_eq!(refused.kind, "invalid_input");
        assert_eq!(scans.open_count(), 0);
    }

    /// A failure crosses in the form the core writes down for both
    /// bridges, `CoreError.json` of its reference files in the
    /// gerfaut-core checkout beside this repository: the code as `kind`
    /// and the error's words as `message`, nothing else.
    #[test]
    fn a_failure_crosses_in_the_form_the_core_writes_down() {
        use serde_json::Value;

        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../gerfaut-core/tests/bridge/CoreError.json"
        );
        let text = std::fs::read_to_string(path).expect("gerfaut-core beside this repository");
        let cases: Value = serde_json::from_str(&text).expect("the reference file is JSON");
        let keys = |value: &Value| -> Vec<String> {
            let mut keys: Vec<String> = value
                .as_object()
                .expect("an object")
                .keys()
                .cloned()
                .collect();
            keys.sort();
            keys
        };
        let sent = serde_json::to_value(CommandError::from(CoreError::WalletNotFound(
            "w1".to_owned(),
        )))
        .expect("a failure serializes");
        let case = &cases["wallet_not_found"];
        assert_eq!(keys(&sent), keys(case));
        assert_eq!(sent["kind"], case["kind"]);
    }

    /// The code the core gives is the kind the screens read, unchanged,
    /// with the core's words beside it. A wrong password, a file that
    /// is not a backup and one a newer Gerfaut wrote arrive under three
    /// kinds, so the screen says "wrong password" for the first and for
    /// nothing else.
    #[test]
    fn the_core_code_goes_through_as_the_kind() {
        use gerfaut_core::error::VaultError;

        let relayed = |error: CoreError| {
            let code = error.code().as_str();
            let words = error.to_string();
            let relayed = CommandError::from(error);
            assert_eq!(relayed.kind, code);
            assert_eq!(relayed.message, words);
            relayed.kind
        };
        assert_eq!(
            relayed(CoreError::Vault(VaultError::WrongKeyOrCorrupted)),
            "wrong_key"
        );
        assert_eq!(
            relayed(CoreError::UnreadableBackup(
                "this is not a Gerfaut backup".to_owned()
            )),
            "unreadable_backup"
        );
        assert_eq!(
            relayed(CoreError::NewerBackup(
                "this backup was written by a newer Gerfaut (backup version 2)".to_owned()
            )),
            "newer_format"
        );
        assert_eq!(
            relayed(CoreError::Vault(VaultError::UnsupportedVersion(9))),
            "newer_format"
        );
        assert_eq!(
            relayed(CoreError::Vault(VaultError::AlreadyOpen)),
            "vault_in_use"
        );
        assert_eq!(relayed(CoreError::TooManyParts(6_000)), "too_many_parts");
    }

    /// A test instance on its own directory is an app of its own, and
    /// two launches on the same directory are still one.
    #[cfg(debug_assertions)]
    #[test]
    fn each_data_directory_gets_an_identifier_of_its_own() {
        use super::isolated_identifier;
        use std::ffi::OsStr;

        let shipped = "com.gerfautwallet.gerfaut";
        let one = isolated_identifier(shipped, OsStr::new("C:\\scratch\\one"));
        let again = isolated_identifier(shipped, OsStr::new("C:\\scratch\\one"));
        let two = isolated_identifier(shipped, OsStr::new("C:\\scratch\\two"));
        assert_eq!(one, again);
        assert_ne!(one, two);
        assert_ne!(one, shipped);
        // Still a reverse-domain name whose last label starts with a
        // letter, which the D-Bus name on Linux requires.
        let last = one.strip_prefix("com.gerfautwallet.gerfaut.").unwrap();
        assert!(last.starts_with("dev"), "{one}");
        assert!(last.chars().all(|c| c.is_ascii_alphanumeric()), "{one}");
    }

    /// A test instance on its own directory files its vault key apart
    /// from the shipped one, under the suffix of its identifier, and
    /// finds it again at the next launch on the same directory.
    #[cfg(debug_assertions)]
    #[test]
    fn each_data_directory_keeps_a_vault_key_of_its_own() {
        use super::{KEYRING_ACCOUNT, dev_suffix, isolated_account, isolated_identifier};
        use std::ffi::OsStr;

        let dir = OsStr::new("C:\\scratch\\one");
        let one = isolated_account(dir);
        assert_ne!(one, KEYRING_ACCOUNT);
        assert_eq!(one, isolated_account(OsStr::new("C:\\scratch\\one")));
        assert_ne!(one, isolated_account(OsStr::new("C:\\scratch\\two")));
        let suffix = dev_suffix(dir);
        assert_eq!(one, format!("vault-key.{suffix}"));
        assert!(isolated_identifier("com.gerfautwallet.gerfaut", dir).ends_with(&suffix));
        // FNV-1a, pinned: a toolchain update must not lose the key of a
        // test vault.
        assert_eq!(dev_suffix(OsStr::new("a")), "deve40c292c");
    }

    /// A store in memory, the OS one left alone.
    fn mock_entry() -> keyring::Entry {
        keyring::Entry::new_with_credential(Box::new(keyring::mock::MockCredential::default()))
    }

    /// The first launch stores a key, and the next one reads it back.
    #[test]
    fn a_vault_key_is_made_once_before_any_vault() {
        use gerfaut_core::store::VaultKey;
        let entry = mock_entry();
        let VaultKey::Raw(made) = super::key_from(&entry, false).unwrap() else {
            panic!("a raw key");
        };
        let VaultKey::Raw(read) = super::key_from(&entry, true).unwrap() else {
            panic!("a raw key");
        };
        assert_eq!(made, read);
    }

    /// A store that holds no key beside a vault already on disk gets
    /// none: a new one would never open that vault, and would take the
    /// place of the right one had the store answered "none" by mistake.
    #[test]
    fn no_new_vault_key_is_stored_beside_an_existing_vault() {
        let entry = mock_entry();
        let refused = super::key_from(&entry, true).err().expect("refused");
        assert!(refused.contains("no key"), "{refused}");
        assert!(matches!(entry.get_password(), Err(keyring::Error::NoEntry)));
    }

    /// The vault file is looked for under the name the core gives it.
    #[test]
    fn the_vault_file_is_named_as_the_core_names_it() {
        let dir = tempfile::tempdir().unwrap();
        let _manager = gerfaut_core::WalletManager::open(
            dir.path(),
            gerfaut_core::store::VaultKey::Raw([7; 32]),
        )
        .unwrap();
        assert!(dir.path().join(super::VAULT_FILE).is_file());
    }

    /// A vault another Gerfaut holds has a kind of its own, so the
    /// window says to switch to the other one rather than that the
    /// vault is broken.
    #[test]
    fn a_vault_another_gerfaut_holds_is_named_for_the_screen() {
        let dir = tempfile::tempdir().unwrap();
        let _first = gerfaut_core::WalletManager::open(
            dir.path(),
            gerfaut_core::store::VaultKey::Raw([9; 32]),
        )
        .unwrap();
        let second = gerfaut_core::WalletManager::open(
            dir.path(),
            gerfaut_core::store::VaultKey::Raw([9; 32]),
        )
        .err()
        .expect("the vault is held");
        assert_eq!(CommandError::from(second).kind, "vault_in_use");
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
    use gerfaut_core::prefs::{Preferences, PreferencesChange};
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
                live: crate::live::LiveAlerts::default(),
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
            live: crate::live::LiveAlerts::default(),
        };

        runtime.block_on(super::lock_vault(&state)).unwrap();
        assert!(state.unlocked().is_ok());
    }

    /// Behind the lock the settings answer the theme and the kind of
    /// secret to ask for. A backend, an accepted certificate or another
    /// preference, sitting in the webview's cache, are there to be
    /// read.
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
        pref("desktop.sidebar", "collapsed");
        let shared = runtime
            .block_on(state.manager.set_preferences(PreferencesChange {
                masked: Some(true),
                fiat: Some(true),
                ..PreferencesChange::default()
            }))
            .unwrap();
        runtime
            .block_on(state.manager.set_active_network(Network::Signet))
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
        assert_eq!(shut.preferences, Preferences::default());

        // And in full once a secret went through.
        runtime
            .block_on(super::verify_lock(&state, "246813"))
            .unwrap();
        let open = runtime.block_on(super::settings_of(&state));
        assert_eq!(open.electrum_certs.len(), 1);
        assert!(open.app_prefs.contains_key("desktop.sidebar"));
        assert_eq!(open.preferences, shared);
    }

    /// The network the redacted settings name is the one the wallets
    /// are on. The app asks for that network's wallets the moment a
    /// secret goes through; a default answer for a signet vault sent it
    /// after mainnet wallets it does not have, and drew it empty.
    #[test]
    fn the_network_read_behind_the_lock_is_the_one_the_wallets_are_on() {
        use gerfaut_core::input::ImportOptions;

        let dir = tempfile::tempdir().unwrap();
        let (state, runtime) = locked_state(dir.path());
        // The BIP 173 example address: public, and valid on signet.
        let parsed = gerfaut_core::input::parse_input_with_options(
            "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
            &ImportOptions::default(),
        )
        .unwrap();
        runtime
            .block_on(state.manager.set_active_network(Network::Signet))
            .unwrap();
        runtime
            .block_on(
                state
                    .manager
                    .add_wallet("Cold storage", &parsed, Network::Signet),
            )
            .unwrap();

        let shut = runtime.block_on(super::settings_of(&state));
        assert_eq!(shut.active_network, Network::Signet);

        runtime
            .block_on(super::verify_lock(&state, "246813"))
            .unwrap();
        let found = runtime.block_on(state.manager.list_wallets(Some(shut.active_network)));
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].network, Network::Signet);
        // What a default answer would have sent the app after.
        assert!(
            runtime
                .block_on(state.manager.list_wallets(Some(Network::Mainnet)))
                .is_empty()
        );
    }

    /// Every sync leaves what it found in the vault until someone claims
    /// it, and whoever runs a sync is the one who claims. A command that
    /// syncs and does not claim leaves a payment unsaid until the next
    /// sync of that wallet, and this is the only thing that notices.
    #[test]
    fn every_command_that_syncs_claims_what_it_found() {
        let source = include_str!("lib.rs");
        let tests = source.find("#[cfg(test)]").unwrap_or(source.len());
        let mut checked = 0;
        for chunk in source[..tests].split("#[tauri::command]").skip(1) {
            let body = chunk.split("\n}\n").next().unwrap_or_default();
            let syncs = [".sync_wallet(", ".rescan_wallet(", ".sync_all("]
                .iter()
                .any(|call| body.contains(&format!("manager{call}")));
            if !syncs {
                continue;
            }
            checked += 1;
            let name = body
                .split("fn ")
                .nth(1)
                .and_then(|rest| rest.split('(').next())
                .unwrap_or("?");
            assert!(
                body.contains("live::announce_report("),
                "{name} runs a sync, so it claims after it with live::announce_report"
            );
        }
        assert_eq!(checked, 3, "sync_wallet, rescan_wallet and sync_all");
    }

    /// The guard is one line at the top of a function: the day a command
    /// is added without it, this is the only thing that notices.
    ///
    /// Four commands answer behind the lock, and only four: the two that
    /// read the lock itself, the one that draws it, and the settings,
    /// which go through the redaction above instead.
    ///
    /// Every shape of command is read, synchronous ones included: one
    /// that took the state without being `async` used to pass unseen.
    #[test]
    fn every_command_that_reaches_the_vault_begins_with_the_guard() {
        const PASSES_LOCKED: [&str; 4] =
            ["app_lock", "verify_app_lock", "lock_app", "get_settings"];
        const SHAPES: [&str; 6] = [
            "pub async fn ",
            "pub(crate) async fn ",
            "async fn ",
            "pub fn ",
            "pub(crate) fn ",
            "fn ",
        ];
        let sources = [
            ("lib.rs", include_str!("lib.rs")),
            ("live.rs", include_str!("live.rs")),
            ("clipboard.rs", include_str!("clipboard.rs")),
        ];

        let mut checked = 0;
        let mut commands = 0;
        for (file, source) in sources {
            let lines: Vec<&str> = source.lines().collect();
            for (index, line) in lines.iter().enumerate() {
                let Some(rest) = SHAPES.iter().find_map(|shape| line.strip_prefix(shape)) else {
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
                commands += 1;
                // The body opens at the first line ending in `{`.
                let Some(offset) = lines[index..]
                    .iter()
                    .position(|line| line.trim_end().ends_with('{'))
                else {
                    continue;
                };
                let body = index + offset;
                // A command handed no state never reaches the vault, and
                // it may not reach it through its app handle either: that
                // would pass this scan with no guard at all. One that
                // needs the state takes it as a parameter, and is checked.
                if !lines[index..=body]
                    .iter()
                    .any(|line| line.contains("tauri::State<'_, AppState>"))
                {
                    let end = lines[body..]
                        .iter()
                        .position(|line| *line == "}")
                        .map_or(lines.len(), |close| body + close);
                    assert!(
                        !lines[body..end]
                            .iter()
                            .any(|line| line.contains("state::<AppState>")),
                        "{file}: {name} reaches the state through its handle; \
                         take `state: tauri::State<'_, AppState>` and begin with \
                         `state.unlocked()?;`"
                    );
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
        // Counts, so an empty scan cannot pass for a clean one: every
        // command the app registers is read, the six synchronous ones
        // and the one in clipboard.rs among them.
        assert!(checked >= 45, "only {checked} commands checked");
        let registered = include_str!("lib.rs")
            .split("generate_handler![")
            .nth(1)
            .and_then(|list| list.split(']').next())
            .map(|list| {
                list.split(',')
                    .filter(|name| !name.trim().is_empty())
                    .count()
            })
            .unwrap_or_default();
        assert_eq!(commands, registered, "a registered command was not read");
    }
}
