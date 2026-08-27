import type { ReactNode } from "react";
import { AddressChip } from "../components/AddressChip";
import { StackedAmount } from "../components/Amount";
import { SyncIndicator } from "../components/SyncIndicator";
import type { AddressRow } from "../lib/ipc";
import { useAddressList, useSnapshot, useSyncing } from "../state/queries";
import { useUi } from "../state/store";

/** Address audit of one wallet: every revealed address by keychain,
    its usage, and the balance sitting on it. Capped server-side — an
    audit view, not an infinite scroll. */
export function AddressesView({ walletId }: { walletId: string }) {
  const { syncErrors } = useUi();
  const snapshot = useSnapshot(walletId);
  const addresses = useAddressList(walletId);
  const syncing = useSyncing();

  if (snapshot.isPending || addresses.isPending) {
    return <p className="px-1 py-4 font-ui text-sm text-muted">Loading addresses…</p>;
  }
  if (snapshot.isError || addresses.isError || !snapshot.data || !addresses.data) {
    return (
      <p className="px-1 py-4 font-ui text-sm text-muted">
        The addresses could not be loaded.
      </p>
    );
  }
  const singleAddress = snapshot.data.meta.kind.type === "single_address";
  const { external, internal, truncated } = addresses.data;
  const count = external.length + internal.length;

  return (
    <div className="pb-8">
      <header className="px-1 pb-4 pt-2">
        <h1 className="flex items-baseline gap-2.5 font-display text-2xl font-semibold tracking-[-0.01em] text-text">
          Addresses
          {count > 0 && (
            <span className="tabular rounded-full bg-sunken px-2 py-0.5 font-ui text-xs font-medium text-muted">
              {count}
            </span>
          )}
        </h1>
        <div className="mt-1">
          <SyncIndicator
            stamp={snapshot.data.meta.last_sync}
            syncing={syncing}
            error={syncErrors[walletId] ?? null}
          />
        </div>
      </header>

      <div className="flex flex-col gap-4">
        <AddressTable
          title={singleAddress ? "Watched address" : "External"}
          hint={
            singleAddress
              ? "The one address this wallet watches."
              : "Receive addresses, in derivation order."
          }
          rows={external}
        />
        {!singleAddress && (
          <AddressTable
            title="Change"
            hint="Internal addresses used by outgoing transactions."
            rows={internal}
            empty="No change addresses revealed yet."
          />
        )}
        {truncated && (
          <p className="px-1 font-ui text-xs text-muted">
            Long keychains are capped: only the first 200 addresses of each
            are listed.
          </p>
        )}
      </div>
    </div>
  );
}

function AddressTable({
  title,
  hint,
  rows,
  empty,
}: {
  title: string;
  hint: string;
  rows: AddressRow[];
  empty?: string;
}) {
  return (
    <section aria-label={title} className="overflow-clip rounded-lg border border-border bg-surface">
      <div className="flex items-baseline justify-between gap-3 px-4 pb-1 pt-3">
        <h2 className="font-ui text-sm font-semibold text-text">{title}</h2>
        <p className="font-ui text-xs text-muted">{hint}</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 pb-4 pt-1 font-ui text-sm text-muted">{empty ?? "Nothing here yet."}</p>
      ) : (
        <table className="w-full border-separate border-spacing-0">
          {/* Pinned while the list scrolls under it: the section clips
              its corners with overflow-clip, which, unlike hidden, leaves
              the canvas as the scrolling ancestor. */}
          <thead className="sticky top-0 z-10">
            <tr className="text-left [&>th]:border-b [&>th]:border-border [&>th]:bg-surface">
              <Th className="w-16">Index</Th>
              <Th>Address</Th>
              <Th className="w-24">Status</Th>
              <Th className="w-40 text-right">Balance</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.index}
                className="transition-colors duration-100 hover:bg-sunken/60 [&>td]:border-b [&>td]:border-border last:[&>td]:border-b-0"
              >
                <td className="tabular px-3 py-2 text-[13px] text-muted">{row.index}</td>
                <td className="px-3 py-2">
                  <AddressChip value={row.address} head={16} tail={10} />
                </td>
                <td className="px-3 py-2">
                  {row.used ? (
                    <span className="inline-flex rounded-full border border-border bg-sunken px-2 py-0.5 font-ui text-[11px] font-medium text-muted">
                      Used
                    </span>
                  ) : (
                    <span className="font-ui text-[13px] text-muted">Fresh</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {row.balance_sats > 0 ? (
                    <StackedAmount sats={row.balance_sats} />
                  ) : (
                    <span className="font-ui text-[13px] text-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Th({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th
      className={`px-3 py-2 font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted ${className ?? ""}`}
    >
      {children}
    </th>
  );
}
