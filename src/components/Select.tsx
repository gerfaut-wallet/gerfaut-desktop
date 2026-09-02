import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { clsx } from "clsx";

/** One choice of a select. */
export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** Second line, muted: what the choice means, or a caveat. */
  hint?: string;
  icon?: ReactNode;
  disabled?: boolean;
  /** Choices sharing a group are listed under its heading. */
  group?: string;
}

/** The wallet switcher's menu, made into a form control.
    Closed: an input-shaped button with the current choice and a
    chevron. Open: a floating list (listbox/option) with two-line rows,
    a check on the current one, group headings, hairline dividers.
    Arrow keys move, Enter and Space choose, Escape and outside clicks
    close, focus returns to the button. */
export function Select<T extends string>({
  id,
  value,
  options,
  onChange,
  label,
  disabled = false,
  size = "md",
  className,
}: {
  id?: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
  /** `md` is the form gabarit (44px); `sm` sits in a settings row. */
  size?: "md" | "sm";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<T>(value);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const current = options.find((option) => option.value === value);
  const enabled = options.filter((option) => !option.disabled);

  const choose = (next: T) => {
    setOpen(false);
    buttonRef.current?.focus();
    if (next !== value) onChange(next);
  };

  useEffect(() => {
    if (!open) return;
    setActive(value);
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-value="${CSS.escape(active)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const move = (delta: number) => {
    if (enabled.length === 0) return;
    const index = enabled.findIndex((option) => option.value === active);
    const next = enabled[(index + delta + enabled.length) % enabled.length];
    setActive(next.value);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "Home":
        event.preventDefault();
        if (enabled[0]) setActive(enabled[0].value);
        break;
      case "End":
        event.preventDefault();
        if (enabled.length) setActive(enabled[enabled.length - 1].value);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        choose(active);
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  // Rows in display order, with a heading wherever a new group starts
  // and a hairline between groups.
  const rows: ReactNode[] = [];
  let lastGroup: string | undefined;
  options.forEach((option, index) => {
    if (option.group !== undefined && option.group !== lastGroup) {
      if (index > 0) {
        rows.push(<div key={`rule-${option.group}`} aria-hidden className="mx-1 my-1 h-px bg-border/60" />);
      }
      rows.push(
        <div
          key={`group-${option.group}`}
          role="presentation"
          className="px-2.5 pb-1 pt-2 font-ui text-[11px] font-medium uppercase tracking-[0.04em] text-muted"
        >
          {option.group}
        </div>,
      );
      lastGroup = option.group;
    }
    const selected = option.value === value;
    const highlighted = option.value === active;
    rows.push(
      <div
        key={option.value}
        role="option"
        id={`${listId}-${option.value}`}
        data-value={option.value}
        aria-selected={selected}
        aria-disabled={option.disabled || undefined}
        onMouseEnter={() => !option.disabled && setActive(option.value)}
        onClick={() => !option.disabled && choose(option.value)}
        className={clsx(
          "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors duration-100",
          option.disabled
            ? "cursor-not-allowed opacity-45"
            : "cursor-pointer",
          highlighted && !option.disabled && "bg-sunken/70",
          selected && !highlighted && "bg-sunken/50",
        )}
      >
        {option.icon && (
          <span aria-hidden className="shrink-0 text-muted">
            {option.icon}
          </span>
        )}
        {/* Block elements: the accessible name then reads "label hint",
            the way a screen reader announces the row. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="truncate font-ui text-sm font-medium text-text">{option.label}</div>
          {option.hint && (
            <div className="truncate font-ui text-[11px] text-muted">{option.hint}</div>
          )}
        </div>
        {selected && (
          <Check size={14} strokeWidth={2} aria-hidden className="shrink-0 text-primary" />
        )}
      </div>,
    );
  });

  return (
    <div ref={rootRef} className={clsx("relative", className)} onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-label={label}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className={clsx(
          "field-focus flex w-full items-center gap-2.5 rounded-sm border border-transparent bg-sunken text-left",
          disabled ? "cursor-default opacity-60" : "cursor-pointer hover:bg-border/60",
          size === "md" ? "h-11 px-3" : "h-9 px-2.5",
        )}
      >
        {current?.icon && (
          <span aria-hidden className="shrink-0 text-muted">
            {current.icon}
          </span>
        )}
        <span
          className={clsx(
            "min-w-0 flex-1 truncate font-ui text-text",
            size === "md" ? "text-base" : "text-sm font-medium",
          )}
        >
          {current?.label ?? ""}
        </span>
        <ChevronDown
          size={size === "md" ? 16 : 14}
          strokeWidth={1.5}
          aria-hidden
          className={clsx("shrink-0 text-muted transition-transform duration-150", open && "rotate-180")}
        />
      </button>

      {open && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          className="absolute left-0 right-0 top-full z-40 mt-1.5 max-h-[320px] min-w-[220px] overflow-y-auto rounded-lg border border-border bg-surface p-1.5 shadow-overlay"
        >
          {rows}
        </div>
      )}
    </div>
  );
}
