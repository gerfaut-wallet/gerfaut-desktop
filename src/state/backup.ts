// The encrypted backup of the wallet list: the same file or QR code
// that moves wallets between the desktop and the phone.

import { useMutation, useQuery } from "@tanstack/react-query";
import type { BackupOptions, ImportChoices } from "../lib/ipc";
import { ipc } from "../lib/ipc";

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

export function useImportBackup() {
  return useMutation({
    mutationFn: (args: { source: string; password: string; choices: ImportChoices }) =>
      ipc.importBackup(args.source, args.password, args.choices),
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
