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
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime};

use gerfaut_core::WalletManager;
use gerfaut_core::live::{LiveEvent, LiveEvents};
use gerfaut_core::wallet::snapshot::SyncReport;
use gerfaut_core::watch::WatchStatus;
use serde::Serialize;
use tauri::{Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::notice::{self, Context, Held, Notice, NoticeKind, Unit};
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
/// desktop ring without end. Payments no longer coming draw on a
/// budget of the same size of their own.
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

/// One budget per kind of notification: a burst of new transactions
/// never silences a payment that is no longer coming.
#[derive(Debug)]
pub(crate) struct Budgets {
    transactions: Budget,
    dropped: Budget,
}

impl Budgets {
    pub(crate) const fn new() -> Self {
        Budgets {
            transactions: Budget::new(),
            dropped: Budget::new(),
        }
    }
}

/// The running watch, as the app holds it.
pub(crate) struct LiveAlerts {
    /// The task reading the events; present while the watch runs.
    task: tokio::sync::Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    budgets: std::sync::Mutex<Budgets>,
}

impl Default for LiveAlerts {
    fn default() -> Self {
        LiveAlerts {
            task: tokio::sync::Mutex::new(None),
            budgets: std::sync::Mutex::new(Budgets::new()),
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

/// The notices the budgets let through, the last one of each kind
/// replaced by a line saying more is waiting.
pub(crate) fn within_budget(
    budgets: &mut Budgets,
    notices: Vec<Notice>,
    now: Instant,
) -> Vec<Notice> {
    let mut out = Vec::new();
    for notice in notices {
        let (budget, last_call) = match notice.kind {
            NoticeKind::Transaction => (
                &mut budgets.transactions,
                "More transactions are coming in. Open Gerfaut to see them.",
            ),
            NoticeKind::Dropped => (
                &mut budgets.dropped,
                "More pending payments are no longer coming. Open Gerfaut to see them.",
            ),
        };
        match budget.allow(now) {
            Allowance::Post => out.push(notice),
            Allowance::LastCall => out.push(Notice {
                title: notice::APP_TITLE.to_owned(),
                body: last_call.to_owned(),
                kind: notice.kind,
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

/// What one wallet's news amounts to, as it may be posted now. Nothing
/// once the alerts are off: a watch being stopped still hands out what
/// it held, and that is dropped rather than said to someone who just
/// turned them off. Otherwise the text is read against the vault and
/// the lock as they are at this moment, within the budgets.
async fn notices_for(state: &AppState, wallet_id: &str, held: &Held) -> Vec<Notice> {
    if !enabled(&state.manager).await {
        return Vec::new();
    }
    let context = context(state).await;
    let notices = notice::compose(wallet_id, held, &context);
    let mut budgets = state
        .live
        .budgets
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    within_budget(&mut budgets, notices, Instant::now())
}

/// Posts what one wallet's sync amounts to. A notification that cannot
/// be posted is not a failed sync: it is dropped, quietly.
async fn announce(app: &tauri::AppHandle, wallet_id: &str, held: &Held) {
    let state = app.state::<AppState>();
    for notice in &notices_for(&state, wallet_id, held).await {
        let _ = post(app, notice);
    }
}

/// Claims what a sync asked for by hand found, and announces it. The
/// record is the one the watch claims from, so neither says what the
/// other said, and the core already leaves out a wallet's first sync,
/// which is an import rather than news. The claim is made even with
/// the alerts off, and what it hands out is then dropped on purpose:
/// what was seen with them off is not news the day they are turned on.
///
/// A claim that fails takes nothing: the news stays in the vault for
/// the next claim of that wallet. So it is said on stderr, and tried
/// again a few times in the background rather than left to a sync that
/// may not come before the core forgets it.
pub(crate) async fn announce_report(app: &tauri::AppHandle, report: &SyncReport) {
    if claim_and_announce(app, report).await {
        return;
    }
    let app = app.clone();
    let report = report.clone();
    tauri::async_runtime::spawn(async move {
        for delay in CLAIM_RETRIES {
            tokio::time::sleep(delay).await;
            if claim_and_announce(&app, &report).await {
                return;
            }
        }
    });
}

/// Waits before a failed claim is tried again.
const CLAIM_RETRIES: [Duration; 3] = [
    Duration::from_secs(30),
    Duration::from_secs(120),
    Duration::from_secs(600),
];

/// One claim of a wallet's news, announced when the alerts are on.
/// False when the claim failed and the news is still waiting.
async fn claim_and_announce(app: &tauri::AppHandle, report: &SyncReport) -> bool {
    let state = app.state::<AppState>();
    let claimed = match state.manager.claim_announcements(report).await {
        Ok(claimed) => claimed,
        Err(error) => {
            eprintln!(
                "gerfaut: what a sync found could not be claimed and waits in the vault \
                 for the next claim: {error}"
            );
            return false;
        }
    };
    if !claimed.is_empty() {
        let held: Held = claimed.into_iter().collect();
        announce(app, &report.wallet_id, &held).await;
    }
    true
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
    // The preference is read under the lock: two calls that race, the
    // one at launch and a switch turned off, would otherwise leave the
    // watch running on the older reading.
    let mut task = state.live.task.lock().await;
    let wanted = enabled(&state.manager).await;
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

/// The longest the process lives once it is asked to exit, whatever
/// is still in flight: a sync waiting on a server that does not answer,
/// a name lookup, a notification the system is slow to take.
pub(crate) const EXIT_GRACE: Duration = Duration::from_secs(2);
/// How long quitting waits for the watch to let go. The core returns
/// at once; this only bounds a surprise.
const STOP_BUDGET: Duration = Duration::from_millis(500);

/// Set once the process is on its way out.
static EXITING: AtomicBool = AtomicBool::new(false);

/// Stops the watch on the way out, and makes sure the way out takes at
/// most [`EXIT_GRACE`]. Called when the last window closes and again
/// as the event loop ends; the second call finds nothing left to do.
///
/// The watch closes its connection and abandons its syncs at once. The
/// watchdog is for everything else: the process leaves with exit code
/// 0 when the grace is over, and the vault loses nothing to it, since
/// every write lands whole or not at all.
pub(crate) fn shutdown(app: &tauri::AppHandle) {
    if !EXITING.swap(true, Ordering::SeqCst) {
        std::thread::spawn(|| {
            std::thread::sleep(EXIT_GRACE);
            eprintln!("gerfaut: still running {EXIT_GRACE:?} after the exit request, ending now");
            std::process::exit(0);
        });
    }
    if let Some(state) = app.try_state::<AppState>() {
        tauri::async_runtime::block_on(async {
            let _ = tokio::time::timeout(STOP_BUDGET, state.manager.live_stop()).await;
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
/// the budget of the transaction alerts: a page gone wrong cannot flood
/// with it. Behind the lock it posts nothing, like every other command
/// that reaches the state.
#[tauri::command]
pub async fn send_test_notification(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> CommandResult<()> {
    state.unlocked()?;
    let allowance = state
        .live
        .budgets
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .transactions
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
            kind: NoticeKind::Transaction,
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

    fn notices(kind: NoticeKind, count: usize) -> Vec<Notice> {
        (0..count)
            .map(|i| Notice {
                title: "w".to_owned(),
                body: format!("n{i}"),
                kind,
            })
            .collect()
    }

    #[test]
    fn the_budget_caps_a_minute_and_says_more_is_waiting() {
        let mut budget = Budgets::new();
        let start = Instant::now();
        let notices = notices(NoticeKind::Transaction, 50);
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

    /// A minute spent on new transactions leaves the payments no longer
    /// coming untouched, and their own flood line says what they are.
    #[test]
    fn a_burst_of_transactions_never_silences_a_payment_no_longer_coming() {
        let mut budgets = Budgets::new();
        let start = Instant::now();
        let mut all = notices(NoticeKind::Transaction, 50);
        all.push(Notice {
            title: "Cold storage".to_owned(),
            body: "A pending payment is no longer coming".to_owned(),
            kind: NoticeKind::Dropped,
        });
        let posted = within_budget(&mut budgets, all, start);
        assert_eq!(posted.len(), BUDGET as usize + 1);
        assert_eq!(
            posted.last().map(|notice| notice.body.as_str()),
            Some("A pending payment is no longer coming")
        );

        let flood = within_budget(&mut budgets, notices(NoticeKind::Dropped, 50), start);
        assert_eq!(flood.len(), BUDGET as usize - 1);
        assert_eq!(
            flood.last().map(|notice| notice.body.as_str()),
            Some("More pending payments are no longer coming. Open Gerfaut to see them.")
        );
    }

    /// A payment no longer coming is held with the rest of its sync and
    /// said with it, never counted into the line of the others.
    #[test]
    fn a_payment_no_longer_coming_is_held_and_said_with_its_sync() {
        let mut announcer = Announcer::default();
        for i in 0..5 {
            announcer.on_event(LiveEvent::Transaction(tx(
                "w1",
                &format!("a{i}"),
                TxStage::Mempool,
            )));
        }
        announcer.on_event(LiveEvent::Transaction(tx("w1", "gone", TxStage::Dropped)));
        let outcome = announcer.on_event(LiveEvent::WalletSynced {
            report: report("w1", vec![], vec![]),
        });
        let (_, held) = outcome.announce.expect("w1 has something to say");
        assert_eq!(held.first.len(), 3);
        assert_eq!(held.more, 2);
        assert_eq!(held.dropped.len(), 1);
        assert_eq!(held.dropped[0].txid, "gone");

        // A sync that found only that still speaks.
        announcer.on_event(LiveEvent::Transaction(tx("w2", "gone", TxStage::Dropped)));
        let outcome = announcer.on_event(LiveEvent::WalletSynced {
            report: report("w2", vec![], vec![]),
        });
        assert!(outcome.announce.is_some());
    }

    /// What a claim hands out is what a sync recorded in the vault, not
    /// what a report lists: a report nobody's sync produced claims
    /// nothing, however many transactions it names.
    #[test]
    fn a_claim_hands_out_only_what_a_sync_recorded() {
        let dir = tempfile::tempdir().unwrap();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let manager = WalletManager::open(dir.path(), VaultKey::Raw([7u8; 32])).unwrap();
        let forged = report(
            "w1",
            vec![new_tx("aa", false), new_tx("bb", true)],
            vec![new_tx("cc", true)],
        );
        let claimed = runtime
            .block_on(manager.claim_announcements(&forged))
            .unwrap();
        assert!(claimed.is_empty(), "{claimed:?}");
    }

    /// What is posted is decided when it is posted: nothing with the
    /// alerts off, even for news a stopped watch still held; the name
    /// and the amount while unlocked; neither behind the lock.
    #[test]
    fn what_is_posted_follows_the_alerts_and_the_lock() {
        use gerfaut_core::input::ImportOptions;
        use gerfaut_core::network::Network;

        let dir = tempfile::tempdir().unwrap();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let state = AppState {
            manager: WalletManager::open(dir.path(), VaultKey::Raw([7u8; 32])).unwrap(),
            locked: AtomicBool::new(false),
            live: LiveAlerts::default(),
        };
        // The BIP 173 example address: public, and valid on signet.
        let parsed = gerfaut_core::input::parse_input_with_options(
            "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
            &ImportOptions {
                script: None,
                derivation: None,
            },
        )
        .unwrap();
        let wallet = runtime
            .block_on(
                state
                    .manager
                    .add_wallet("Cold storage", &parsed, Network::Signet),
            )
            .unwrap();
        let held: Held = [tx(&wallet.id, "a", TxStage::Mempool)]
            .into_iter()
            .collect();
        let posted = || runtime.block_on(notices_for(&state, &wallet.id, &held));

        assert_eq!(posted(), vec![]);

        runtime
            .block_on(
                state
                    .manager
                    .set_app_pref(NOTIFY_PREF.to_owned(), "1".to_owned()),
            )
            .unwrap();
        assert_eq!(
            posted(),
            vec![Notice {
                title: "Cold storage".to_owned(),
                body: "Received 0.00001000 BTC · pending".to_owned(),
                kind: NoticeKind::Transaction,
            }]
        );

        state.locked.store(true, Ordering::SeqCst);
        assert_eq!(
            posted(),
            vec![Notice {
                title: "Gerfaut".to_owned(),
                body: "New transaction · pending".to_owned(),
                kind: NoticeKind::Transaction,
            }]
        );

        state.locked.store(false, Ordering::SeqCst);
        runtime
            .block_on(
                state
                    .manager
                    .set_app_pref(NOTIFY_PREF.to_owned(), "0".to_owned()),
            )
            .unwrap();
        assert_eq!(posted(), vec![]);
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
