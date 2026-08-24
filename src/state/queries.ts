// Server-state hooks. One place defines cache keys and invalidation.

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { BackendConfig, Network, ParsedInput } from "../lib/ipc";
import { ipc, isCommandError } from "../lib/ipc";
import { useUi } from "./store";

export const keys = {
  settings: ["settings"] as const,
  wallets: (network?: Network) => ["wallets", network ?? "all"] as const,
  snapshot: (id: string) => ["snapshot", id] as const,
  utxos: (id: string) => ["utxos", id] as const,
  txDetail: (id: string, txid: string) => ["tx", id, txid] as const,
  receive: (id: string) => ["receive", id] as const,
};

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: ipc.getSettings });
}

export function useWallets(network?: Network) {
  return useQuery({
    queryKey: keys.wallets(network),
    queryFn: () => ipc.listWallets(network),
  });
}

export function useSnapshot(id: string | null) {
  return useQuery({
    queryKey: keys.snapshot(id ?? "none"),
    queryFn: () => ipc.walletSnapshot(id!),
    enabled: id !== null,
  });
}

export function useUtxos(id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: keys.utxos(id ?? "none"),
    queryFn: () => ipc.utxos(id!),
    enabled: id !== null && enabled,
  });
}

export function useTxDetail(id: string | null, txid: string | null) {
  return useQuery({
    queryKey: keys.txDetail(id ?? "none", txid ?? "none"),
    queryFn: () => ipc.txDetail(id!, txid!),
    enabled: id !== null && txid !== null,
  });
}

export function useReceiveAddresses(id: string | null, open: boolean) {
  return useQuery({
    queryKey: keys.receive(id ?? "none"),
    queryFn: () => ipc.receiveAddresses(id!, 0),
    enabled: id !== null && open,
  });
}

/** Invalidates everything that changes when chain state moves. */
function useInvalidateWallet() {
  const client = useQueryClient();
  return (id?: string) => {
    void client.invalidateQueries({ queryKey: ["wallets"] });
    if (id) {
      void client.invalidateQueries({ queryKey: keys.snapshot(id) });
      void client.invalidateQueries({ queryKey: keys.utxos(id) });
      void client.invalidateQueries({ queryKey: ["tx", id] });
    } else {
      void client.invalidateQueries({ queryKey: ["snapshot"] });
      void client.invalidateQueries({ queryKey: ["utxos"] });
      void client.invalidateQueries({ queryKey: ["tx"] });
    }
  };
}

export function useSyncWallet() {
  const invalidate = useInvalidateWallet();
  return useMutation({
    mutationFn: (id: string) => ipc.syncWallet(id),
    onSuccess: (_report, id) => useUi.getState().setSyncError(id, null),
    onError: (error, id) =>
      useUi
        .getState()
        .setSyncError(id, isCommandError(error) ? error.message : String(error)),
    onSettled: (_data, _error, id) => invalidate(id),
  });
}

/** Fetches an older round of watched-address history. */
export function useLoadMoreHistory() {
  const invalidate = useInvalidateWallet();
  return useMutation({
    mutationFn: (id: string) => ipc.loadMoreHistory(id),
    onSuccess: (added, id) => {
      invalidate(id);
      useUi
        .getState()
        .showToast(added === 0 ? "History is complete" : `${added} older transactions`);
    },
  });
}

export function useSyncAll() {
  const invalidate = useInvalidateWallet();
  return useMutation({
    mutationFn: (network?: Network) => ipc.syncAll(network),
    onSuccess: (report) => {
      const ui = useUi.getState();
      for (const sync of report.reports) {
        ui.setSyncError(sync.wallet_id, null);
      }
      for (const failure of report.failures) {
        ui.setSyncError(failure.wallet_id, failure.message);
      }
      if (report.failures.length === 0) {
        ui.showToast(
          report.reports.length === 1
            ? "1 wallet synced"
            : `${report.reports.length} wallets synced`,
        );
      } else {
        ui.showToast(
          `${report.reports.length} synced, ${report.failures.length} failed`,
        );
      }
    },
    onSettled: () => invalidate(),
  });
}

/** Current BTC price, refreshed every minute while fiat display is on. */
export function useFiatRate() {
  const { fiatEnabled, fiatSource, fiatCurrency } = useUi();
  return useQuery({
    queryKey: ["price", fiatSource, fiatCurrency],
    queryFn: () => ipc.fetchPrice(fiatSource, fiatCurrency),
    enabled: fiatEnabled,
    refetchInterval: 60_000,
    staleTime: 55_000,
    retry: 1,
  });
}

export function useCheckUpdate() {
  return useMutation({ mutationFn: () => ipc.checkUpdate() });
}

export function useAddWallet() {
  const invalidate = useInvalidateWallet();
  return useMutation({
    mutationFn: (args: { name: string; parsed: ParsedInput; network: Network }) =>
      ipc.addWallet(args.name, args.parsed, args.network),
    onSuccess: () => invalidate(),
  });
}

export function useRemoveWallet() {
  const invalidate = useInvalidateWallet();
  return useMutation({
    mutationFn: (id: string) => ipc.removeWallet(id),
    onSuccess: () => invalidate(),
  });
}

export function useRenameWallet() {
  const invalidate = useInvalidateWallet();
  return useMutation({
    mutationFn: (args: { id: string; name: string }) => ipc.renameWallet(args.id, args.name),
    onSuccess: () => invalidate(),
  });
}

export function useSetActiveNetwork() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (network: Network) => ipc.setActiveNetwork(network),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.settings }),
  });
}

export function useSetBackend() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (args: { network: Network; config: BackendConfig }) =>
      ipc.setBackend(args.network, args.config),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.settings }),
  });
}
