import { ExternalLink, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Network } from "../lib/ipc";
import { MASKED, formatBtcSigned, formatSats, groupThousands } from "../lib/format";
import { useTxDetail } from "../state/queries";
import { useUi } from "../state/store";
import { AddressChip } from "../components/AddressChip";
import { StatusPill } from "../components/StatusPill";
import { IconButton } from "../components/Button";
import { explorerTxUrl } from "../lib/explorer";

/** The 320px context rail: transaction detail without leaving the view. */
export function TxDetailRail({ walletId, network }: { walletId: string; network: Network }) {
  const { selectedTxid, selectTx, masked } = useUi();
  const detail = useTxDetail(walletId, selectedTxid);

  if (!selectedTxid) return null;

  return (
    <aside
      aria-label="Transaction detail"
      className="flex h-full w-[320px] shrink-0 flex-col border-l border-border bg-surface"
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="font-display text-base font-semibold text-text">Transaction</h2>
        <IconButton label="Close detail" onClick={() => selectTx(null)}>
          <X size={18} strokeWidth={1.5} aria-hidden />
        </IconButton>
      </header>

      {detail.isPending && (
        <p className="px-4 py-4 font-ui text-sm text-muted">Loading…</p>
      )}
      {detail.isError && (
        <p className="px-4 py-4 font-ui text-sm text-muted">
          This transaction could not be loaded.
        </p>
      )}

      {detail.data && (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="selectable font-data text-[22px] font-medium tracking-[-0.01em] text-text">
            {masked ? MASKED : formatBtcSigned(detail.data.summary.net_sats)}
            <span className="ml-1.5 font-ui text-xs font-normal text-muted">BTC</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <StatusPill
              status={detail.data.summary.status}
              confirmations={detail.data.summary.confirmations}
            />
            {detail.data.summary.status.state === "confirmed" && (
              <span className="font-data text-xs text-muted">
                block {groupThousands(String(detail.data.summary.status.height))}
              </span>
            )}
          </div>

          <dl className="mt-4 flex flex-col gap-3">
            <div>
              <dt className="font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
                Transaction id
              </dt>
              <dd className="mt-1">
                <AddressChip value={detail.data.summary.txid} head={10} tail={10} />
              </dd>
            </div>
            <div className="flex gap-6">
              <div>
                <dt className="font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
                  Fee
                </dt>
                <dd className="selectable mt-1 font-data text-[13px] text-text">
                  {detail.data.summary.fee_sats !== null
                    ? formatSats(detail.data.summary.fee_sats)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
                  Fee rate
                </dt>
                <dd className="selectable mt-1 font-data text-[13px] text-text">
                  {detail.data.fee_rate_sat_vb !== null
                    ? `${detail.data.fee_rate_sat_vb.toFixed(1)} sat/vB`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
                  Size
                </dt>
                <dd className="selectable mt-1 font-data text-[13px] text-text">
                  {detail.data.vsize} vB
                </dd>
              </div>
            </div>

            <IoSection title={`Inputs (${detail.data.inputs.length})`} ios={detail.data.inputs} masked={masked} />
            <IoSection title={`Outputs (${detail.data.outputs.length})`} ios={detail.data.outputs} masked={masked} />
          </dl>

          {explorerTxUrl(network, detail.data.summary.txid) !== "" && (
            <button
              type="button"
              onClick={() => void openUrl(explorerTxUrl(network, detail.data.summary.txid))}
              className="mt-5 inline-flex cursor-pointer items-center gap-1.5 font-ui text-sm text-primary transition-colors duration-150 hover:underline"
            >
              View on explorer
              <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
            </button>
          )}
        </div>
      )}
    </aside>
  );
}

function IoSection({
  title,
  ios,
  masked,
}: {
  title: string;
  ios: { address: string | null; value_sats: number | null; is_mine: boolean }[];
  masked: boolean;
}) {
  return (
    <div>
      <dt className="font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
        {title}
      </dt>
      <dd className="mt-1 flex flex-col gap-1">
        {ios.map((io, index) => (
          <div key={index} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 overflow-hidden">
              {io.address ? (
                <AddressChip value={io.address} />
              ) : (
                <span className="font-data text-[13px] text-muted">unknown</span>
              )}
              {io.is_mine && (
                <span className="rounded-full bg-sunken px-1.5 py-px font-ui text-[10px] font-medium uppercase tracking-[0.04em] text-muted">
                  mine
                </span>
              )}
            </span>
            <span className="shrink-0 font-data text-xs text-text">
              {io.value_sats !== null ? (masked ? MASKED : formatSats(io.value_sats)) : "—"}
            </span>
          </div>
        ))}
      </dd>
    </div>
  );
}
