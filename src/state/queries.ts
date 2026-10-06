// Server-state hooks. One place defines cache keys and invalidation.

import type { FetchStatus } from "@tanstack/react-query";
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  BackendConfig,
  ExportOptions,
  FiatCurrency,
  LockKind,
  Network,
  ParsedInput,
  PriceRange,
  WalletIconId,
} from "../lib/ipc";
import { ipc, isCommandError } from "../lib/ipc";
import { useUi } from "./store";

// What a sync found is announced by the Rust side, which posts the
// notifications and keeps the record of what was said: a sync asked
// for here and the live watch never say the same thing twice.

export const keys = {
  settings: ["settings"] as const,
  wallets: (network?: Network) => ["wallets", network ?? "all"] as const,
  snapshot: (id: string) => ["snapshot", id] as const,
  utxos: (id: string) => ["utxos", id] as const,
  policy: (id: string) => ["policy", id] as const,
  txDetail: (id: string, txid: string) => ["tx", id, txid] as const,
  receive: (id: string) => ["receive", id] as const,
  liveStatus: ["live-status"] as const,
};

/** What kept the vault shut at startup, or null. Asked once: only a
    retry from the screen that shows it changes the answer, and that
    screen resets every query when it does. A bridge that does not know
    the command reads as no failure. */
export function useStartupFailure() {
  return useQuery({
    queryKey: ["startup"],
    queryFn: async () => (await ipc.startupFailure()) ?? null,
    staleTime: Infinity,
    retry: false,
  });
}

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: ipc.getSettings });
}

/** The public servers offered for a network. A static catalogue: it
    only changes when the app is updated. */
export function usePublicServers(network: Network) {
  return useQuery({
    queryKey: ["public-servers", network],
    queryFn: () => ipc.publicServers(network),
    staleTime: Infinity,
  });
}

/** The wallets of a network. `enabled` is how the lock keeps them out
    of the cache: the list is names, kinds and networks, and behind the
    lock screen none of it has any business being in the webview. */
export function useWallets(network?: Network, enabled = true) {
  return useQuery({
    queryKey: keys.wallets(network),
    queryFn: () => ipc.listWallets(network),
    enabled,
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

/** The wallet's policy read against the tip and its coins. Its lock
    states move with the chain, so it is invalidated with the snapshot. */
export function useWalletPolicy(id: string | null) {
  return useQuery({
    queryKey: keys.policy(id ?? "none"),
    queryFn: () => ipc.walletPolicy(id!),
    enabled: id !== null,
  });
}

export function useTxDetail(id: string | null, txid: string | null) {
  return useQuery({
    queryKey: keys.txDetail(id ?? "none", txid ?? "none"),
    queryFn: () => ipc.txDetail(id!, txid!),
    enabled: id !== null && txid !== null,
  });
}

export function useReceiveAddresses(id: string | null, lookahead: number) {
  return useQuery({
    queryKey: [...keys.receive(id ?? "none"), lookahead],
    queryFn: () => ipc.receiveAddresses(id!, lookahead),
    enabled: id !== null,
    // Skipping to the next index must not flash the page empty — but
    // never carry an address across wallets, even for a frame.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === id ? previous : undefined,
  });
}

/** Invalidates everything that changes when chain state moves. */
export function useInvalidateWallet() {
  const client = useQueryClient();
  return (id?: string) => {
    void client.invalidateQueries({ queryKey: ["wallets"] });
    if (id) {
      void client.invalidateQueries({ queryKey: keys.snapshot(id) });
      void client.invalidateQueries({ queryKey: keys.utxos(id) });
      // Timelocks are read against the tip and the coins: both moved.
      void client.invalidateQueries({ queryKey: keys.policy(id) });
      void client.invalidateQueries({ queryKey: ["tx", id] });
      // A sync can mark the shown receive address as used.
      void client.invalidateQueries({ queryKey: keys.receive(id) });
      void client.invalidateQueries({ queryKey: ["addresses", id] });
    } else {
      void client.invalidateQueries({ queryKey: ["snapshot"] });
      void client.invalidateQueries({ queryKey: ["utxos"] });
      void client.invalidateQueries({ queryKey: ["policy"] });
      void client.invalidateQueries({ queryKey: ["tx"] });
      void client.invalidateQueries({ queryKey: ["receive"] });
      void client.invalidateQueries({ queryKey: ["addresses"] });
    }
  };
}

/** True while any sync (one wallet or all) is in flight, from any
    component: mutation state itself is local to its hook instance. */
export function useSyncing(): boolean {
  return useIsMutating({ mutationKey: ["sync"] }) > 0;
}

export function useSyncWallet() {
  const invalidate = useInvalidateWallet();
  return useMutation({
    mutationKey: ["sync"],
    mutationFn: (id: string) => ipc.syncWallet(id),
    onSuccess: (_report, id) => {
      useUi.getState().setSyncError(id, null);
    },
    onError: (error, id) =>
      useUi
        .getState()
        .setSyncError(id, isCommandError(error) ? error.message : String(error)),
    onSettled: (_data, _error, id) => invalidate(id),
  });
}

/** Scans a wallet again from its first address with the current gap
    limit. An incremental sync only watches the addresses it revealed:
    funds that landed past them, or a descriptor also used elsewhere,
    are only found by starting over. */
export function useRescanWallet() {
  const invalidate = useInvalidateWallet();
  return useMutation({
    // The same key as a sync, so the sidebar icon turns for it too.
    mutationKey: ["sync"],
    mutationFn: (id: string) => ipc.rescanWallet(id),
    onSuccess: (report, id) => {
      useUi.getState().setSyncError(id, null);
      const found =
        report.new_tx_count === 0
          ? "no new transactions"
          : report.new_tx_count === 1
            ? "1 new transaction"
            : `${report.new_tx_count} new transactions`;
      useUi.getState().showToast(`Rescanned · ${found}`);
    },
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
    // A backend that refuses must say so: the button would otherwise
    // look like it did nothing.
    onError: (error) =>
      useUi
        .getState()
        .showToast(
          isCommandError(error) ? "Could not reach the backend" : "Could not load more",
        ),
  });
}

export function useSyncAll() {
  const invalidate = useInvalidateWallet();
  return useMutation({
    mutationKey: ["sync"],
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

export function useAddressList(id: string | null) {
  return useQuery({
    queryKey: ["addresses", id ?? "none"],
    queryFn: () => ipc.addressList(id!),
    enabled: id !== null,
  });
}

export function useExportCsv() {
  return useMutation({
    mutationFn: (args: { id: string; options: ExportOptions; suggestedName: string }) =>
      ipc.exportTransactionsCsv(args.id, args.options, args.suggestedName),
  });
}

/** Whether a price was not asked because Tor is required and cannot
    be had: with an onion backend the core sends nothing in the clear. */
export function torDown(error: unknown): boolean {
  return isCommandError(error) && error.kind === "tor";
}

/** Asked whatever the webview thinks of the network. The request is a
    command to the core, which reaches the source or says why not, Tor
    included; by default TanStack holds a refresh back while the
    webview reads offline, and the query keeps its old answer and its
    success, with no error for anyone to see. */
const PRICE_NETWORK_MODE = "always";

/** Current BTC price, refreshed every minute while fiat display is on. */
export function useFiatRate() {
  const { fiatEnabled, fiatSource, fiatCurrency } = useUi();
  return useQuery({
    queryKey: ["price", fiatSource, fiatCurrency],
    queryFn: () => ipc.fetchPrice(fiatSource, fiatCurrency),
    enabled: fiatEnabled,
    networkMode: PRICE_NETWORK_MODE,
    refetchInterval: 60_000,
    staleTime: 55_000,
    retry: 1,
  });
}

/** The answer a price display may use: the last one, while the last
    request for it went through, and in the currency chosen. A failed
    refresh keeps the answer before it in the cache, and showing it
    would price every amount at a rate of an hour ago with nothing to
    say so; a quote in another currency would put a dollar figure
    behind a euro sign. A refresh held back offline is no better: it
    keeps the old answer as if it had just come. Either way the display
    shows no price, as the settings say it will. */
export function liveAnswer<T extends { currency: FiatCurrency }>(
  query: { isError: boolean; data: T | undefined; fetchStatus: FetchStatus },
  currency: FiatCurrency,
): T | null {
  if (query.isError || query.fetchStatus === "paused") return null;
  if (!query.data || query.data.currency !== currency) return null;
  return query.data;
}

/** Price series for the overview chart, from the configured source in
    the configured currency.
 *
 *  `enabled` is the fiat setting and nothing else. A price request is a
 *  request to a third party from this machine at the moment Gerfaut
 *  opened, in the clear unless a backend is a `.onion` address, when
 *  the core sends it through Tor. Fiat display is off by default
 *  because of exactly that, so the chart asks for nothing until the
 *  setting says yes. */
export function usePriceHistory(range: PriceRange, enabled: boolean) {
  const { fiatSource, fiatCurrency } = useUi();
  return useQuery({
    queryKey: ["price-history", fiatSource, fiatCurrency, range],
    queryFn: () => ipc.fetchPriceHistory(fiatSource, fiatCurrency, range),
    enabled,
    networkMode: PRICE_NETWORK_MODE,
    staleTime: range === "day" ? 5 * 60_000 : 30 * 60_000,
    retry: 1,
  });
}

/** Decodes a pasted, imported or scanned transaction into its preview. */
export function usePreviewTransaction() {
  return useMutation({
    mutationFn: (args: { input: string; network: Network }) =>
      ipc.previewTransaction(args.input, args.network),
  });
}

/** Sends a ready transaction through the configured backend. */
export function useBroadcastTransaction() {
  return useMutation({
    mutationFn: (args: { network: Network; hex: string }) =>
      ipc.broadcastTransaction(args.network, args.hex),
  });
}

/** Follows a broadcast transaction: every 30 seconds while pending,
    stopping once it has confirmed. */
export function useTransactionStatus(network: Network, hex: string | null) {
  return useQuery({
    queryKey: ["broadcast-status", network, hex ?? "none"],
    queryFn: () => ipc.transactionStatus(network, hex!),
    enabled: hex !== null,
    refetchInterval: (query) => (query.state.data?.confirmed ? false : 30_000),
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

/** An icon lives in the wallet list and in the wallet's own snapshot;
    nothing on chain moved, so nothing else is read again. */
export function useSetWalletIcon() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; icon: WalletIconId }) =>
      ipc.setWalletIcon(args.id, args.icon),
    onSuccess: (_data, { id }) => {
      void client.invalidateQueries({ queryKey: ["wallets"] });
      void client.invalidateQueries({ queryKey: keys.snapshot(id) });
    },
  });
}

/** A pin lives in the wallet list; the live watch takes it at once and
    its status says how much of each wallet it now hears. */
export function useSetWalletLivePinned() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; pinned: boolean }) =>
      ipc.setWalletLivePinned(args.id, args.pinned),
    // Settled once the list has been read back, so the switch shows
    // what the vault holds and never flips back for a frame.
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.liveStatus });
      return client.invalidateQueries({ queryKey: ["wallets"] });
    },
  });
}

/** The order is a fact of the list alone. Settled only once the list
    has been read back, so a caller's own callbacks see the vault's
    order in the cache. */
export function useReorderWallets() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => ipc.reorderWallets(ids),
    onSuccess: () => client.invalidateQueries({ queryKey: ["wallets"] }),
  });
}

export function useSetActiveNetwork() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (network: Network) => ipc.setActiveNetwork(network),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.settings }),
  });
}

export function useSetGapLimit() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (gapLimit: number) => ipc.setGapLimit(gapLimit),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.settings });
      // Metas carry the effective gap limit.
      void client.invalidateQueries({ queryKey: ["wallets"] });
      void client.invalidateQueries({ queryKey: ["snapshot"] });
    },
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

/** Asks what an Electrum server's certificate amounts to. Reads only:
    accepting one is [useTrustCertificate]. */
export function useInspectCertificate() {
  return useMutation({ mutationFn: (url: string) => ipc.inspectCertificate(url) });
}

export function useTrustCertificate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (args: { url: string; fingerprint: string }) =>
      ipc.trustCertificate(args.url, args.fingerprint),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.settings }),
  });
}

export function useSetAppLock() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (args: { kind: LockKind; secret: string; current?: string }) =>
      ipc.setAppLock(args.kind, args.secret, args.current),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.settings }),
  });
}

export function useClearAppLock() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (current: string) => ipc.clearAppLock(current),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.settings }),
  });
}

export function useForgetCertificate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (host: string) => ipc.forgetCertificate(host),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.settings }),
  });
}
