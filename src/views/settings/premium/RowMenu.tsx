import { clsx } from "clsx";
import { EllipsisVertical } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { IconButton } from "../../../components/Button";

export interface RowMenuItem {
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
  /** Why the item cannot be picked, when it cannot. */
  blocked?: string | null;
}

/** The actions of one row, behind one button. Arrow keys, Home and End
    walk the items, Escape, Tab and a click outside close, and the focus
    returns to the button. */
export function RowMenu({
  label,
  items,
  busy = false,
}: {
  /** What the row is, for the button's name: "More for Mac". */
  label: string;
  items: RowMenuItem[];
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) rootRef.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus();
  };

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const entries = [
      ...(rootRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? []),
    ];
    const index = entries.indexOf(document.activeElement as HTMLElement);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        entries[(index + 1) % entries.length]?.focus();
        break;
      case "ArrowUp":
        event.preventDefault();
        entries[(index - 1 + entries.length) % entries.length]?.focus();
        break;
      case "Home":
        event.preventDefault();
        entries[0]?.focus();
        break;
      case "End":
        event.preventDefault();
        entries[entries.length - 1]?.focus();
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close(true);
        break;
      case "Tab":
        event.preventDefault();
        close(true);
        break;
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <IconButton
        label={`More for ${label}`}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
      >
        <EllipsisVertical size={18} strokeWidth={1.5} aria-hidden />
      </IconButton>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={`Actions for ${label}`}
          onKeyDown={onKeyDown}
          className="absolute right-0 top-full z-30 mt-1.5 w-[220px] rounded-lg border border-border bg-surface p-1.5 shadow-overlay motion-safe:animate-[menu-in_150ms_ease-out]"
        >
          {items.map((item) => (
            <MenuItem
              key={item.label}
              icon={item.icon}
              blocked={item.blocked}
              onClick={() => {
                close(true);
                item.onSelect();
              }}
            >
              {item.label}
            </MenuItem>
          ))}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  onClick,
  blocked,
  children,
}: {
  icon: LucideIcon;
  onClick: () => void;
  /** Why the item cannot be picked, when it cannot. It stays in the
      menu, dimmed and still focusable — the arrow keys do not drop the
      focus on it, and the menu keeps saying what it can do — and the
      reason reads under the name. */
  blocked?: string | null;
  children: string;
}) {
  const off = blocked != null;
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-disabled={off || undefined}
      onClick={off ? undefined : onClick}
      className={clsx(
        "flex min-h-10 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left font-ui text-sm font-medium text-text transition-colors duration-100 focus-visible:bg-sunken/70 focus-visible:outline-none",
        off ? "cursor-not-allowed opacity-45" : "cursor-pointer hover:bg-sunken/70",
      )}
    >
      <Icon size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-muted" />
      {/* Two blocks, so a reader announces the name then the reason. */}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{children}</span>
        {off && (
          <span className="truncate font-ui text-[11px] font-normal text-muted">{blocked}</span>
        )}
      </span>
    </button>
  );
}
