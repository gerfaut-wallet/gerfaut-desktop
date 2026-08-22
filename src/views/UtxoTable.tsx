import type { UtxoInfo } from "../lib/ipc";
import { StackedAmount } from "../components/Amount";
import { AddressChip } from "../components/AddressChip";
import { StatusPill } from "../components/StatusPill";
import { EmptyState } from "../components/EmptyState";

/** Dense UTXO table: mono data columns, tabular figures, hairlines. */
export function UtxoTable({ utxos }: { utxos: UtxoInfo[] }) {
  if (utxos.length === 0) {
    return (
      <EmptyState
        title="No unspent outputs"
        hint="UTXOs appear here as soon as the wallet holds coins."
      />
    );
  }

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="border-b border-border text-left">
          <th className="px-3 py-2 font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
            Outpoint
          </th>
          <th className="px-3 py-2 font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
            Address
          </th>
          <th className="px-3 py-2 font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
            Status
          </th>
          <th className="px-3 py-2 text-right font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
            Amount
          </th>
        </tr>
      </thead>
      <tbody>
        {utxos.map((utxo) => (
          <tr
            key={`${utxo.txid}:${utxo.vout}`}
            className="border-b border-border transition-colors duration-100 last:border-b-0 hover:bg-sunken/60"
          >
            <td className="px-3 py-2">
              <AddressChip value={`${utxo.txid}:${utxo.vout}`} head={8} tail={6} />
            </td>
            <td className="px-3 py-2">
              {utxo.address ? (
                <AddressChip value={utxo.address} />
              ) : (
                <span className="font-data text-[13px] text-muted">n/a</span>
              )}
            </td>
            <td className="px-3 py-2">
              <StatusPill status={utxo.status} />
            </td>
            <td className="px-3 py-2 text-right">
              <StackedAmount sats={utxo.value_sats} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
