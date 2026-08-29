// Local notifications: what Gerfaut says when a sync finds a
// transaction it had not seen. Composed here, posted by the desktop,
// and sent nowhere: the only traffic is the sync itself.

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { NewTx, SyncReport } from "../lib/ipc";
import { formatAmount } from "../lib/format";
import type { Unit } from "../lib/format";

/** One notification, ready to post. */
export interface TxNotice {
  id: string;
  title: string;
  body: string;
}

/** Transactions said one by one for a wallet in one sync; the rest are
    counted in a single line. */
export const NOTICES_PER_WALLET = 3;

/** A balance change is stated, never celebrated: an amount, a
    direction, and whether the chain has it yet. */
function describe(tx: NewTx, unit: Unit, masked: boolean): string {
  let what: string;
  if (masked || tx.net_sats === 0) {
    what = tx.net_sats < 0 ? "New outgoing transaction" : "New transaction";
  } else if (tx.net_sats > 0) {
    what = `Received ${formatAmount(tx.net_sats, unit)}`;
  } else {
    what = `${formatAmount(-tx.net_sats, unit)} left this wallet`;
  }
  return tx.confirmed ? what : `${what} · pending`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** What the reports amount to: one notice per transaction up to
    [NOTICES_PER_WALLET] a wallet, then one line counting the rest.
    Pure: the same reports, names, unit and mask always say the same. */
export function formatNewTxNotices(
  reports: SyncReport[],
  names: Record<string, string>,
  unit: Unit,
  masked: boolean,
): TxNotice[] {
  const notices: TxNotice[] = [];
  for (const report of reports) {
    const title = names[report.wallet_id] ?? report.wallet_id;
    const txs = report.new_txs ?? [];
    if (txs.length === 0) {
      // A core that counts without listing still gets its line.
      if (report.new_tx_count > 0) {
        notices.push({
          id: `count:${report.wallet_id}`,
          title,
          body: plural(report.new_tx_count, "new transaction"),
        });
      }
      continue;
    }
    for (const tx of txs.slice(0, NOTICES_PER_WALLET)) {
      notices.push({ id: tx.txid, title, body: describe(tx, unit, masked) });
    }
    const rest = txs.length - NOTICES_PER_WALLET;
    if (rest > 0) {
      notices.push({
        id: `more:${report.wallet_id}`,
        title,
        body: plural(rest, "more new transaction"),
      });
    }
  }
  return notices;
}

/** The platform, behind one object so a test can stand in for it. */
export const notifier = {
  isPermissionGranted,
  requestPermission,
  sendNotification,
};

/** Posts what the reports amount to, when the preference is on and the
    system agrees. A notification that cannot be posted is not a failed
    sync: it is dropped, quietly. */
export async function announce(
  reports: SyncReport[],
  {
    enabled,
    names,
    unit,
    masked,
  }: {
    enabled: boolean;
    names: Record<string, string>;
    unit: Unit;
    masked: boolean;
  },
): Promise<void> {
  if (!enabled) return;
  const notices = formatNewTxNotices(reports, names, unit, masked);
  if (notices.length === 0) return;
  try {
    let granted = await notifier.isPermissionGranted();
    if (!granted) granted = (await notifier.requestPermission()) === "granted";
    if (!granted) return;
    for (const notice of notices) {
      notifier.sendNotification({ title: notice.title, body: notice.body });
    }
  } catch {
    // The desktop refused to post; the sync itself stands.
  }
}
