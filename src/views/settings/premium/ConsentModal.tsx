import { Button } from "../../../components/Button";
import { Modal } from "../../../components/Modal";
import { Notice } from "../../../components/Notice";

/** The question asked once per wallet before its descriptor leaves the
    device. Red, because privacy is what is at stake (D-20): the server
    will know every address of the wallet from then on. What goes is
    listed in full, and the yes repeats the consequence. A wallet that
    is a single address sends that address, and the words say so. */
export function ConsentModal({
  open,
  walletName,
  singleAddress = false,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  walletName: string;
  /** The wallet is one address, not a descriptor. */
  singleAddress?: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} onClose={onCancel} centered width={520} title="Watch this wallet from the server">
      <div className="flex flex-col gap-4">
        <Notice tone="alert">
          {singleAddress
            ? "Gerfaut's server will learn this address and see when coins move."
            : "Gerfaut's server will learn every address of this wallet, present and future, and see when coins move."}{" "}
          It keeps nothing else: no name, no e-mail unless you add one as
          a channel, no IP address.
        </Notice>
        <div>
          <p className="mb-1.5 font-ui text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
            What leaves this device
          </p>
          <ul className="flex flex-col gap-1 font-ui text-sm text-text">
            <li className="flex items-baseline gap-2">
              <span aria-hidden className="text-muted">
                ·
              </span>
              {singleAddress ? "The address" : "The descriptor"}
            </li>
            <li className="flex items-baseline gap-2">
              <span aria-hidden className="text-muted">
                ·
              </span>
              The name you gave the wallet
              <span className="text-muted">— "{walletName}"</span>
            </li>
          </ul>
        </div>
        <div className="mt-1 flex items-center justify-end gap-3">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="premium" onClick={onConfirm} disabled={busy} aria-busy={busy || undefined}>
            {busy ? "Watching…" : "Watch this wallet"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
