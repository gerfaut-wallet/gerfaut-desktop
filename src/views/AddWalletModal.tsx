import { ChevronDown, ChevronUp, FileUp, ScanLine } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { Notice } from "../components/Notice";
import { Select } from "../components/Select";
import { ScanQrModal } from "../components/ScanQrModal";
import type {
  DerivationChoice,
  InputWarning,
  Network,
  ParsedInput,
  RecognizedKind,
  ScriptKind,
} from "../lib/ipc";
import { ipc, isCommandError } from "../lib/ipc";
import { useAddWallet, useSetActiveNetwork, useSyncWallet } from "../state/queries";
import { useUi } from "../state/store";

const KIND_LABEL: Record<RecognizedKind, string> = {
  descriptor: "Output descriptor",
  descriptor_pair: "Descriptor pair (receive + change)",
  multipath_descriptor: "Multipath descriptor (BIP-389)",
  extended_key: "Extended public key",
  address: "Single address",
  wallet_export: "Wallet export file",
  bsms: "BSMS record",
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
  assumed_segwit: "This key carries no script type. Check the one selected below.",
  slip132_converted: "The SLIP-132 prefix was converted to a standard extended key.",
  change_not_tracked: "No change path was provided: change outputs will not be tracked.",
  multiple_accounts_in_file: "The file holds several account types; the preferred one was selected.",
  non_standard_derivation:
    "The paths chosen are not the usual 0/* and 1/*: compare the first address with your wallet.",
};

/** What each script type means to the person choosing, in one line. */
const SCRIPT_HINT: Record<ScriptKind, string> = {
  legacy: "P2PKH, addresses starting with 1",
  nested_segwit: "P2SH-P2WPKH, addresses starting with 3",
  segwit: "P2WPKH, addresses starting with bc1q",
  taproot: "P2TR, addresses starting with bc1p",
  witness_script: "P2WSH multisig or script",
  legacy_script: "P2SH multisig or script",
  bare: "Raw script",
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
  const [script, setScript] = useState<ScriptKind | null>(null);
  const [name, setName] = useState("");
  const [network, setNetwork] = useState<Network>(activeNetwork);
  const [scanOpen, setScanOpen] = useState(false);
  // The advanced disclosure, and what it holds. The fields survive a
  // re-parse: whoever tried one branch tries the next from there.
  const [advanced, setAdvanced] = useState(false);
  const [receive, setReceive] = useState("0/*");
  const [change, setChange] = useState("1/*");
  const [origin, setOrigin] = useState("");
  const [derivationError, setDerivationError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const addWallet = useAddWallet();
  const sync = useSyncWallet();
  const setActiveNetwork = useSetActiveNetwork();

  const reset = () => {
    setRaw("");
    setError(null);
    setParsed(null);
    setScript(null);
    setName("");
    addWallet.reset();
  };
  const close = () => {
    setAddWalletOpen(false);
    reset();
  };

  /** What the derivation fields amount to, in the core's shape. */
  const derivation = (): DerivationChoice => ({
    receive: receive.trim(),
    change: change.trim() || null,
    origin: origin.trim() || null,
  });

  /** Fills the fields with the paths the core says are in effect, so
      opening the disclosure shows what is actually used. */
  const seedDerivation = (result: ParsedInput) => {
    if (!result.derivation) return;
    setReceive(result.derivation.receive);
    setChange(result.derivation.change ?? "");
    setOrigin(result.derivation.origin ?? "");
  };

  const parse = async (
    input: string,
    chosen?: ScriptKind,
    paths?: DerivationChoice,
  ) => {
    setError(null);
    try {
      const result = await ipc.parseInput(input, chosen, paths);
      setParsed(result);
      seedDerivation(result);
      setDerivationError(null);
      if (chosen === undefined && paths === undefined) {
        setNetwork(
          result.networks.includes(activeNetwork) ? activeNetwork : result.networks[0],
        );
      }
    } catch (err) {
      const message = isCommandError(err) ? err.message : String(err);
      // A refused path belongs under the fields that caused it; the
      // card above keeps the parse that did work.
      if (paths) setDerivationError(message);
      else setError(message);
    }
  };

  /** The script type is rebuilt by the core, never patched locally:
      the descriptors and the preview address must come from one place.
      The derivation goes along, or picking a script would undo it. */
  const chooseScript = (chosen: ScriptKind) => {
    setScript(chosen);
    void parse(raw, chosen, advanced ? derivation() : undefined);
  };

  const importFile = async (file: File) => {
    const text = await file.text();
    setRaw(text.trim());
    await parse(text);
  };

  const submit = async () => {
    if (!parsed || name.trim().length === 0) return;
    try {
      const meta = await addWallet.mutateAsync({ name, parsed, network });
      // The workspace follows the wallet that was just added, otherwise
      // it would land invisible on another network.
      if (network !== activeNetwork) {
        await setActiveNetwork.mutateAsync(network);
      }
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
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  if (raw.trim().length > 0) void parse(raw);
                }
              }}
              rows={5}
              spellCheck={false}
              aria-invalid={error !== null}
              placeholder="wpkh([fingerprint/84h/0h/0h]xpub.../0/*)"
              className="field-focus selectable w-full resize-none rounded-sm border border-transparent bg-sunken p-3 font-data text-[13px] leading-relaxed text-text placeholder:text-muted/60"
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
            <div className="flex gap-1">
              <Button variant="ghost" onClick={() => fileRef.current?.click()}>
                <FileUp size={16} strokeWidth={1.5} aria-hidden />
                Import a file
              </Button>
              <Button variant="ghost" onClick={() => setScanOpen(true)}>
                <ScanLine size={16} strokeWidth={1.5} aria-hidden />
                Scan a QR code
              </Button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.json,.desc,.bsms,text/plain,application/json"
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
            {parsed.preview_address && (
              <p className="mt-2 flex flex-wrap items-baseline gap-x-2 font-ui text-xs text-muted">
                <span>First address</span>
                <span
                  data-testid="preview-address"
                  className="selectable break-all font-data text-[13px] text-text"
                >
                  {parsed.preview_address}
                </span>
              </p>
            )}
          </div>

          {/* What the core did not know sits outside the card that says
              what it recognized, so the two do not read as one block of
              facts. Nothing here risks funds or privacy: amber. */}
          {parsed.warnings.length > 0 && (
            <ul aria-label="Cautions" className="flex flex-col gap-2">
              {parsed.warnings.map((warning) => (
                <li key={warning}>
                  <Notice tone="info">{WARNING_LABEL[warning]}</Notice>
                </li>
              ))}
            </ul>
          )}

          {parsed.script_options.length > 0 && parsed.payload.type === "descriptors" && (
            <div>
              <label
                htmlFor="wallet-script"
                className="mb-1 block font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted"
              >
                Script type
              </label>
              <Select
                id="wallet-script"
                label="Script type"
                value={script ?? parsed.payload.script}
                onChange={chooseScript}
                options={parsed.script_options.map((option) => ({
                  value: option,
                  label: SCRIPT_LABEL[option],
                  hint: SCRIPT_HINT[option],
                }))}
              />
              <p className="mt-1.5 font-ui text-xs text-muted">
                Compare the first address above with your wallet.
              </p>
            </div>
          )}

          {/* Only a lone extended key leaves the branches open;
              everything else carries its own and the core ignores a
              choice made here. */}
          {parsed.derivation_editable && parsed.payload.type === "descriptors" && (
            <div>
              <Button
                variant="ghost"
                className="h-9 px-2"
                aria-expanded={advanced}
                onClick={() => setAdvanced(!advanced)}
              >
                {advanced ? (
                  <ChevronUp size={14} strokeWidth={1.5} aria-hidden />
                ) : (
                  <ChevronDown size={14} strokeWidth={1.5} aria-hidden />
                )}
                Advanced
              </Button>
              {advanced && (
                <div className="mt-2 flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <PathField
                      id="derivation-receive"
                      label="Receive path"
                      value={receive}
                      placeholder="0/*"
                      onChange={setReceive}
                    />
                    <PathField
                      id="derivation-change"
                      label="Change path"
                      value={change}
                      placeholder="Leave empty to not track change"
                      onChange={setChange}
                    />
                  </div>
                  <PathField
                    id="derivation-origin"
                    label="Key origin"
                    value={origin}
                    placeholder="[deadbeef/84'/0'/0']"
                    onChange={setOrigin}
                  />
                  <p className="font-ui text-xs text-muted">
                    For a key used outside the usual branches. The first
                    address above updates so you can check.
                  </p>
                  {derivationError && (
                    <p className="font-ui text-xs text-muted">{derivationError}</p>
                  )}
                  <span>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        void parse(raw, script ?? undefined, derivation())
                      }
                    >
                      Apply
                    </Button>
                  </span>
                </div>
              )}
            </div>
          )}

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
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void submit();
                  }
                }}
                placeholder="Cold storage"
                className="field-focus h-11 w-full rounded-sm border border-transparent bg-sunken px-3 font-ui text-base text-text placeholder:text-muted/60"
              />
            </div>
            <div>
              <label
                htmlFor="wallet-network"
                className="mb-1 block font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted"
              >
                Network
              </label>
              <Select
                id="wallet-network"
                label="Network"
                className="w-40"
                value={network}
                onChange={setNetwork}
                disabled={parsed.networks.length === 1}
                options={parsed.networks.map((candidate) => ({
                  value: candidate,
                  label: NETWORK_LABEL[candidate],
                }))}
              />
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
      <ScanQrModal
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onScan={(text) => {
          setRaw(text);
          void parse(text);
        }}
      />
    </Modal>
  );
}

/** One derivation field: an identifier, so it reads in the mono face. */
function PathField({
  id,
  label,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted"
      >
        {label}
      </label>
      <input
        id={id}
        type="text"
        spellCheck={false}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="field-focus h-11 w-full rounded-sm border border-transparent bg-sunken px-3 font-data text-[13px] text-text placeholder:text-muted"
      />
    </div>
  );
}
