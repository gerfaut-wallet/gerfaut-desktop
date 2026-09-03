import { Shapes } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { clsx } from "clsx";
import { Button } from "../../components/Button";
import { WALLET_ICONS } from "../../lib/ipc";
import type { WalletIconId } from "../../lib/ipc";
import { WALLET_ICON, WALLET_ICON_LABEL } from "../../lib/walletIcons";

/** The Icon action of a wallet row and the popover it opens: the seven
    icons in a row, the current one marked. Arrow keys move, Enter and
    Space choose, Escape and a click outside close, focus returns to
    the action. */
export function WalletIconPicker({
  name,
  value,
  disabled = false,
  onChoose,
}: {
  /** The wallet's name, for the group's accessible name. */
  name: string;
  value: WalletIconId;
  disabled?: boolean;
  onChoose: (icon: WalletIconId) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const groupId = useId();

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) rootRef.current?.querySelector<HTMLElement>("[aria-expanded]")?.focus();
  };

  // Focus lands on the current icon; a click anywhere else closes.
  useEffect(() => {
    if (!open) return;
    groupRef.current?.querySelector<HTMLElement>("[aria-checked='true']")?.focus();
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(groupRef.current?.querySelectorAll<HTMLElement>("[role='radio']") ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        items[(index + 1) % items.length]?.focus();
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        items[(index - 1 + items.length) % items.length]?.focus();
        break;
      case "Home":
        event.preventDefault();
        items[0]?.focus();
        break;
      case "End":
        event.preventDefault();
        items[items.length - 1]?.focus();
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close(true);
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  const choose = (icon: WalletIconId) => {
    close(true);
    if (icon !== value) onChoose(icon);
  };

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="ghost"
        className="h-9"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={open ? groupId : undefined}
        onClick={() => setOpen(!open)}
      >
        <Shapes size={14} strokeWidth={1.5} aria-hidden />
        Icon
      </Button>
      {open && (
        <div
          ref={groupRef}
          id={groupId}
          role="radiogroup"
          aria-label={`Icon of ${name}`}
          onKeyDown={onKeyDown}
          className="absolute right-0 top-full z-30 mt-1.5 flex gap-1 rounded-lg border border-border bg-surface p-1.5 shadow-overlay"
        >
          {WALLET_ICONS.map((icon) => {
            const Glyph = WALLET_ICON[icon];
            const current = icon === value;
            return (
              <button
                key={icon}
                type="button"
                role="radio"
                aria-checked={current}
                aria-label={WALLET_ICON_LABEL[icon]}
                title={WALLET_ICON_LABEL[icon]}
                tabIndex={current ? 0 : -1}
                onClick={() => choose(icon)}
                className={clsx(
                  "inline-flex size-10 cursor-pointer items-center justify-center rounded-md",
                  "transition-colors duration-150 ease-out active:scale-[0.96]",
                  current
                    ? "bg-sunken text-primary ring-2 ring-inset ring-primary"
                    : "text-muted hover:bg-sunken hover:text-text",
                )}
              >
                <Glyph size={20} strokeWidth={1.5} aria-hidden />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
