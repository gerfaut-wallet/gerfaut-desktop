//! The pages Gerfaut links to, opened in the browser.
//!
//! The window names the page and this side opens it, or refuses: it
//! opens the explorer page of a transaction, the releases page, the
//! issues page and the page a price source's credit links to, and no
//! other address, whatever a page gone wrong asks for. The address
//! reaches the opener as one argument, never through a shell.
//!
//! In an AppImage, the opener is `xdg-open`, started outside the
//! AppImage's environment. Its launcher puts the bundled libraries
//! first in `LD_LIBRARY_PATH`, and its hooks point `XDG_DATA_DIRS`,
//! `GTK_PATH`, `GIO_EXTRA_MODULES`, GStreamer's plugin paths and others
//! into the bundle. The system's `xdg-open` and the tools it starts
//! inherited all of it: on Ubuntu 26.04 the coreutils loaded the bundled
//! `libsystemd.so.0`, older than they need, stopped on the missing
//! symbol version, and no browser opened, without a word. Only the child
//! is cleaned: the app keeps the libraries it was bundled with.

use crate::{CommandError, CommandResult};

/// The releases page: the update check and Settings › About send there.
const RELEASES: &str = "https://github.com/gerfaut-wallet/gerfaut-desktop/releases/latest";
/// The issues of this repository, behind "Report a problem".
const ISSUES: &str = "https://github.com/gerfaut-wallet/gerfaut-desktop/issues";
/// A transaction on the explorer, by network: one of these, then its
/// txid and nothing after it.
const EXPLORER_TX: [&str; 3] = [
    "https://mempool.space/tx/",
    "https://mempool.space/signet/tx/",
    "https://mempool.space/testnet4/tx/",
];

/// Whether `url` is one of the pages Gerfaut links to, written exactly
/// as the app writes it. A credit's page is the one the core gives.
pub(crate) fn allowed(url: &str) -> bool {
    url == RELEASES
        || url == ISSUES
        || EXPLORER_TX
            .iter()
            .any(|page| url.strip_prefix(page).is_some_and(is_txid))
        || gerfaut_core::price::price_table()
            .sources
            .iter()
            .filter_map(|entry| entry.credit.as_ref())
            .any(|credit| credit.url == url)
}

/// A txid as the core writes it: 64 lowercase hex digits.
fn is_txid(text: &str) -> bool {
    text.len() == 64 && text.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn refused() -> CommandError {
    CommandError::new("link", "Gerfaut does not open this address.")
}

fn failed(message: String) -> CommandError {
    CommandError::new("link", message)
}

/// Opens one of the pages Gerfaut links to in the browser. In an
/// AppImage, through [`appimage`]; elsewhere, as the opener plugin
/// does.
pub(crate) async fn open(url: String) -> CommandResult<()> {
    if !allowed(&url) {
        return Err(refused());
    }
    #[cfg(target_os = "linux")]
    if let Some(root) = appimage::root() {
        return tauri::async_runtime::spawn_blocking(move || appimage::open(&url, &root))
            .await
            .map_err(|e| failed(format!("the browser did not start: {e}")))?;
    }
    tauri_plugin_opener::open_url(&url, None::<&str>)
        .map_err(|e| failed(format!("the browser did not start: {e}")))
}

/// `xdg-open`, outside the environment an AppImage sets up.
#[cfg(target_os = "linux")]
mod appimage {
    use std::ffi::{OsStr, OsString};
    use std::os::unix::ffi::{OsStrExt, OsStringExt};
    use std::os::unix::process::CommandExt;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Stdio};
    use std::sync::mpsc;
    use std::time::Duration;

    use super::failed;
    use crate::CommandResult;

    /// How long `xdg-open` has to say it failed. On a desktop it hands
    /// the page to the browser and ends at once; without one, it waits
    /// for the browser it started itself, and is left to it.
    const ANSWER: Duration = Duration::from_secs(5);

    /// Where the AppImage is mounted when the app runs from one: the
    /// `APPDIR` its runtime sets, or with only `APPIMAGE` set, the
    /// folder above the executable's `usr/bin`. `None` outside an
    /// AppImage, and for a root that would take in every path.
    pub(super) fn root() -> Option<PathBuf> {
        root_from(
            std::env::var_os("APPDIR"),
            std::env::var_os("APPIMAGE"),
            std::env::current_exe().ok(),
        )
    }

    pub(super) fn root_from(
        appdir: Option<OsString>,
        appimage: Option<OsString>,
        exe: Option<PathBuf>,
    ) -> Option<PathBuf> {
        let root = match appdir.filter(|dir| !dir.is_empty()) {
            Some(dir) => PathBuf::from(dir),
            None => {
                appimage.filter(|file| !file.is_empty())?;
                let bin = exe?.parent()?.to_path_buf();
                if !bin.ends_with("usr/bin") {
                    return None;
                }
                bin.parent()?.parent()?.to_path_buf()
            }
        };
        (root.is_absolute() && root.parent().is_some()).then_some(root)
    }

    /// The environment `xdg-open` is given: the app's own, with every
    /// entry under `root` taken out of each variable that holds one, so
    /// that neither it nor the browser loads anything from the bundle.
    /// A variable left with no entry goes, and so do the empty entries
    /// the launcher appends when a list was unset: an empty entry of
    /// `PATH` or `LD_LIBRARY_PATH` reads as the current folder. A
    /// variable with nothing under `root` is passed on as it is.
    pub(super) fn outside(
        vars: impl IntoIterator<Item = (OsString, OsString)>,
        root: &Path,
    ) -> Vec<(OsString, OsString)> {
        let under = |entry: &[u8]| Path::new(OsStr::from_bytes(entry)).starts_with(root);
        vars.into_iter()
            .filter_map(|(name, value)| {
                let entries: Vec<&[u8]> = value.as_bytes().split(|&b| b == b':').collect();
                if !entries.iter().any(|entry| under(entry)) {
                    return Some((name, value));
                }
                let kept: Vec<&[u8]> = entries
                    .into_iter()
                    .filter(|entry| !entry.is_empty() && !under(entry))
                    .collect();
                (!kept.is_empty()).then(|| (name, OsString::from_vec(kept.join(&b':'))))
            })
            .collect()
    }

    /// `xdg-open url`, in that environment: the address as its one
    /// argument, no shell, nothing on its standard streams, in a
    /// process group of its own so that a Ctrl-C meant for the app does
    /// not reach the browser.
    pub(super) fn command(
        url: &str,
        root: &Path,
        vars: impl IntoIterator<Item = (OsString, OsString)>,
    ) -> Command {
        let mut command = Command::new("xdg-open");
        command
            .arg(url)
            .env_clear()
            .envs(outside(vars, root))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0);
        command
    }

    /// Opens `url` and waits [`ANSWER`] for `xdg-open` to end: a
    /// failure it reports in that time comes back as an error, so the
    /// window shows the address to copy rather than a button that does
    /// nothing. Past it, `xdg-open` is still waiting on the browser; a
    /// thread of its own collects it when it ends.
    pub(super) fn open(url: &str, root: &Path) -> CommandResult<()> {
        let mut child = command(url, root, std::env::vars_os())
            .spawn()
            .map_err(|e| failed(format!("xdg-open did not start: {e}")))?;
        let (sender, answer) = mpsc::channel();
        std::thread::spawn(move || {
            let _ = sender.send(child.wait());
        });
        match answer.recv_timeout(ANSWER) {
            Ok(Ok(status)) if status.success() => Ok(()),
            Ok(Ok(status)) => Err(failed(format!("xdg-open failed: {status}"))),
            Ok(Err(e)) => Err(failed(format!("xdg-open did not answer: {e}"))),
            Err(_) => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TXID: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    /// Every page the app links to, written as the window writes it:
    /// `src/test/capabilities.test.ts` checks that this file names the
    /// window's own constants.
    #[test]
    fn opens_every_page_the_app_links_to() {
        let credits: Vec<String> = gerfaut_core::price::price_table()
            .sources
            .into_iter()
            .filter_map(|entry| entry.credit.map(|credit| credit.url))
            .collect();
        assert!(!credits.is_empty());
        for url in [
            format!("https://mempool.space/tx/{TXID}"),
            format!("https://mempool.space/signet/tx/{TXID}"),
            format!("https://mempool.space/testnet4/tx/{TXID}"),
            RELEASES.to_owned(),
            ISSUES.to_owned(),
        ]
        .into_iter()
        .chain(credits)
        {
            assert!(allowed(&url), "{url}");
        }
    }

    #[test]
    fn opens_nothing_else() {
        let long = format!("{TXID}0");
        let short = &TXID[1..];
        for url in [
            "",
            "https://evil.example/",
            &format!("http://mempool.space/tx/{TXID}"),
            &format!("https://mempool.space.evil.example/tx/{TXID}"),
            &format!("https://mempool.space@evil.example/tx/{TXID}"),
            &format!("https://mempoolxspace/tx/{TXID}"),
            "https://mempool.space/",
            "https://mempool.space/tx/",
            &format!("https://mempool.space/tx/{long}"),
            &format!("https://mempool.space/tx/{short}"),
            &format!("https://mempool.space/tx/{}", TXID.to_uppercase()),
            &format!("https://mempool.space/tx/{TXID}?evil"),
            &format!("https://mempool.space/tx/{TXID}#evil"),
            &format!("https://mempool.space/tx/{TXID}/../../evil"),
            &format!("https://mempool.space/tx/{TXID}\n"),
            &format!(" https://mempool.space/tx/{TXID}"),
            &format!("https://mempool.space/regtest/tx/{TXID}"),
            "https://mempool.space/address/bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
            "https://github.com/someone/else/releases/latest",
            "https://github.com/gerfaut-wallet/gerfaut-desktop/releases/latest/other",
            "https://github.com/gerfaut-wallet/gerfaut-desktop/issues/new",
            "https://github.com/gerfaut-wallet/gerfaut-desktop/issues?q=evil",
            "https://github.com/someone/else/issues",
            "https://www.coingecko.com/en/coins/evil",
            "https://www.coingecko.com.evil.example",
            "http://www.coingecko.com",
            "file:///etc/passwd",
            "file:///C:/Windows/System32/calc.exe",
            "mailto:someone@example.com",
            "javascript:alert(1)",
            "--help",
            "/usr/bin/xterm",
        ] {
            assert!(!allowed(url), "{url}");
        }
    }

    /// A refused address comes back as an error before anything starts.
    #[test]
    fn a_refused_address_is_an_error() {
        for url in ["https://evil.example/", "file:///etc/passwd", "--help"] {
            let error = tauri::async_runtime::block_on(open(url.to_owned())).unwrap_err();
            assert_eq!(error.kind, "link", "{url}");
        }
    }

    #[cfg(target_os = "linux")]
    mod appimage {
        use std::ffi::{OsStr, OsString};
        use std::path::{Path, PathBuf};

        use super::super::appimage::{command, outside, root_from};

        const ROOT: &str = "/tmp/.mount_GerfauXYZ";

        fn vars(list: &[(&str, &str)]) -> Vec<(OsString, OsString)> {
            list.iter()
                .map(|(name, value)| (OsString::from(name), OsString::from(value)))
                .collect()
        }

        /// The variables the AppImage's launcher and its GTK and
        /// GStreamer hooks set, as they read on Ubuntu 26.04.
        #[test]
        fn takes_the_bundle_out_of_the_environment() {
            let env = outside(
                vars(&[
                    (
                        "LD_LIBRARY_PATH",
                        &format!("{ROOT}/usr/lib/:{ROOT}/usr/lib/x86_64-linux-gnu/:{ROOT}/lib/:"),
                    ),
                    (
                        "PATH",
                        &format!("{ROOT}/usr/bin/:{ROOT}/usr/sbin/:/usr/local/bin:/usr/bin:/bin"),
                    ),
                    (
                        "XDG_DATA_DIRS",
                        &format!("{ROOT}/usr/share:/usr/share:/usr/local/share"),
                    ),
                    ("GTK_PATH", &format!("{ROOT}/usr/lib/gtk-3.0")),
                    ("GIO_EXTRA_MODULES", &format!("{ROOT}/usr/lib/gio/modules")),
                    (
                        "GSETTINGS_SCHEMA_DIR",
                        &format!("{ROOT}/usr/share/glib-2.0/schemas"),
                    ),
                    ("GST_REGISTRY_REUSE_PLUGIN_SCANNER", "no"),
                    (
                        "GST_PLUGIN_SYSTEM_PATH_1_0",
                        &format!("{ROOT}/usr/lib/gstreamer-1.0"),
                    ),
                    (
                        "GST_PLUGIN_PATH_1_0",
                        &format!("{ROOT}/usr/lib/gstreamer-1.0"),
                    ),
                    (
                        "GST_PLUGIN_SCANNER_1_0",
                        &format!("{ROOT}/usr/lib/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner"),
                    ),
                    (
                        "GST_PTP_HELPER_1_0",
                        &format!("{ROOT}/usr/lib/gstreamer1.0/gstreamer-1.0/gst-ptp-helper"),
                    ),
                    ("APPDIR", ROOT),
                    ("APPIMAGE", "/home/someone/Gerfaut_0.1.0_amd64.AppImage"),
                    ("GDK_BACKEND", "x11"),
                    ("DISPLAY", ":0"),
                    ("DBUS_SESSION_BUS_ADDRESS", "unix:path=/run/user/1000/bus"),
                    ("HOME", "/home/someone"),
                    ("NEAR", "/tmp/.mount_GerfauXYZW/usr/lib:/opt/lib"),
                ]),
                Path::new(ROOT),
            );
            assert_eq!(
                env,
                vars(&[
                    ("PATH", "/usr/local/bin:/usr/bin:/bin"),
                    ("XDG_DATA_DIRS", "/usr/share:/usr/local/share"),
                    ("GST_REGISTRY_REUSE_PLUGIN_SCANNER", "no"),
                    ("APPIMAGE", "/home/someone/Gerfaut_0.1.0_amd64.AppImage"),
                    ("GDK_BACKEND", "x11"),
                    ("DISPLAY", ":0"),
                    ("DBUS_SESSION_BUS_ADDRESS", "unix:path=/run/user/1000/bus"),
                    ("HOME", "/home/someone"),
                    // A sibling of the mount is not under it.
                    ("NEAR", "/tmp/.mount_GerfauXYZW/usr/lib:/opt/lib"),
                ]),
            );
        }

        #[test]
        fn keeps_what_the_bundle_did_not_touch() {
            let list = vars(&[("PATH", "/usr/bin::/bin"), ("LD_LIBRARY_PATH", "/opt/lib:")]);
            assert_eq!(outside(list.clone(), Path::new(ROOT)), list);
        }

        /// The address is the one argument of `xdg-open`, started as
        /// it is and not through a shell, in the cleaned environment.
        #[test]
        fn passes_the_address_as_one_argument() {
            let url = "https://mempool.space/tx/ab;$(touch /tmp/x) `id`";
            let command = command(
                url,
                Path::new(ROOT),
                vars(&[
                    ("PATH", &format!("{ROOT}/usr/bin:/usr/bin")),
                    ("HOME", "/home/someone"),
                ]),
            );
            assert_eq!(command.get_program(), "xdg-open");
            assert_eq!(command.get_args().collect::<Vec<_>>(), [OsStr::new(url)]);
            let envs: Vec<(&OsStr, Option<&OsStr>)> = command.get_envs().collect();
            assert_eq!(
                envs,
                [
                    (OsStr::new("HOME"), Some(OsStr::new("/home/someone"))),
                    (OsStr::new("PATH"), Some(OsStr::new("/usr/bin"))),
                ]
            );
        }

        #[test]
        fn finds_the_mount() {
            let exe = Some(PathBuf::from(format!("{ROOT}/usr/bin/gerfaut-desktop")));
            assert_eq!(
                root_from(Some(ROOT.into()), None, None),
                Some(PathBuf::from(ROOT))
            );
            assert_eq!(
                root_from(
                    None,
                    Some("/home/someone/Gerfaut.AppImage".into()),
                    exe.clone()
                ),
                Some(PathBuf::from(ROOT))
            );
            // Outside an AppImage, the opener plugin's way.
            assert_eq!(root_from(None, None, exe.clone()), None);
            assert_eq!(root_from(Some("".into()), Some("".into()), exe), None);
            assert_eq!(
                root_from(
                    None,
                    Some("/x.AppImage".into()),
                    Some(PathBuf::from("/opt/gerfaut/gerfaut-desktop"))
                ),
                None
            );
            // A root that would take in every path, or a relative one.
            assert_eq!(root_from(Some("/".into()), None, None), None);
            assert_eq!(root_from(Some("squashfs-root".into()), None, None), None);
        }
    }
}
