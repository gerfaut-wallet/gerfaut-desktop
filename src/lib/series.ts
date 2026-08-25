// Wallet balance over time, derived from the transaction list.

import type { TxSummary } from "./ipc";

export interface BalancePoint {
  /** Unix timestamp, seconds. */
  t: number;
  /** Balance after every transaction up to `t`, in sats. */
  sats: number;
}

/** Builds the balance curve of the loaded transaction window, oldest
    point first, ending on a "now" point at the current total.

    The curve is anchored on the current total and walked backward, so a
    truncated history (busy watched address) still yields correct
    balances for the window it covers — the pre-window remainder simply
    becomes the starting level. Pending transactions carry no timestamp:
    they only show up in the final point. */
export function balanceSeries(
  txs: TxSummary[],
  totalSats: number,
  nowSecs = Math.floor(Date.now() / 1000),
): BalancePoint[] {
  const confirmed: { t: number; net: number }[] = [];
  let loadedNet = 0;
  for (const tx of txs) {
    loadedNet += tx.net_sats;
    if (tx.status.state === "confirmed" && tx.status.timestamp !== null) {
      confirmed.push({ t: tx.status.timestamp, net: tx.net_sats });
    }
  }
  if (confirmed.length === 0) return [];
  confirmed.sort((a, b) => a.t - b.t);

  // Balance before the first loaded transaction; zero for a complete
  // history, the not-yet-loaded remainder for a truncated one.
  let running = totalSats - loadedNet;
  const points: BalancePoint[] = [];
  for (const { t, net } of confirmed) {
    running += net;
    points.push({ t, sats: Math.max(0, running) });
  }
  const last = points[points.length - 1];
  points.push({ t: Math.max(nowSecs, last.t + 1), sats: totalSats });
  return points;
}
