//! Notifications on Windows, posted here rather than through the
//! notification plugin.
//!
//! A toast takes the place of an earlier one when both carry the same
//! tag and group, in the Action Center as on screen. The plugin posts
//! with neither, so the confirmation of a payment used to sit beside
//! its pending notice. Here a notice about a payment carries a tag
//! drawn from its [`NoticeId`], and the next notice of that payment
//! replaces it, as the id does on Linux.
//!
//! The tag names the payment without saying which: a keyed hash of the
//! wallet and the txid, under a key drawn when the process starts.
//! Windows keeps its notifications in a database of its own, and a txid
//! there would tie the machine to a transaction on the chain. The price
//! is the one Linux pays already, where the server's ids do not outlive
//! the process: a notice posted before a restart stays beside its
//! confirmation.

use std::collections::hash_map::RandomState;
use std::hash::BuildHasher;
use std::path::Path;

use crate::notice::NoticeId;

/// The group every notice about a payment is posted in. A toast is
/// known by its tag and its group together.
#[cfg(windows)]
pub(crate) const GROUP: &str = "payments";

/// The AppUserModelID Windows files a toast under when the build runs
/// from the cargo target directory, where no shortcut names the app:
/// PowerShell's, as the plugin does, so a development build still
/// shows its notifications.
pub(crate) const DEVELOPMENT_APP_ID: &str =
    "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";

/// The tags of this run.
#[derive(Debug, Default)]
pub(crate) struct Tags {
    key: RandomState,
}

impl Tags {
    /// The tag of a payment's notices: the same for every notice of one
    /// payment in one wallet during this run, sixteen hex digits, which
    /// every Windows 10 takes.
    pub(crate) fn of(&self, id: &NoticeId) -> String {
        format!("{:016x}", self.key.hash_one(id))
    }
}

/// The AppUserModelID to post under. The installer gives the Start menu
/// shortcut the bundle identifier, and a toast posted under it shows
/// with the app's name and icon. A build run from `target/debug` or
/// `target/release` has no such shortcut: it posts as PowerShell.
pub(crate) fn app_id<'a>(exe_dir: &Path, identifier: &'a str) -> &'a str {
    let target = Path::new("target");
    if exe_dir.ends_with(target.join("debug")) || exe_dir.ends_with(target.join("release")) {
        DEVELOPMENT_APP_ID
    } else {
        identifier
    }
}

/// Posts a notice as a toast. The system is waited for on a thread of
/// its own, never by the caller. A toast it refuses goes out through
/// the plugin instead, without the tag: a notice beside its pending one
/// is better than no notice at all.
#[cfg(windows)]
pub(crate) fn post(app: &tauri::AppHandle, notice: &crate::notice::Notice) -> Result<(), String> {
    use tauri::Manager;
    use tauri_plugin_notification::NotificationExt;

    let tag = notice
        .id
        .as_ref()
        .map(|id| app.state::<crate::AppState>().live.tags.of(id));
    let exe_dir = tauri::utils::platform::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_default();
    let app_id = app_id(&exe_dir, &app.config().identifier).to_owned();
    let (title, body) = (notice.title.clone(), notice.body.clone());
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = show(&app_id, &title, &body, tag.as_deref()) {
            eprintln!("gerfaut: the toast was refused ({error}), posting it through the plugin");
            let _ = app
                .notification()
                .builder()
                .title(&title)
                .body(&body)
                .show();
        }
    });
    Ok(())
}

/// Shows one toast: the title, the body, and the tag in [`GROUP`] when
/// there is one. The text goes in as text nodes of the system's own
/// template, never through markup: a wallet name cannot shape the toast.
#[cfg(windows)]
pub(crate) fn show(
    app_id: &str,
    title: &str,
    body: &str,
    tag: Option<&str>,
) -> windows::core::Result<()> {
    use windows::UI::Notifications::{
        ToastNotification, ToastNotificationManager, ToastTemplateType,
    };
    use windows::core::HSTRING;

    let xml = ToastNotificationManager::GetTemplateContent(ToastTemplateType::ToastText02)?;
    let lines = xml.GetElementsByTagName(&HSTRING::from("text"))?;
    for (index, text) in (0u32..).zip([title, body]) {
        let node = xml.CreateTextNode(&HSTRING::from(text))?;
        lines.Item(index)?.AppendChild(&node)?;
    }
    let toast = ToastNotification::CreateToastNotification(&xml)?;
    if let Some(tag) = tag {
        toast.SetTag(&HSTRING::from(tag))?;
        toast.SetGroup(&HSTRING::from(GROUP))?;
    }
    ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id))?.Show(&toast)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(wallet_id: &str, txid: &str) -> NoticeId {
        NoticeId {
            wallet_id: wallet_id.to_owned(),
            txid: txid.to_owned(),
        }
    }

    /// Every notice of one payment carries one tag, and the same payment
    /// in another wallet another one: a payment between two watched
    /// wallets is announced for each, and one must not replace the other.
    #[test]
    fn a_payment_keeps_one_tag_and_each_wallet_its_own() {
        let tags = Tags::default();
        let pending = tags.of(&id("w1", "aa"));
        assert_eq!(tags.of(&id("w1", "aa")), pending);
        assert_ne!(tags.of(&id("w2", "aa")), pending);
        assert_ne!(tags.of(&id("w1", "ab")), pending);
        // Short enough for every Windows 10, and nothing but hex digits.
        assert_eq!(pending.len(), 16);
        assert!(pending.chars().all(|c| c.is_ascii_hexdigit()), "{pending}");
    }

    /// The tag says nothing of the txid: it holds none of it, and a run
    /// with another key tags the same payment differently.
    #[test]
    fn a_tag_names_no_transaction() {
        let txid = "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b";
        let tag = Tags::default().of(&id("w1", txid));
        assert!(!txid.contains(&tag), "{tag}");
        let others: Vec<String> = (0..8)
            .map(|_| Tags::default().of(&id("w1", txid)))
            .collect();
        assert!(others.iter().any(|other| other != &tag), "{others:?}");
    }

    #[test]
    fn a_development_build_posts_as_powershell() {
        let identifier = "com.gerfautwallet.gerfaut";
        let under = |parts: &[&str]| parts.iter().collect::<std::path::PathBuf>();
        for profile in ["debug", "release"] {
            let dev = under(&["C:\\", "src", "src-tauri", "target", profile]);
            assert_eq!(app_id(&dev, identifier), DEVELOPMENT_APP_ID, "{dev:?}");
        }
        for installed in [
            under(&["C:\\", "Users", "me", "AppData", "Local", "Gerfaut"]),
            under(&["C:\\", "Program Files", "Gerfaut"]),
            // A folder merely named like one is not the target directory.
            under(&["C:\\", "release"]),
            under(&["C:\\", "debug"]),
        ] {
            assert_eq!(app_id(&installed, identifier), identifier, "{installed:?}");
        }
    }

    /// The real thing, on the machine it runs on: a pending notice, then
    /// its confirmation under the same tag, and the Action Center holds
    /// one toast for the payment, the confirmation. Posted as PowerShell,
    /// removed afterwards. Run by hand: `cargo test -- --ignored`.
    #[cfg(windows)]
    #[test]
    #[ignore = "posts real toasts on this machine"]
    fn a_confirmation_takes_the_place_of_its_pending_toast() {
        use windows::UI::Notifications::ToastNotificationManager;
        use windows::core::HSTRING;

        let tag = Tags::default().of(&id("w1", "aa"));
        show(
            DEVELOPMENT_APP_ID,
            "Cold storage",
            "Received 0.00050000 BTC · pending",
            Some(&tag),
        )
        .unwrap();
        std::thread::sleep(std::time::Duration::from_secs(2));
        show(
            DEVELOPMENT_APP_ID,
            "Cold storage",
            "Received 0.00049600 BTC · confirmed",
            Some(&tag),
        )
        .unwrap();
        std::thread::sleep(std::time::Duration::from_secs(1));

        let history = ToastNotificationManager::History().unwrap();
        let app_id = HSTRING::from(DEVELOPMENT_APP_ID);
        let shown = history.GetHistoryWithId(&app_id).unwrap();
        let mine: Vec<String> = (0..shown.Size().unwrap())
            .map(|index| shown.GetAt(index).unwrap())
            .filter(|toast| toast.Tag().unwrap() == tag.as_str() && toast.Group().unwrap() == GROUP)
            .map(|toast| toast.Content().unwrap().GetXml().unwrap().to_string())
            .collect();
        history
            .RemoveGroupedTagWithId(&HSTRING::from(tag.as_str()), &HSTRING::from(GROUP), &app_id)
            .unwrap();
        assert_eq!(mine.len(), 1, "{mine:?}");
        assert!(mine[0].contains("confirmed"), "{}", mine[0]);
    }
}
