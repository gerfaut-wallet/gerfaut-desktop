import {
  Check,
  Coins,
  Compass,
  Globe,
  Info,
  Monitor,
  Moon,
  Pencil,
  RefreshCw,
  ScanLine,
  ScanSearch,
  Server,
  ShieldCheck,
  Sun,
  SunMoon,
  Trash2,
  Wallet as WalletIcon,
  X,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { clsx } from "clsx";
import { Button, IconButton } from "../components/Button";
import { BackupSection } from "./settings/BackupSection";
import { NotificationsSection } from "./settings/NotificationsSection";
import { SecuritySection } from "./settings/SecuritySection";
import { TorSection } from "./settings/TorSection";
import { WelcomeTour } from "./WelcomeTour";
import { Modal } from "../components/Modal";
import { Notice } from "../components/Notice";
import { ScanQrModal } from "../components/ScanQrModal";
import { Select } from "../components/Select";
import { FieldLabel, SectionCard, Segmented, SettingRow, Toggle } from "./settings/primitives";
import {
  COINGECKO_ONLY_CURRENCIES,
  SHARED_CURRENCIES,
  ipc,
  isCommandError,
  quotesCurrency,
} from "../lib/ipc";
import type {
  BackendConfig,
  CertificateReport,
  FiatCurrency,
  Network,
  PriceSource,
  Settings,
  UpdateCheck,
  WalletMeta,
} from "../lib/ipc";
import { formatFiat, relativeTime } from "../lib/format";
import {
  useCheckUpdate,
  useFiatRate,
  useForgetCertificate,
  useInspectCertificate,
  useRemoveWallet,
  useRenameWallet,
  useRescanWallet,
  usePublicServers,
  useSetActiveNetwork,
  useSetBackend,
  useSetGapLimit,
  useTrustCertificate,
} from "../state/queries";
import { useUi } from "../state/store";
import type { ThemePref } from "../state/store";

const APP_VERSION = "0.1.0";

/** Plain names beside the codes: a list of thirty triplets is not a
    list anyone can read. */
const CURRENCY_NAME: Record<FiatCurrency, string> = {
  eur: "Euro",
  usd: "US dollar",
  gbp: "Pound sterling",
  chf: "Swiss franc",
  jpy: "Japanese yen",
  cad: "Canadian dollar",
  aud: "Australian dollar",
  inr: "Indian rupee",
  cny: "Chinese yuan",
  brl: "Brazilian real",
  ngn: "Nigerian naira",
  idr: "Indonesian rupiah",
  pkr: "Pakistani rupee",
  bdt: "Bangladeshi taka",
  rub: "Russian ruble",
  mxn: "Mexican peso",
  php: "Philippine peso",
  vnd: "Vietnamese dong",
  try: "Turkish lira",
  ars: "Argentine peso",
  krw: "South Korean won",
  zar: "South African rand",
  thb: "Thai baht",
  uah: "Ukrainian hryvnia",
  pln: "Polish zloty",
  sek: "Swedish krona",
  sgd: "Singapore dollar",
  hkd: "Hong Kong dollar",
  aed: "UAE dirham",
  nzd: "New Zealand dollar",
};

const PRICE_SOURCES: { value: PriceSource; label: string }[] = [
  { value: "coingecko", label: "CoinGecko" },
  { value: "kraken", label: "Kraken" },
  { value: "mempool_space", label: "mempool.space" },
];

const NETWORKS: { value: Network; label: string; hint: string }[] = [
  { value: "mainnet", label: "Mainnet", hint: "The Bitcoin network" },
  { value: "signet", label: "Signet", hint: "Test network, reliable blocks" },
  { value: "testnet4", label: "Testnet 4", hint: "Public test network" },
  { value: "regtest", label: "Regtest", hint: "Local development chain" },
];

// --- electrum url helpers ----------------------------------------------

export function parseElectrumUrl(url: string): { host: string; port: string; tls: boolean } {
  const tls = !url.startsWith("tcp://");
  const rest = url.replace(/^(ssl|tcp):\/\//, "");
  const [host, port] = rest.split(":");
  return { host: host ?? "", port: port ?? "", tls };
}

export function buildElectrumUrl(host: string, port: string, tls: boolean): string {
  return `${tls ? "ssl" : "tcp"}://${host.trim()}:${port.trim()}`;
}

// --- certificates -------------------------------------------------------

/** A fingerprint laid out to be compared by eye: two rows of sixteen
    bytes, in the same uppercase hex pairs `openssl` prints. */
export function Fingerprint({ value, tone = "text" }: { value: string; tone?: "text" | "alert" }) {
  const bytes = value.split(":");
  const rows = [bytes.slice(0, 16).join(":"), bytes.slice(16).join(":")].filter(Boolean);
  return (
    <p
      className={clsx(
        "selectable rounded-sm bg-sunken px-3 py-2 font-data text-[13px] leading-6 tracking-[0.02em]",
        tone === "alert" ? "text-alert" : "text-text",
      )}
    >
      {rows.map((row) => (
        <span key={row} className="block">
          {row}
        </span>
      ))}
    </p>
  );
}

/** One labelled fact of a certificate. */
function CertFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="font-ui text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
        {label}
      </dt>
      <dd className="mt-0.5 break-words font-ui text-sm text-text">{children}</dd>
    </div>
  );
}

/** The day a certificate stops being valid, in the reader's locale. */
function expiryLabel(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * The decision Gerfaut cannot make for the user: whether this
 * certificate is the one their server presents.
 *
 * A certificate nothing vouches for is a question, not an error: it is
 * asked calmly, with the fingerprint as the subject of the dialog. One
 * that changed after being accepted is an alert, and trusting the new
 * one takes a second, deliberate confirmation.
 */
export function CertificateDialog({
  report,
  busy,
  onAccept,
  onCancel,
}: {
  report: CertificateReport;
  busy: boolean;
  onAccept: (fingerprint: string) => void;
  onCancel: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const changed = report.status === "changed";
  const fingerprint =
    report.status === "changed"
      ? report.presented
      : report.status === "unknown"
        ? report.fingerprint
        : "";

  return (
    <Modal
      open
      onClose={onCancel}
      centered
      width={560}
      title={changed ? "This server's certificate changed" : "This server signs its own certificate"}
    >
      <div className="flex flex-col gap-4">
        {changed ? (
          <>
            <Notice tone="alert">
              {report.host} was accepted with another certificate. Either whoever runs it
              replaced it, or something is answering in its place.
            </Notice>
            <div>
              <p className="mb-1 font-ui text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
                Accepted before
              </p>
              <Fingerprint value={report.stored} />
            </div>
            <div>
              <p className="mb-1 font-ui text-[11px] font-medium uppercase tracking-[0.04em] text-alert">
                Presented now
              </p>
              <Fingerprint value={report.presented} tone="alert" />
            </div>
            <p className="font-ui text-sm text-muted">
              Ask whoever runs the server before accepting this one.
            </p>
          </>
        ) : (
          report.status === "unknown" && (
            <>
              <p className="font-ui text-sm text-text">
                No public authority vouches for the certificate of {report.host}. Compare the
                fingerprint below with the one your server shows, then accept it once: Gerfaut
                remembers it and refuses anything else afterwards.
              </p>
              <Fingerprint value={report.fingerprint} />
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                {report.subject && (
                  <div className="col-span-2">
                    <CertFact label="Subject">{report.subject}</CertFact>
                  </div>
                )}
                {report.expires !== null && (
                  <CertFact label="Valid until">{expiryLabel(report.expires)}</CertFact>
                )}
                <CertFact label="Why it is asked">{report.reason}</CertFact>
              </dl>
              <p className="font-ui text-xs text-muted">
                On the server:{" "}
                <span className="selectable font-data text-[12px] text-text">
                  openssl x509 -noout -fingerprint -sha256 -in cert.pem
                </span>
              </p>
            </>
          )
        )}

        <div className="mt-1 flex flex-wrap items-center justify-end gap-3">
          {changed ? (
            <>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => (confirming ? onAccept(fingerprint) : setConfirming(true))}
              >
                {confirming ? "Yes, trust the new certificate" : "Trust the new certificate"}
              </Button>
              <Button variant="primary" onClick={onCancel}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
              <Button variant="primary" disabled={busy} onClick={() => onAccept(fingerprint)}>
                {busy ? "Saving…" : "Accept and save"}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** The certificates the user accepted, and the way back out of one. */
export function CertificatesSection({ certs }: { certs: Record<string, string> }) {
  const forget = useForgetCertificate();
  const { showToast } = useUi();
  const [pending, setPending] = useState<string | null>(null);
  const hosts = Object.keys(certs).sort();
  if (hosts.length === 0) return null;

  return (
    <SectionCard icon={<ShieldCheck size={18} strokeWidth={1.5} />} title="Trusted certificates">
      <ul className="flex flex-col divide-y divide-border">
        {hosts.map((host) => (
          <li key={host} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <p className="truncate font-data text-[13px] text-text">{host}</p>
              <p className="truncate font-data text-[11px] text-muted" title={certs[host]}>
                {certs[host]}
              </p>
            </div>
            <Button
              variant="ghost"
              className="h-9 shrink-0 px-2"
              aria-label={`Forget the certificate accepted for ${host}`}
              onClick={() => setPending(host)}
            >
              <Trash2 size={14} strokeWidth={1.5} aria-hidden />
              Forget
            </Button>
          </li>
        ))}
      </ul>
      <p className="mt-3 font-ui text-xs text-muted">
        Each line is a certificate you accepted for that server. Forget one and Gerfaut asks
        again the next time it connects.
      </p>
      {pending && (
        <Modal open onClose={() => setPending(null)} centered width={440} title="Forget this certificate?">
          <p className="font-ui text-sm text-text">
            Gerfaut will ask again the next time it connects to {pending}, and refuse until the
            certificate is accepted.
          </p>
          <div className="mt-4 flex items-center justify-end gap-3">
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={forget.isPending}
              onClick={() =>
                void forget.mutateAsync(pending).then(() => {
                  setPending(null);
                  showToast("Certificate forgotten");
                })
              }
            >
              Forget it
            </Button>
          </div>
        </Modal>
      )}
    </SectionCard>
  );
}

// --- the view -----------------------------------------------------------

/** Settings: workspace, backend, display, appearance, wallets, about. */
export function SettingsView({
  settings,
  wallets,
}: {
  settings: Settings;
  wallets: WalletMeta[];
}) {
  const {
    theme,
    setTheme,
    unit,
    setUnit,
    fiatEnabled,
    setFiatEnabled,
    fiatCurrency,
    setFiatCurrency,
    fiatSource,
    setFiatSource,
    showToast,
  } = useUi();
  const setActiveNetwork = useSetActiveNetwork();
  const setBackend = useSetBackend();

  const network = settings.active_network;

  return (
    <div className="pb-8">
      <h1 className="px-1 pb-5 pt-2 font-display text-2xl font-semibold tracking-[-0.01em] text-text">
        Settings
      </h1>
      <div className="flex flex-col gap-5">
        <SectionCard icon={<Globe size={18} strokeWidth={1.5} />} title="Network">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {NETWORKS.map((option) => {
              const selected = network === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    if (!selected) {
                      void setActiveNetwork.mutateAsync(option.value).then(() => {
                        showToast("Setting saved");
                      });
                    }
                  }}
                  className={clsx(
                    "cursor-pointer rounded-md border p-3 text-left transition-colors duration-150",
                    selected
                      ? "border-primary bg-sunken"
                      : "border-border hover:bg-sunken/60",
                  )}
                >
                  <span className="flex items-center justify-between">
                    <span
                      className={clsx(
                        "font-ui text-sm font-medium",
                        selected ? "text-primary" : "text-text",
                      )}
                    >
                      {option.label}
                    </span>
                    {selected && (
                      <Check size={15} strokeWidth={2} aria-hidden className="text-primary" />
                    )}
                  </span>
                  <span className="mt-0.5 block font-ui text-xs text-muted">
                    {option.hint}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 font-ui text-xs text-muted">
            Only wallets on the selected network are shown.
          </p>
        </SectionCard>

        <BackendSection
          network={network}
          settings={settings}
          onSave={(config) =>
            void setBackend.mutateAsync({ network, config }).then(() => {
              showToast("Setting saved");
            })
          }
          saving={setBackend.isPending}
        />

        <CertificatesSection certs={settings.electrum_certs ?? {}} />

        <SectionCard icon={<Coins size={18} strokeWidth={1.5} />} title="Display">
          <div className="flex flex-col gap-4">
            <SettingRow title="Unit" hint="Applies to every amount in the app.">
              <Segmented
                label="Amount unit"
                value={unit}
                onChange={setUnit}
                options={[
                  { value: "btc", label: "BTC" },
                  { value: "sats", label: "sats" },
                ]}
              />
            </SettingRow>
            <SettingRow
              title="Fiat value"
              hint="Shows the fiat value next to every amount."
            >
              <Toggle checked={fiatEnabled} onChange={setFiatEnabled} label="Show fiat value" />
            </SettingRow>
            <SettingRow
              title="Currency"
              hint="Used by the fiat value and the overview price chart."
            >
              <Select
                id="fiat-currency"
                label="Fiat currency"
                size="sm"
                className="w-40"
                value={fiatCurrency}
                onChange={setFiatCurrency}
                options={[
                  ...SHARED_CURRENCIES.map((currency) => ({
                    value: currency,
                    label: currency.toUpperCase(),
                    hint: CURRENCY_NAME[currency],
                    group: "Every source",
                  })),
                  ...COINGECKO_ONLY_CURRENCIES.map((currency) => ({
                    value: currency,
                    label: currency.toUpperCase(),
                    hint: CURRENCY_NAME[currency],
                    group: "CoinGecko only",
                  })),
                ]}
              />
            </SettingRow>
            <div>
              <SettingRow
                title="Price source"
                hint="Serves the fiat value and the overview price."
              >
                <Segmented
                  label="Price source"
                  value={fiatSource}
                  onChange={setFiatSource}
                  options={PRICE_SOURCES.map((source) => ({
                    ...source,
                    disabled: !quotesCurrency(source.value, fiatCurrency),
                  }))}
                />
              </SettingRow>
              {!quotesCurrency("kraken", fiatCurrency) && (
                <p className="mt-1.5 font-ui text-xs text-muted">
                  CoinGecko is the only source that quotes{" "}
                  {fiatCurrency.toUpperCase()}.
                </p>
              )}
              {/* Required by the CoinGecko API terms whenever their data
                  is on screen. */}
              {fiatSource === "coingecko" && (
                <p className="mt-1.5 font-ui text-[11px] text-muted">Powered by CoinGecko</p>
              )}
            </div>
            {fiatEnabled && <RatePreview />}
          </div>
        </SectionCard>

        <SectionCard icon={<SunMoon size={18} strokeWidth={1.5} />} title="Appearance">
          <SettingRow title="Theme">
            <Segmented
              label="Theme"
              value={theme}
              onChange={(value) => setTheme(value as ThemePref)}
              options={[
                {
                  value: "light",
                  label: "Light",
                  icon: <Sun size={15} strokeWidth={1.5} />,
                },
                {
                  value: "dark",
                  label: "Dark",
                  icon: <Moon size={15} strokeWidth={1.5} />,
                },
                {
                  value: "system",
                  label: "System",
                  icon: <Monitor size={15} strokeWidth={1.5} />,
                },
              ]}
            />
          </SettingRow>
        </SectionCard>

        <TorSection tor={settings.tor} />

        <SecuritySection lock={settings.app_lock} />

        <NotificationsSection />

        <BackupSection activeNetwork={settings.active_network} />

        <WalletsSection wallets={wallets} gapLimit={settings.gap_limit} />

        <AboutSection />
      </div>
    </div>
  );
}

function RatePreview() {
  const rate = useFiatRate();
  const { fiatCurrency } = useUi();
  if (rate.isPending) {
    return <p className="font-ui text-xs text-muted">Fetching the current price…</p>;
  }
  if (rate.isError || !rate.data) {
    return (
      <p className="font-ui text-xs text-pending">
        The price source did not answer. Amounts show without fiat until it does.
      </p>
    );
  }
  return (
    <p className="tabular text-xs text-muted">
      1 BTC = {formatFiat(100_000_000, rate.data.rate, fiatCurrency)} · updated{" "}
      {relativeTime(rate.data.at)}
    </p>
  );
}

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
            ? "Only this server is asked, for chain data and for fee estimates."
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
              }}
              spellCheck={false}
              placeholder="https://node.example.org:3002/api"
              className="selectable h-11 w-full rounded-sm bg-sunken px-3 font-data text-[13px] text-text outline-none placeholder:text-muted/60"
            />
          </div>
          <ScanButton onClick={() => setScanOpen(true)} />
        </div>
        <ScanRefusal reason={scanError} />
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
              }}
              spellCheck={false}
              placeholder="node.example.org or xxxxxxxx.onion"
              className="selectable h-11 w-full rounded-sm bg-sunken px-3 font-data text-[13px] text-text outline-none placeholder:text-muted/60"
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
              }}
              inputMode="numeric"
              placeholder="50002"
              className="selectable h-11 w-full rounded-sm bg-sunken px-3 font-data text-[13px] text-text outline-none placeholder:text-muted/60"
            />
          </div>
          <div className="flex h-11 items-center gap-2 pb-0.5">
            <Toggle checked={tls} onChange={setTls} label="Use TLS" />
            <span className="font-ui text-sm text-text">TLS</span>
          </div>
          <ScanButton onClick={() => setScanOpen(true)} />
        </div>
        <ScanRefusal reason={scanError} />
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

/** Numeric gap-limit field: commits on blur or Enter, clamped to what
    the backend accepts, shared by every wallet. */
function GapLimitField({ gapLimit }: { gapLimit: number }) {
  const { showToast } = useUi();
  const setGapLimit = useSetGapLimit();
  const [draft, setDraft] = useState(String(gapLimit));

  // Follow external changes (another commit, a vault reload).
  useEffect(() => setDraft(String(gapLimit)), [gapLimit]);

  const commit = () => {
    const value = Number.parseInt(draft, 10);
    if (Number.isNaN(value) || value < 1 || value > 500) {
      setDraft(String(gapLimit));
      return;
    }
    if (value === gapLimit) return;
    void setGapLimit.mutateAsync(value).then(() => showToast("Setting saved"));
  };

  return (
    <input
      id="gap-limit"
      value={draft}
      onChange={(event) => setDraft(event.target.value.replace(/\D/g, ""))}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
      inputMode="numeric"
      aria-label="Gap limit"
      className="selectable h-11 w-24 rounded-sm bg-sunken px-3 text-right font-data text-[13px] text-text outline-none"
    />
  );
}

function WalletsSection({ wallets, gapLimit }: { wallets: WalletMeta[]; gapLimit: number }) {
  const { showToast, syncErrors } = useUi();
  const removeWallet = useRemoveWallet();
  const renameWallet = useRenameWallet();
  const rescan = useRescanWallet();
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [rescanning, setRescanning] = useState<string | null>(null);

  const commitRename = () => {
    if (!renaming || renaming.name.trim().length === 0) return;
    void renameWallet
      .mutateAsync({ id: renaming.id, name: renaming.name.trim() })
      .then(() => {
        setRenaming(null);
        showToast("Setting saved");
      });
  };

  return (
    <SectionCard
      icon={<WalletIcon size={18} strokeWidth={1.5} />}
      title="Wallets"
    >
      <div className="mb-4 border-b border-border pb-4">
        <SettingRow
          title="Gap limit"
          hint="How many unused addresses Gerfaut scans past the last used one. Rescan a wallet to look again from its first address."
        >
          <GapLimitField gapLimit={gapLimit} />
        </SettingRow>
      </div>
      {wallets.length === 0 ? (
        <p className="font-ui text-sm text-muted">No wallets on this network yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {wallets.map((wallet) => {
            const single = wallet.kind.type === "single_address";
            return (
              <li
                key={wallet.id}
                className="rounded-md border border-border px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="text-muted">
                      <WalletIcon size={16} strokeWidth={1.5} aria-hidden />
                    </span>
                    {renaming?.id === wallet.id ? (
                      <span className="flex items-center gap-1.5">
                        <input
                          autoFocus
                          value={renaming.name}
                          onChange={(event) =>
                            setRenaming({ id: wallet.id, name: event.target.value })
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") commitRename();
                            if (event.key === "Escape") setRenaming(null);
                          }}
                          className="h-9 w-56 rounded-sm bg-sunken px-2 font-ui text-sm text-text outline-none"
                          aria-label="Wallet name"
                        />
                        <IconButton
                          label="Save name"
                          className="size-9 text-primary"
                          onClick={commitRename}
                        >
                          <Check size={16} strokeWidth={2} aria-hidden />
                        </IconButton>
                        <IconButton
                          label="Cancel renaming"
                          className="size-9"
                          onClick={() => setRenaming(null)}
                        >
                          <X size={16} strokeWidth={1.5} aria-hidden />
                        </IconButton>
                      </span>
                    ) : (
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-ui text-sm font-medium text-text">
                          {wallet.name}
                        </span>
                        <span className="font-ui text-xs text-muted">
                          {single ? "Single address" : "Descriptor wallet"}
                        </span>
                      </span>
                    )}
                  </span>
                  {renaming?.id !== wallet.id && confirmRemove !== wallet.id && (
                    <span className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        className="h-9"
                        disabled={rescanning !== null}
                        onClick={() => {
                          setRescanning(wallet.id);
                          void rescan
                            .mutateAsync(wallet.id)
                            .catch(() => undefined)
                            .finally(() => setRescanning(null));
                        }}
                      >
                        <ScanSearch size={14} strokeWidth={1.5} aria-hidden />
                        {rescanning === wallet.id ? "Rescanning…" : "Rescan"}
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-9"
                        disabled={rescanning !== null}
                        onClick={() => {
                          setConfirmRemove(null);
                          setRenaming({ id: wallet.id, name: wallet.name });
                        }}
                      >
                        <Pencil size={14} strokeWidth={1.5} aria-hidden />
                        Rename
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-9 text-alert hover:text-alert"
                        disabled={rescanning !== null}
                        onClick={() => {
                          setRenaming(null);
                          setConfirmRemove(wallet.id);
                        }}
                      >
                        <Trash2 size={14} strokeWidth={1.5} aria-hidden />
                        Remove
                      </Button>
                    </span>
                  )}
                </div>
                {syncErrors[wallet.id] && (
                  <p className="mt-2 font-ui text-xs text-muted">
                    {syncErrors[wallet.id]}
                  </p>
                )}
                {confirmRemove === wallet.id && (
                  <Notice
                    tone="info"
                    className="mt-3"
                    action={<span className="flex items-center gap-2">
                      <Button
                        variant="danger"
                        className="h-9"
                        onClick={() =>
                          void removeWallet.mutateAsync(wallet.id).then(() => {
                            setConfirmRemove(null);
                            showToast("Wallet removed");
                          })
                        }
                      >
                        Remove wallet
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-9 hover:bg-surface hover:shadow-[inset_0_0_0_1px_var(--color-border)] dark:hover:bg-sunken dark:hover:shadow-none"
                        onClick={() => setConfirmRemove(null)}
                      >
                        Cancel
                      </Button>
                    </span>}
                  >
                    You are removing "{wallet.name}" from Gerfaut. This only
                    stops watching. Nothing moves on chain.
                  </Notice>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

function AboutSection() {
  const check = useCheckUpdate();
  const [result, setResult] = useState<UpdateCheck | "failed" | null>(null);
  const [tourOpen, setTourOpen] = useState(false);

  return (
    <SectionCard
      icon={<Info size={18} strokeWidth={1.5} />}
      title="About"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-ui text-sm text-text">
          Gerfaut {APP_VERSION}
          <span className="ml-2 font-ui text-xs text-muted">for Windows, macOS, and Linux</span>
        </p>
        <span className="flex items-center gap-3">
          {result === "failed" && (
            <span className="font-ui text-xs text-muted">
              Could not reach the release page. Try again later.
            </span>
          )}
          {result !== null && result !== "failed" && !result.update_available && (
            <span className="font-ui text-xs text-muted">You are up to date.</span>
          )}
          {result !== null && result !== "failed" && result.update_available && (
            <Button variant="primary" onClick={() => void openUrl(result.url)}>
              Get {result.latest}
            </Button>
          )}
          <Button
            variant="secondary"
            disabled={check.isPending}
            onClick={() =>
              check.mutate(undefined, {
                onSuccess: (data) => setResult(data),
                onError: () => setResult("failed"),
              })
            }
          >
            <RefreshCw
              size={14}
              strokeWidth={1.5}
              aria-hidden
              className={check.isPending ? "motion-safe:animate-spin" : undefined}
            />
            {check.isPending ? "Checking…" : "Check for updates"}
          </Button>
        </span>
      </div>
      <div className="mt-3">
        <Button variant="ghost" onClick={() => setTourOpen(true)}>
          <Compass size={14} strokeWidth={1.5} aria-hidden />
          Show the welcome tour
        </Button>
      </div>
      <WelcomeTour open={tourOpen} onClose={() => setTourOpen(false)} />
    </SectionCard>
  );
}
