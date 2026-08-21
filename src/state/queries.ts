// Server-state hooks. One place defines cache keys and invalidation.

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { BackendConfig, Network, ParsedInput } from "../lib/ipc";
import { ipc } from "../lib/ipc";

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
    onSettled: (_data, _error, id) => invalidate(id),
  });
}

export function useSyncAll() {
  const invalidate = useInvalidateWallet();
  return useMutation({
    mutationFn: (network?: Network) => ipc.syncAll(network),
    onSettled: () => invalidate(),
  });
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
