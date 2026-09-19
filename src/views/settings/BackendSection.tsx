import { ScanLine, Server } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "../../components/Button";
import { ScanQrModal } from "../../components/ScanQrModal";
import { Select } from "../../components/Select";
import { OnionIcon } from "../../components/icons/OnionIcon";
import { ipc, isCommandError } from "../../lib/ipc";
import type { BackendConfig, CertificateReport, Network, Settings } from "../../lib/ipc";
import {
  useInspectCertificate,
  usePublicServers,
  useTrustCertificate,
} from "../../state/queries";
import { useUi } from "../../state/store";
import { CertificateDialog } from "./CertificatesSection";
import { FieldLabel, SectionCard, Toggle } from "./primitives";

/** The chains a workspace can watch, each with a word on what it is. */
export const NETWORKS: { value: Network; label: string; hint: string }[] = [
  { value: "mainnet", label: "Mainnet", hint: "The Bitcoin network" },
  { value: "signet", label: "Signet", hint: "Test network, reliable blocks" },
  { value: "testnet4", label: "Testnet 4", hint: "Public test network" },
  { value: "regtest", label: "Regtest", hint: "Local development chain" },
];

// --- electrum url helpers ----------------------------------------------

/** A stored Electrum address back into the three fields of the form.
    An IPv6 literal is full of colons, so the port is only ever what
    follows the closing bracket, or the single colon of a name or an
    IPv4. The host comes back without its brackets, the way a scan
    hands it over; `buildElectrumUrl` puts them back. Anything that
    reads as neither leaves the port empty rather than guessing one. */
export function parseElectrumUrl(url: string): { host: string; port: string; tls: boolean } {
  const text = url.trim();
  const tls = !/^tcp:\/\//i.test(text);
  const rest = text.replace(/^(ssl|tcp):\/\//i, "").split(/[/?#]/)[0] ?? "";
  const digits = (value: string) => (/^\d+$/.test(value) ? value : "");
  const bracketed = /^\[([^\]]*)\](?::(.*))?$/.exec(rest);
  if (bracketed) return { host: bracketed[1] ?? "", port: digits(bracketed[2] ?? ""), tls };
  const colon = rest.indexOf(":");
  // No colon is a bare name; more than one is a bare IPv6, port and all
  // undecidable, so the whole of it is the host.
  if (colon === -1 || colon !== rest.lastIndexOf(":")) return { host: rest, port: "", tls };
  return { host: rest.slice(0, colon), port: digits(rest.slice(colon + 1)), tls };
}

export function buildElectrumUrl(host: string, port: string, tls: boolean): string {
  const name = host.trim();
  // A bare IPv6 goes in brackets, or its last group reads as the port.
  const literal = name.includes(":") && !name.startsWith("[") ? `[${name}]` : name;
  return `${tls ? "ssl" : "tcp"}://${literal}:${port.trim()}`;
}

// --- the card -----------------------------------------------------------

export function BackendSection({
  network,
  settings,
  onSave,
  saving,
}: {
  network: Network;
  settings: Settings;
  onSave: (config: BackendConfig) => void;
  saving: boolean;
}) {
  const current = settings.backends[network] ?? { type: "public_esplora" };
  const servers = usePublicServers(network);
  const [kind, setKind] = useState<BackendConfig["type"]>(current.type);
  // "" is the automatic rotation over every public instance.
  const [publicServer, setPublicServer] = useState(
    current.type === "public_esplora" ? (current.server ?? "") : "",
  );
  const [esploraUrl, setEsploraUrl] = useState(
    current.type === "custom_esplora" ? current.url : "",
  );
  const initialElectrum =
    current.type === "custom_electrum"
      ? parseElectrumUrl(current.url)
      : { host: "", port: "50002", tls: true };
  const [host, setHost] = useState(initialElectrum.host);
  const [port, setPort] = useState(initialElectrum.port);
  const [tls, setTls] = useState(initialElectrum.tls);
  const inspect = useInspectCertificate();
  const trust = useTrustCertificate();
  const { showToast } = useUi();
  const [scanOpen, setScanOpen] = useState(false);
  // Why the core refused the last code read, in its own words.
  const [scanError, setScanError] = useState<string | null>(null);
  // The last code read was a Tor hidden service: a fact about the
  // address the fields now hold, gone the moment one of them is edited.
  const [onion, setOnion] = useState(false);
  // The certificate the user has to settle before this backend is saved.
  const [pending, setPending] = useState<{
    url: string;
    config: BackendConfig;
    report: CertificateReport;
  } | null>(null);

  // Re-seed the form when the workspace network changes.
  useEffect(() => {
    const config = settings.backends[network] ?? { type: "public_esplora" };
    setKind(config.type);
    setPublicServer(config.type === "public_esplora" ? (config.server ?? "") : "");
    setEsploraUrl(config.type === "custom_esplora" ? config.url : "");
    const electrum =
      config.type === "custom_electrum"
        ? parseElectrumUrl(config.url)
        : { host: "", port: "50002", tls: true };
    setHost(electrum.host);
    setPort(electrum.port);
    setTls(electrum.tls);
    setOnion(false);
  }, [network, settings.backends]);

  const valid =
    kind === "public_esplora" ||
    (kind === "custom_esplora" && esploraUrl.trim().length > 0) ||
    (kind === "custom_electrum" && host.trim().length > 0 && /^\d+$/.test(port.trim()));

  // A server the app no longer lists falls back to the rotation, the
  // same resolution the core makes.
  const known = servers.data?.some((server) => server.id === publicServer) ?? false;
  const chosen = known ? publicServer : "";

  /** What the form describes right now. */
  const draft = (): BackendConfig => {
    if (kind === "public_esplora")
      return chosen ? { type: "public_esplora", server: chosen } : { type: "public_esplora" };
    if (kind === "custom_esplora") return { type: "custom_esplora", url: esploraUrl.trim() };
    return { type: "custom_electrum", url: buildElectrumUrl(host, port, tls) };
  };

  /** The Electrum address a configuration talks to, if any: the only case
      where a certificate has to be settled before saving. */
  const electrumUrlOf = (config: BackendConfig): string | null => {
    if (config.type === "custom_electrum") return config.url;
    if (config.type !== "public_esplora" || !config.server) return null;
    const server = servers.data?.find((entry) => entry.id === config.server);
    return server?.protocol === "electrum" ? server.url : null;
  };

  /** Fills the form from a scanned address. The core says which of the
      two backends it is and the choice follows: an `https://` read while
      Electrum is selected is plainly meant for Esplora, and refusing it
      would be pedantic. Nothing is saved; the person still presses Save. */
  const applyScan = async (text: string) => {
    try {
      const backend = await ipc.parseBackend(text);
      setScanError(null);
      setOnion(backend.onion);
      if (backend.kind === "esplora") {
        setKind("custom_esplora");
        setEsploraUrl(backend.url);
        return;
      }
      setKind("custom_electrum");
      // An IPv6 literal goes back into its brackets: host and port are
      // joined again on save, and without them the two cannot be told
      // apart.
      setHost(backend.host.includes(":") ? `[${backend.host}]` : backend.host);
      setPort(backend.port === null ? "" : String(backend.port));
      setTls(backend.tls);
    } catch (error) {
      // Pointing the wrong QR at it is the likely slip, so the refusal
      // names what was read instead.
      setScanError(isCommandError(error) ? error.message : String(error));
    }
  };

  const save = async () => {
    const config = draft();
    const url = electrumUrlOf(config);
    if (!url) return onSave(config);
    // A bridge that cannot answer must not block a setting: the sync
    // meets the same certificate and says so.
    const report = await inspect.mutateAsync(url).catch(() => null);
    if (report?.status === "unknown" || report?.status === "changed") {
      setPending({ url, config, report });
      return;
    }
    if (report?.status === "unreachable") {
      showToast("Saved. The server did not answer, so its certificate is unchecked.");
    }
    onSave(config);
  };

  const accept = (fingerprint: string) => {
    if (!pending) return;
    void trust.mutateAsync({ url: pending.url, fingerprint }).then(() => {
      onSave(pending.config);
      setPending(null);
    });
  };

  const chosenProtocol = servers.data?.find((server) => server.id === chosen)?.protocol;
  const networkLabel = NETWORKS.find((option) => option.value === network)?.label;

  /** The field the selected source needs, rendered under its own option
      so no reader has to guess which one it belongs to. */
  const fields: Record<BackendConfig["type"], ReactNode> = {
    public_esplora: (
      <>
        <FieldLabel htmlFor="public-server">Server</FieldLabel>
        <Select
          id="public-server"
          label="Public server"
          className="max-w-md"
          value={chosen}
          onChange={setPublicServer}
          options={[
            {
              value: "",
              label: "Automatic",
              hint: "Every public Esplora instance, tried in turn",
            },
            ...(servers.data ?? []).map((server) => ({
              value: server.id,
              label: server.label,
              hint:
                server.protocol === "esplora"
                  ? "Esplora"
                  : server.self_signed
                    ? "Electrum · signs its own certificate"
                    : "Electrum",
            })),
          ]}
        />
        <p className="mt-1.5 font-ui text-xs text-muted">
          {chosen
            ? "Only this server is asked for chain data."
            : "Every public server is tried in turn until one answers."}
          {chosenProtocol === "electrum" &&
            " Electrum servers cannot serve a single-address wallet."}
        </p>
      </>
    ),
    custom_esplora: (
      <>
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <FieldLabel htmlFor="backend-url">Server URL</FieldLabel>
            <input
              id="backend-url"
              value={esploraUrl}
              onChange={(event) => {
                setEsploraUrl(event.target.value);
                setScanError(null);
                setOnion(false);
              }}
              spellCheck={false}
              placeholder="https://node.example.org:3002/api"
              className="field-focus selectable h-11 w-full rounded-sm border border-transparent bg-sunken px-3 font-data text-[13px] text-text placeholder:text-muted/60"
            />
          </div>
          <ScanButton onClick={() => setScanOpen(true)} />
        </div>
        <ScanRefusal reason={scanError} />
        {onion && <OnionNote />}
      </>
    ),
    custom_electrum: (
      <>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-40 flex-1">
            <FieldLabel htmlFor="electrum-host">Host</FieldLabel>
            <input
              id="electrum-host"
              value={host}
              onChange={(event) => {
                setHost(event.target.value);
                setScanError(null);
                setOnion(false);
              }}
              spellCheck={false}
              placeholder="node.example.org or xxxxxxxx.onion"
              className="field-focus selectable h-11 w-full rounded-sm border border-transparent bg-sunken px-3 font-data text-[13px] text-text placeholder:text-muted/60"
            />
          </div>
          <div className="w-24">
            <FieldLabel htmlFor="electrum-port">Port</FieldLabel>
            <input
              id="electrum-port"
              value={port}
              onChange={(event) => {
                setPort(event.target.value.replace(/\D/g, ""));
                setScanError(null);
                setOnion(false);
              }}
              inputMode="numeric"
              placeholder="50002"
              className="field-focus selectable h-11 w-full rounded-sm border border-transparent bg-sunken px-3 font-data text-[13px] text-text placeholder:text-muted/60"
            />
          </div>
          <div className="flex h-11 items-center gap-2 pb-0.5">
            <Toggle checked={tls} onChange={setTls} label="Use TLS" />
            <span className="font-ui text-sm text-text">TLS</span>
          </div>
          <ScanButton onClick={() => setScanOpen(true)} />
        </div>
        <ScanRefusal reason={scanError} />
        {onion && <OnionNote />}
      </>
    ),
  };

  const plainTcp = kind === "custom_electrum" && !tls;

  return (
    <SectionCard
      icon={<Server size={18} strokeWidth={1.5} />}
      title={`Backend · ${networkLabel}`}
    >
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">Chain data source</legend>
        {(
          [
            {
              value: "public_esplora",
              label: "Public API",
              hint: "Free, keyless servers, no setup. The operator that answers can see this wallet's addresses.",
            },
            {
              value: "custom_esplora",
              label: "My own Esplora",
              hint: "An Esplora-compatible HTTP endpoint you run yourself.",
            },
            {
              value: "custom_electrum",
              label: "My own Electrum server",
              hint: "electrs or Fulcrum, reachable over TLS or plain TCP.",
            },
          ] as const
        ).map((option) => (
          <div key={option.value}>
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="radio"
                name="backend"
                value={option.value}
                checked={kind === option.value}
                onChange={() => {
                  setKind(option.value);
                  setScanError(null);
                  setOnion(false);
                }}
                className="mt-1 accent-(--color-primary)"
              />
              <span>
                <span className="block font-ui text-sm font-medium text-text">
                  {option.label}
                </span>
                <span className="block font-ui text-xs text-muted">{option.hint}</span>
              </span>
            </label>
            {kind === option.value && (
              <div className="mt-3 pl-7">{fields[option.value]}</div>
            )}
          </div>
        ))}
      </fieldset>

      {kind !== "public_esplora" && (
        <p className="mt-3 font-ui text-xs text-muted">
          An address ending in .onion goes through Tor; the Tor card below says
          which one and lets you test it.
        </p>
      )}
      {plainTcp && (
        <p className="mt-3 font-ui text-xs text-muted">
          Without TLS everything travels in the clear: anything on the path between this
          machine and the server reads the addresses being watched.
        </p>
      )}
      <div className="mt-4">
        <Button
          variant="primary"
          onClick={() => void save()}
          disabled={saving || inspect.isPending || !valid}
        >
          {inspect.isPending ? "Checking the certificate…" : "Save backend"}
        </Button>
      </div>
      {pending && (
        <CertificateDialog
          report={pending.report}
          busy={trust.isPending || saving}
          onAccept={accept}
          onCancel={() => setPending(null)}
        />
      )}
      <ScanQrModal
        caption="Point the camera at the QR code your node prints beside its Electrum or Esplora app."
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onScan={(text) => void applyScan(text)}
      />
    </SectionCard>
  );
}

/** Opens the camera on the QR code a node prints beside its Electrum or
    Esplora app. Nobody retypes a 56-character onion address. */
function ScanButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="secondary"
      onClick={onClick}
      aria-label="Scan a server address QR code"
    >
      <ScanLine size={16} strokeWidth={1.5} aria-hidden />
      Scan
    </Button>
  );
}

/** The one fact a scan tells that the fields cannot show: the address
    is a Tor hidden service, so it is reached through Tor alone. Which
    Tor is the Tor card's to say, under the same onion, once. */
function OnionNote() {
  return (
    <p className="mt-2 flex items-center gap-1.5 font-ui text-xs text-muted">
      <OnionIcon size={13} />
      A Tor hidden service: reached through Tor only.
    </p>
  );
}

/** Why a scanned code was not a server address, in the core's words:
    pointing the wrong QR at it is the likely slip, so it is named. */
function ScanRefusal({ reason }: { reason: string | null }) {
  if (!reason) return null;
  return (
    <p role="alert" className="mt-2 font-ui text-xs text-muted">
      {reason}
    </p>
  );
}
