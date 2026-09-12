//! The premium commands: the account key and its licence, the wallets
//! the server watches, the channels it tells, and the heartbeat that
//! says it is up.
//!
//! Every request leaves from here, and every signature is checked here,
//! by the core, against the key it embeds. The webview shows what was
//! verified and never judges a certificate or a heartbeat itself; the
//! descriptor a wallet is registered with is read from the vault, not
//! taken from the screen.

use std::time::{SystemTime, UNIX_EPOCH};

use gerfaut_core::premium::client::{
    DEFAULT_BASE_URL, NTFY_BASE_URL, TELEGRAM_BOT, new_ntfy_topic, ntfy_subscribe_url,
    telegram_link_url,
};
use gerfaut_core::premium::licence::{self, LICENCE_PUBLIC_KEY_HEX};
use gerfaut_core::premium::{
    Account, Channel, ChannelKind, Event, HeartbeatReport, LicenceState, PremiumClient,
    PremiumState, WalletWatch,
};
use gerfaut_core::wallet::meta::WalletKind;
use serde::Serialize;

use crate::{AppState, CommandError, CommandResult};

/// How many events the "Recent alerts" card shows.
const RECENT_EVENTS: usize = 20;
/// How many events are asked of the server to find the recent ones: its
/// own cap. The route pages forward from an id; the latest are the tail.
const EVENTS_PAGE: u32 = 500;
/// How long a dismissed "watch is offline" banner stays quiet: a day.
/// A heartbeat that verifies again clears it sooner; an outage that
/// outlives it is worth a second look.
const ACKNOWLEDGE_SECS: i64 = 24 * 60 * 60;

/// What the vault says about the account, readable without a network.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PremiumStatus {
    /// The account key as it is shown, `xxxx-xxxx-xxxx-xxxx`; null until
    /// one is entered.
    pub key: Option<String>,
    /// What the stored certificate says right now, verified offline
    /// against the embedded key; null without a certificate, and for
    /// one this build cannot verify.
    pub licence: Option<LicenceState>,
    /// The wallets the user agreed to send to the server.
    pub consented: Vec<String>,
    /// Unix seconds until which the "watch is offline" banner stays
    /// quiet because it was dismissed.
    pub acknowledged_offline_until: Option<i64>,
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
    }
}

/// The descriptor text a wallet is registered with: the external
/// descriptor alone, or both on two lines, the form the core's own
/// parser reads back. A single address has none.
fn descriptor_input(kind: &WalletKind) -> Option<String> {
    match kind {
        WalletKind::Descriptors {
            external,
            internal: Some(internal),
            ..
        } => Some(format!("{external}\n{internal}")),
        WalletKind::Descriptors {
            external,
            internal: None,
            ..
        } => Some(external.clone()),
        WalletKind::SingleAddress { .. } => None,
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

async fn client(state: &AppState) -> CommandResult<PremiumClient> {
    Ok(state.manager.premium_client(DEFAULT_BASE_URL).await?)
}

/// Tells the server about the wallets removed from this device since it
/// last heard, and lets a failure go: what could not be told stays
/// queued in the vault for the next call, and whatever the caller came
/// to do does not depend on it.
pub(crate) async fn flush_unwatch(state: &AppState) {
    let _ = state.manager.premium_flush_unwatch(DEFAULT_BASE_URL).await;
}

async fn status(state: &AppState) -> PremiumStatus {
    status_of(
        &state.manager.premium_state().await,
        LICENCE_PUBLIC_KEY_HEX,
        now_unix(),
    )
}

/// Stores the certificate a licence answer carried, and the key it was
/// asked with when one is given.
async fn store_licence(
    state: &AppState,
    key: Option<&str>,
    certificate: String,
) -> CommandResult<()> {
    let mut premium = state.manager.premium_state().await;
    if let Some(key) = key {
        premium.key = Some(licence::normalize_key(key));
    }
    premium.certificate = Some(certificate);
    state.manager.set_premium_state(premium).await?;
    Ok(())
}

// --- commands ----------------------------------------------------------

/// The account as the vault knows it: no network, so the section opens
/// the same offline.
#[tauri::command]
pub async fn premium_status(state: tauri::State<'_, AppState>) -> CommandResult<PremiumStatus> {
    state.unlocked()?;
    Ok(status(&state).await)
}

/// Asks the server for the licence of a key just typed, and keeps both
/// once the certificate verifies. A key the server does not know, or one
/// never paid for, is refused and nothing is stored.
#[tauri::command]
pub async fn premium_activate(
    state: tauri::State<'_, AppState>,
    key: String,
) -> CommandResult<PremiumStatus> {
    state.unlocked()?;
    if !licence::is_well_formed_key(&key) {
        return Err(CommandError {
            kind: "invalid_input",
            message: "a key is sixteen letters and digits".to_owned(),
        });
    }
    let mut client = client(&state).await?;
    client.set_key(Some(key.clone()));
    let licence = client.licence().await?;
    store_licence(&state, Some(&key), licence.certificate).await?;
    Ok(status(&state).await)
}

/// Drops the key and its certificate from this device. The server keeps
/// watching what it was told to; the consents stay, so a wallet already
/// agreed to is not asked about twice.
#[tauri::command]
pub async fn premium_forget(state: tauri::State<'_, AppState>) -> CommandResult<PremiumStatus> {
    state.unlocked()?;
    let mut premium = state.manager.premium_state().await;
    premium.key = None;
    premium.certificate = None;
    premium.acknowledged_offline_until = None;
    state.manager.set_premium_state(premium).await?;
    Ok(status(&state).await)
}

/// The account from the server, and the certificate refreshed on the
/// way when the server hands one out: a renewal made on the site shows
/// its new date here. A key with no paid time still reads its account.
#[tauri::command]
pub async fn premium_account(state: tauri::State<'_, AppState>) -> CommandResult<PremiumAccount> {
    state.unlocked()?;
    let client = client(&state).await?;
    let account = client.account().await?;
    if let Ok(licence) = client.licence().await {
        store_licence(&state, None, licence.certificate).await?;
    }
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
    flush_unwatch(&state).await;
    Ok(client(&state).await?.wallets().await?)
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
        .ok_or_else(|| CommandError {
            kind: "wallet_not_found",
            message: format!("no wallet with id {id}"),
        })?;
    let input = descriptor_input(&wallet.kind).ok_or_else(|| CommandError {
        kind: "invalid_input",
        message: "a single address cannot be watched yet".to_owned(),
    })?;
    let mut premium = state.manager.premium_state().await;
    premium.consent(&id, now_unix());
    state.manager.set_premium_state(premium).await?;
    client(&state)
        .await?
        .put_wallet(&id, &wallet.name, &input)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn premium_unwatch_wallet(
    state: tauri::State<'_, AppState>,
    id: String,
) -> CommandResult<()> {
    state.unlocked()?;
    Ok(client(&state).await?.delete_wallet(&id).await?)
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
/// and comes back with the code to send the bot.
#[tauri::command]
pub async fn premium_add_channel(
    state: tauri::State<'_, AppState>,
    kind: ChannelKind,
    target: Option<String>,
    secret: Option<String>,
) -> CommandResult<NewChannel> {
    state.unlocked()?;
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

#[tauri::command]
pub async fn premium_delete_channel(
    state: tauri::State<'_, AppState>,
    id: String,
) -> CommandResult<()> {
    state.unlocked()?;
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
    confirm_channel(&state, DEFAULT_BASE_URL, &id, &code).await
}

async fn confirm_channel(
    state: &AppState,
    base_url: &str,
    id: &str,
    code: &str,
) -> CommandResult<ChannelView> {
    let code = code.trim();
    if code.is_empty() {
        return Err(CommandError {
            kind: "invalid_input",
            message: "type the code from the e-mail".to_owned(),
        });
    }
    let channel = state
        .manager
        .premium_confirm_channel(base_url, id, code)
        .await?;
    Ok(view_of(channel))
}

/// Deletes the account on the server, everything it watches and tells
/// included, and forgets the key here once the server said it did. The
/// opposite of `premium_forget`, which leaves the server as it is.
#[tauri::command]
pub async fn premium_delete_account(
    state: tauri::State<'_, AppState>,
) -> CommandResult<PremiumStatus> {
    state.unlocked()?;
    delete_account(&state, DEFAULT_BASE_URL).await
}

async fn delete_account(state: &AppState, base_url: &str) -> CommandResult<PremiumStatus> {
    state.manager.premium_delete_account(base_url).await?;
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

/// The server's heartbeat, verified against the embedded key and this
/// device's clock. One that verifies also lifts a dismissed banner: the
/// next outage is a new one, and gets shown. The pulse is also when a
/// wallet removed while the server was out of reach gets unwatched
/// there: every fifteen minutes, the queue gets its chance.
#[tauri::command]
pub async fn premium_heartbeat(
    state: tauri::State<'_, AppState>,
) -> CommandResult<HeartbeatReport> {
    state.unlocked()?;
    flush_unwatch(&state).await;
    let report = client(&state).await?.heartbeat(now_unix()).await?;
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

#[cfg(test)]
mod tests {
    use data_encoding::{BASE64URL_NOPAD, HEXLOWER};
    use ed25519_dalek::{Signer, SigningKey};
    use gerfaut_core::input::ScriptKind;
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
            }
        );
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
            pending_unwatch: Vec::new(),
        };
        let status = status_of(&state, &public, NOW);
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
            descriptor_input(&pair).as_deref(),
            Some("wpkh(A/0/*)#aaaaaaaa\nwpkh(A/1/*)#bbbbbbbb")
        );
        let external_only = WalletKind::Descriptors {
            external: "wpkh(A/0/*)#aaaaaaaa".to_owned(),
            internal: None,
            script: ScriptKind::Segwit,
        };
        assert_eq!(
            descriptor_input(&external_only).as_deref(),
            Some("wpkh(A/0/*)#aaaaaaaa")
        );
        let address = WalletKind::SingleAddress {
            address: "bc1q...".to_owned(),
        };
        assert_eq!(descriptor_input(&address), None);
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
    // loopback that answers every request the same way and hands each
    // request to the test: what left the app is checked byte by byte.

    use std::io::{Read, Write};
    use std::net::{Ipv4Addr, Shutdown, TcpListener};
    use std::sync::mpsc;

    use gerfaut_core::WalletManager;
    use gerfaut_core::store::VaultKey;

    /// One HTTP request, read whole: the head, then as much body as its
    /// `Content-Length` announces.
    fn read_request(stream: &mut std::net::TcpStream) -> String {
        let mut bytes = Vec::new();
        let mut buf = [0u8; 4096];
        loop {
            let n = stream.read(&mut buf).unwrap_or(0);
            if n == 0 {
                break;
            }
            bytes.extend_from_slice(&buf[..n]);
            let text = String::from_utf8_lossy(&bytes);
            let Some(end) = text.find("\r\n\r\n") else {
                continue;
            };
            let length = text[..end]
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse::<usize>().ok())
                        .flatten()
                })
                .unwrap_or(0);
            if bytes.len() >= end + 4 + length {
                break;
            }
        }
        String::from_utf8_lossy(&bytes).into_owned()
    }

    /// A premium server on loopback that answers every request with
    /// `status` and `body`, and hands each request to the test.
    fn stub_server(status: u16, body: &'static str) -> (String, mpsc::Receiver<String>) {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                let request = read_request(&mut stream);
                let _ = sender.send(request);
                let response = format!(
                    "HTTP/1.1 {status} Stub\r\nContent-Type: application/json\r\n\
                     Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.shutdown(Shutdown::Both);
            }
        });
        (format!("http://{address}"), receiver)
    }

    /// A fresh vault holding an account: a key and a certificate.
    fn state_with_account(dir: &std::path::Path) -> AppState {
        let manager = WalletManager::open(dir, VaultKey::Raw([7u8; 32])).unwrap();
        let (signing, _) = signer();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime
            .block_on(manager.set_premium_state(PremiumState {
                key: Some("abcdefghijkmnpqr".to_owned()),
                certificate: Some(issue(&signing, NOW + 86_400)),
                ..PremiumState::default()
            }))
            .unwrap();
        AppState {
            manager,
            locked: std::sync::atomic::AtomicBool::new(false),
        }
    }

    const EMAIL_CHANNEL: &str = r#"{"id":"4f8f5252-b152-4fae-b142-5e6f70819203","kind":"email","target":"a…@example.org","linked":true,"link_code":null,"link_url":null,"linked_name":null,"enabled":true,"created_at":1789000004}"#;

    /// The code goes to the channel's own route with the stored key,
    /// the channel comes back as the list shows it, and a code the
    /// server refuses is refused in its words.
    #[test]
    fn confirming_a_channel_sends_the_code_and_reads_the_channel_back() {
        let dir = tempfile::tempdir().unwrap();
        let state = state_with_account(dir.path());
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
        assert!(request.contains("Bearer abcdefghijkmnpqr"), "{request}");
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

    /// One request with the stored key; the key is forgotten here only
    /// once the server said the account is gone.
    #[test]
    fn deleting_the_account_forgets_the_key_once_the_server_confirms() {
        let dir = tempfile::tempdir().unwrap();
        let state = state_with_account(dir.path());
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
        let request = requests.recv().unwrap();
        assert!(
            request.starts_with("DELETE /v1/account HTTP/1.1"),
            "{request}"
        );
        assert!(request.contains("Bearer abcdefghijkmnpqr"), "{request}");
    }
}
