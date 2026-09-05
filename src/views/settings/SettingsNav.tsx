import { Archive, Bell, Gem, Globe, Info, Lock, SlidersHorizontal, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { clsx } from "clsx";
import type { KeyboardEvent } from "react";
import type { SettingsSection } from "../../state/store";

/** The eight pages of Settings, in the order they are listed. Premium
    comes last, and its gem keeps the premium colour whether the entry
    is current or not: the one marker of the paid service in the app. */
export const SECTIONS: { id: SettingsSection; label: string; icon: LucideIcon }[] = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "network", label: "Network", icon: Globe },
  { id: "wallets", label: "Wallets", icon: Wallet },
  { id: "security", label: "Security", icon: Lock },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "backup", label: "Backup & sync", icon: Archive },
  { id: "about", label: "About", icon: Info },
  { id: "premium", label: "Premium", icon: Gem },
];

/** The sub-navigation of Settings: a column beside the cards when the
    canvas is wide enough, a scrollable row above them otherwise. Every
    item is a tab stop, as in the sidebar; the arrow keys walk them. */
export function SettingsNav({
  active,
  onSelect,
  className,
}: {
  active: SettingsSection;
  onSelect: (section: SettingsSection) => void;
  className?: string;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const step =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? -1
          : 0;
    if (step === 0 && event.key !== "Home" && event.key !== "End") return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>("button")];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (index === -1) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (index + step + items.length) % items.length;
    items[next].focus();
  };

  return (
    <nav aria-label="Settings sections" className={className}>
      <ul
        onKeyDown={onKeyDown}
        className={clsx(
          // Room for the focus ring, which the horizontal scroller would
          // otherwise clip.
          "-m-1 flex gap-1 overflow-x-auto p-1",
          "@4xl:m-0 @4xl:flex-col @4xl:gap-0.5 @4xl:overflow-visible @4xl:p-0",
        )}
      >
        {SECTIONS.map(({ id, label, icon: Icon }) => {
          const current = id === active;
          return (
            <li key={id} className="shrink-0">
              <button
                type="button"
                aria-current={current ? "page" : undefined}
                onClick={() => onSelect(id)}
                className={clsx(
                  "relative flex w-full cursor-pointer items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-left font-ui text-sm font-medium",
                  "transition-colors duration-150",
                  current
                    ? "bg-sunken text-text"
                    : "text-muted hover:bg-sunken/60 hover:text-text",
                )}
              >
                {current && (
                  <span
                    aria-hidden
                    className="absolute left-0 top-1/2 hidden h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary @4xl:block"
                  />
                )}
                <Icon
                  size={18}
                  strokeWidth={1.5}
                  aria-hidden
                  className={clsx(
                    "shrink-0",
                    id === "premium" ? "text-premium" : current && "text-primary",
                  )}
                />
                <span className="truncate">{label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
