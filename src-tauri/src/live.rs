//! Live alerts on the desktop.
//!
//! The core keeps one connection open to the configured backend and
//! says when a wallet moved. This module is what listens to it: one
//! task reads the events for as long as the process runs, posts the
//! system notifications itself, and tells the window to read again what
//! a sync changed.
//!
//! All of it lives on the Rust side on purpose. A minimised window has
//! its timers throttled and may be unloaded; a task of the process does
//! not care. For the same reason the watch keeps running behind the
//! lock screen: the lock is a curtain over the window, and what is
//! posted over it names no wallet and no amount (see [`crate::notice`]).
//!
//! The watch runs while "New transactions" is on in Settings ›
//! Notifications, and only then: holding a connection open tells the
//! server how long the app stays up, which is for the person to agree
//! to.
//!
//! A transaction is announced once. The core keeps the record in the
//! vault, and every path that announces goes through it: the events
//! here, and the reports of a sync asked for by hand.

use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant, SystemTime};

use gerfaut_core::WalletManager;
use gerfaut_core::live::{LiveEvent, LiveEvents};
use gerfaut_core::wallet::snapshot::SyncReport;
use gerfaut_core::watch::WatchStatus;
use serde::Serialize;
use tauri::{Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::notice::{self, Context, Held, Notice, Unit};
use crate::{AppState, CommandError, CommandResult};

/// The preference that turns the alerts, and with them the watch, on.
pub(crate) const NOTIFY_PREF: &str = "notify.new_tx";
const UNIT_PREF: &str = "display.unit";
const MASKED_PREF: &str = "desktop.masked";

/// A wallet was synced by the watch: the window reads it again.
const EVENT_WALLET_SYNCED: &str = "live://wallet-synced";
/// The sync a change asked for failed.
const EVENT_SYNC_FAILED: &str = "live://sync-failed";
/// The status of the watch moved. No payload: the window asks for it,
/// through a command the lock guards.
const EVENT_STATUS: &str = "live://status";

/// Notifications posted in one window of time, whatever the backend
/// says. A server can make a wallet look busy; it cannot make the
/// desktop ring without end.
const BUDGET: u32 = 20;
const BUDGET_WINDOW: Duration = Duration::from_secs(60);

/// Wallets with transactions held for their sync to end. Far above any
/// vault; past it everything held is dropped rather than grown.
const MAX_HELD_WALLETS: usize = 512;

/// How often the wall clock is looked at, and the jump that reads as
/// "the machine slept": Tauri has no resume or network signal, so the
/// clock is what tells.
const CLOCK_EVERY: Duration = Duration::from_secs(30);
const CLOCK_JUMP: Duration = Duration::from_secs(90);

/// A cap on what is posted per minute.
#[derive(Debug)]
pub(crate) struct Budget {
    started: Option<Instant>,
    spent: u32,
}

/// What the budget says about one more notification.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Allowance {
    Post,
    /// The last one of the window: say that more is waiting instead.
    LastCall,
    Silent,
}

impl Budget {
    pub(crate) const fn new() -> Self {
        Budget {
            started: None,
            spent: 0,
        }
    }

    pub(crate) fn allow(&mut self, now: Instant) -> Allowance {
        let fresh = self
            .started
            .is_none_or(|started| now.duration_since(started) >= BUDGET_WINDOW);
        if fresh {
            self.started = Some(now);
            self.spent = 0;
        }
        self.spent = self.spent.saturating_add(1);
        match self.spent {
            n if n < BUDGET => Allowance::Post,
            n if n == BUDGET => Allowance::LastCall,
            _ => Allowance::Silent,
        }
    }
}

/// What the task owes the window after an event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Signal {
    WalletSynced { wallet_id: String },
    SyncFailed { wallet_id: String, message: String },
    Status,
}

/// What one event amounts to.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Outcome {
    /// A wallet's sync ended with these to announce.
    pub announce: Option<(String, Held)>,
    pub signal: Option<Signal>,
}

/// Holds the transactions of a sync until the sync is over, so that
/// "three, then a count" is said per sync and not per transaction. The
/// core sends a wallet's transactions first and its `WalletSynced`
/// last, from one task.
#[derive(Debug, Default)]
pub(crate) struct Announcer {
    held: HashMap<String, Held>,
}

impl Announcer {
    pub(crate) fn on_event(&mut self, event: LiveEvent) -> Outcome {
        match event {
            LiveEvent::Transaction(tx) => {
                if self.held.len() >= MAX_HELD_WALLETS && !self.held.contains_key(&tx.wallet_id) {
                    self.held.clear();
                }
                self.held.entry(tx.wallet_id.clone()).or_default().push(tx);
                Outcome::default()
            }
            LiveEvent::WalletSynced { report } => {
                let announce = self
                    .held
                    .remove(&report.wallet_id)
                    .filter(|held| !held.is_empty())
                    .map(|held| (report.wallet_id.clone(), held));
                Outcome {
                    announce,
                    signal: Some(Signal::WalletSynced {
                        wallet_id: report.wallet_id,
                    }),
                }
            }
            LiveEvent::SyncFailed { wallet_id, message } => {
                self.held.remove(&wallet_id);
                Outcome {
                    announce: None,
                    signal: Some(Signal::SyncFailed { wallet_id, message }),
                }
            }
            LiveEvent::NewBlock { .. } => Outcome::default(),
            LiveEvent::Status(_) => Outcome {
                announce: None,
                signal: Some(Signal::Status),
            },
        }
    }
}

/// The running watch, as the app holds it.
pub(crate) struct LiveAlerts {
    /// The task reading the events; present while the watch runs.
    task: tokio::sync::Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    budget: std::sync::Mutex<Budget>,
}

impl Default for LiveAlerts {
    fn default() -> Self {
        LiveAlerts {
            task: tokio::sync::Mutex::new(None),
            budget: std::sync::Mutex::new(Budget::new()),
        }
    }
}

/// Whether the person asked to be told.
pub(crate) async fn enabled(manager: &WalletManager) -> bool {
    manager
        .settings()
        .await
        .app_prefs
        .get(NOTIFY_PREF)
        .is_some_and(|value| value == "1")
}

/// What the text depends on, read from the vault at the moment of
/// posting: a name changed, a mask raised or a lock drawn since the
/// sync began all count.
async fn context(state: &AppState) -> Context {
    let prefs = state.manager.settings().await.app_prefs;
    let names = state
        .manager
        .list_wallets(None)
        .await
        .into_iter()
        .map(|meta| (meta.id, meta.name))
        .collect();
    Context {
        names,
        unit: match prefs.get(UNIT_PREF).map(String::as_str) {
            Some("sats") => Unit::Sats,
            _ => Unit::Btc,
        },
        masked: prefs.get(MASKED_PREF).is_some_and(|value| value == "1"),
        locked: state.locked.load(Ordering::SeqCst),
    }
}

/// The notices the budget lets through, the last of them replaced by a
/// line saying more is waiting.
pub(crate) fn within_budget(
    budget: &mut Budget,
    notices: Vec<Notice>,
    now: Instant,
) -> Vec<Notice> {
    let mut out = Vec::new();
    for notice in notices {
        match budget.allow(now) {
            Allowance::Post => out.push(notice),
            Allowance::LastCall => out.push(Notice {
                title: notice::APP_TITLE.to_owned(),
                body: "More transactions are coming in. Open Gerfaut to see them.".to_owned(),
            }),
            Allowance::Silent => {}
        }
    }
    out
}

fn post(app: &tauri::AppHandle, notice: &Notice) -> Result<(), String> {
    app.notification()
        .builder()
        .title(&notice.title)
        .body(&notice.body)
        .show()
        .map_err(|e| e.to_string())
}

/// Posts what one wallet's sync amounts to. A notification that cannot
/// be posted is not a failed sync: it is dropped, quietly.
async fn announce(app: &tauri::AppHandle, wallet_id: &str, held: &Held) {
    let state = app.state::<AppState>();
    let context = context(&state).await;
    let notices = notice::compose(wallet_id, held, &context);
    let notices = {
        let mut budget = state
            .live
            .budget
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        within_budget(&mut budget, notices, Instant::now())
    };
    for notice in &notices {
        let _ = post(app, notice);
    }
}

/// Announces what a sync asked for by hand found, through the record
/// the watch uses, so that neither says what the other said. The claim
/// is made even with the alerts off: what was seen with them off is
/// not news the day they are turned on. `first_sync` is a wallet's
/// import, whose whole history is "new" and none of it news.
pub(crate) async fn announce_report(app: &tauri::AppHandle, report: &SyncReport, first_sync: bool) {
    let state = app.state::<AppState>();
    let Ok(claimed) = state.manager.claim_announcements(report).await else {
        return;
    };
    if first_sync || claimed.is_empty() || !enabled(&state.manager).await {
        return;
    }
    let held: Held = claimed.into_iter().collect();
    announce(app, &report.wallet_id, &held).await;
}

/// The wallets that have never been synced: their next sync is an
/// import. Read before a sync, which is what stamps them.
pub(crate) async fn never_synced(manager: &WalletManager) -> Vec<String> {
    manager
        .list_wallets(None)
        .await
        .into_iter()
        .filter(|meta| meta.last_sync.is_none())
        .map(|meta| meta.id)
        .collect()
}

/// Reads the events until the watch stops.
async fn run(app: tauri::AppHandle, mut events: LiveEvents) {
    let mut announcer = Announcer::default();
    while let Some(event) = events.next().await {
        let outcome = announcer.on_event(event);
        if let Some((wallet_id, held)) = outcome.announce {
            announce(&app, &wallet_id, &held).await;
        }
        let Some(signal) = outcome.signal else {
            continue;
        };
        // Behind the lock the window is told nothing of a wallet, not
        // even that one moved: it reads everything again at the unlock.
        let locked = app.state::<AppState>().locked.load(Ordering::SeqCst);
        match signal {
            Signal::Status => {
                let _ = app.emit(EVENT_STATUS, ());
            }
            Signal::WalletSynced { wallet_id } if !locked => {
                let _ = app.emit(EVENT_WALLET_SYNCED, WalletSignal { wallet_id });
            }
            Signal::SyncFailed { wallet_id, message } if !locked => {
                let _ = app.emit(EVENT_SYNC_FAILED, FailureSignal { wallet_id, message });
            }
            Signal::WalletSynced { .. } | Signal::SyncFailed { .. } => {}
        }
    }
}

#[derive(Debug, Clone, Serialize)]
struct WalletSignal {
    wallet_id: String,
}

#[derive(Debug, Clone, Serialize)]
struct FailureSignal {
    wallet_id: String,
    message: String,
}

/// Starts or stops the watch so that it matches the preference. Called
/// at launch, and whenever the preference may have moved. The settings
/// and the wallets change under a running watch without a call: the
/// core follows the backend, the network, Tor and the wallet list.
pub(crate) async fn apply(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let wanted = enabled(&state.manager).await;
    let mut task = state.live.task.lock().await;
    match (wanted, task.is_some()) {
        (true, false) => {
            if let Ok(events) = state.manager.live_start().await {
                *task = Some(tauri::async_runtime::spawn(run(app.clone(), events)));
                let _ = app.emit(EVENT_STATUS, ());
            }
        }
        (false, true) => {
            state.manager.live_stop().await;
            // The receiver closed with the watch; the task ends on its
            // own, having posted what it held.
            task.take();
            let _ = app.emit(EVENT_STATUS, ());
        }
        _ => {}
    }
}

/// How long quitting waits for the watch to close its connection.
const SHUTDOWN_BUDGET: Duration = Duration::from_secs(3);

/// Closes the connection on the way out. Bounded: a clean goodbye to
/// the server is a courtesy, and quitting never waits on one.
pub(crate) fn shutdown(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        tauri::async_runtime::block_on(async {
            let _ = tokio::time::timeout(SHUTDOWN_BUDGET, state.manager.live_stop()).await;
        });
    }
}

/// Watches the wall clock for the jump a sleeping machine leaves, and
/// has the connection checked at once when it sees one: timers do not
/// all count the time asleep, and a socket can die in it unnoticed.
pub(crate) async fn keep_time(app: tauri::AppHandle) {
    let mut last = SystemTime::now();
    loop {
        tokio::time::sleep(CLOCK_EVERY).await;
        let now = SystemTime::now();
        // A clock set backwards reads as no time at all; forwards, as
        // a sleep, which costs one ping.
        let elapsed = now.duration_since(last).unwrap_or_default();
        last = now;
        if elapsed >= CLOCK_JUMP
            && let Some(state) = app.try_state::<AppState>()
        {
            state.manager.live_tick().await;
        }
    }
}

/// What Settings › Notifications shows about the watch.
#[derive(Debug, Clone, Serialize)]
pub struct LiveStatus {
    /// The preference is on, so a watch should be running.
    pub enabled: bool,
    pub status: WatchStatus,
}

/// Where the watch stands. Behind the lock it answers nothing: the
/// status names the server.
#[tauri::command]
pub async fn live_status(state: tauri::State<'_, AppState>) -> CommandResult<LiveStatus> {
    state.unlocked()?;
    Ok(LiveStatus {
        enabled: enabled(&state.manager).await,
        status: state.manager.live_status().await,
    })
}

/// Posts one notification with fixed words, so the person can see
/// whether the system shows them at all. The desktop platforms report
/// every permission as granted; this is the only honest check. It is
/// the one way the window has to make the system ring, so it draws on
/// the same budget as the alerts: a page gone wrong cannot flood with it.
#[tauri::command]
pub async fn send_test_notification(app: tauri::AppHandle) -> CommandResult<()> {
    let allowance = app
        .state::<AppState>()
        .live
        .budget
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .allow(Instant::now());
    if allowance != Allowance::Post {
        return Err(CommandError {
            kind: "notification",
            message: "too many notifications in the last minute; try again shortly".to_owned(),
        });
    }
    post(
        &app,
        &Notice {
            title: notice::APP_TITLE.to_owned(),
            body: "This is a test. Alerts about your wallets appear like this one.".to_owned(),
        },
    )
    .map_err(|message| CommandError {
        kind: "notification",
        message,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use gerfaut_core::live::LiveTx;
    use gerfaut_core::store::{TxStage, VaultKey};
    use gerfaut_core::wallet::snapshot::{BalanceSnapshot, NewTx};

    fn tx(wallet_id: &str, txid: &str, stage: TxStage) -> LiveTx {
        LiveTx {
            wallet_id: wallet_id.to_owned(),
            txid: txid.to_owned(),
            net_sats: 1_000,
            stage,
        }
    }

    fn report(wallet_id: &str, new_txs: Vec<NewTx>, confirmed_txs: Vec<NewTx>) -> SyncReport {
        SyncReport {
            wallet_id: wallet_id.to_owned(),
            new_tx_count: new_txs.len() as u32,
            new_txs,
            confirmed_txs,
            balance: BalanceSnapshot::default(),
            tip_height: 0,
            took_ms: 0,
            backend: "example.invalid".to_owned(),
        }
    }

    fn new_tx(txid: &str, confirmed: bool) -> NewTx {
        NewTx {
            txid: txid.to_owned(),
            net_sats: 1_000,
            confirmed,
        }
    }

    /// The stream as the core sends it: a wallet's transactions, then
    /// the end of its sync. Nothing is said before the sync is over,
    /// and then everything at once, per wallet.
    #[test]
    fn transactions_are_held_until_their_wallet_is_synced() {
        let mut announcer = Announcer::default();
        for i in 0..5 {
            let outcome = announcer.on_event(LiveEvent::Transaction(tx(
                "w1",
                &format!("a{i}"),
                TxStage::Mempool,
            )));
            assert_eq!(outcome, Outcome::default());
        }
        announcer.on_event(LiveEvent::Transaction(tx("w2", "b0", TxStage::Confirmed)));

        let outcome = announcer.on_event(LiveEvent::WalletSynced {
            report: report("w1", vec![], vec![]),
        });
        let (wallet_id, held) = outcome.announce.expect("w1 has something to say");
        assert_eq!(wallet_id, "w1");
        assert_eq!(held.first.len(), 3);
        assert_eq!(held.more, 2);
        assert_eq!(
            outcome.signal,
            Some(Signal::WalletSynced {
                wallet_id: "w1".to_owned()
            })
        );

        // The other wallet's is still held, and said once.
        let outcome = announcer.on_event(LiveEvent::WalletSynced {
            report: report("w2", vec![], vec![]),
        });
        assert_eq!(outcome.announce.map(|(_, held)| held.first.len()), Some(1));
        let again = announcer.on_event(LiveEvent::WalletSynced {
            report: report("w2", vec![], vec![]),
        });
        assert_eq!(again.announce, None);
    }

    #[test]
    fn a_sync_with_nothing_new_refreshes_and_says_nothing() {
        let mut announcer = Announcer::default();
        let outcome = announcer.on_event(LiveEvent::WalletSynced {
            report: report("w1", vec![], vec![]),
        });
        assert_eq!(outcome.announce, None);
        assert!(matches!(outcome.signal, Some(Signal::WalletSynced { .. })));

        assert_eq!(
            announcer.on_event(LiveEvent::NewBlock { height: 1 }),
            Outcome::default()
        );
        assert_eq!(
            announcer
                .on_event(LiveEvent::Status(WatchStatus::default()))
                .signal,
            Some(Signal::Status)
        );
    }

    #[test]
    fn a_failed_sync_drops_what_was_held_for_it() {
        let mut announcer = Announcer::default();
        announcer.on_event(LiveEvent::Transaction(tx("w1", "a", TxStage::Mempool)));
        let outcome = announcer.on_event(LiveEvent::SyncFailed {
            wallet_id: "w1".to_owned(),
            message: "timed out".to_owned(),
        });
        assert_eq!(outcome.announce, None);
        let later = announcer.on_event(LiveEvent::WalletSynced {
            report: report("w1", vec![], vec![]),
        });
        assert_eq!(later.announce, None);
    }

    /// A flood of wallet ids never grows the map without end.
    #[test]
    fn what_is_held_is_bounded() {
        let mut announcer = Announcer::default();
        for i in 0..(MAX_HELD_WALLETS * 3) {
            announcer.on_event(LiveEvent::Transaction(tx(
                &format!("w{i}"),
                "a",
                TxStage::Mempool,
            )));
            assert!(announcer.held.len() <= MAX_HELD_WALLETS);
        }
    }

    #[test]
    fn the_budget_caps_a_minute_and_says_more_is_waiting() {
        let mut budget = Budget::new();
        let start = Instant::now();
        let notices: Vec<Notice> = (0..50)
            .map(|i| Notice {
                title: "w".to_owned(),
                body: format!("n{i}"),
            })
            .collect();
        let posted = within_budget(&mut budget, notices.clone(), start);
        assert_eq!(posted.len(), BUDGET as usize);
        assert_eq!(posted[0].body, "n0");
        assert_eq!(
            posted.last().map(|notice| notice.body.as_str()),
            Some("More transactions are coming in. Open Gerfaut to see them.")
        );
        // Nothing more inside the window, everything again after it.
        assert!(
            within_budget(
                &mut budget,
                notices.clone(),
                start + Duration::from_secs(30)
            )
            .is_empty()
        );
        let later = within_budget(&mut budget, notices, start + BUDGET_WINDOW);
        assert_eq!(later.len(), BUDGET as usize);
    }

    /// The watch and a sync asked for by hand can both hold the same
    /// report. Whoever claims first announces; the other gets nothing,
    /// now and after a restart. The confirmation is a second, separate
    /// announcement, made once too.
    #[test]
    fn a_transaction_is_claimed_once_per_stage_whoever_asks() {
        let dir = tempfile::tempdir().unwrap();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let manager = WalletManager::open(dir.path(), VaultKey::Raw([7u8; 32])).unwrap();
        let seen = report("w1", vec![new_tx("aa", false), new_tx("bb", true)], vec![]);

        let first = runtime
            .block_on(manager.claim_announcements(&seen))
            .unwrap();
        assert_eq!(first.len(), 2);
        assert_eq!(first[0].stage, TxStage::Mempool);
        assert_eq!(first[1].stage, TxStage::Confirmed);
        let second = runtime
            .block_on(manager.claim_announcements(&seen))
            .unwrap();
        assert!(second.is_empty(), "{second:?}");

        let confirmed = report("w1", vec![], vec![new_tx("aa", true)]);
        let once = runtime
            .block_on(manager.claim_announcements(&confirmed))
            .unwrap();
        assert_eq!(once.len(), 1);
        assert_eq!(once[0].stage, TxStage::Confirmed);
        assert!(
            runtime
                .block_on(manager.claim_announcements(&confirmed))
                .unwrap()
                .is_empty()
        );

        // The record is in the vault: a restart changes nothing.
        drop(manager);
        let reopened = WalletManager::open(dir.path(), VaultKey::Raw([7u8; 32])).unwrap();
        assert!(
            runtime
                .block_on(reopened.claim_announcements(&seen))
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn the_watch_follows_the_preference() {
        let dir = tempfile::tempdir().unwrap();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let manager = WalletManager::open(dir.path(), VaultKey::Raw([7u8; 32])).unwrap();
        assert!(!runtime.block_on(enabled(&manager)));
        runtime
            .block_on(manager.set_app_pref(NOTIFY_PREF.to_owned(), "1".to_owned()))
            .unwrap();
        assert!(runtime.block_on(enabled(&manager)));
        runtime
            .block_on(manager.set_app_pref(NOTIFY_PREF.to_owned(), "0".to_owned()))
            .unwrap();
        assert!(!runtime.block_on(enabled(&manager)));
    }
}
