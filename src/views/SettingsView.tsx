import type { Settings, WalletMeta } from "../lib/ipc";
import { AboutSection } from "./settings/AboutSection";
import { BackupSection } from "./settings/BackupSection";
import { AppearanceCard, DisplayCard } from "./settings/GeneralSection";
import { NetworkSection } from "./settings/NetworkSection";
import { NotificationsSection } from "./settings/NotificationsSection";
import { SecuritySection } from "./settings/SecuritySection";
import { TorSection } from "./settings/TorSection";
import { WalletsSection } from "./settings/WalletsSection";

export { BackendSection, buildElectrumUrl, parseElectrumUrl } from "./settings/BackendSection";
export {
  CertificateDialog,
  CertificatesSection,
  Fingerprint,
} from "./settings/CertificatesSection";

/** Settings: workspace, backend, display, appearance, wallets, about. */
export function SettingsView({
  settings,
  wallets,
}: {
  settings: Settings;
  wallets: WalletMeta[];
}) {
  return (
    <div className="pb-8">
      <h1 className="px-1 pb-5 pt-2 font-display text-2xl font-semibold tracking-[-0.01em] text-text">
        Settings
      </h1>
      <div className="flex flex-col gap-5">
        <NetworkSection settings={settings} />
        <DisplayCard />
        <AppearanceCard />
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
