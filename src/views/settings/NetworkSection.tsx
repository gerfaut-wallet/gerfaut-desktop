import { Check, Globe } from "lucide-react";
import { clsx } from "clsx";
import type { Settings } from "../../lib/ipc";
import { useSetActiveNetwork, useSetBackend } from "../../state/queries";
import { useUi } from "../../state/store";
import { BackendSection, NETWORKS } from "./BackendSection";
import { CertificatesSection } from "./CertificatesSection";
import { SectionCard } from "./primitives";

/** The chain the workspace watches, where its data comes from, and the
    certificates accepted along the way. */
export function NetworkSection({ settings }: { settings: Settings }) {
  const { showToast } = useUi();
  const setActiveNetwork = useSetActiveNetwork();
  const setBackend = useSetBackend();
  const network = settings.active_network;

  return (
    <>
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
    </>
  );
}
