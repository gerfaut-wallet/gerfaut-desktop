//! Copying what identifies a wallet.
//!
//! A descriptor put on the clipboard stays there until something else
//! takes its place: for hours, in the clipboard history Windows keeps,
//! synced to the cloud clipboard, read by any app that looks. What goes
//! through here is marked so the system keeps it out of its history and
//! its cloud, and taken off the clipboard after [`CLEAR_AFTER`] — but
//! only if it is still there: whatever the person copied since is
//! theirs.
//!
//! An address and a transaction are on the chain for anyone to read,
//! so they keep the webview's plain clipboard: a flag spent on things
//! that are not secret would mean nothing.

use std::sync::Mutex;
use std::time::Duration;

use tauri::Manager;

use crate::{CommandResult, internal};

/// How long a sensitive copy stays on the clipboard: time to paste it
/// into the other app, not time to forget it is there.
pub(crate) const CLEAR_AFTER: Duration = Duration::from_secs(60);
/// The clipboard can be held by another app for a moment: the clearing
/// tries again this many times, this far apart, before giving up.
const CLEAR_ATTEMPTS: u32 = 5;
const CLEAR_RETRY: Duration = Duration::from_secs(1);

/// The three things done with the system clipboard, behind a trait so
/// the tests never touch the real one.
pub(crate) trait Board: Send {
    /// Puts text there, kept out of the clipboard history and the cloud
    /// clipboard where the system knows the flag.
    fn put_secret(&mut self, text: &str) -> Result<(), String>;
    /// The text there now, `None` when it holds no text; an error when
    /// the clipboard could not be read at all.
    fn text(&mut self) -> Result<Option<String>, String>;
    fn clear(&mut self) -> Result<(), String>;
}

/// The system clipboard.
struct SystemBoard(arboard::Clipboard);

impl Board for SystemBoard {
    fn put_secret(&mut self, text: &str) -> Result<(), String> {
        let set = self.0.set();
        #[cfg(windows)]
        let set = {
            use arboard::SetExtWindows;
            set.exclude_from_history()
                .exclude_from_cloud()
                .exclude_from_monitoring()
        };
        #[cfg(target_os = "macos")]
        let set = {
            use arboard::SetExtApple;
            set.exclude_from_history()
        };
        #[cfg(all(unix, not(target_os = "macos")))]
        let set = {
            use arboard::SetExtLinux;
            set.exclude_from_history()
        };
        set.text(text).map_err(|e| e.to_string())
    }

    fn text(&mut self) -> Result<Option<String>, String> {
        match self.0.get_text() {
            Ok(text) => Ok(Some(text)),
            Err(arboard::Error::ContentNotAvailable) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    fn clear(&mut self) -> Result<(), String> {
        self.0.clear().map_err(|e| e.to_string())
    }
}

/// What a clearing found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Expiry {
    /// The copy was still there and is gone.
    Cleared,
    /// Something else took its place, or a later copy did: left alone.
    LeftAlone,
    /// The clipboard could not be read; worth another try.
    Busy,
}

#[derive(Default)]
struct Held {
    /// Opened at the first copy and kept: on Linux the app that copied
    /// serves the text to whoever pastes, for as long as it holds this.
    board: Option<Box<dyn Board>>,
    /// The text Gerfaut last put there, until it is cleared or replaced.
    copied: Option<String>,
    /// Counts the copies, so the timer of an older one leaves a newer
    /// one its full minute.
    generation: u64,
}

/// The sensitive copies of this run.
#[derive(Default)]
pub(crate) struct SensitiveClipboard {
    held: Mutex<Held>,
}

impl SensitiveClipboard {
    /// A clipboard on a board of the test's making.
    #[cfg(test)]
    fn on(board: Box<dyn Board>) -> Self {
        SensitiveClipboard {
            held: Mutex::new(Held {
                board: Some(board),
                ..Held::default()
            }),
        }
    }

    /// Puts `text` on the clipboard, and returns the generation its
    /// clearing is to name.
    pub(crate) fn copy(&self, text: &str) -> Result<u64, String> {
        let mut held = self.held.lock().unwrap_or_else(|e| e.into_inner());
        if held.board.is_none() {
            let board = arboard::Clipboard::new().map_err(|e| e.to_string())?;
            held.board = Some(Box::new(SystemBoard(board)));
        }
        let board = held.board.as_mut().expect("opened just above");
        board.put_secret(text)?;
        held.generation += 1;
        held.copied = Some(text.to_owned());
        Ok(held.generation)
    }

    /// Takes the copy of that generation off the clipboard, if it is
    /// still the last one Gerfaut made and still what the clipboard
    /// holds.
    pub(crate) fn expire(&self, generation: u64) -> Expiry {
        let mut held = self.held.lock().unwrap_or_else(|e| e.into_inner());
        if held.generation != generation {
            return Expiry::LeftAlone;
        }
        Self::clear_if_ours(&mut held)
    }

    /// The app is closing: a copy still on the clipboard leaves with it.
    pub(crate) fn expire_now(&self) {
        let mut held = self.held.lock().unwrap_or_else(|e| e.into_inner());
        let _ = Self::clear_if_ours(&mut held);
    }

    fn clear_if_ours(held: &mut Held) -> Expiry {
        let Some(copied) = held.copied.as_deref() else {
            return Expiry::LeftAlone;
        };
        let Some(board) = held.board.as_mut() else {
            return Expiry::LeftAlone;
        };
        let ours = match board.text() {
            Ok(text) => text.as_deref() == Some(copied),
            Err(_) => return Expiry::Busy,
        };
        let expiry = if ours {
            match board.clear() {
                Ok(()) => Expiry::Cleared,
                Err(_) => return Expiry::Busy,
            }
        } else {
            Expiry::LeftAlone
        };
        held.copied = None;
        expiry
    }
}

/// Copies a secret, kept out of the clipboard history, and clears it
/// after [`CLEAR_AFTER`] unless something else was copied since. Answers
/// the seconds it stays, for the confirmation to say. It reads nothing
/// from the vault: the text is what the window already shows.
#[tauri::command]
pub(crate) async fn copy_sensitive(app: tauri::AppHandle, text: String) -> CommandResult<u64> {
    let handle = app.clone();
    let generation = tauri::async_runtime::spawn_blocking(move || {
        handle.state::<SensitiveClipboard>().copy(&text)
    })
    .await
    .map_err(|e| internal(format!("the clipboard did not answer: {e}")))?
    .map_err(|e| internal(format!("the clipboard refused the text: {e}")))?;

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(CLEAR_AFTER).await;
        for _ in 0..CLEAR_ATTEMPTS {
            let handle = app.clone();
            let expiry = tauri::async_runtime::spawn_blocking(move || {
                handle.state::<SensitiveClipboard>().expire(generation)
            })
            .await
            .unwrap_or(Expiry::Busy);
            if expiry != Expiry::Busy {
                break;
            }
            tokio::time::sleep(CLEAR_RETRY).await;
        }
    });
    Ok(CLEAR_AFTER.as_secs())
}

#[cfg(test)]
mod tests {
    use super::{Board, Expiry, SensitiveClipboard};
    use std::sync::{Arc, Mutex};

    /// A clipboard in memory, shared with the test so it can play the
    /// person copying something else.
    #[derive(Clone, Default)]
    struct FakeBoard {
        text: Arc<Mutex<Option<String>>>,
        /// Whether what is there was marked secret.
        secret: Arc<Mutex<bool>>,
        busy: Arc<Mutex<bool>>,
    }

    impl FakeBoard {
        fn user_copies(&self, text: &str) {
            *self.text.lock().unwrap() = Some(text.to_owned());
            *self.secret.lock().unwrap() = false;
        }
        fn holds(&self) -> Option<String> {
            self.text.lock().unwrap().clone()
        }
    }

    impl Board for FakeBoard {
        fn put_secret(&mut self, text: &str) -> Result<(), String> {
            *self.text.lock().unwrap() = Some(text.to_owned());
            *self.secret.lock().unwrap() = true;
            Ok(())
        }
        fn text(&mut self) -> Result<Option<String>, String> {
            if *self.busy.lock().unwrap() {
                return Err("held by another app".to_owned());
            }
            Ok(self.holds())
        }
        fn clear(&mut self) -> Result<(), String> {
            *self.text.lock().unwrap() = None;
            Ok(())
        }
    }

    fn fake() -> (SensitiveClipboard, FakeBoard) {
        let board = FakeBoard::default();
        (SensitiveClipboard::on(Box::new(board.clone())), board)
    }

    #[test]
    fn a_secret_left_on_the_clipboard_is_cleared() {
        let (clipboard, board) = fake();
        let generation = clipboard.copy("a descriptor").unwrap();
        assert!(
            *board.secret.lock().unwrap(),
            "marked for the history to skip"
        );
        assert_eq!(clipboard.expire(generation), Expiry::Cleared);
        assert_eq!(board.holds(), None);
    }

    /// What the person copied after Gerfaut is theirs: the minute
    /// running out takes nothing of it.
    #[test]
    fn what_the_person_copied_since_is_left_alone() {
        let (clipboard, board) = fake();
        let generation = clipboard.copy("wpkh(DESCRIPTOR)").unwrap();
        board.user_copies("a note of their own");
        assert_eq!(clipboard.expire(generation), Expiry::LeftAlone);
        assert_eq!(board.holds().as_deref(), Some("a note of their own"));
    }

    /// Two copies in a row: the first one's timer must not cut the
    /// second one's minute short.
    #[test]
    fn an_older_timer_leaves_a_newer_copy_its_time() {
        let (clipboard, board) = fake();
        let first = clipboard.copy("wpkh(FIRST)").unwrap();
        let second = clipboard.copy("wpkh(SECOND)").unwrap();
        assert_eq!(clipboard.expire(first), Expiry::LeftAlone);
        assert_eq!(board.holds().as_deref(), Some("wpkh(SECOND)"));
        assert_eq!(clipboard.expire(second), Expiry::Cleared);
    }

    /// A clipboard another app holds at that instant is tried again,
    /// and the copy is still known to be Gerfaut's when it frees up.
    #[test]
    fn a_busy_clipboard_is_tried_again() {
        let (clipboard, board) = fake();
        let generation = clipboard.copy("wpkh(DESCRIPTOR)").unwrap();
        *board.busy.lock().unwrap() = true;
        assert_eq!(clipboard.expire(generation), Expiry::Busy);
        *board.busy.lock().unwrap() = false;
        assert_eq!(clipboard.expire(generation), Expiry::Cleared);
    }

    /// Closing the app takes the copy with it, and only the copy.
    #[test]
    fn closing_the_app_clears_its_own_copy_only() {
        let (clipboard, board) = fake();
        clipboard.copy("wpkh(DESCRIPTOR)").unwrap();
        clipboard.expire_now();
        assert_eq!(board.holds(), None);

        let (clipboard, board) = fake();
        clipboard.copy("wpkh(DESCRIPTOR)").unwrap();
        board.user_copies("theirs");
        clipboard.expire_now();
        assert_eq!(board.holds().as_deref(), Some("theirs"));
    }

    /// Once cleared, a copy is forgotten: the same words copied by the
    /// person later are not taken for Gerfaut's.
    #[test]
    fn a_cleared_copy_is_forgotten() {
        let (clipboard, board) = fake();
        let generation = clipboard.copy("wpkh(DESCRIPTOR)").unwrap();
        assert_eq!(clipboard.expire(generation), Expiry::Cleared);
        board.user_copies("wpkh(DESCRIPTOR)");
        clipboard.expire_now();
        assert_eq!(board.holds().as_deref(), Some("wpkh(DESCRIPTOR)"));
    }
}
