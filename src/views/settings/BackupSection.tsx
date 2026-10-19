import { Archive, Download, Upload } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/Button";
import type { Network } from "../../lib/ipc";
import { useWallets } from "../../state/queries";
import { BackupExportModal, BackupRestoreModal } from "../BackupModals";
import { SectionCard } from "./primitives";

/** The settings card that seals the wallet list under a password and
    opens such a backup: the file or the animated QR code a backup
    makes is also how wallets travel between the desktop and the
    phone. */
export function BackupSection({ activeNetwork }: { activeNetwork: Network }) {
  // Every wallet, on every network: a backup is not scoped to the
  // workspace the settings happen to show.
  const wallets = useWallets();
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);

  return (
    <SectionCard icon={<Archive size={18} strokeWidth={1.5} />} title="Backup & sync">
      <p className="max-w-2xl font-ui text-sm text-muted">
        Every wallet you watch, encrypted with a password you choose. Restore it
        on another device: the same file or QR code moves your wallets between
        the desktop and the phone. A backup holds descriptors and addresses,
        never a private key or seed.
      </p>
      {/* Exporting is the habit, restoring happens once on a new device:
          one filled action, its counterpart beside it. */}
      <div className="mt-4 flex gap-2">
        <Button variant="primary" onClick={() => setExporting(true)} icon={Upload}>
          Export…
        </Button>
        <Button variant="secondary" onClick={() => setRestoring(true)} icon={Download}>
          Restore…
        </Button>
      </div>

      <BackupExportModal
        open={exporting}
        onClose={() => setExporting(false)}
        wallets={wallets.data ?? []}
        activeNetwork={activeNetwork}
      />
      <BackupRestoreModal
        open={restoring}
        onClose={() => setRestoring(false)}
        activeNetwork={activeNetwork}
      />
    </SectionCard>
  );
}
