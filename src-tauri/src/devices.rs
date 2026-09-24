//! The account's devices, watched from this side.
//!
//! A device that connects with the key waits ten days, or until one
//! with full access approves it, and every channel of the account says
//! so. The app says it too: a red banner on the Overview while one
//! waits, and a system notification, once per device. Both come from
//! the list asked here, when the window opens or comes back to the
//! front, and every five minutes on this side for as long as the app
//! runs — minimised and locked included, which is when a window's own
//! timers stop being worth anything.
//!
//! Only a device with full access asks: one that waits is refused the
//! list, and could do nothing about another anyway. What was announced
//! is recorded in the vault by the core, so a device is announced once
//! whichever path saw it first. Behind the lock the notification takes
//! the generic form, and the window is told nothing.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use gerfaut_core::error::{CoreError, CoreResult, PremiumError};
use gerfaut_core::premium::Device;
use tauri::{Emitter, Manager};

use crate::notice::{self, Notice};
use crate::premium::{self, locked, waits};
use crate::{AppState, live};

/// The list the background check fetched, for the window.
const EVENT_DEVICES: &str = "premium://devices";
/// This device's connection moved on this side: the server disowned it.
const EVENT_CHANGED: &str = "premium://changed";

/// How often the list is asked for while the app runs.
const EVERY: Duration = Duration::from_secs(5 * 60);
/// How often the background task looks at the clock. A check made by
/// the window in between counts, so the server is asked no more than
/// once in [`EVERY`] however the two interleave.
const TICK: Duration = Duration::from_secs(30);
/// Left to the window at launch: when it is open it asks first, and the
/// background task then finds the list fresh.
const SETTLE: Duration = Duration::from_secs(10);
/// Notifications posted by one check at most. The server holds ten
/// devices per account; this caps what a server gone wrong could make
/// the desktop say.
const MAX_ANNOUNCED: usize = 10;

/// What this side remembers between two checks.
#[derive(Debug, Default)]
pub(crate) struct DeviceWatch {
    /// When the list was last asked for, by either side.
    last: Mutex<Option<Instant>>,
    /// The server last said this device waits for approval: the list is
    /// not asked for until it says otherwise.
    waiting: AtomicBool,
}

impl DeviceWatch {
    /// The server described this device.
    pub(crate) fn saw(&self, device: &Device) {
        self.waiting.store(waits(device), Ordering::SeqCst);
    }

    /// This device left the account: nothing is known of it any more.
    pub(crate) fn forget(&self) {
        self.waiting.store(false, Ordering::SeqCst);
        *self.slot() = None;
    }

    fn slot(&self) -> std::sync::MutexGuard<'_, Option<Instant>> {
        self.last
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn touch(&self, now: Instant) {
        *self.slot() = Some(now);
    }

    /// Whether the background check is due at `now`.
    pub(crate) fn due(&self, now: Instant) -> bool {
        !self.waiting.load(Ordering::SeqCst)
            && self
                .slot()
                .is_none_or(|last| now.duration_since(last) >= EVERY)
    }
}

/// The ids of the devices that wait, as the list gives them.
pub(crate) fn waiting_ids(devices: &[Device]) -> Vec<String> {
    devices
        .iter()
        .filter(|device| waits(device) && !device.this_device)
        .map(|device| device.id.clone())
        .collect()
}

/// Asks the server for the account's devices, and announces each one
/// that waits and was never announced. The window's call and the
/// background check both come through here.
pub(crate) async fn check(
    app: &tauri::AppHandle,
    state: &AppState,
    base_url: &str,
) -> CoreResult<Vec<Device>> {
    let (devices, notices) = fetch(state, base_url).await?;
    for notice in &notices {
        let _ = live::post(app, notice);
    }
    Ok(devices)
}

/// The list, and what it has to announce: one notice per device that
/// waits and that no earlier check announced. The record is the core's:
/// a device announced once is not announced again, and one that stopped
/// waiting leaves it. The notices are written for the lock as it is at
/// this moment.
pub(crate) async fn fetch(
    state: &AppState,
    base_url: &str,
) -> CoreResult<(Vec<Device>, Vec<Notice>)> {
    state.devices.touch(Instant::now());
    let devices = match state.manager.premium_devices(base_url).await {
        Ok(devices) => devices,
        Err(error) => {
            if matches!(
                error,
                CoreError::Premium(PremiumError::DevicePending { .. })
            ) {
                state.devices.waiting.store(true, Ordering::SeqCst);
            }
            return Err(error);
        }
    };
    state.devices.waiting.store(false, Ordering::SeqCst);
    let fresh = state
        .manager
        .premium_mark_announced(&waiting_ids(&devices))
        .await
        .unwrap_or_default();
    let locked = locked(state);
    let notices = fresh
        .iter()
        .filter_map(|id| devices.iter().find(|device| &device.id == id))
        .take(MAX_ANNOUNCED)
        .map(|device| notice::new_device(device.platform, locked))
        .collect();
    Ok((devices, notices))
}

/// One background check: the list, when this device is connected, has
/// full access as far as is known, and nobody asked for a while. What
/// came back goes to the window while it is unlocked.
async fn tick(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    if !state.devices.due(Instant::now()) || !premium::connected(&state).await {
        return;
    }
    let result = check(app, &state, &premium::base_url()).await;
    if locked(&state) {
        return;
    }
    match result {
        Ok(devices) => {
            let _ = app.emit(EVENT_DEVICES, devices);
        }
        Err(CoreError::Premium(PremiumError::DeviceDisconnected)) => {
            let _ = app.emit(EVENT_CHANGED, ());
        }
        Err(_) => {}
    }
}

/// Runs the background check for as long as the app does.
pub(crate) async fn watch(app: tauri::AppHandle) {
    tokio::time::sleep(SETTLE).await;
    loop {
        tick(&app).await;
        tokio::time::sleep(TICK).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gerfaut_core::premium::{DeviceAccess, DevicePlatform};

    fn device(id: &str, access: DeviceAccess, this_device: bool) -> Device {
        Device {
            id: id.to_owned(),
            platform: DevicePlatform::Android,
            connected_at: 1_790_000_000,
            access,
            pending_until: (access == DeviceAccess::Pending).then_some(1_790_864_000),
            approved_at: None,
            this_device,
        }
    }

    #[test]
    fn only_the_other_devices_that_wait_are_announced() {
        let devices = [
            device("mine", DeviceAccess::Full, true),
            device("phone", DeviceAccess::Full, false),
            device("stranger", DeviceAccess::Pending, false),
            device("second", DeviceAccess::Pending, false),
        ];
        assert_eq!(waiting_ids(&devices), vec!["stranger", "second"]);
        // A device never announces itself, whatever the server says.
        assert!(waiting_ids(&[device("mine", DeviceAccess::Pending, true)]).is_empty());
    }

    #[test]
    fn the_check_is_due_every_five_minutes_whoever_asked_last() {
        let watch = DeviceWatch::default();
        let start = Instant::now();
        assert!(watch.due(start), "nothing asked yet");
        watch.touch(start);
        assert!(!watch.due(start + Duration::from_secs(60)));
        assert!(!watch.due(start + EVERY - Duration::from_secs(1)));
        assert!(watch.due(start + EVERY));
        // The window asked in between: the clock starts again from there.
        watch.touch(start + Duration::from_secs(200));
        assert!(!watch.due(start + EVERY));
        assert!(watch.due(start + Duration::from_secs(200) + EVERY));
    }

    #[test]
    fn a_device_that_waits_asks_for_no_list() {
        let watch = DeviceWatch::default();
        let now = Instant::now();
        watch.saw(&device("mine", DeviceAccess::Pending, true));
        assert!(!watch.due(now));
        assert!(!watch.due(now + EVERY * 10));
        // Approved: the checks start.
        watch.saw(&device("mine", DeviceAccess::Full, true));
        assert!(watch.due(now));
        // Logged out: nothing is remembered.
        watch.touch(now);
        watch.saw(&device("mine", DeviceAccess::Pending, true));
        watch.forget();
        assert!(watch.due(now));
    }
}
