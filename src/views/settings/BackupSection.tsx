import { Archive, Download, Upload } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/Button";
import type { Network } from "../../lib/ipc";
import { useAllWallets } from "../../state/backup";
import { BackupExportModal, BackupRestoreModal } from "../BackupModals";
import { SectionCard } from "./primitives";

/** The settings card that seals the wallet list under a password and
    opens such a backup: the file or the animated QR code a backup
    makes is also how wallets travel between the desktop and the
    phone. */
export function BackupSection({ activeNetwork }: { activeNetwork: Network }) {
  const wallets = useAllWallets();
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);

  return (
    <SectionCard icon={<Archive size={18} strokeWidth={1.5} />} title="Backup & sync">
      <p className="font-ui text-sm text-muted">
        Every wallet you watch, encrypted with a password you choose. Restore it
        on another device: the same file or QR code moves your wallets between
        the desktop and the phone. A backup holds descriptors and addresses,
        never a key.
      </p>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" onClick={() => setExporting(true)}>
          <Upload size={14} strokeWidth={1.5} aria-hidden />
          Export…
        </Button>
        <Button variant="secondary" onClick={() => setRestoring(true)}>
          <Download size={14} strokeWidth={1.5} aria-hidden />
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
