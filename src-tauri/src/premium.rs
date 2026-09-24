//! The premium commands: the account key and the device it connects,
//! the account's other devices, the licence, the wallets the server
//! watches, the channels it tells, and the heartbeat that says it is up.
//!
//! Every request leaves from here, and every signature is checked here,
//! by the core, against the key it trusts. The webview shows what was
//! verified and never judges a certificate or a heartbeat itself; the
//! descriptor a wallet is registered with is read from the vault, not
//! taken from the screen, and the token this device speaks with never
//! leaves the core.
//!
//! What changes who can use the account, or what it watches and where
//! it tells, takes the app lock's secret and checks it first, through
//! the lock screen's own path: see [`confirm_identity`].

use std::time::{SystemTime, UNIX_EPOCH};

use gerfaut_core::error::{CoreError, CoreResult};
use gerfaut_core::premium::client::{
    NTFY_BASE_URL, TELEGRAM_BOT, endpoint, new_ntfy_topic, ntfy_subscribe_url, telegram_link_url,
};
use gerfaut_core::premium::licence;
use gerfaut_core::premium::{
    Account, Channel, ChannelKind, Device, DeviceAccess, DevicePlatform, Event, HeartbeatReport,
    LicenceState, PremiumClient, PremiumState, WalletWatch,
};
use gerfaut_core::wallet::meta::WalletKind;
use serde::Serialize;
use std::sync::atomic::Ordering;

use crate::{AppState, CommandError, CommandResult, devices};

/// How many events the "Recent alerts" card shows.
const RECENT_EVENTS: usize = 20;
/// How many events are asked of the server to find the recent ones: its
/// own cap. The route pages forward from an id; the latest are the tail.
const EVENTS_PAGE: u32 = 500;
/// How long a dismissed "watch is offline" banner stays quiet: a day.
/// A heartbeat that verifies again clears it sooner; an outage that
/// outlives it is worth a second look.
const ACKNOWLEDGE_SECS: i64 = 24 * 60 * 60;

/// This device's connection as the screen may know it: which device it
/// is and since when. Never the token.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DeviceConnection {
    pub id: String,
    pub connected_at: i64,
}

/// What the vault says about the account, readable without a network.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PremiumStatus {
    /// The account key as it is shown, `xxxx-xxxx-xxxx-xxxx`; null until
    /// one is entered.
    pub key: Option<String>,
    /// What the stored certificate says right now, verified offline
    /// against the trusted key; null without a certificate, and for one
    /// this build cannot verify.
    pub licence: Option<LicenceState>,
    /// The wallets the user agreed to send to the server.
    pub consented: Vec<String>,
    /// Unix seconds until which the "watch is offline" banner stays
    /// quiet because it was dismissed.
    pub acknowledged_offline_until: Option<i64>,
    /// This device's connection; null until the key connects it, and
    /// again once the server disowned it.
    pub device: Option<DeviceConnection>,
    /// The server disowned this device, and the key stays: "Connect
    /// again" is the user's to press.
    pub disconnected: bool,
    /// Why the server would not connect this device again, in its own
    /// words, when it said: the key has every device it takes. Null for
    /// a device disowned or a key no longer known, which the screen
    /// words itself.
    pub disconnected_reason: Option<String>,
    /// "I saved my key" was ticked for the key in place.
    pub key_saved: bool,
    /// The "Protect your Premium account" card was hidden.
    pub checklist_hidden: bool,
    /// A key change was sent and not answered: the key above may no
    /// longer work. The screen says the change did not finish, offers
    /// to try again, which sends the same new key, and does not offer
    /// to copy the key meanwhile.
    pub key_change_pending: bool,
    /// A connection of this device was sent and not answered. It is
    /// sent again as it was, in the background and by the next
    /// premium call, never drawn anew.
    pub connect_pending: bool,
}

/// The account as the server sees it, and the vault brought up to date
/// with the certificate it handed back.
#[derive(Debug, Clone, Serialize)]
pub struct PremiumAccount {
    pub account: Account,
    pub status: PremiumStatus,
}

/// A channel with the link the screen offers for it: the bot, for a
/// Telegram channel not linked yet.
#[derive(Debug, Clone, Serialize)]
pub struct ChannelView {
    #[serde(flatten)]
    pub channel: Channel,
    pub telegram_url: Option<String>,
}

/// A channel just created, with what the screen shows once: the ntfy
/// URL to subscribe to. The server masks the topic afterwards.
#[derive(Debug, Clone, Serialize)]
pub struct NewChannel {
    pub channel: ChannelView,
    pub subscribe_url: Option<String>,
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

/// The premium server this build talks to. A release build names the
/// production server; a debug build may be pointed at another one.
pub(crate) fn base_url() -> String {
    endpoint().0
}

/// The vault's premium state read against a clock and a licence key.
/// A certificate that does not verify reads as no certificate: the
/// screen then says nothing it cannot stand behind.
fn status_of(state: &PremiumState, public_key_hex: &str, now: i64) -> PremiumStatus {
    let licence = state
        .certificate
        .as_deref()
        .and_then(|certificate| licence::verify_certificate(certificate, public_key_hex).ok())
        .map(|claims| claims.state(now));
    PremiumStatus {
        key: state.key.as_deref().map(licence::format_key),
        licence,
        consented: state.watched.iter().map(|w| w.wallet_id.clone()).collect(),
        acknowledged_offline_until: state.acknowledged_offline_until,
        device: state.device.as_ref().map(|device| DeviceConnection {
            id: device.id.clone(),
            connected_at: device.connected_at,
        }),
        disconnected: state.disconnected,
        disconnected_reason: state.disconnected_reason.clone(),
        key_saved: state.key_saved,
        checklist_hidden: state.checklist_hidden,
        key_change_pending: state.key_change_pending(),
        connect_pending: state.connect_pending(),
    }
}

/// The text a wallet is registered with: the external descriptor
/// alone, or both on two lines, the form the core's own parser reads
/// back. A single address goes as it was imported: to the server it is
/// a wallet of one script.
fn descriptor_input(kind: &WalletKind) -> String {
    match kind {
        WalletKind::Descriptors {
            external,
            internal: Some(internal),
            ..
        } => format!("{external}\n{internal}"),
        WalletKind::Descriptors {
            external,
            internal: None,
            ..
        } => external.clone(),
        WalletKind::SingleAddress { address } => address.clone(),
    }
}

/// The last `count` events, newest first. The server lists oldest
/// first and pages forward, so the recent ones are the tail of a page.
fn latest_events(mut events: Vec<Event>, count: usize) -> Vec<Event> {
    events.sort_by_key(|event| event.id);
    events.dedup_by_key(|event| event.id);
    let skip = events.len().saturating_sub(count);
    let mut recent: Vec<Event> = events.into_iter().skip(skip).collect();
    recent.reverse();
    recent
}

fn view_of(channel: Channel) -> ChannelView {
    let telegram_url = match (channel.kind, channel.linked, channel.link_code.as_deref()) {
        (ChannelKind::Telegram, false, Some(code)) => Some(telegram_link_url(TELEGRAM_BOT, code)),
        _ => None,
    };
    ChannelView {
        channel,
        telegram_url,
    }
}

/// The platform this device connects as. The desktop builds for three,
/// all of which the server takes.
fn platform() -> CommandResult<DevicePlatform> {
    DevicePlatform::current().ok_or_else(|| {
        CommandError::new(
            "invalid_input",
            "this system is not one the Premium server takes",
        )
    })
}

/// Connects this device when the vault says it should be and is not:
/// a connection sent and not answered goes again as it was, and a
/// vault written before devices existed is connected once with the key
/// it holds. Every premium call goes through here first. A device the
/// server disowned is left alone, and so is a key it refused: connecting
/// again is the user's call. After a rate limit, the core answers the
/// wait that is left without asking the server.
///
/// Returns the device it connected, if any, and the core's own error
/// otherwise: the background round tells a refusal that leaves this
/// device disconnected from a server it could not reach.
pub(crate) async fn ensure_device(state: &AppState, base_url: &str) -> CoreResult<Option<Device>> {
    let platform = DevicePlatform::current().ok_or_else(|| CoreError::InvalidInput {
        kind: "device platform",
        detail: "this system is not one the Premium server takes".to_owned(),
    })?;
    let device = state
        .manager
        .premium_ensure_device(base_url, platform)
        .await?;
    if let Some(device) = &device {
        state.devices.saw(device);
    }
    Ok(device)
}

/// Whether the vault says this device should be connected and is not,
/// which is what [`ensure_device`] acts on: a connection sent and not
/// answered, or a key from before devices, with no token and no word
/// from the server against it.
pub(crate) async fn connection_owed(state: &AppState) -> bool {
    let premium = state.manager.premium_state().await;
    premium.connect_pending()
        || (premium.key.is_some() && !premium.has_device() && !premium.disconnected)
}

/// A client for the server at `base_url`, for this device, connected
/// on the way when the vault predates devices.
async fn client_at(state: &AppState, base_url: &str) -> CommandResult<PremiumClient> {
    ensure_device(state, base_url).await?;
    Ok(state.manager.premium_client(base_url).await?)
}

async fn client(state: &AppState) -> CommandResult<PremiumClient> {
    client_at(state, &base_url()).await
}

/// Tells the server about the wallets removed from this device since it
/// last heard, and lets a failure go: what could not be told stays
/// queued in the vault for the next call, and whatever the caller came
/// to do does not depend on it.
pub(crate) async fn flush_unwatch(state: &AppState) {
    let _ = state.manager.premium_flush_unwatch(&base_url()).await;
}

/// Tells the server about the connections this device dropped while it
/// could not be reached: a key forgotten offline, an account left for
/// another. Their tokens wait in the vault, never shown, until the
/// server confirms; nothing waiting costs no request. Called at start,
/// with the heartbeat, and every five minutes from the background.
pub(crate) async fn flush_logouts(state: &AppState, base_url: &str) {
    let _ = state.manager.premium_flush_logouts(base_url).await;
}

async fn status(state: &AppState) -> PremiumStatus {
    status_of(
        &state.manager.premium_state().await,
        &endpoint().1,
        now_unix(),
    )
}

/// Whether the person at the keyboard knows the app lock's secret, asked
/// before anything that changes who can use the account, or what it
/// watches and where it tells.
///
/// The secret goes through the core the way the lock screen's does: the
/// same hash, the same count of failures and the same wait after three,
/// shared with the lock screen, so trying PINs here costs what it costs
/// there. A secret that does not verify comes back as `identity_refused`
/// with the wait before the next one is looked at. With no lock on this
/// device the answer is `app_lock_required`: an unlocked computer is
/// all it would take otherwise, and the screen says to set a lock.
pub(crate) async fn confirm_identity(state: &AppState, secret: &str) -> CommandResult<()> {
    if state.manager.app_lock().await.is_none() {
        return Err(CommandError::new(
            "app_lock_required",
            "this needs an app lock on this device",
        ));
    }
    let verdict = state.manager.verify_app_lock(secret).await?;
    if verdict.unlocked {
        return Ok(());
    }
    Err(CommandError {
        kind: "identity_refused",
        message: "the PIN or password did not match".to_owned(),
        retry_after_secs: Some(verdict.retry_after_secs),
    })
}

/// [`confirm_identity`] for a command that asks for the secret only in
/// some cases, and may have been handed none: that is refused as a
/// secret that did not match, without counting against the lock.
pub(crate) async fn confirm_identity_given(
    state: &AppState,
    secret: Option<&str>,
) -> CommandResult<()> {
    match secret {
        Some(secret) => confirm_identity(state, secret).await,
        None if state.manager.app_lock().await.is_none() => Err(CommandError::new(
            "app_lock_required",
            "this needs an app lock on this device",
        )),
        None => Err(CommandError::new(
            "identity_refused",
            "this needs the PIN or password of the app lock",
        )),
    }
}

/// Whether removing this wallet from the device ends the server's watch
/// of it: a key is set and the wallet was agreed to, the rule the core
/// queues the unwatch by.
pub(crate) async fn watched_by_server(state: &AppState, id: &str) -> bool {
    let premium = state.manager.premium_state().await;
    premium.has_key() && premium.is_consented(id)
}

// --- commands ----------------------------------------------------------

/// The account as the vault knows it: no network, so the section opens
/// the same offline.
#[tauri::command]
pub async fn premium_status(state: tauri::State<'_, AppState>) -> CommandResult<PremiumStatus> {
    state.unlocked()?;
    Ok(status(&state).await)
}

/// Connects this device with a key just typed: the one request the key
/// goes with. The core keeps the key with the token the server handed
/// back, in one write, and fetches the certificate after. A key the
/// server does not know is refused and nothing is stored. The account's
/// first device gets full access at once; any other waits for approval.
#[tauri::command]
pub async fn premium_activate(
    state: tauri::State<'_, AppState>,
    key: String,
) -> CommandResult<PremiumStatus> {
    state.unlocked()?;
    if !licence::is_well_formed_key(&key) {
        return Err(CommandError::new(
            "invalid_input",
            "a key is sixteen letters and digits",
        ));
    }
    // Another key would move this device to another account and log it
    // out of this one: what "Forget this key" does behind the secret.
    // The screen offers the field only once the key is gone.
    if full_access(&state).await && !holds_key(&state, &key).await {
        return Err(CommandError::new(
            "invalid_input",
            "forget this key before entering another one",
        ));
    }
    let device = state
        .manager
        .premium_connect(&base_url(), &key, platform()?)
        .await?;
    state.devices.saw(&device);
    Ok(status(&state).await)
}

/// Connects this device again after the server disowned it, with the
/// key the vault kept. A key changed on another device comes back as
/// `premium_unknown_key`, and the screen asks for the new one.
#[tauri::command]
pub async fn premium_reconnect(state: tauri::State<'_, AppState>) -> CommandResult<PremiumStatus> {
    state.unlocked()?;
    let Some(key) = state.manager.premium_state().await.key else {
        return Err(CommandError::new("premium_no_key", "no premium key"));
    };
    let device = state
        .manager
        .premium_connect(&base_url(), &key, platform()?)
        .await?;
    state.devices.saw(&device);
    Ok(status(&state).await)
}

/// Logs this device out and drops the key here: the server is told as
/// far as it can be reached, and the account and what it watches stay.
/// The consents stay too, so a wallet already agreed to is not asked
/// about twice.
///
/// A device with full access is one the account may depend on, and
/// connecting it again means waiting for an approval: that takes the
/// app lock's secret. One that waits, or that the server disowned,
/// leaves without it.
#[tauri::command]
pub async fn premium_forget(
    state: tauri::State<'_, AppState>,
    secret: Option<String>,
) -> CommandResult<PremiumStatus> {
    state.unlocked()?;
    if full_access(&state).await {
        confirm_identity_given(&state, secret.as_deref()).await?;
    }
    state.manager.premium_log_out(&base_url()).await?;
    state.devices.forget();
    Ok(status(&state).await)
}

/// This device as the server sees it: full access, or waiting and until
/// when. A vault that predates devices is connected on the way.
#[tauri::command]
pub async fn premium_device(state: tauri::State<'_, AppState>) -> CommandResult<Device> {
    state.unlocked()?;
    let base_url = base_url();
    ensure_device(&state, &base_url).await?;
    let device = state.manager.premium_device(&base_url).await?;
    state.devices.saw(&device);
    Ok(device)
}

/// Every device of the account, oldest first, for a device with full
/// access. A device waiting for approval is announced here once, as the
/// background check does: see [`devices::check`].
#[tauri::command]
pub async fn premium_devices(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> CommandResult<Vec<Device>> {
    state.unlocked()?;
    let base_url = base_url();
    ensure_device(&state, &base_url).await?;
    Ok(devices::check(&app, &state, &base_url).await?)
}

/// Gives a waiting device full access now, once the app lock's secret
/// went through.
#[tauri::command]
pub async fn premium_approve_device(
    state: tauri::State<'_, AppState>,
    id: String,
    secret: String,
) -> CommandResult<Device> {
    state.unlocked()?;
    confirm_identity(&state, &secret).await?;
    let base_url = base_url();
    ensure_device(&state, &base_url).await?;
    Ok(state.manager.premium_approve_device(&base_url, &id).await?)
}

/// Refuses a waiting device, or disconnects one with full access, once
/// the app lock's secret went through.
#[tauri::command]
pub async fn premium_remove_device(
    state: tauri::State<'_, AppState>,
    id: String,
    secret: String,
) -> CommandResult<()> {
    state.unlocked()?;
    confirm_identity(&state, &secret).await?;
    let base_url = base_url();
    ensure_device(&state, &base_url).await?;
    Ok(state.manager.premium_remove_device(&base_url, &id).await?)
}

/// Replaces the account key once the app lock's secret went through:
/// the old key stops working everywhere, every other device is
/// disconnected, and this one stays. Answers the new key, formatted to
/// be shown: it is shown there and nowhere else.
#[tauri::command]
pub async fn premium_change_key(
    state: tauri::State<'_, AppState>,
    secret: String,
) -> CommandResult<String> {
    state.unlocked()?;
    confirm_identity(&state, &secret).await?;
    let base_url = base_url();
    ensure_device(&state, &base_url).await?;
    Ok(state.manager.premium_change_key(&base_url).await?)
}

/// Records whether the key was saved somewhere safe.
#[tauri::command]
pub async fn premium_set_key_saved(
    state: tauri::State<'_, AppState>,
    saved: bool,
) -> CommandResult<PremiumStatus> {
    state.unlocked()?;
    state.manager.premium_set_key_saved(saved).await?;
    Ok(status(&state).await)
}

/// Puts the "Protect your Premium account" card away.
#[tauri::command]
pub async fn premium_hide_checklist(
    state: tauri::State<'_, AppState>,
) -> CommandResult<PremiumStatus> {
    state.unlocked()?;
    state.manager.premium_hide_checklist().await?;
    Ok(status(&state).await)
}

/// The account from the server, and the certificate refreshed on the
/// way when the server hands one out: a renewal made on the site shows
/// its new date here. A key with no paid time still reads its account.
#[tauri::command]
pub async fn premium_account(state: tauri::State<'_, AppState>) -> CommandResult<PremiumAccount> {
    state.unlocked()?;
    let base_url = base_url();
    let account = client_at(&state, &base_url).await?.account().await?;
    let _ = state.manager.premium_refresh_licence(&base_url).await;
    Ok(PremiumAccount {
        account,
        status: status(&state).await,
    })
}

/// The wallets the server watches. A removal it has not heard of yet is
/// told first: the list is what the screen holds against this device's
/// wallets, and it should not show a wallet the user already removed.
#[tauri::command]
pub async fn premium_wallets(state: tauri::State<'_, AppState>) -> CommandResult<Vec<WalletWatch>> {
    state.unlocked()?;
    let client = client(&state).await?;
    flush_unwatch(&state).await;
    Ok(client.wallets().await?)
}

/// Records the consent and registers the wallet under its own id, with
/// the name and the descriptor the vault holds. The consent is written
/// first: the user said yes, and a request that fails is retried without
/// asking again.
#[tauri::command]
pub async fn premium_watch_wallet(
    state: tauri::State<'_, AppState>,
    id: String,
) -> CommandResult<()> {
    state.unlocked()?;
    let wallet = state
        .manager
        .list_wallets(None)
        .await
        .into_iter()
        .find(|wallet| wallet.id == id)
        .ok_or_else(|| CommandError::new("wallet_not_found", format!("no wallet with id {id}")))?;
    let input = descriptor_input(&wallet.kind);
    let mut premium = state.manager.premium_state().await;
    premium.consent(&id, now_unix());
    state.manager.set_premium_state(premium).await?;
    client(&state)
        .await?
        .put_wallet(&id, &wallet.name, &input)
        .await?;
    Ok(())
}

/// Ends the server's watch of a wallet once the app lock's secret went
/// through. The manager withdraws the consent with the watch: switching
/// the wallet back on asks the question again, and removing it later
/// queues nothing for a server that already forgot it.
#[tauri::command]
pub async fn premium_unwatch_wallet(
    state: tauri::State<'_, AppState>,
    id: String,
    secret: String,
) -> CommandResult<()> {
    state.unlocked()?;
    confirm_identity(&state, &secret).await?;
    let base_url = base_url();
    ensure_device(&state, &base_url).await?;
    Ok(state.manager.premium_unwatch_wallet(&base_url, &id).await?)
}

#[tauri::command]
pub async fn premium_channels(
    state: tauri::State<'_, AppState>,
) -> CommandResult<Vec<ChannelView>> {
    state.unlocked()?;
    let channels = client(&state).await?.channels().await?;
    Ok(channels.into_iter().map(view_of).collect())
}

/// Adds a channel. An ntfy topic is drawn here, long and random, and
/// returned once as the URL to subscribe to; Telegram takes no target
/// and comes back with the code to send the bot. `secret` is a
/// webhook's own.
///
/// A channel receives every alert, so with an app lock on, adding one
/// takes the lock's secret, `identity`: someone at the unlocked app
/// would otherwise have the alerts sent to them. Without a lock it goes
/// through as it always did.
#[tauri::command]
pub async fn premium_add_channel(
    state: tauri::State<'_, AppState>,
    kind: ChannelKind,
    target: Option<String>,
    secret: Option<String>,
    identity: Option<String>,
) -> CommandResult<NewChannel> {
    state.unlocked()?;
    if state.manager.app_lock().await.is_some() {
        confirm_identity_given(&state, identity.as_deref()).await?;
    }
    let client = client(&state).await?;
    let (target, subscribe_url) = match kind {
        ChannelKind::Ntfy => {
            let topic = target.unwrap_or_else(new_ntfy_topic);
            let url = ntfy_subscribe_url(NTFY_BASE_URL, &topic);
            (Some(topic), Some(url))
        }
        ChannelKind::Telegram => (None, None),
        ChannelKind::Email | ChannelKind::Webhook => (target, None),
    };
    let channel = client
        .create_channel(kind, target.as_deref(), secret.as_deref())
        .await?;
    Ok(NewChannel {
        channel: view_of(channel),
        subscribe_url,
    })
}

/// Removes a channel once the app lock's secret went through: nothing
/// is sent there again.
#[tauri::command]
pub async fn premium_delete_channel(
    state: tauri::State<'_, AppState>,
    id: String,
    secret: String,
) -> CommandResult<()> {
    state.unlocked()?;
    confirm_identity(&state, &secret).await?;
    Ok(client(&state).await?.delete_channel(&id).await?)
}

/// Confirms an e-mail channel with the code the server sent to that
/// address: nothing is written to it before its owner typed the code
/// back. A wrong or expired code, or too many tries, comes back in the
/// server's words; the channel comes back as the list shows it.
#[tauri::command]
pub async fn premium_confirm_channel(
    state: tauri::State<'_, AppState>,
    id: String,
    code: String,
) -> CommandResult<ChannelView> {
    state.unlocked()?;
    confirm_channel(&state, &base_url(), &id, &code).await
}

async fn confirm_channel(
    state: &AppState,
    base_url: &str,
    id: &str,
    code: &str,
) -> CommandResult<ChannelView> {
    let code = code.trim();
    if code.is_empty() {
        return Err(CommandError::new(
            "invalid_input",
            "type the code from the e-mail",
        ));
    }
    ensure_device(state, base_url).await?;
    let channel = state
        .manager
        .premium_confirm_channel(base_url, id, code)
        .await?;
    Ok(view_of(channel))
}

/// Deletes the account on the server once the app lock's secret went
/// through, everything it watches and tells included, and forgets the
/// key here once the server said it did. The opposite of
/// `premium_forget`, which leaves the server as it is.
#[tauri::command]
pub async fn premium_delete_account(
    state: tauri::State<'_, AppState>,
    secret: String,
) -> CommandResult<PremiumStatus> {
    state.unlocked()?;
    confirm_identity(&state, &secret).await?;
    delete_account(&state, &base_url()).await
}

async fn delete_account(state: &AppState, base_url: &str) -> CommandResult<PremiumStatus> {
    ensure_device(state, base_url).await?;
    state.manager.premium_delete_account(base_url).await?;
    state.devices.forget();
    Ok(status(state).await)
}

/// Sends a test message right away; the provider's refusal comes back
/// in its own words.
#[tauri::command]
pub async fn premium_test_channel(
    state: tauri::State<'_, AppState>,
    id: String,
) -> CommandResult<()> {
    state.unlocked()?;
    Ok(client(&state).await?.test_channel(&id).await?)
}

/// The last twenty events, newest first.
#[tauri::command]
pub async fn premium_events(state: tauri::State<'_, AppState>) -> CommandResult<Vec<Event>> {
    state.unlocked()?;
    let events = client(&state).await?.events(0, EVENTS_PAGE).await?;
    Ok(latest_events(events, RECENT_EVENTS))
}

/// The server's heartbeat, verified against the trusted key and this
/// device's clock. One that verifies also lifts a dismissed banner: the
/// next outage is a new one, and gets shown. The pulse is also when a
/// wallet removed while the server was out of reach gets unwatched
/// there, and a connection dropped offline gets revoked: every fifteen
/// minutes, the queues get their chance.
#[tauri::command]
pub async fn premium_heartbeat(
    state: tauri::State<'_, AppState>,
) -> CommandResult<HeartbeatReport> {
    state.unlocked()?;
    let base_url = base_url();
    flush_logouts(&state, &base_url).await;
    let client = client_at(&state, &base_url).await?;
    flush_unwatch(&state).await;
    let report = client.heartbeat(now_unix()).await?;
    let premium = state.manager.premium_state().await;
    if premium.acknowledged_offline_until.is_some() {
        let mut premium = premium;
        premium.acknowledged_offline_until = None;
        state.manager.set_premium_state(premium).await?;
    }
    Ok(report)
}

/// Dismisses the "watch is offline" banner for a day, or until the
/// heartbeat comes back, whichever is first.
#[tauri::command]
pub async fn premium_acknowledge_offline(
    state: tauri::State<'_, AppState>,
) -> CommandResult<PremiumStatus> {
    state.unlocked()?;
    let mut premium = state.manager.premium_state().await;
    premium.acknowledged_offline_until = Some(now_unix() + ACKNOWLEDGE_SECS);
    state.manager.set_premium_state(premium).await?;
    Ok(status(&state).await)
}

/// Whether the device the server described waits for approval.
pub(crate) fn waits(device: &Device) -> bool {
    device.access == DeviceAccess::Pending
}

/// Whether the vault holds a connected device, the only kind the
/// background check asks about.
pub(crate) async fn connected(state: &AppState) -> bool {
    let premium = state.manager.premium_state().await;
    premium.key.is_some() && premium.device.is_some() && !premium.disconnected
}

/// Whether this device is connected and, as far as the server last
/// said, has full access. Not known yet counts as full: the secret is
/// asked rather than skipped.
pub(crate) async fn full_access(state: &AppState) -> bool {
    connected(state).await && !state.devices.waiting()
}

/// Whether `key` is the one the vault holds, however it was typed.
async fn holds_key(state: &AppState, key: &str) -> bool {
    state
        .manager
        .premium_state()
        .await
        .key
        .is_some_and(|held| licence::normalize_key(&held) == licence::normalize_key(key))
}

/// Whether the app is locked right now.
pub(crate) fn locked(state: &AppState) -> bool {
    state.locked.load(Ordering::SeqCst)
}

#[cfg(test)]
mod tests {
    use data_encoding::{BASE64URL_NOPAD, HEXLOWER};
    use ed25519_dalek::{Signer, SigningKey};
    use gerfaut_core::input::ScriptKind;
    use gerfaut_core::premium::licence::LICENCE_PUBLIC_KEY_HEX;
    use gerfaut_core::premium::{Claims, EventKind, WatchedWallet};

    use super::*;

    const NOW: i64 = 1_790_000_000;

    /// The server's side of the certificate, for these tests only.
    fn issue(signing: &SigningKey, exp: i64) -> String {
        let claims = Claims {
            v: 1,
            sub: "ab".repeat(32),
            exp,
            iat: NOW - 60,
        };
        let payload = serde_json::to_vec(&claims).unwrap();
        let signature = signing.sign(&payload);
        format!(
            "{}.{}",
            BASE64URL_NOPAD.encode(&payload),
            BASE64URL_NOPAD.encode(&signature.to_bytes())
        )
    }

    fn signer() -> (SigningKey, String) {
        let signing = SigningKey::from_bytes(&[7u8; 32]);
        let public = HEXLOWER.encode(&signing.verifying_key().to_bytes());
        (signing, public)
    }

    #[test]
    fn an_empty_vault_reads_as_no_account() {
        let status = status_of(&PremiumState::default(), LICENCE_PUBLIC_KEY_HEX, NOW);
        assert_eq!(
            status,
            PremiumStatus {
                key: None,
                licence: None,
                consented: vec![],
                acknowledged_offline_until: None,
                device: None,
                disconnected: false,
                disconnected_reason: None,
                key_saved: false,
                checklist_hidden: false,
                key_change_pending: false,
                connect_pending: false,
            }
        );
    }

    /// What the network left hanging reads from the vault, with no
    /// network: a key change that did not finish, a connection on its
    /// way, and why the server would not connect this device again. The
    /// new key and the token stay on the Rust side.
    #[test]
    fn what_the_network_left_hanging_reads_offline() {
        const TOO_MANY: &str =
            "this key already has 10 devices; disconnect one from a device with full access";
        let state: PremiumState = serde_json::from_value(serde_json::json!({
            "key": "abcdefghijkmnpqr",
            "disconnected": true,
            "disconnected_reason": TOO_MANY,
            "pending_key": "mnpq23456789abcd",
            "pending_connect": {"key": "abcdefghijkmnpqr", "token": TOKEN, "platform": "linux"},
        }))
        .unwrap();
        let status = status_of(&state, LICENCE_PUBLIC_KEY_HEX, NOW);
        assert!(status.key_change_pending);
        assert!(status.connect_pending);
        assert!(status.disconnected);
        assert_eq!(status.disconnected_reason.as_deref(), Some(TOO_MANY));
        let shown = serde_json::to_string(&status).unwrap();
        assert!(!shown.contains("mnpq23456789abcd"), "{shown}");
        assert!(!shown.contains(TOKEN), "{shown}");
    }

    #[test]
    fn the_stored_certificate_is_read_offline_and_the_key_shown_in_groups() {
        let (signing, public) = signer();
        let mut state = PremiumState {
            key: Some("abcdefghijkmnpqr".to_owned()),
            certificate: Some(issue(&signing, NOW + 86_400)),
            watched: vec![WatchedWallet {
                wallet_id: "w1".to_owned(),
                consented_at: NOW,
            }],
            acknowledged_offline_until: Some(NOW + 100),
            key_saved: true,
            ..PremiumState::default()
        };
        let status = status_of(&state, &public, NOW);
        assert!(status.key_saved);
        assert!(!status.checklist_hidden);
        assert_eq!(status.device, None);
        assert!(!status.disconnected);
        assert_eq!(status.key.as_deref(), Some("abcd-efgh-ijkm-npqr"));
        assert_eq!(
            status.licence,
            Some(LicenceState::Active {
                until: NOW + 86_400
            })
        );
        assert_eq!(status.consented, vec!["w1".to_owned()]);
        assert_eq!(status.acknowledged_offline_until, Some(NOW + 100));

        // Paid time that ended still reads, and says since when.
        state.certificate = Some(issue(&signing, NOW - 3_600));
        assert_eq!(
            status_of(&state, &public, NOW).licence,
            Some(LicenceState::Expired { since: NOW - 3_600 })
        );
    }

    /// A certificate another key signed, or one that got damaged, says
    /// nothing: the screen must not show "active" on its word.
    #[test]
    fn a_certificate_that_does_not_verify_reads_as_none() {
        let (signing, _) = signer();
        let state = PremiumState {
            key: Some("abcdefghijkmnpqr".to_owned()),
            certificate: Some(issue(&signing, NOW + 86_400)),
            ..PremiumState::default()
        };
        assert_eq!(status_of(&state, LICENCE_PUBLIC_KEY_HEX, NOW).licence, None);
        let damaged = PremiumState {
            certificate: Some("not.a.certificate".to_owned()),
            ..state
        };
        assert_eq!(
            status_of(&damaged, LICENCE_PUBLIC_KEY_HEX, NOW).licence,
            None
        );
    }

    #[test]
    fn the_server_is_told_both_descriptors_or_the_one_there_is() {
        let pair = WalletKind::Descriptors {
            external: "wpkh(A/0/*)#aaaaaaaa".to_owned(),
            internal: Some("wpkh(A/1/*)#bbbbbbbb".to_owned()),
            script: ScriptKind::Segwit,
        };
        assert_eq!(
            descriptor_input(&pair),
            "wpkh(A/0/*)#aaaaaaaa\nwpkh(A/1/*)#bbbbbbbb"
        );
        let external_only = WalletKind::Descriptors {
            external: "wpkh(A/0/*)#aaaaaaaa".to_owned(),
            internal: None,
            script: ScriptKind::Segwit,
        };
        assert_eq!(descriptor_input(&external_only), "wpkh(A/0/*)#aaaaaaaa");
        let address = WalletKind::SingleAddress {
            address: "bc1q...".to_owned(),
        };
        // A single address is watchable: it is registered as the
        // address itself, which the server reads as a wallet of one
        // script.
        assert_eq!(descriptor_input(&address), "bc1q...");
    }

    fn event(id: i64) -> Event {
        Event {
            id,
            kind: EventKind::SpendDetected,
            wallet: "w1".to_owned(),
            wallet_name: "Cold".to_owned(),
            at: NOW + id,
            data: serde_json::Value::Null,
        }
    }

    #[test]
    fn the_recent_events_are_the_newest_first_without_doubles() {
        let events = vec![event(3), event(1), event(4), event(3), event(2), event(5)];
        let ids: Vec<i64> = latest_events(events, 3).iter().map(|e| e.id).collect();
        assert_eq!(ids, vec![5, 4, 3]);
        let few: Vec<i64> = latest_events(vec![event(2), event(1)], 20)
            .iter()
            .map(|e| e.id)
            .collect();
        assert_eq!(few, vec![2, 1]);
        assert!(latest_events(vec![], 20).is_empty());
    }

    fn channel(kind: ChannelKind, linked: bool, code: Option<&str>) -> Channel {
        Channel {
            id: "c1".to_owned(),
            kind,
            target: String::new(),
            linked,
            link_code: code.map(str::to_owned),
            link_url: None,
            linked_name: None,
            linked_at: None,
            enabled: true,
            created_at: NOW,
        }
    }

    #[test]
    fn only_an_unlinked_telegram_channel_offers_the_bot_link() {
        let waiting = view_of(channel(ChannelKind::Telegram, false, Some("0123456789ab")));
        assert_eq!(
            waiting.telegram_url.as_deref(),
            Some("https://t.me/GerfautAlertsBot?start=0123456789ab")
        );
        assert_eq!(
            view_of(channel(ChannelKind::Telegram, true, None)).telegram_url,
            None
        );
        assert_eq!(
            view_of(channel(ChannelKind::Ntfy, true, Some("x"))).telegram_url,
            None
        );
        // The flattened view keeps the channel's own fields at the top.
        let json = serde_json::to_value(&waiting).unwrap();
        assert_eq!(json["kind"], "telegram");
        assert_eq!(json["linked"], false);
        assert!(json["telegram_url"].is_string());
    }

    // --- against a server ---------------------------------------------
    //
    // The commands that talk to the server are run against one on
    // loopback, scripted by the test: see `crate::testkit`.

    use gerfaut_core::WalletManager;
    use gerfaut_core::store::VaultKey;

    use crate::testkit::{
        DEVICE_ID, KEY, TOKEN, connected_body, platform_word, sent_field, stub_answers, stub_server,
    };

    fn app_state(manager: WalletManager) -> AppState {
        AppState {
            manager,
            locked: std::sync::atomic::AtomicBool::new(false),
            live: crate::live::LiveAlerts::default(),
            devices: crate::devices::DeviceWatch::default(),
        }
    }

    /// A fresh vault holding an account this device is connected to: a
    /// key and a token. What left for the connection is handed back.
    fn state_with_account(dir: &std::path::Path) -> (AppState, String) {
        let manager = WalletManager::open(dir, VaultKey::Raw([7u8; 32])).unwrap();
        let connection = crate::testkit::connect(&manager);
        (app_state(manager), connection)
    }

    /// The key goes with the connection and with nothing else, along
    /// with a token this device drew for itself, so that the same
    /// request can be sent again if its answer is lost. Every later
    /// request carries the token the server settled on, and the screen
    /// learns which device this is, never its token.
    #[test]
    fn a_device_connects_with_the_key_and_speaks_with_its_token_after() {
        let dir = tempfile::tempdir().unwrap();
        let (state, connection) = state_with_account(dir.path());
        assert!(
            connection.starts_with("POST /v1/devices HTTP/1.1"),
            "{connection}"
        );
        assert!(
            connection.contains("Bearer abcdefghijkmnpqr"),
            "{connection}"
        );
        assert_eq!(sent_field(&connection, "platform"), platform_word());
        let drawn = sent_field(&connection, "token");
        assert!(
            drawn.starts_with("gdt1_") && drawn.len() == "gdt1_".len() + 43,
            "{drawn}"
        );

        let runtime = tokio::runtime::Runtime::new().unwrap();
        let status = runtime.block_on(status(&state));
        assert_eq!(
            status.device,
            Some(DeviceConnection {
                id: DEVICE_ID.to_owned(),
                connected_at: NOW,
            })
        );
        assert!(!status.disconnected);
        let shown = serde_json::to_string(&status).unwrap();
        assert!(!shown.contains("gdt1_"), "{shown}");

        let (base_url, requests) = stub_server(200, EMAIL_CHANNEL);
        runtime
            .block_on(confirm_channel(&state, &base_url, "c1", "482913"))
            .unwrap();
        let request = requests.recv().unwrap();
        assert!(request.contains(&format!("Bearer {TOKEN}")), "{request}");
        assert!(!request.contains("abcdefghijkmnpqr"), "{request}");
    }

    /// A token the server no longer knows is dropped on the way, the key
    /// stays, and the screen reads a disconnected device: the one state
    /// with "Connect again" under it.
    #[test]
    fn a_disowned_device_reads_as_disconnected_and_keeps_its_key() {
        let dir = tempfile::tempdir().unwrap();
        let (state, _) = state_with_account(dir.path());
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let (base_url, _) = stub_server(
            401,
            r#"{"error":"this device was disconnected from the Premium account","code":"device_disconnected"}"#,
        );
        let error = runtime
            .block_on(state.manager.premium_device(&base_url))
            .map_err(CommandError::from)
            .unwrap_err();
        assert_eq!(error.kind, "premium_device_disconnected");
        let after = runtime.block_on(status(&state));
        assert_eq!(after.device, None);
        assert!(after.disconnected);
        assert_eq!(after.key.as_deref(), Some("abcd-efgh-ijkm-npqr"));
        // And nothing connects it again behind the user's back.
        let (base_url, requests) = stub_server(201, "{}");
        runtime.block_on(ensure_device(&state, &base_url)).unwrap();
        assert!(requests.try_recv().is_err());
    }

    /// A device that waits is refused the list, in the kind the window
    /// reads the waiting card by, and the background check stops asking
    /// until the server says otherwise.
    #[test]
    fn a_device_that_waits_is_told_so_and_asks_no_more() {
        let dir = tempfile::tempdir().unwrap();
        let (state, _) = state_with_account(dir.path());
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let (base_url, _) = stub_server(
            403,
            r#"{"error":"this device is waiting for approval: approve it on another of your devices, or wait until it gets full access","code":"device_pending","pending_until":1790864000}"#,
        );
        let error = runtime
            .block_on(crate::devices::fetch(&state, &base_url))
            .map(|_| ())
            .map_err(CommandError::from)
            .unwrap_err();
        assert_eq!(error.kind, "premium_device_pending");
        assert!(!state.devices.due(std::time::Instant::now()));
    }

    /// The list of the account with this device first, and `extra`
    /// after it.
    fn device_list(extra: &str) -> &'static str {
        Box::leak(
            format!(
                r#"{{"devices":[{{"id":"{DEVICE_ID}","platform":"windows","connected_at":{NOW},"access":"full","approved_at":{NOW},"this_device":true}}{extra}]}}"#
            )
            .into_boxed_str(),
        )
    }

    /// A device that waits is announced once, by the list that first
    /// shows it, in words that name its platform; behind the lock, in
    /// words that name neither it nor the account. One that stops
    /// waiting leaves the record, and nothing is said of this device.
    #[test]
    fn each_waiting_device_is_announced_once() {
        let dir = tempfile::tempdir().unwrap();
        let (state, _) = state_with_account(dir.path());
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let stranger = r#",{"id":"d-mac","platform":"macos","connected_at":1790000100,"access":"pending","pending_until":1790864100,"this_device":false}"#;
        notifications(&state, true);

        let (base_url, requests) = stub_server(200, device_list(stranger));
        let (devices, notices) = runtime
            .block_on(crate::devices::fetch(&state, &base_url))
            .unwrap();
        assert_eq!(devices.len(), 2);
        assert_eq!(notices.len(), 1);
        assert_eq!(notices[0].title, "Gerfaut Premium: new device");
        assert_eq!(
            notices[0].body,
            "A new Mac asks for access to your Premium account. Open Gerfaut to approve or refuse it."
        );
        let request = requests.recv().unwrap();
        assert!(request.starts_with("GET /v1/devices HTTP/1.1"), "{request}");
        assert!(request.contains(&format!("Bearer {TOKEN}")), "{request}");

        // The same list again: nothing new to say.
        let (_, notices) = runtime
            .block_on(crate::devices::fetch(&state, &base_url))
            .unwrap();
        assert!(notices.is_empty());

        // Refused elsewhere, then back, behind the lock.
        let (base_url, _) = stub_server(200, device_list(""));
        let (_, notices) = runtime
            .block_on(crate::devices::fetch(&state, &base_url))
            .unwrap();
        assert!(notices.is_empty());
        state
            .locked
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let (base_url, _) = stub_server(200, device_list(stranger));
        let (_, notices) = runtime
            .block_on(crate::devices::fetch(&state, &base_url))
            .unwrap();
        assert_eq!(notices.len(), 1, "it stopped waiting, then came back");
        assert_eq!(notices[0].title, "Gerfaut");
        assert!(!notices[0].body.contains("Mac"), "{}", notices[0].body);
    }

    /// Turns the app's alerts on or off, as Settings › Notifications does.
    fn notifications(state: &AppState, on: bool) {
        tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(state.manager.set_app_pref(
                crate::live::NOTIFY_PREF.to_owned(),
                if on { "1" } else { "0" }.to_owned(),
            ))
            .unwrap();
    }

    /// With the alerts off, a waiting device is recorded and not
    /// announced; turned on later, they do not bring it up as news. The
    /// banner, which reads the list, shows it all the same.
    #[test]
    fn device_notices_follow_the_alerts_setting() {
        let dir = tempfile::tempdir().unwrap();
        let (state, _) = state_with_account(dir.path());
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let stranger = r#",{"id":"d-mac","platform":"macos","connected_at":1790000100,"access":"pending","pending_until":1790864100,"this_device":false}"#;
        let (base_url, _) = stub_server(200, device_list(stranger));

        notifications(&state, false);
        let (devices, notices) = runtime
            .block_on(crate::devices::fetch(&state, &base_url))
            .unwrap();
        assert_eq!(devices.len(), 2, "the list is there for the banner");
        assert!(notices.is_empty());

        notifications(&state, true);
        let (_, notices) = runtime
            .block_on(crate::devices::fetch(&state, &base_url))
            .unwrap();
        assert!(notices.is_empty(), "seen with the alerts off, not news now");
    }

    /// This device as the server describes it.
    fn this_device(access: &str) -> String {
        let until = if access == "pending" {
            "1790864000"
        } else {
            "null"
        };
        format!(
            r#"{{"id":"{DEVICE_ID}","platform":"windows","connected_at":{NOW},"access":"{access}","pending_until":{until},"this_device":true}}"#
        )
    }

    /// `GET /v1/devices/me`.
    fn me(access: &str) -> &'static str {
        Box::leak(format!(r#"{{"device":{}}}"#, this_device(access)).into_boxed_str())
    }

    /// The server said this device waits.
    fn seen_waiting(state: &AppState) {
        state
            .devices
            .saw(&serde_json::from_str::<Device>(&this_device("pending")).unwrap());
    }

    /// The background round: a device that waits asks about itself,
    /// and the window hears when it gets full access; one with full
    /// access asks for the list; a device the server disowned is said
    /// once; and nothing is asked twice within five minutes.
    #[test]
    fn a_round_asks_what_this_device_may_ask() {
        use crate::devices::{Round, round};
        use std::time::{Duration, Instant};

        let dir = tempfile::tempdir().unwrap();
        let (state, _) = state_with_account(dir.path());
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let mut now = Instant::now();
        let mut later = || {
            now += Duration::from_secs(301);
            now
        };

        // Waiting: its own standing, and the list is not asked for.
        seen_waiting(&state);
        let (base_url, requests) = stub_server(200, me("pending"));
        let at = later();
        assert!(matches!(
            runtime.block_on(round(&state, &base_url, at)),
            Round::Waiting
        ));
        let request = requests.recv().unwrap();
        assert!(
            request.starts_with("GET /v1/devices/me HTTP/1.1"),
            "{request}"
        );
        // Asked a moment ago: nothing.
        assert!(matches!(
            runtime.block_on(round(&state, &base_url, at + Duration::from_secs(60))),
            Round::Idle
        ));
        assert!(requests.try_recv().is_err());

        // Approved elsewhere: full access, said once.
        let (base_url, _) = stub_server(200, me("full"));
        assert!(matches!(
            runtime.block_on(round(&state, &base_url, later())),
            Round::GotFullAccess
        ));
        assert!(!state.devices.waiting());

        // Full access: the list.
        let (base_url, requests) = stub_server(200, device_list(""));
        assert!(matches!(
            runtime.block_on(round(&state, &base_url, later())),
            Round::Devices { .. }
        ));
        assert!(
            requests
                .recv()
                .unwrap()
                .starts_with("GET /v1/devices HTTP/1.1")
        );

        // Disowned: said, and after that there is no device to ask about.
        let (base_url, _) = stub_server(
            401,
            r#"{"error":"this device was disconnected from the Premium account","code":"device_disconnected"}"#,
        );
        assert!(matches!(
            runtime.block_on(round(&state, &base_url, later())),
            Round::Disowned
        ));
        let (base_url, requests) = stub_server(200, device_list(""));
        assert!(matches!(
            runtime.block_on(round(&state, &base_url, later())),
            Round::Idle
        ));
        assert!(requests.try_recv().is_err());
    }

    const UNREACHABLE: &str = r#"{"error":"node unreachable"}"#;

    /// A fresh vault, with no account yet.
    fn empty_state(dir: &std::path::Path) -> AppState {
        app_state(WalletManager::open(dir, VaultKey::Raw([7u8; 32])).unwrap())
    }

    /// A connection whose answer was lost is sent again by the
    /// background round as it was, the same token with the same key,
    /// and the window hears of it. The key is the account's in the
    /// vault once the server answered, not before.
    #[test]
    fn a_connection_whose_answer_was_lost_is_sent_again_as_it_was() {
        use crate::devices::{Round, round};

        let dir = tempfile::tempdir().unwrap();
        let state = empty_state(dir.path());
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let platform = DevicePlatform::current().unwrap();

        let (base_url, requests) = stub_server(503, UNREACHABLE);
        let lost = runtime
            .block_on(state.manager.premium_connect(&base_url, KEY, platform))
            .map_err(CommandError::from)
            .unwrap_err();
        assert_eq!(lost.kind, "premium_unreachable");
        let drawn = sent_field(&requests.recv().unwrap(), "token");
        let hanging = runtime.block_on(status(&state));
        assert_eq!(hanging.key, None);
        assert!(hanging.connect_pending);

        let (base_url, requests) =
            stub_answers(vec![(201, connected_body()), (503, UNREACHABLE.to_owned())]);
        assert!(matches!(
            runtime.block_on(round(&state, &base_url, std::time::Instant::now())),
            Round::Connected
        ));
        let again = requests.recv().unwrap();
        assert!(again.starts_with("POST /v1/devices HTTP/1.1"), "{again}");
        assert!(again.contains("Bearer abcdefghijkmnpqr"), "{again}");
        assert_eq!(sent_field(&again, "token"), drawn);
        let settled = runtime.block_on(status(&state));
        assert_eq!(settled.key.as_deref(), Some(KEY));
        assert!(!settled.connect_pending);
        assert_eq!(
            settled.device.map(|device| device.id).as_deref(),
            Some(DEVICE_ID)
        );
    }

    /// A rate limit is waited out: the round asks the core, which
    /// answers the wait without a request, and the connection stays
    /// owed, as it was, for after it.
    #[test]
    fn a_rate_limited_connection_waits_without_a_request() {
        use crate::devices::{Round, round};

        let dir = tempfile::tempdir().unwrap();
        let state = empty_state(dir.path());
        let runtime = tokio::runtime::Runtime::new().unwrap();
        // A bare 429, as a proxy on the path sends it: no wait named,
        // so the core holds back for its own.
        let (base_url, requests) = stub_server(429, "<html>Too Many Requests</html>");
        let limited = runtime
            .block_on(state.manager.premium_connect(
                &base_url,
                KEY,
                DevicePlatform::current().unwrap(),
            ))
            .map_err(CommandError::from)
            .unwrap_err();
        assert_eq!(limited.kind, "premium_rate_limited");
        requests.recv().unwrap();

        assert!(matches!(
            runtime.block_on(round(&state, &base_url, std::time::Instant::now())),
            Round::Failed
        ));
        assert!(requests.try_recv().is_err(), "nothing sent before the wait");
        assert!(runtime.block_on(status(&state)).connect_pending);
    }

    /// A key forgotten while the server could not be told leaves its
    /// token to revoke: the next flush tells the server with that very
    /// token, once, and a flush with nothing owed sends nothing.
    #[test]
    fn a_connection_dropped_offline_is_revoked_later() {
        let dir = tempfile::tempdir().unwrap();
        let (state, _) = state_with_account(dir.path());
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime
            .block_on(state.manager.premium_log_out("http://127.0.0.1:9"))
            .unwrap();
        assert_eq!(runtime.block_on(status(&state)).key, None);

        let deleted = format!(r#"{{"id":"{DEVICE_ID}","deleted":true}}"#);
        let (base_url, requests) = stub_server(200, &deleted);
        runtime.block_on(flush_logouts(&state, &base_url));
        let request = requests.recv().unwrap();
        assert!(
            request.starts_with("DELETE /v1/devices/me HTTP/1.1"),
            "{request}"
        );
        assert!(request.contains(&format!("Bearer {TOKEN}")), "{request}");

        runtime.block_on(flush_logouts(&state, &base_url));
        assert!(requests.try_recv().is_err(), "nothing left to tell");
    }

    /// A key change whose answer was lost leaves the key in place and
    /// reads as unfinished; trying again sends the very same new key,
    /// and once the server has answered, it is the key shown. While it
    /// is unfinished the new key stays on the Rust side, and logging
    /// out, which would lose it, is refused under a kind of its own.
    #[test]
    fn a_key_change_whose_answer_was_lost_finishes_with_the_same_key() {
        let dir = tempfile::tempdir().unwrap();
        let (state, _) = state_with_account(dir.path());
        let runtime = tokio::runtime::Runtime::new().unwrap();

        let (base_url, requests) = stub_server(503, UNREACHABLE);
        runtime
            .block_on(state.manager.premium_change_key(&base_url))
            .unwrap_err();
        let first = requests.recv().unwrap();
        assert!(
            first.starts_with("POST /v1/account/key HTTP/1.1"),
            "{first}"
        );
        let drawn = sent_field(&first, "key");
        let hanging = runtime.block_on(status(&state));
        assert!(hanging.key_change_pending);
        assert_eq!(hanging.key.as_deref(), Some(KEY));
        let shown = serde_json::to_string(&hanging).unwrap();
        assert!(!shown.contains(&drawn), "{shown}");
        let refused = runtime
            .block_on(state.manager.premium_log_out(&base_url))
            .map_err(CommandError::from)
            .unwrap_err();
        assert_eq!(refused.kind, "premium_key_change_pending");

        let (base_url, requests) = stub_answers(vec![
            (200, format!(r#"{{"key":"{drawn}"}}"#)),
            (503, UNREACHABLE.to_owned()),
        ]);
        let new_key = runtime
            .block_on(state.manager.premium_change_key(&base_url))
            .unwrap();
        assert_eq!(sent_field(&requests.recv().unwrap(), "key"), drawn);
        let done = runtime.block_on(status(&state));
        assert!(!done.key_change_pending);
        assert_eq!(done.key, Some(new_key));
        assert!(!done.key_saved);
    }

    /// Forgetting the key on a device with full access disconnects it
    /// on the server, and connecting it again waits for an approval: it
    /// takes the secret. On a device that waits, it does not. Another
    /// key cannot stand in for the forgetting either.
    #[test]
    fn leaving_the_account_from_full_access_takes_the_secret() {
        let dir = tempfile::tempdir().unwrap();
        let (state, _) = state_with_account(dir.path());
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime
            .block_on(
                state
                    .manager
                    .set_app_lock(gerfaut_core::lock::LockKind::Pin, "2468", None),
            )
            .unwrap();
        assert!(runtime.block_on(full_access(&state)));
        assert!(!runtime.block_on(holds_key(&state, "2345-6789-abcd-efgh")));
        assert!(runtime.block_on(holds_key(&state, "ABCDEFGHIJKMNPQR")));

        // Waiting: no secret needed.
        seen_waiting(&state);
        assert!(!runtime.block_on(full_access(&state)));
    }

    /// The commands that ask for the secret only in some cases say so
    /// through the one helper, before anything else: forgetting the key
    /// with full access, adding a channel under a lock, removing a
    /// wallet the server watches.
    #[test]
    fn the_conditional_secrets_are_asked_first() {
        let premium = include_str!("premium.rs");
        let lib = include_str!("lib.rs");
        for (source, name, guard) in [
            (premium, "premium_forget", "if full_access(&state).await {"),
            (
                premium,
                "premium_add_channel",
                "if state.manager.app_lock().await.is_some() {",
            ),
            (
                lib,
                "remove_wallet",
                "remove_checked(&state, &id, secret.as_deref()).await?;",
            ),
        ] {
            let source = &source[..source.find("#[cfg(test)]").unwrap_or(source.len())];
            let start = source
                .find(&format!("fn {name}("))
                .unwrap_or_else(|| panic!("{name} is gone"));
            let lines: Vec<&str> = source[start..]
                .lines()
                .map(str::trim)
                .skip_while(|line| !line.ends_with('{'))
                .skip(1)
                .take(3)
                .collect();
            assert_eq!(lines.first(), Some(&"state.unlocked()?;"), "{name}");
            assert_eq!(lines.get(1), Some(&guard), "{name}");
        }
    }

    /// The secret is the lock screen's: without a lock the answer says
    /// one is needed, a wrong secret is refused with the wait the lock
    /// screen would show, and the failures are one count for both.
    #[test]
    fn the_identity_is_asked_of_the_app_lock() {
        let dir = tempfile::tempdir().unwrap();
        let (state, _) = state_with_account(dir.path());
        let runtime = tokio::runtime::Runtime::new().unwrap();

        let none = runtime
            .block_on(confirm_identity(&state, "2468"))
            .unwrap_err();
        assert_eq!(none.kind, "app_lock_required");

        runtime
            .block_on(
                state
                    .manager
                    .set_app_lock(gerfaut_core::lock::LockKind::Pin, "2468", None),
            )
            .unwrap();
        runtime.block_on(confirm_identity(&state, "2468")).unwrap();

        let wrong = runtime
            .block_on(confirm_identity(&state, "1111"))
            .unwrap_err();
        assert_eq!(wrong.kind, "identity_refused");
        assert_eq!(wrong.retry_after_secs, Some(0));
        let json = serde_json::to_value(&wrong).unwrap();
        assert_eq!(json["retry_after_secs"], 0);

        // The lock screen's count goes on from there: its next failure
        // is the second, and the third brings the wait here too.
        let verdict = runtime
            .block_on(state.manager.verify_app_lock("0000"))
            .unwrap();
        assert_eq!(verdict.failures, 2);
        let third = runtime
            .block_on(confirm_identity(&state, "3333"))
            .unwrap_err();
        assert!(third.retry_after_secs.unwrap() > 0, "{third:?}");
        // While it runs, even the right secret is not looked at.
        let waiting = runtime
            .block_on(confirm_identity(&state, "2468"))
            .unwrap_err();
        assert_eq!(waiting.kind, "identity_refused");

        // An error of any other kind carries no wait at all.
        let plain = serde_json::to_value(CommandError::new("internal", "x")).unwrap();
        assert!(plain.get("retry_after_secs").is_none());
    }

    /// Removing a wallet the server watches ends that watch, so it takes
    /// the secret unwatching takes; a wallet the server never had does
    /// not. A removal handed no secret is refused without counting
    /// against the lock.
    #[test]
    fn removing_a_watched_wallet_takes_the_secret() {
        let dir = tempfile::tempdir().unwrap();
        let (state, _) = state_with_account(dir.path());
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let mut premium = runtime.block_on(state.manager.premium_state());
        premium.consent("w-watched", NOW);
        runtime
            .block_on(state.manager.set_premium_state(premium))
            .unwrap();
        assert!(runtime.block_on(watched_by_server(&state, "w-watched")));
        assert!(!runtime.block_on(watched_by_server(&state, "w-local")));

        let none = runtime
            .block_on(confirm_identity_given(&state, None))
            .unwrap_err();
        assert_eq!(none.kind, "app_lock_required");
        runtime
            .block_on(
                state
                    .manager
                    .set_app_lock(gerfaut_core::lock::LockKind::Pin, "2468", None),
            )
            .unwrap();
        let missing = runtime
            .block_on(confirm_identity_given(&state, None))
            .unwrap_err();
        assert_eq!(missing.kind, "identity_refused");
        runtime
            .block_on(confirm_identity_given(&state, Some("2468")))
            .unwrap();
        let verdict = runtime
            .block_on(state.manager.verify_app_lock("0000"))
            .unwrap();
        assert_eq!(verdict.failures, 1, "the missing secret counted nothing");

        // Without a key, nothing the server watches goes with a wallet.
        runtime
            .block_on(state.manager.premium_log_out("http://127.0.0.1:9"))
            .unwrap();
        assert!(!runtime.block_on(watched_by_server(&state, "w-watched")));
    }

    const EMAIL_CHANNEL: &str = r#"{"id":"4f8f5252-b152-4fae-b142-5e6f70819203","kind":"email","target":"a…@example.org","linked":true,"link_code":null,"link_url":null,"linked_name":null,"enabled":true,"created_at":1789000004}"#;

    /// The code goes to the channel's own route with this device's
    /// token, the channel comes back as the list shows it, and a code
    /// the server refuses is refused in its words.
    #[test]
    fn confirming_a_channel_sends_the_code_and_reads_the_channel_back() {
        let dir = tempfile::tempdir().unwrap();
        let (state, _) = state_with_account(dir.path());
        let runtime = tokio::runtime::Runtime::new().unwrap();

        let (base_url, requests) = stub_server(200, EMAIL_CHANNEL);
        let view = runtime
            .block_on(confirm_channel(
                &state,
                &base_url,
                "4f8f5252-b152-4fae-b142-5e6f70819203",
                " 482913 ",
            ))
            .unwrap();
        assert_eq!(view.channel.kind, ChannelKind::Email);
        assert!(view.channel.linked);
        assert_eq!(view.telegram_url, None);
        let request = requests.recv().unwrap();
        assert!(
            request.starts_with(
                "POST /v1/channels/4f8f5252-b152-4fae-b142-5e6f70819203/confirm HTTP/1.1"
            ),
            "{request}"
        );
        assert!(request.contains(&format!("Bearer {TOKEN}")), "{request}");
        assert!(request.ends_with(r#"{"code":"482913"}"#), "{request}");

        // A wrong or expired code, and one try too many: the server's
        // sentence, under the kind the screen reads it by.
        for (status, body, words) in [
            (
                400,
                r#"{"error":"wrong or expired code"}"#,
                "wrong or expired code",
            ),
            (429, r#"{"error":"too many tries"}"#, "too many tries"),
        ] {
            let (base_url, _) = stub_server(status, body);
            let error = runtime
                .block_on(confirm_channel(&state, &base_url, "x", "000000"))
                .unwrap_err();
            assert_eq!(error.kind, "premium_rejected");
            assert_eq!(error.message, words);
        }

        // An empty code never leaves the app.
        let (base_url, requests) = stub_server(200, EMAIL_CHANNEL);
        let error = runtime
            .block_on(confirm_channel(&state, &base_url, "x", "  "))
            .unwrap_err();
        assert_eq!(error.kind, "invalid_input");
        assert!(requests.try_recv().is_err());
    }

    /// One request with this device's token; the key is forgotten here
    /// only once the server said the account is gone.
    #[test]
    fn deleting_the_account_forgets_the_key_once_the_server_confirms() {
        let dir = tempfile::tempdir().unwrap();
        let (state, _) = state_with_account(dir.path());
        let runtime = tokio::runtime::Runtime::new().unwrap();

        let (base_url, _) = stub_server(503, r#"{"error":"node unreachable"}"#);
        let error = runtime
            .block_on(delete_account(&state, &base_url))
            .unwrap_err();
        assert_eq!(error.kind, "premium_unreachable");
        assert_eq!(
            runtime.block_on(status(&state)).key.as_deref(),
            Some("abcd-efgh-ijkm-npqr")
        );

        let (base_url, requests) = stub_server(200, r#"{"deleted":true}"#);
        let after = runtime.block_on(delete_account(&state, &base_url)).unwrap();
        assert_eq!(after.key, None);
        assert_eq!(after.licence, None);
        assert_eq!(after.device, None);
        let request = requests.recv().unwrap();
        assert!(
            request.starts_with("DELETE /v1/account HTTP/1.1"),
            "{request}"
        );
        assert!(request.contains(&format!("Bearer {TOKEN}")), "{request}");
    }

    /// The commands that change who can use the account, or what it
    /// watches and where it tells, ask the app lock first, before any
    /// other line. The day one is added without it, this notices.
    #[test]
    fn every_sensitive_command_asks_for_the_secret_first() {
        const SENSITIVE: [&str; 6] = [
            "premium_approve_device",
            "premium_remove_device",
            "premium_change_key",
            "premium_delete_account",
            "premium_unwatch_wallet",
            "premium_delete_channel",
        ];
        let source = include_str!("premium.rs");
        let source = &source[..source.find("#[cfg(test)]").unwrap_or(source.len())];
        for name in SENSITIVE {
            let start = source
                .find(&format!("pub async fn {name}("))
                .unwrap_or_else(|| panic!("{name} is gone"));
            let body = &source[start..];
            let body = &body[..body.find("\n}\n").unwrap_or(body.len())];
            let lines: Vec<&str> = body
                .lines()
                .map(str::trim)
                .skip_while(|line| !line.ends_with('{'))
                .skip(1)
                .collect();
            assert_eq!(lines.first(), Some(&"state.unlocked()?;"), "{name}");
            assert_eq!(
                lines.get(1),
                Some(&"confirm_identity(&state, &secret).await?;"),
                "{name} asks for the app lock's secret before anything else"
            );
        }
    }
}
