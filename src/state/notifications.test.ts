import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NewTx, SyncReport } from "../lib/ipc";
import { formatAmount } from "../lib/format";
import { announce, formatNewTxNotices, notifier } from "./notifications";

function tx(sats: number, txid = "a", confirmed = true): NewTx {
  return { txid, net_sats: sats, confirmed };
}

function report(txs: NewTx[], wallet_id = "w1"): SyncReport {
  return {
    wallet_id,
    new_tx_count: txs.length,
    new_txs: txs,
    balance: {
      confirmed: 0,
      trusted_pending: 0,
      untrusted_pending: 0,
      immature: 0,
      total: 0,
    },
    tip_height: 100,
    took_ms: 1,
    backend: "mempool.space",
  };
}

const NAMES = { w1: "Cold storage" };

function bodies(
  reports: SyncReport[],
  { unit = "btc", masked = false } = {} as {
    unit?: "btc" | "sats";
    masked?: boolean;
  },
): string[] {
  return formatNewTxNotices(reports, NAMES, unit, masked).map((n) => n.body);
}

describe("what a notification says", () => {
  it("states a receipt and an exit, in the display unit", () => {
    expect(bodies([report([tx(1_000_000)])])).toEqual([
      `Received ${formatAmount(1_000_000, "btc")}`,
    ]);
    expect(bodies([report([tx(-200_000)])])).toEqual([
      `${formatAmount(200_000, "btc")} left this wallet`,
    ]);
    expect(bodies([report([tx(1_000_000)])], { unit: "sats" })).toEqual([
      `Received ${formatAmount(1_000_000, "sats")}`,
    ]);
  });

  it("says when the chain has not taken it yet", () => {
    expect(bodies([report([tx(1000, "a", false)])])).toEqual([
      `Received ${formatAmount(1000, "btc")} · pending`,
    ]);
  });

  it("keeps amounts out while balances are masked", () => {
    expect(bodies([report([tx(1000)])], { masked: true })).toEqual([
      "New transaction",
    ]);
    expect(bodies([report([tx(-1000)])], { masked: true })).toEqual([
      "New outgoing transaction",
    ]);
  });

  it("counts the rest past three", () => {
    const many = Array.from({ length: 5 }, (_, i) => tx(1000 * (i + 1), `tx${i}`));
    const said = bodies([report(many)]);
    expect(said).toHaveLength(4);
    expect(said.at(-1)).toBe("2 more new transactions");
  });

  it("titles each line with the wallet, falling back to its id", () => {
    const notices = formatNewTxNotices(
      [report([tx(1000)]), report([tx(2000)], "w2")],
      NAMES,
      "btc",
      false,
    );
    expect(notices.map((n) => n.title)).toEqual(["Cold storage", "w2"]);
  });

  it("says nothing about a sync that found nothing", () => {
    expect(bodies([report([])])).toEqual([]);
  });
});

describe("posting them", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("posts nothing while the preference is off", async () => {
    const send = vi.spyOn(notifier, "sendNotification").mockImplementation(() => {});
    await announce([report([tx(1000)])], {
      enabled: false,
      names: NAMES,
      unit: "btc",
      masked: false,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("asks the system once and then posts", async () => {
    vi.spyOn(notifier, "isPermissionGranted").mockResolvedValue(false);
    const ask = vi.spyOn(notifier, "requestPermission").mockResolvedValue("granted");
    const send = vi.spyOn(notifier, "sendNotification").mockImplementation(() => {});

    await announce([report([tx(1000)])], {
      enabled: true,
      names: NAMES,
      unit: "btc",
      masked: false,
    });

    expect(ask).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      title: "Cold storage",
      body: `Received ${formatAmount(1000, "btc")}`,
    });
  });

  it("stays quiet when the system refuses", async () => {
    vi.spyOn(notifier, "isPermissionGranted").mockResolvedValue(false);
    vi.spyOn(notifier, "requestPermission").mockResolvedValue("denied");
    const send = vi.spyOn(notifier, "sendNotification").mockImplementation(() => {});

    await announce([report([tx(1000)])], {
      enabled: true,
      names: NAMES,
      unit: "btc",
      masked: false,
    });

    expect(send).not.toHaveBeenCalled();
  });

  it("a platform that throws does not break the sync", async () => {
    vi.spyOn(notifier, "isPermissionGranted").mockRejectedValue(new Error("no"));
    await expect(
      announce([report([tx(1000)])], {
        enabled: true,
        names: NAMES,
        unit: "btc",
        masked: false,
      }),
    ).resolves.toBeUndefined();
  });
});
