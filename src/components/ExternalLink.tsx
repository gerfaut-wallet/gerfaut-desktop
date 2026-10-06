import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useState } from "react";
import { useUi } from "../state/store";
import { Button } from "./Button";
import { Modal } from "./Modal";
import { Notice } from "./Notice";

/** Opens a link in the app the system picks for it, and remembers the
    one that nothing opened: a desktop with no browser set, a browser
    that would not start. The call used to fail without a word, and the
    button looked broken. */
export function useOpenExternal() {
  const [failed, setFailed] = useState<string | null>(null);
  const open = useCallback(async (url: string): Promise<boolean> => {
    try {
      await openUrl(url);
      setFailed(null);
      return true;
    } catch {
      setFailed(url);
      return false;
    }
  }, []);
  return { open, failed };
}

/** What is said under a link nothing opened: the address, to copy by
    hand. Amber, nothing is at risk. `className` replaces the margin
    above, for a parent that spaces its children itself. */
export function OpenFailure({ url, className }: { url: string | null; className?: string }) {
  if (url === null) return null;
  return (
    <Notice tone="info" role="alert" className={className ?? "mt-2"}>
      Nothing on this computer opened the link. Copy it into the app it is for:
      <span className="selectable mt-1 block break-all font-data text-[13px]">{url}</span>
    </Notice>
  );
}

/** The explorer behind its warning, for every page that offers it: the
    transaction detail and the Broadcast page used to keep a copy each,
    and their words had already drifted apart.

    `ask` opens the warning, or the explorer straight away once the
    person ticked "Do not show this warning again"; `warning` is the
    dialog to render; `failed` is the address nothing opened. */
export function useExplorer(url: string, { z }: { z?: number } = {}) {
  const { explorerAck, setExplorerAck } = useUi();
  const [asking, setAsking] = useState(false);
  const [skipNextTime, setSkipNextTime] = useState(false);
  const { open, failed } = useOpenExternal();

  const ask = () => {
    if (!url) return;
    if (explorerAck) void open(url);
    else setAsking(true);
  };

  const warning = (
    <Modal
      open={asking}
      onClose={() => setAsking(false)}
      title="Open an external explorer"
      width={460}
      z={z}
      centered
    >
      <div className="flex flex-col gap-4">
        {/* Handing an operator the link between this transaction and
            an IP address is a privacy loss: red, by the rule. */}
        <Notice tone="alert">
          <span className="font-medium">
            This opens the transaction on mempool.space, a third-party website. Its operator
            can link this transaction to your IP address.
          </span>
        </Notice>
        <p className="font-ui text-sm text-muted">
          Consider a VPN or Tor if that link matters to you.
        </p>
        <label className="flex cursor-pointer items-center gap-2 font-ui text-sm text-text">
          <input
            type="checkbox"
            checked={skipNextTime}
            onChange={(event) => setSkipNextTime(event.target.checked)}
            className="size-4 accent-(--color-primary)"
          />
          Do not show this warning again
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setAsking(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (skipNextTime) setExplorerAck(true);
              setAsking(false);
              void open(url);
            }}
          >
            Open explorer
          </Button>
        </div>
      </div>
    </Modal>
  );

  return { ask, warning, failed };
}
