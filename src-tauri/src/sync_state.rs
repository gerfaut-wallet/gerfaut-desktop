//! Where each wallet's sync stands, from the core to the window.
//!
//! The core says when a sync of a wallet starts and where the wallet
//! stands once it ends, whoever asked for it: the window, a rescan, a
//! sync of every wallet, the live watch. Each change goes to the
//! window as it comes; the window reads the whole list once
//! (`wallet_sync_states`) when it starts listening.

use std::sync::atomic::Ordering;

use gerfaut_core::WalletManager;
use gerfaut_core::manager::WalletSync;
use tauri::{Emitter, Manager};
use tokio::sync::broadcast::error::RecvError;

use crate::AppState;

/// One change: a [`WalletSync`], the state beside the wallet's id.
pub(crate) const EVENT_SYNC_STATE: &str = "sync://state";

/// Hands every change the core makes to the window, for as long as the
/// app runs. A listener that fell behind sends the whole list again,
/// so no wallet stays syncing on screen for a change it missed.
pub(crate) fn forward(app: tauri::AppHandle, manager: &WalletManager) {
    let mut changes = manager.sync_changes();
    let manager = manager.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            match changes.recv().await {
                Ok(change) => tell(&app, &[change]),
                Err(RecvError::Lagged(_)) => tell(&app, &manager.sync_states(None).await),
                Err(RecvError::Closed) => return,
            }
        }
    });
}

/// Behind the lock the window is told nothing of a wallet, not even
/// that it syncs: it reads the list again at the unlock.
fn tell(app: &tauri::AppHandle, changes: &[WalletSync]) {
    let locked = app
        .try_state::<AppState>()
        .is_none_or(|state| state.locked.load(Ordering::SeqCst));
    if locked {
        return;
    }
    for change in changes {
        let _ = app.emit(EVENT_SYNC_STATE, change);
    }
}
