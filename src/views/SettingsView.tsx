import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import type { BackendConfig, Network, Settings, WalletMeta } from "../lib/ipc";
import {
  useRemoveWallet,
  useRenameWallet,
  useSetActiveNetwork,
  useSetBackend,
} from "../state/queries";
import { useUi } from "../state/store";
import type { ThemePref } from "../state/store";

const NETWORKS: { value: Network; label: string; hint: string }[] = [
  { value: "mainnet", label: "Mainnet", hint: "The Bitcoin network" },
  { value: "signet", label: "Signet", hint: "Test network with reliable blocks" },
  { value: "testnet4", label: "Testnet 4", hint: "Public test network" },
  { value: "regtest", label: "Regtest", hint: "Local development chain" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border py-6 last:border-b-0">
      <h2 className="mb-4 font-display text-lg font-semibold text-text">{title}</h2>
      {children}
    </section>
  );
}

function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1 block font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted"
    >
      {children}
    </label>
  );
}

/** Settings: workspace network, backend, theme, wallet management. */
export function SettingsView({
  settings,
  wallets,
}: {
  settings: Settings;
  wallets: WalletMeta[];
}) {
  const { theme, setTheme, showToast } = useUi();
  const setActiveNetwork = useSetActiveNetwork();
  const setBackend = useSetBackend();
  const removeWallet = useRemoveWallet();
  const renameWallet = useRenameWallet();

  const network = settings.active_network;
  const current = settings.backends[network] ?? { type: "public_esplora" };
  const [backendKind, setBackendKind] = useState<BackendConfig["type"]>(current.type);
  const [url, setUrl] = useState("url" in current ? current.url : "");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  // Re-seed the backend form when the workspace network changes.
  useEffect(() => {
    const config = settings.backends[network] ?? { type: "public_esplora" };
    setBackendKind(config.type);
    setUrl("url" in config ? config.url : "");
  }, [network, settings.backends]);

  const saveBackend = async () => {
    const config: BackendConfig =
      backendKind === "public_esplora"
        ? { type: "public_esplora" }
        : backendKind === "custom_esplora"
          ? { type: "custom_esplora", url: url.trim() }
          : { type: "custom_electrum", url: url.trim() };
    await setBackend.mutateAsync({ network, config });
    showToast("Setting saved");
  };

  return (
    <div className="max-w-2xl px-1">
      <h1 className="pt-2 font-display text-2xl font-semibold tracking-[-0.01em] text-text">
        Settings
      </h1>

      <Section title="Workspace">
        <FieldLabel htmlFor="settings-network">Network</FieldLabel>
        <select
          id="settings-network"
          value={network}
          onChange={(event) => {
            void setActiveNetwork.mutateAsync(event.target.value as Network).then(() => {
              showToast("Setting saved");
            });
          }}
          className="h-11 cursor-pointer rounded-sm bg-sunken px-3 font-ui text-base text-text outline-none"
        >
          {NETWORKS.map((n) => (
            <option key={n.value} value={n.value}>
              {n.label}
            </option>
          ))}
        </select>
        <p className="mt-2 font-ui text-sm text-muted">
          {NETWORKS.find((n) => n.value === network)?.hint}. The workspace only
          shows wallets on this network.
        </p>
      </Section>

      <Section title={`Backend · ${NETWORKS.find((n) => n.value === network)?.label}`}>
        <fieldset className="flex flex-col gap-3">
          <legend className="sr-only">Chain data source</legend>
          {(
            [
              {
                value: "public_esplora",
                label: "Public API",
                hint: "mempool.space, blockstream.info — no setup. The server operator can see this wallet's addresses.",
              },
              {
                value: "custom_esplora",
                label: "My own Esplora",
                hint: "An Esplora-compatible HTTP endpoint you run yourself.",
              },
              {
                value: "custom_electrum",
                label: "My own Electrum server",
                hint: "electrs or Fulcrum, ssl://host:port or tcp://host:port.",
              },
            ] as const
          ).map((option) => (
            <label key={option.value} className="flex cursor-pointer items-start gap-3">
              <input
                type="radio"
                name="backend"
                value={option.value}
                checked={backendKind === option.value}
                onChange={() => setBackendKind(option.value)}
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
        {backendKind !== "public_esplora" && (
          <div className="mt-3">
            <FieldLabel htmlFor="backend-url">Server URL</FieldLabel>
            <input
              id="backend-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              spellCheck={false}
              placeholder={
                backendKind === "custom_esplora"
                  ? "https://node.example.org:3002/api"
                  : "ssl://node.example.org:50002"
              }
              className="selectable h-11 w-full rounded-sm bg-sunken px-3 font-data text-[13px] text-text outline-none placeholder:text-muted/60"
            />
          </div>
        )}
        <div className="mt-4">
          <Button
            variant="secondary"
            onClick={() => void saveBackend()}
            disabled={
              setBackend.isPending ||
              (backendKind !== "public_esplora" && url.trim().length === 0)
            }
          >
            Save backend
          </Button>
        </div>
      </Section>

      <Section title="Appearance">
        <FieldLabel>Theme</FieldLabel>
        <div className="flex gap-2" role="radiogroup" aria-label="Theme">
          {(["light", "dark", "system"] as ThemePref[]).map((option) => (
            <Button
              key={option}
              variant={theme === option ? "secondary" : "ghost"}
              aria-pressed={theme === option}
              onClick={() => setTheme(option)}
            >
              {option === "light" ? "Light" : option === "dark" ? "Dark" : "System"}
            </Button>
          ))}
        </div>
      </Section>

      <Section title="Wallets">
        {wallets.length === 0 ? (
          <p className="font-ui text-sm text-muted">No wallets on this network yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {wallets.map((wallet) => (
              <li
                key={wallet.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-4 py-3"
              >
                {renaming?.id === wallet.id ? (
                  <input
                    autoFocus
                    value={renaming.name}
                    onChange={(event) => setRenaming({ id: wallet.id, name: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && renaming.name.trim()) {
                        void renameWallet
                          .mutateAsync({ id: wallet.id, name: renaming.name })
                          .then(() => {
                            setRenaming(null);
                            showToast("Setting saved");
                          });
                      }
                      if (event.key === "Escape") setRenaming(null);
                    }}
                    className="h-9 flex-1 rounded-sm bg-sunken px-2 font-ui text-sm text-text outline-none"
                    aria-label="Wallet name"
                  />
                ) : (
                  <span className="font-ui text-sm font-medium text-text">{wallet.name}</span>
                )}
                {confirmRemove === wallet.id ? (
                  <span className="flex items-center gap-2">
                    <span className="font-ui text-xs text-muted">
                      Stop watching this wallet? Nothing on chain changes.
                    </span>
                    <Button
                      variant="secondary"
                      className="h-9"
                      onClick={() =>
                        void removeWallet.mutateAsync(wallet.id).then(() => {
                          setConfirmRemove(null);
                          showToast("Wallet removed");
                        })
                      }
                    >
                      Remove
                    </Button>
                    <Button variant="ghost" className="h-9" onClick={() => setConfirmRemove(null)}>
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      className="h-9"
                      onClick={() => setRenaming({ id: wallet.id, name: wallet.name })}
                    >
                      Rename
                    </Button>
                    <Button
                      variant="ghost"
                      className="h-9"
                      onClick={() => setConfirmRemove(wallet.id)}
                    >
                      Remove
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="About">
        <p className="font-ui text-sm text-text">Gerfaut 0.1.0</p>
        <p className="mt-1 font-ui text-sm text-muted">
          Watch-only by design: this application contains no code to generate
          keys, handle seeds, or sign transactions. There is no send button.
        </p>
      </Section>
    </div>
  );
}
