import { ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import type { Network, TxIo } from "../lib/ipc";
import { MASKED, formatBtcSigned, groupThousands } from "../lib/format";
import { explorerTxUrl } from "../lib/explorer";
import { useTxDetail } from "../state/queries";
import { useUi } from "../state/store";
import { AddressChip } from "../components/AddressChip";
import { useFiatValue } from "../components/Amount";
import { Button } from "../components/Button";
import { FlowDiagram } from "../components/FlowDiagram";
import { Modal } from "../components/Modal";
import { StatusPill } from "../components/StatusPill";
import { InlineAmount } from "../components/Amount";

/** Transaction detail as a large centered modal: summary, flow diagram,
    input and output tables, explorer link behind a privacy warning. */
export function TxDetailModal({ walletId, network }: { walletId: string; network: Network }) {
  const { selectedTxid, selectTx, masked } = useUi();
  const detail = useTxDetail(walletId, selectedTxid);
  const [confirmExplorer, setConfirmExplorer] = useState(false);

  const explorerUrl =
    detail.data && explorerTxUrl(network, detail.data.summary.txid);

  return (
    <Modal
      open={selectedTxid !== null}
      onClose={() => selectTx(null)}
      title="Transaction"
      width={760}
    >
      {detail.isPending && <p className="font-ui text-sm text-muted">Loading…</p>}
      {detail.isError && (
        <p className="font-ui text-sm text-muted">
          This transaction could not be loaded.
        </p>
      )}
      {detail.data && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <NetAmount sats={detail.data.summary.net_sats} masked={masked} />
            <span className="flex items-center gap-2">
              <StatusPill
                status={detail.data.summary.status}
                confirmations={detail.data.summary.confirmations}
              />
              {detail.data.summary.status.state === "confirmed" && (
                <span className="font-data text-xs text-muted">
                  block {groupThousands(String(detail.data.summary.status.height))}
                </span>
              )}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-border bg-background p-4 sm:grid-cols-4">
            <MetaItem label="Transaction id">
              <AddressChip value={detail.data.summary.txid} head={8} tail={8} />
            </MetaItem>
            <MetaItem label="Fee">
              {detail.data.summary.fee_sats !== null ? (
                <InlineAmount sats={detail.data.summary.fee_sats} withFiat={false} />
              ) : (
                <span className="font-data text-[13px] text-muted">n/a</span>
              )}
            </MetaItem>
            <MetaItem label="Fee rate">
              <span className="selectable font-data text-[13px] text-text">
                {detail.data.fee_rate_sat_vb !== null
                  ? `${detail.data.fee_rate_sat_vb.toFixed(1)} sat/vB`
                  : "n/a"}
              </span>
            </MetaItem>
            <MetaItem label="Size">
              <span className="selectable font-data text-[13px] text-text">
                {detail.data.vsize} vB
              </span>
            </MetaItem>
          </dl>

          <FlowDiagram
            inputs={detail.data.inputs}
            outputs={detail.data.outputs}
            feeSats={detail.data.summary.fee_sats}
            feeRate={detail.data.fee_rate_sat_vb}
          />

          <div className="grid gap-5 lg:grid-cols-2">
            <IoTable title={`Inputs (${detail.data.inputs.length})`} ios={detail.data.inputs} />
            <IoTable
              title={`Outputs (${detail.data.outputs.length})`}
              ios={detail.data.outputs}
            />
          </div>

          {explorerUrl !== "" && explorerUrl !== undefined && (
            <div className="flex justify-end">
              <Button variant="ghost" onClick={() => setConfirmExplorer(true)}>
                View on mempool.space
                <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
              </Button>
            </div>
          )}
        </div>
      )}

      <Modal
        open={confirmExplorer}
        onClose={() => setConfirmExplorer(false)}
        title="Open an external explorer"
        width={440}
        z={60}
      >
        <div className="flex flex-col gap-4">
          <p className="font-ui text-sm text-text">
            This opens the transaction on mempool.space, a third-party website.
            Its operator can link this transaction to your IP address.
          </p>
          <p className="font-ui text-sm text-muted">
            Consider a VPN or Tor if that link matters to you.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmExplorer(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirmExplorer(false);
                if (explorerUrl) void openUrl(explorerUrl);
              }}
            >
              Open explorer
            </Button>
          </div>
        </div>
      </Modal>
    </Modal>
  );
}

function NetAmount({ sats, masked }: { sats: number; masked: boolean }) {
  const fiat = useFiatValue(sats);
  return (
    <div className="selectable">
      <span className="font-data text-[24px] font-medium tracking-[-0.01em] text-text">
        {masked ? MASKED : formatBtcSigned(sats)}
        <span className="ml-1.5 font-ui text-xs font-normal text-muted">BTC</span>
      </span>
      {fiat && <span className="ml-2 font-data text-[13px] text-muted">{fiat}</span>}
    </div>
  );
}

function MetaItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="mb-1 font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

function IoTable({ title, ios }: { title: string; ios: TxIo[] }) {
  return (
    <div className="min-w-0">
      <h2 className="mb-2 font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
        {title}
      </h2>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full border-collapse">
          <tbody>
            {ios.map((io, index) => (
              <tr
                key={index}
                className="border-b border-border last:border-b-0"
              >
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5">
                    {io.address ? (
                      <AddressChip value={io.address} />
                    ) : (
                      <span className="font-data text-[13px] text-muted">script output</span>
                    )}
                    {io.is_mine && (
                      <span className="rounded-full bg-sunken px-1.5 py-px font-ui text-[10px] font-medium uppercase tracking-[0.04em] text-muted">
                        mine
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  {io.value_sats !== null ? (
                    <InlineAmount sats={io.value_sats} />
                  ) : (
                    <span className="font-data text-[13px] text-muted">n/a</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
