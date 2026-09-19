import { useRef } from "react";
import type { ReactNode } from "react";
import type { Settings, WalletMeta } from "../lib/ipc";
import { useUi } from "../state/store";
import type { SettingsSection } from "../state/store";
import { AboutSection } from "./settings/AboutSection";
import { BackupSection } from "./settings/BackupSection";
import { GeneralSection } from "./settings/GeneralSection";
import { NetworkSection } from "./settings/NetworkSection";
import { NotificationsSection } from "./settings/NotificationsSection";
import { PremiumSection } from "./settings/PremiumSection";
import { SecuritySection } from "./settings/SecuritySection";
import { SettingsNav } from "./settings/SettingsNav";
import { WalletsSection } from "./settings/WalletsSection";

/** Settings, one section at a time. The sub-navigation picks it and
    the store remembers it: the sidebar's Settings entry comes back to
    where one left off, and any view can open a section directly. */
export function SettingsView({
  settings,
  wallets,
}: {
  settings: Settings;
  wallets: WalletMeta[];
}) {
  const section = useUi((state) => state.settingsSection);
  const setSettingsSection = useUi((state) => state.setSettingsSection);
  const rootRef = useRef<HTMLDivElement>(null);

  const content: Record<SettingsSection, ReactNode> = {
    general: <GeneralSection />,
    network: <NetworkSection settings={settings} />,
    wallets: (
      <WalletsSection wallets={wallets} gapLimit={settings.gap_limit} premium={settings.premium} />
    ),
    security: <SecuritySection lock={settings.app_lock} />,
    notifications: <NotificationsSection />,
    backup: <BackupSection activeNetwork={settings.active_network} />,
    about: <AboutSection settings={settings} />,
    premium: <PremiumSection wallets={wallets} />,
  };

  const select = (next: SettingsSection) => {
    setSettingsSection(next);
    // A section starts at its top: how far the last one was scrolled
    // says nothing about this one.
    rootRef.current?.scrollIntoView({ block: "start" });
  };

  return (
    // The container the sub-navigation measures itself against: a
    // column beside the cards on a wide canvas, a row above them on a
    // narrow one.
    <div ref={rootRef} className="@container scroll-mt-4 pb-8">
      <h1 className="px-1 pb-5 pt-2 font-display text-2xl font-semibold tracking-[-0.01em] text-text">
        Settings
      </h1>
      <div className="flex flex-col gap-5 @4xl:flex-row @4xl:items-start @4xl:gap-8">
        <SettingsNav
          active={section}
          onSelect={select}
          className="@4xl:sticky @4xl:top-4 @4xl:w-[200px] @4xl:shrink-0"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-5">{content[section]}</div>
      </div>
    </div>
  );
}
