import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { useReceiveAddresses } from "../state/queries";
import { useUi } from "../state/store";

/** Receive address display: the full address in mono, copy with
    explicit feedback, index shown. Single-address wallets show their
    one address. */
export function ReceiveModal({ walletId }: { walletId: string }) {
  const { receiveOpen, setReceiveOpen, showToast } = useUi();
  const addresses = useReceiveAddresses(walletId, receiveOpen);
  const [copied, setCopied] = useState(false);

  const entry = addresses.data?.[0];

  const copy = async () => {
    if (!entry) return;
    await navigator.clipboard.writeText(entry.address);
    setCopied(true);
    showToast("Copied");
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Modal open={receiveOpen} onClose={() => setReceiveOpen(false)} title="Receive" width={480}>
      {addresses.isPending && (
        <p className="font-ui text-sm text-muted">Deriving address…</p>
      )}
      {addresses.isError && (
        <p className="font-ui text-sm text-muted">
          The receive address could not be derived.
        </p>
      )}
      {entry && (
        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-1 font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted">
              Next unused address · index {entry.index}
            </p>
            <p className="selectable break-all rounded-sm bg-sunken p-4 font-data text-[15px] leading-relaxed text-text">
              {entry.address}
            </p>
          </div>
          <p className="font-ui text-xs text-muted">
            Verify this address on your signing device before sharing it. Gerfaut
            only watches: it never holds the keys behind it.
          </p>
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => void copy()}>
              {copied ? (
                <Check size={16} strokeWidth={1.5} aria-hidden />
              ) : (
                <Copy size={16} strokeWidth={1.5} aria-hidden />
              )}
              {copied ? "Copied" : "Copy address"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
