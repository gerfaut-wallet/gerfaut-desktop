import { FileUp, Info } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import type { InputWarning, Network, ParsedInput, RecognizedKind, ScriptKind } from "../lib/ipc";
import { ipc, isCommandError } from "../lib/ipc";
import { useAddWallet, useSyncWallet } from "../state/queries";
import { useUi } from "../state/store";

const KIND_LABEL: Record<RecognizedKind, string> = {
  descriptor: "Output descriptor",
  descriptor_pair: "Descriptor pair (receive + change)",
  multipath_descriptor: "Multipath descriptor (BIP-389)",
  extended_key: "Extended public key",
  address: "Single address",
  wallet_export: "Wallet export file",
};

const SCRIPT_LABEL: Record<ScriptKind, string> = {
  legacy: "Legacy (P2PKH)",
  nested_segwit: "Nested SegWit (P2SH-P2WPKH)",
  segwit: "Native SegWit (P2WPKH)",
  taproot: "Taproot (P2TR)",
  witness_script: "Script (P2WSH)",
  legacy_script: "Script (P2SH)",
  bare: "Bare script",
};

const WARNING_LABEL: Record<InputWarning, string> = {
  assumed_segwit: "The key does not say its script type: Native SegWit was assumed.",
  slip132_converted: "The SLIP-132 prefix was converted to a standard extended key.",
  change_not_tracked: "No change path was provided: change outputs will not be tracked.",
  multiple_accounts_in_file: "The file holds several account types; the preferred one was selected.",
};

const NETWORK_LABEL: Record<Network, string> = {
  mainnet: "Mainnet",
  signet: "Signet",
  testnet4: "Testnet 4",
  regtest: "Regtest",
};

/** Two steps: paste or import, then confirm what was recognized.
    Detection is never silent — the user validates before anything is
    stored. */
export function AddWalletModal({ activeNetwork }: { activeNetwork: Network }) {
  const { addWalletOpen, setAddWalletOpen, openWallet, showToast } = useUi();
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedInput | null>(null);
  const [name, setName] = useState("");
  const [network, setNetwork] = useState<Network>(activeNetwork);
  const fileRef = useRef<HTMLInputElement>(null);
  const addWallet = useAddWallet();
  const sync = useSyncWallet();

  const reset = () => {
    setRaw("");
    setError(null);
    setParsed(null);
    setName("");
    addWallet.reset();
  };
  const close = () => {
    setAddWalletOpen(false);
    reset();
  };

  const parse = async (input: string) => {
    setError(null);
    try {
      const result = await ipc.parseInput(input);
      setParsed(result);
      setNetwork(
        result.networks.includes(activeNetwork) ? activeNetwork : result.networks[0],
      );
    } catch (err) {
      setError(isCommandError(err) ? err.message : String(err));
    }
  };

  const importFile = async (file: File) => {
    const text = await file.text();
    setRaw(text.trim());
    await parse(text);
  };

  const submit = async () => {
    if (!parsed) return;
    try {
      const meta = await addWallet.mutateAsync({ name, parsed, network });
      showToast("Wallet added");
      close();
      openWallet(meta.id);
      sync.mutate(meta.id);
    } catch (err) {
      setError(isCommandError(err) ? err.message : String(err));
    }
  };

  return (
    <Modal open={addWalletOpen} onClose={close} title="Add a wallet" width={560}>
      {parsed === null ? (
        <div className="flex flex-col gap-4">
          <div>
            <label
              htmlFor="wallet-input"
              className="mb-1 block font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted"
            >
              Descriptor, extended public key, or address
            </label>
            <textarea
              id="wallet-input"
              value={raw}
              onChange={(event) => setRaw(event.target.value)}
              rows={5}
              spellCheck={false}
              placeholder="wpkh([fingerprint/84h/0h/0h]xpub.../0/*)"
              className="selectable w-full resize-none rounded-sm bg-sunken p-3 font-data text-[13px] leading-relaxed text-text outline-none placeholder:text-muted/60"
            />
            {error && (
              <p role="alert" className="mt-2 font-ui text-sm text-muted">
                {error}
              </p>
            )}
            <p className="mt-2 font-ui text-xs text-muted">
              Gerfaut is watch-only: anything containing a private key or a seed
              phrase is refused and never stored.
            </p>
          </div>
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={() => fileRef.current?.click()}>
              <FileUp size={16} strokeWidth={1.5} aria-hidden />
              Import a file
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.json,.desc,text/plain,application/json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importFile(file);
                event.target.value = "";
              }}
            />
            <div className="flex gap-2">
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={raw.trim().length === 0}
                onClick={() => void parse(raw)}
              >
                Continue
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border bg-background p-4">
            <p className="font-ui text-sm text-text">
              Recognized as <strong className="font-medium">{KIND_LABEL[parsed.kind]}</strong>
              {parsed.payload.type === "descriptors" && (
                <> · {SCRIPT_LABEL[parsed.payload.script]}</>
              )}
            </p>
            {parsed.payload.type === "address" && (
              <p className="selectable mt-1 break-all font-data text-[13px] text-muted">
                {parsed.payload.address}
              </p>
            )}
            {parsed.warnings.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1.5">
                {parsed.warnings.map((warning) => (
                  <li key={warning} className="flex items-start gap-2 font-ui text-xs text-muted">
                    <Info size={14} strokeWidth={1.5} aria-hidden className="mt-px shrink-0" />
                    {WARNING_LABEL[warning]}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label
                htmlFor="wallet-name"
                className="mb-1 block font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted"
              >
                Name
              </label>
              <input
                id="wallet-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Cold storage"
                className="h-11 w-full rounded-sm bg-sunken px-3 font-ui text-base text-text outline-none placeholder:text-muted/60"
              />
            </div>
            <div>
              <label
                htmlFor="wallet-network"
                className="mb-1 block font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted"
              >
                Network
              </label>
              <select
                id="wallet-network"
                value={network}
                onChange={(event) => setNetwork(event.target.value as Network)}
                disabled={parsed.networks.length === 1}
                className="h-11 cursor-pointer rounded-sm bg-sunken px-3 font-ui text-base text-text outline-none"
              >
                {parsed.networks.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {NETWORK_LABEL[candidate]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && (
            <p role="alert" className="font-ui text-sm text-muted">
              {error}
            </p>
          )}

          <div className="flex justify-between">
            <Button variant="ghost" onClick={reset}>
              Back
            </Button>
            <Button
              variant="primary"
              disabled={name.trim().length === 0 || addWallet.isPending}
              onClick={() => void submit()}
            >
              {addWallet.isPending ? "Adding…" : "Add wallet"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
