//! One Gerfaut at a time on macOS, met through a socket only its user
//! can reach.
//!
//! A second launch hands over to the window already open rather than
//! failing on the vault the first one holds. Elsewhere the single
//! instance plugin does it; on macOS the plugin puts its socket in
//! `/tmp`, which every account of the Mac shares: another account could
//! take the name first, and every launch of Gerfaut would then knock on
//! its door, hand it the working directory and the arguments, and quit.
//! Here the socket lives in the user's own temporary directory, which
//! macOS creates for each account and nobody else may write to, and
//! nothing is sent through it: the connection alone brings the window
//! forward. Where no such directory is found, Gerfaut launches as if it
//! were alone, and the vault, which opens in one place at a time, says
//! the rest.

use std::io::ErrorKind;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};

/// The longest path a Unix socket takes on macOS, terminator included.
const MAX_SOCKET_PATH: usize = 104;

/// What a launch found.
#[derive(Debug)]
pub(crate) enum Claim {
    /// No Gerfaut was running: this one listens for the next launch.
    First(Listener),
    /// A Gerfaut is running and was told to come forward.
    Second,
    /// No private place for the socket, or it could not be made: this
    /// launch goes on alone.
    Unavailable,
}

/// The socket a running Gerfaut listens on, removed when it closes.
#[derive(Debug)]
pub(crate) struct Listener {
    listener: UnixListener,
    path: PathBuf,
}

impl Listener {
    /// Where the socket is, for [`release`] when the app closes.
    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    /// Brings the window forward, through `on_launch`, at each later
    /// launch, on a thread of its own for as long as the app runs.
    pub(crate) fn serve(self, on_launch: impl Fn() + Send + 'static) {
        let Listener { listener, .. } = self;
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                // Nothing is read: the knock is the whole message.
                if stream.is_ok() {
                    on_launch();
                }
            }
        });
    }
}

/// Meets a Gerfaut already running under this identifier, or becomes
/// the one the next launch meets.
pub(crate) fn claim(identifier: &str) -> Claim {
    match socket_path(&std::env::temp_dir(), identifier) {
        Some(path) => claim_at(path),
        None => Claim::Unavailable,
    }
}

/// Where the socket goes in `dir`: nowhere unless the directory is the
/// user's alone. `/tmp` fails this, which is the point.
fn socket_path(dir: &Path, identifier: &str) -> Option<PathBuf> {
    let metadata = std::fs::metadata(dir).ok()?;
    // Writable by the group or by others: someone else could put a
    // socket there under this name.
    if !metadata.is_dir() || metadata.permissions().mode() & 0o022 != 0 {
        return None;
    }
    let path = dir.join(format!("{identifier}.sock"));
    (path.as_os_str().len() < MAX_SOCKET_PATH).then_some(path)
}

fn claim_at(path: PathBuf) -> Claim {
    match UnixStream::connect(&path) {
        Ok(_) => Claim::Second,
        Err(error)
            if matches!(
                error.kind(),
                ErrorKind::NotFound | ErrorKind::ConnectionRefused
            ) =>
        {
            // Left by a Gerfaut that did not close cleanly: nobody
            // answers on it any more.
            let _ = std::fs::remove_file(&path);
            match UnixListener::bind(&path) {
                Ok(listener) => Claim::First(Listener { listener, path }),
                Err(_) => Claim::Unavailable,
            }
        }
        Err(_) => Claim::Unavailable,
    }
}

/// The app is closing: the next launch finds no socket and goes first.
pub(crate) fn release(path: &Path) {
    let _ = std::fs::remove_file(path);
}

#[cfg(test)]
mod tests {
    use super::{Claim, claim_at, release, socket_path};
    use std::os::unix::fs::PermissionsExt;
    use std::sync::mpsc;
    use std::time::Duration;

    fn dir(mode: u32) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(mode)).unwrap();
        dir
    }

    #[test]
    fn the_socket_goes_only_where_nobody_else_writes() {
        let private = dir(0o700);
        let path = socket_path(private.path(), "com.gerfautwallet.gerfaut").unwrap();
        assert_eq!(path, private.path().join("com.gerfautwallet.gerfaut.sock"));
        // What /tmp is: anyone may create a name there.
        assert_eq!(
            socket_path(dir(0o1777).path(), "com.gerfautwallet.gerfaut"),
            None
        );
        assert_eq!(
            socket_path(dir(0o770).path(), "com.gerfautwallet.gerfaut"),
            None
        );
    }

    #[test]
    fn a_name_too_long_for_a_socket_is_given_up() {
        let private = dir(0o700);
        assert_eq!(socket_path(private.path(), &"g".repeat(120)), None);
    }

    /// The second launch knocks, the first one hears it, and the second
    /// one is told to leave.
    #[test]
    fn a_second_launch_brings_the_first_forward() {
        let private = dir(0o700);
        let path = socket_path(private.path(), "gerfaut").unwrap();
        let Claim::First(listener) = claim_at(path.clone()) else {
            panic!("the first launch listens");
        };
        let (heard, knocks) = mpsc::channel();
        assert_eq!(listener.path(), path);
        listener.serve(move || heard.send(()).unwrap());

        assert!(matches!(claim_at(path.clone()), Claim::Second));
        knocks.recv_timeout(Duration::from_secs(5)).unwrap();
        release(&path);
        assert!(!path.exists());
    }

    /// A Gerfaut that crashed left its socket behind: the next launch
    /// is not turned away by a name nobody answers on.
    #[test]
    fn a_socket_left_behind_does_not_turn_a_launch_away() {
        let private = dir(0o700);
        let path = socket_path(private.path(), "gerfaut").unwrap();
        drop(std::os::unix::net::UnixListener::bind(&path).unwrap());
        assert!(path.exists());
        assert!(matches!(claim_at(path), Claim::First(_)));
    }
}
