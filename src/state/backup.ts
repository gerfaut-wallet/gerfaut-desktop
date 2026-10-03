// The encrypted backup of the wallet list: the same file or QR code
// that moves wallets between the desktop and the phone.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BackupOptions, ImportChoices, ImportReport, Network } from "../lib/ipc";
import { ipc } from "../lib/ipc";
import { keys, useInvalidateWallet } from "./queries";

/** Every wallet, on every network: a backup is not scoped to the
    workspace the settings happen to show. */
export function useAllWallets() {
  return useQuery({ queryKey: ["wallets", "all"], queryFn: () => ipc.listWallets() });
}

export function useExportBackup() {
  return useMutation({
    mutationFn: (args: { options: BackupOptions; password: string }) =>
      ipc.exportBackup(args.options, args.password),
  });
}

export function usePreviewBackup() {
  return useMutation({
    mutationFn: (args: { source: string; password: string }) =>
      ipc.previewBackup(args.source, args.password),
  });
}

/** What a restore did: the core's report, and the network the
    workspace is on once it is over. */
export interface Restored {
  report: ImportReport;
  network: Network;
  /** The restored wallets are all on another network, and moving the
      workspace there failed: they are in, out of sight. */
  elsewhere: boolean;
}

/** Restores a backup, and knows everything a restore changes: the
    wallets, the settings when the backup's are applied, and the
    workspace's network, which follows the restored wallets when none
    of them is on the active one — otherwise they would land out of
    sight. The cache is read again whatever happened: a restore that
    failed half way may still have written. */
export function useImportBackup(activeNetwork: Network) {
  const client = useQueryClient();
  const invalidate = useInvalidateWallet();
  return useMutation({
    mutationFn: async (args: {
      source: string;
      password: string;
      choices: ImportChoices;
    }): Promise<Restored> => {
      const report = await ipc.importBackup(args.source, args.password, args.choices);
      const landed = report.added.map((wallet) => wallet.network);
      if (landed.length === 0 || landed.includes(activeNetwork)) {
        return { report, network: activeNetwork, elsewhere: false };
      }
      try {
        await ipc.setActiveNetwork(landed[0]);
        return { report, network: landed[0], elsewhere: false };
      } catch {
        // The wallets are in: the restore did not fail, and the network
        // can be switched by hand.
        return { report, network: activeNetwork, elsewhere: true };
      }
    },
    onSettled: () => {
      invalidate();
      void client.invalidateQueries({ queryKey: keys.settings });
      void client.invalidateQueries({ queryKey: keys.liveStatus });
    },
  });
}

/** A byte count the way a file manager states it. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/** Today, as the name of a backup file. */
export function backupFilename(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `gerfaut-backup-${now.getFullYear()}-${month}-${day}.gerfaut`;
}
