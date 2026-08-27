import {
  AlertTriangle,
  Check,
  Coins,
  Globe,
  Info,
  Monitor,
  Moon,
  Pencil,
  RefreshCw,
  Server,
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
import type {
  BackendConfig,
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
  useRemoveWallet,
  useRenameWallet,
  useSetActiveNetwork,
  useSetBackend,
  useSetGapLimit,
} from "../state/queries";
import { useUi } from "../state/store";
import type { ThemePref } from "../state/store";

const APP_VERSION = "0.1.0";

const NETWORKS: { value: Network; label: string; hint: string }[] = [
  { value: "mainnet", label: "Mainnet", hint: "The Bitcoin network" },
  { value: "signet", label: "Signet", hint: "Test network, reliable blocks" },
  { value: "testnet4", label: "Testnet 4", hint: "Public test network" },
  { value: "regtest", label: "Regtest", hint: "Local development chain" },
];

// --- small building blocks ---------------------------------------------

function SectionCard({
  icon,
  title,
  children,
  className,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={clsx(
        "rounded-lg border border-border bg-surface p-5",
        className,
      )}
    >
      <h2 className="mb-4 flex items-center gap-2 font-display text-base font-semibold text-text">
        <span className="text-muted">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Full-width setting line: title and hint on the left, control on the
    right, so stacked cards stay balanced at any window width. */
function SettingRow({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
      <div className="min-w-0 max-w-xl">
        <p className="font-ui text-sm font-medium text-text">{title}</p>
        {hint && <p className="mt-0.5 font-ui text-xs text-muted">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted"
    >
      {children}
    </label>
  );
}

/** Row of mutually exclusive choices, styled instead of a native select. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-md bg-sunken p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={clsx(
            "inline-flex cursor-pointer items-center gap-1.5 rounded-[6px] px-3 py-1.5 font-ui text-sm font-medium transition-colors duration-150",
            value === option.value
              ? "bg-surface text-text shadow-[inset_0_0_0_1px_var(--color-border)]"
              : "text-muted hover:text-text",
          )}
        >
          {option.icon && (
            <span aria-hidden className="shrink-0">
              {option.icon}
            </span>
          )}
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative h-6 w-11 cursor-pointer rounded-full transition-colors duration-150",
        checked ? "bg-primary" : "bg-border",
      )}
    >
      {/* Anchored left-0.5: without an explicit inset the knob's resting
          spot follows the button's text alignment and drifts per engine. */}
      <span
        aria-hidden
        className={clsx(
          "absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-[0_1px_2px_rgba(13,19,23,0.25)] transition-transform duration-150",
          checked && "translate-x-5",
        )}
      />
    </button>
  );
}

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
              <Segmented
                label="Fiat currency"
                value={fiatCurrency}
                onChange={setFiatCurrency}
                options={(["eur", "usd", "gbp", "chf"] as FiatCurrency[]).map(
                  (currency) => ({ value: currency, label: currency.toUpperCase() }),
                )}
              />
            </SettingRow>
            <SettingRow
              title="Price source"
              hint="Serves the fiat value and the overview price."
            >
              <Segmented
                label="Price source"
                value={fiatSource}
                onChange={setFiatSource}
                options={
                  [
                    { value: "coingecko", label: "CoinGecko" },
                    { value: "kraken", label: "Kraken" },
                    { value: "mempool_space", label: "mempool.space" },
                  ] as { value: PriceSource; label: string }[]
                }
              />
            </SettingRow>
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

function BackendSection({
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
  const [kind, setKind] = useState<BackendConfig["type"]>(current.type);
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

  // Re-seed the form when the workspace network changes.
  useEffect(() => {
    const config = settings.backends[network] ?? { type: "public_esplora" };
    setKind(config.type);
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

  const save = () => {
    if (kind === "public_esplora") onSave({ type: "public_esplora" });
    else if (kind === "custom_esplora")
      onSave({ type: "custom_esplora", url: esploraUrl.trim() });
    else onSave({ type: "custom_electrum", url: buildElectrumUrl(host, port, tls) });
  };

  const networkLabel = NETWORKS.find((option) => option.value === network)?.label;

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
              hint: "mempool.space, blockstream.info and mempool.emzy.de, no setup. The operator that answers can see this wallet's addresses.",
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
          <label key={option.value} className="flex cursor-pointer items-start gap-3">
            <input
              type="radio"
              name="backend"
              value={option.value}
              checked={kind === option.value}
              onChange={() => setKind(option.value)}
              className="mt-1 accent-(--color-primary)"
            />
            <span>
              <span className="block font-ui text-sm font-medium text-text">
                {option.label}
              </span>
              <span className="block font-ui text-xs text-muted">{option.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {kind === "custom_esplora" && (
        <div className="mt-3">
          <FieldLabel htmlFor="backend-url">Server URL</FieldLabel>
          <input
            id="backend-url"
            value={esploraUrl}
            onChange={(event) => setEsploraUrl(event.target.value)}
            spellCheck={false}
            placeholder="https://node.example.org:3002/api"
            className="selectable h-11 w-full rounded-sm bg-sunken px-3 font-data text-[13px] text-text outline-none placeholder:text-muted/60"
          />
        </div>
      )}
      {kind === "custom_electrum" && (
        <div className="mt-3 flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <FieldLabel htmlFor="electrum-host">Host</FieldLabel>
            <input
              id="electrum-host"
              value={host}
              onChange={(event) => setHost(event.target.value)}
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
              onChange={(event) => setPort(event.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              placeholder="50002"
              className="selectable h-11 w-full rounded-sm bg-sunken px-3 font-data text-[13px] text-text outline-none placeholder:text-muted/60"
            />
          </div>
          <div className="flex h-11 items-center gap-2 pb-0.5">
            <Toggle checked={tls} onChange={setTls} label="Use TLS" />
            <span className="font-ui text-sm text-text">TLS</span>
          </div>
        </div>
      )}
      {kind !== "public_esplora" && (
        <p className="mt-3 font-ui text-xs text-muted">
          Onion addresses go through the Tor proxy at 127.0.0.1:9050. Start Tor
          on this machine before syncing; a built-in Tor client is planned.
        </p>
      )}
      <div className="mt-4">
        <Button variant="primary" onClick={save} disabled={saving || !valid}>
          Save backend
        </Button>
      </div>
    </SectionCard>
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
  const { showToast } = useUi();
  const removeWallet = useRemoveWallet();
  const renameWallet = useRenameWallet();
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

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
          hint="How many unused addresses Gerfaut scans past the last used one."
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
                {confirmRemove === wallet.id && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-alert/25 bg-alert-surface p-3">
                    <span className="flex items-center gap-2 font-ui text-sm text-alert">
                      <AlertTriangle size={16} strokeWidth={1.5} aria-hidden />
                      You are removing "{wallet.name}" from Gerfaut. This only
                      stops watching. Nothing moves on chain.
                    </span>
                    <span className="flex items-center gap-2">
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
                    </span>
                  </div>
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
    </SectionCard>
  );
}
