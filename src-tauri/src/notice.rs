//! What a notification says.
//!
//! Composed here, on the Rust side, because this is the side that is
//! still awake when the window is minimised or locked. Pure: the same
//! transactions, names, unit, mask and lock always read the same.
//!
//! Four rules hold the text:
//!
//! - A balance change is stated, never celebrated: an amount, a
//!   direction, and whether the chain has it yet.
//! - While balances are masked, no amount.
//! - While the app is locked, no amount and no wallet name either: the
//!   lock screen shows neither, and a notification must not say what
//!   the window refuses to.
//! - A pending payment that is no longer coming is always said, one
//!   notification each: it takes back what an earlier one promised,
//!   and folding it into a count would leave the promise standing.

use std::collections::HashMap;

use gerfaut_core::format::{format_btc, group_thousands};
use gerfaut_core::live::LiveTx;
use gerfaut_core::store::TxStage;

/// Transactions said one by one for a wallet in one sync; the rest are
/// counted in a single line.
pub(crate) const NOTICES_PER_WALLET: usize = 3;

/// The longest wallet name a notification carries, in characters.
const MAX_TITLE_CHARS: usize = 64;

/// The title of a notification that must not name a wallet.
pub(crate) const APP_TITLE: &str = "Gerfaut";

/// Payments no longer coming held for one sync. Far above what a real
/// wallet sees; the rest are counted in a line that says the same.
const MAX_DROPPED_HELD: usize = 64;

/// The unit amounts are shown in, as the display setting has it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Unit {
    #[default]
    Btc,
    Sats,
}

/// Everything the text depends on besides the transactions.
#[derive(Debug, Clone, Default)]
pub(crate) struct Context {
    pub names: HashMap<String, String>,
    pub unit: Unit,
    pub masked: bool,
    pub locked: bool,
}

/// Which flood budget a notification draws on. A payment that is no
/// longer coming has one of its own, so a burst of new transactions
/// can never silence it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum NoticeKind {
    Transaction,
    Dropped,
}

/// One notification, ready to post.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Notice {
    pub title: String,
    pub body: String,
    pub kind: NoticeKind,
}

/// What one sync of one wallet has to announce: the first few
/// transactions and how many came after them, and every pending
/// payment that is no longer coming.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Held {
    pub first: Vec<LiveTx>,
    pub more: u32,
    pub dropped: Vec<LiveTx>,
    pub dropped_more: u32,
}

impl Held {
    pub(crate) fn push(&mut self, tx: LiveTx) {
        if tx.stage == TxStage::Dropped {
            if self.dropped.len() < MAX_DROPPED_HELD {
                self.dropped.push(tx);
            } else {
                self.dropped_more = self.dropped_more.saturating_add(1);
            }
        } else if self.first.len() < NOTICES_PER_WALLET {
            self.first.push(tx);
        } else {
            self.more = self.more.saturating_add(1);
        }
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.first.is_empty() && self.dropped.is_empty()
    }
}

impl FromIterator<LiveTx> for Held {
    fn from_iter<I: IntoIterator<Item = LiveTx>>(txs: I) -> Self {
        let mut held = Held::default();
        for tx in txs {
            held.push(tx);
        }
        held
    }
}

fn amount(sats: u64, unit: Unit) -> String {
    match unit {
        Unit::Btc => format!("{} BTC", group_thousands(&format_btc(sats))),
        Unit::Sats => format!("{} sats", group_thousands(&sats.to_string())),
    }
}

fn describe(tx: &LiveTx, context: &Context) -> String {
    let hidden = context.masked || context.locked || tx.net_sats == 0;
    let outgoing = tx.net_sats < 0;
    let sats = || amount(tx.net_sats.unsigned_abs(), context.unit);
    let moved = || {
        if outgoing {
            format!("{} left this wallet", sats())
        } else {
            format!("Received {}", sats())
        }
    };
    match (hidden, tx.stage) {
        (true, TxStage::Mempool) if outgoing => "New outgoing transaction · pending".to_owned(),
        (true, TxStage::Mempool) => "New transaction · pending".to_owned(),
        (true, TxStage::Confirmed) if outgoing => "Outgoing transaction confirmed".to_owned(),
        (true, TxStage::Confirmed) => "Transaction confirmed".to_owned(),
        (true, TxStage::Dropped) => "A pending payment is no longer coming".to_owned(),
        (false, TxStage::Mempool) => format!("{} · pending", moved()),
        (false, TxStage::Confirmed) => format!("{} · confirmed", moved()),
        (false, TxStage::Dropped) => {
            format!("A pending payment of {} is no longer coming", sats())
        }
    }
}

/// Characters that draw nothing yet reorder or hide what is around
/// them: the bidirectional overrides, embeddings, isolates and marks,
/// and the zero-width space, word joiner and byte order mark. The two
/// zero-width joiners stay: some scripts and emoji need them.
fn invisible(c: char) -> bool {
    matches!(
        c,
        '\u{061C}'
            | '\u{200B}'
            | '\u{200E}'
            | '\u{200F}'
            | '\u{202A}'..='\u{202E}'
            | '\u{2060}'
            | '\u{2066}'..='\u{2069}'
            | '\u{FEFF}'
    )
}

/// A wallet name as a notification may carry it. The name is the one
/// piece of free text that reaches the system: it comes from the
/// person, or from a backup someone handed them. Control characters
/// and the invisible ones that turn text around go, runs of blanks
/// become one space, and the length is held.
pub(crate) fn safe_title(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_whitespace() { ' ' } else { c })
        .filter(|&c| !c.is_control() && !invisible(c))
        .collect();
    let joined =
        cleaned
            .split(' ')
            .filter(|part| !part.is_empty())
            .fold(String::new(), |mut out, part| {
                if !out.is_empty() {
                    out.push(' ');
                }
                out.push_str(part);
                out
            });
    let title: String = joined.chars().take(MAX_TITLE_CHARS).collect();
    if title.is_empty() {
        APP_TITLE.to_owned()
    } else {
        title
    }
}

fn plural(count: u32, noun: &str) -> String {
    format!("{count} {noun}{}", if count == 1 { "" } else { "s" })
}

/// What one wallet's sync amounts to: one notice per transaction up to
/// [`NOTICES_PER_WALLET`], then one line counting the rest, then one
/// notice for each payment no longer coming. Those come last, so they
/// sit on top of the pile the system keeps.
pub(crate) fn compose(wallet_id: &str, held: &Held, context: &Context) -> Vec<Notice> {
    let title = if context.locked {
        APP_TITLE.to_owned()
    } else {
        context
            .names
            .get(wallet_id)
            .map(|name| safe_title(name))
            .unwrap_or_else(|| APP_TITLE.to_owned())
    };
    let mut notices: Vec<Notice> = held
        .first
        .iter()
        .map(|tx| Notice {
            title: title.clone(),
            body: describe(tx, context),
            kind: NoticeKind::Transaction,
        })
        .collect();
    if held.more > 0 {
        notices.push(Notice {
            title: title.clone(),
            body: plural(held.more, "more transaction"),
            kind: NoticeKind::Transaction,
        });
    }
    notices.extend(held.dropped.iter().map(|tx| Notice {
        title: title.clone(),
        body: describe(tx, context),
        kind: NoticeKind::Dropped,
    }));
    if held.dropped_more > 0 {
        let count = held.dropped_more;
        notices.push(Notice {
            title,
            body: format!(
                "{count} more pending payment{} no longer coming",
                if count == 1 { " is" } else { "s are" }
            ),
            kind: NoticeKind::Dropped,
        });
    }
    notices
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tx(txid: &str, net_sats: i64, stage: TxStage) -> LiveTx {
        LiveTx {
            wallet_id: "w1".to_owned(),
            txid: txid.to_owned(),
            net_sats,
            stage,
        }
    }

    fn context() -> Context {
        Context {
            names: HashMap::from([("w1".to_owned(), "Cold storage".to_owned())]),
            ..Context::default()
        }
    }

    #[test]
    fn an_amount_a_direction_and_where_the_chain_has_it() {
        let held: Held = [
            tx("a", 150_000, TxStage::Mempool),
            tx("b", -2_100_000_000, TxStage::Mempool),
            tx("a", 150_000, TxStage::Confirmed),
        ]
        .into_iter()
        .collect();
        let notices = compose("w1", &held, &context());
        assert_eq!(notices.len(), 3);
        assert!(notices.iter().all(|notice| notice.title == "Cold storage"));
        assert_eq!(notices[0].body, "Received 0.00150000 BTC · pending");
        assert_eq!(
            notices[1].body,
            "21.00000000 BTC left this wallet · pending"
        );
        assert_eq!(notices[2].body, "Received 0.00150000 BTC · confirmed");
    }

    #[test]
    fn amounts_follow_the_unit() {
        let held: Held = [tx("a", 1_234_567, TxStage::Mempool)].into_iter().collect();
        let sats = Context {
            unit: Unit::Sats,
            ..context()
        };
        assert_eq!(
            compose("w1", &held, &sats)[0].body,
            "Received 1\u{202f}234\u{202f}567 sats · pending"
        );
    }

    #[test]
    fn masked_says_the_direction_and_never_the_amount() {
        let held: Held = [
            tx("a", 150_000, TxStage::Mempool),
            tx("b", -150_000, TxStage::Mempool),
            tx("c", -150_000, TxStage::Confirmed),
        ]
        .into_iter()
        .collect();
        let masked = Context {
            masked: true,
            ..context()
        };
        let notices = compose("w1", &held, &masked);
        assert_eq!(notices[0].title, "Cold storage");
        assert_eq!(notices[0].body, "New transaction · pending");
        assert_eq!(notices[1].body, "New outgoing transaction · pending");
        assert_eq!(notices[2].body, "Outgoing transaction confirmed");
        assert!(notices.iter().all(|notice| !notice.body.contains("150")));
    }

    /// Behind the lock the window shows no wallet and no amount, and
    /// neither does what is posted over it, masked or not.
    #[test]
    fn locked_names_no_wallet_and_no_amount() {
        let held: Held = [
            tx("a", 150_000, TxStage::Mempool),
            tx("b", -150_000, TxStage::Mempool),
            tx("a", 150_000, TxStage::Confirmed),
            tx("d", 9, TxStage::Mempool),
            tx("e", 9, TxStage::Mempool),
        ]
        .into_iter()
        .collect();
        let locked = Context {
            locked: true,
            ..context()
        };
        let notices = compose("w1", &held, &locked);
        assert_eq!(
            notices,
            vec![
                Notice {
                    title: "Gerfaut".to_owned(),
                    body: "New transaction · pending".to_owned(),
                    kind: NoticeKind::Transaction,
                },
                Notice {
                    title: "Gerfaut".to_owned(),
                    body: "New outgoing transaction · pending".to_owned(),
                    kind: NoticeKind::Transaction,
                },
                Notice {
                    title: "Gerfaut".to_owned(),
                    body: "Transaction confirmed".to_owned(),
                    kind: NoticeKind::Transaction,
                },
                Notice {
                    title: "Gerfaut".to_owned(),
                    body: "2 more transactions".to_owned(),
                    kind: NoticeKind::Transaction,
                },
            ]
        );
        for notice in &notices {
            assert!(!notice.title.contains("Cold"));
            assert!(!notice.body.contains("150"));
            assert!(!notice.body.contains("BTC"));
        }
    }

    /// A payment that vanished takes back an earlier notification:
    /// with its amount when amounts show, without it when they are
    /// masked, and naming nothing behind the lock.
    #[test]
    fn a_payment_no_longer_coming_is_said_in_every_state() {
        let held: Held = [tx("a", 150_000, TxStage::Dropped)].into_iter().collect();
        let plain = compose("w1", &held, &context());
        assert_eq!(
            plain,
            vec![Notice {
                title: "Cold storage".to_owned(),
                body: "A pending payment of 0.00150000 BTC is no longer coming".to_owned(),
                kind: NoticeKind::Dropped,
            }]
        );

        let sats = Context {
            unit: Unit::Sats,
            ..context()
        };
        assert_eq!(
            compose("w1", &held, &sats)[0].body,
            "A pending payment of 150\u{202f}000 sats is no longer coming"
        );

        let masked = Context {
            masked: true,
            ..context()
        };
        let shown = compose("w1", &held, &masked);
        assert_eq!(shown[0].title, "Cold storage");
        assert_eq!(shown[0].body, "A pending payment is no longer coming");

        let locked = Context {
            locked: true,
            ..context()
        };
        let shown = compose("w1", &held, &locked);
        assert_eq!(shown[0].title, "Gerfaut");
        assert_eq!(shown[0].body, "A pending payment is no longer coming");
    }

    /// However many transactions a sync found, each payment that is no
    /// longer coming gets its own notification, after them.
    #[test]
    fn a_payment_no_longer_coming_is_never_folded_into_a_count() {
        let mut held: Held = (0..9)
            .map(|i| tx(&format!("t{i}"), 1_000, TxStage::Mempool))
            .collect();
        held.push(tx("gone1", 5_000, TxStage::Dropped));
        held.push(tx("t9", 1_000, TxStage::Confirmed));
        held.push(tx("gone2", 7_000, TxStage::Dropped));
        let notices = compose("w1", &held, &context());
        let bodies: Vec<&str> = notices.iter().map(|n| n.body.as_str()).collect();
        assert_eq!(bodies[3], "7 more transactions");
        assert_eq!(
            &bodies[4..],
            [
                "A pending payment of 0.00005000 BTC is no longer coming",
                "A pending payment of 0.00007000 BTC is no longer coming",
            ]
        );
        assert!(notices[4..].iter().all(|n| n.kind == NoticeKind::Dropped));
        assert!(
            notices[..4]
                .iter()
                .all(|n| n.kind == NoticeKind::Transaction)
        );

        // Past what is held one by one, the rest still say what they are.
        let flood: Held = (0..(MAX_DROPPED_HELD + 2))
            .map(|i| tx(&format!("d{i}"), 1, TxStage::Dropped))
            .collect();
        let notices = compose("w1", &flood, &context());
        assert_eq!(notices.len(), MAX_DROPPED_HELD + 1);
        assert_eq!(
            notices.last().map(|n| n.body.as_str()),
            Some("2 more pending payments are no longer coming")
        );
    }

    #[test]
    fn three_are_said_and_the_rest_counted() {
        let held: Held = (0..7)
            .map(|i| tx(&format!("t{i}"), 1_000, TxStage::Mempool))
            .collect();
        assert_eq!(held.first.len(), NOTICES_PER_WALLET);
        assert_eq!(held.more, 4);
        let notices = compose("w1", &held, &context());
        assert_eq!(notices.len(), 4);
        assert_eq!(notices[3].body, "4 more transactions");

        let one_more: Held = (0..4)
            .map(|i| tx(&format!("t{i}"), 1_000, TxStage::Mempool))
            .collect();
        assert_eq!(
            compose("w1", &one_more, &context())[3].body,
            "1 more transaction"
        );
    }

    /// A name is free text, and may come from a backup someone else
    /// wrote: nothing in it shapes the notification.
    #[test]
    fn a_wallet_name_cannot_shape_the_notification() {
        assert_eq!(
            safe_title("Savings\r\nReceived 5 BTC\u{0}\u{1b}[31m"),
            "Savings Received 5 BTC[31m"
        );
        assert_eq!(safe_title("  a \t\n  b  "), "a b");
        assert_eq!(safe_title(&"x".repeat(500)).chars().count(), 64);
        assert_eq!(safe_title("\u{7}\n"), "Gerfaut");
        // An override would draw the rest of the line backwards, and an
        // isolate or a mark would move it around: none of them stays.
        assert_eq!(
            safe_title("Savings \u{202E}CTB 5 devieceR\u{202C}"),
            "Savings CTB 5 devieceR"
        );
        assert_eq!(
            safe_title("\u{2067}a\u{2069}\u{200F}b\u{200B}c\u{FEFF}\u{2060}d\u{061C}"),
            "abcd"
        );
        assert_eq!(safe_title("\u{202E}\u{200B}"), "Gerfaut");
        // What joins letters or emoji is kept.
        assert_eq!(
            safe_title("\u{1F468}\u{200D}\u{1F469}\u{200C}"),
            "\u{1F468}\u{200D}\u{1F469}\u{200C}"
        );
        // Markup is text: the platform layer escapes it, and it stays
        // one line either way.
        assert_eq!(
            safe_title("<toast launch='x'>"),
            "<toast launch='x'>".to_owned()
        );
        // A wallet nobody can name falls back on the app.
        let held: Held = [tx("a", 1, TxStage::Mempool)].into_iter().collect();
        assert_eq!(
            compose("unknown", &held, &Context::default())[0].title,
            "Gerfaut"
        );
    }
}
