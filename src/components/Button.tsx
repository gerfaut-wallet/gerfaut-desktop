import { clsx } from "clsx";
import { ChevronDown, ChevronUp, LoaderCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, Ref } from "react";

/** Every labelled button is filled: a word alone with no fill and no
    edge does not read as something to press.

    - `primary` — an action that stands on its own: a card's action, a
      form that saves, the yes of a dialog.
    - `secondary` — the way out beside it (Cancel, Back, Later), one of
      several equal choices (two sources, two outputs), and the actions
      a list repeats on every row.
    - `danger` — the yes of a destructive confirmation only, never the
      button that opens it. */
type Variant = "primary" | "secondary" | "danger";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: the role is a choice made where the button is used. */
  variant: Variant;
  /** `sm` for a list row, a notice or a header line: 40px, the
      desktop's smallest target. */
  size?: "md" | "sm";
  /** The glyph before the label, which the spinner takes over while
      busy: one slot, so the label does not move. */
  icon?: LucideIcon;
  /** Working on it: a spinner, at full strength rather than greyed —
      it is not off, it is busy. Clicks are ignored, but the button
      keeps the keyboard focus it was pressed with. */
  busy?: boolean;
  /** A secondary on a tinted panel (a notice): Neige with a hairline,
      where Givre would read dirty. Dark keeps its fill. */
  onTint?: boolean;
  /** The element itself, for a caller that hands the focus back to it. */
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant,
  size = "md",
  icon: Icon,
  busy = false,
  onTint = false,
  disabled = false,
  type = "button",
  onClick,
  className,
  children,
  ...rest
}: Props) {
  const inert = disabled || busy;
  return (
    <button
      // First, so nothing passed here can undo the busy state below.
      {...rest}
      type={type}
      // A busy button stays focusable; a submit one is switched off
      // outright, or Enter in a field of its form would send it again.
      disabled={disabled || (busy && type === "submit")}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      onClick={busy ? (event) => event.preventDefault() : onClick}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-md",
        "font-ui text-sm font-medium transition-[background-color,color,box-shadow,scale] duration-150 ease-out",
        size === "md" ? "h-11 px-4" : "h-10 px-3",
        busy
          ? "cursor-wait"
          : disabled
            ? "cursor-default opacity-50"
            : "cursor-pointer active:scale-[0.96]",
        variant === "primary" && ["bg-primary text-on-primary", !inert && "hover:bg-primary-hover"],
        variant === "secondary" && [
          "text-text",
          onTint
            ? "bg-surface shadow-[inset_0_0_0_1px_var(--color-border)] dark:bg-sunken dark:shadow-none"
            : "bg-sunken",
          !inert && (onTint ? "hover:bg-background dark:hover:bg-border" : "hover:bg-border/60"),
        ],
        variant === "danger" && ["bg-alert text-on-alert", !inert && "hover:bg-alert-hover"],
        className,
      )}
    >
      {busy ? (
        <LoaderCircle
          size={ICON_SIZE}
          strokeWidth={1.5}
          aria-hidden
          className="shrink-0 motion-safe:animate-spin"
        />
      ) : (
        Icon && <Icon size={ICON_SIZE} strokeWidth={1.5} aria-hidden className="shrink-0" />
      )}
      {children}
    </button>
  );
}

/** The glyph of a labelled button, and of its spinner. */
const ICON_SIZE = 16;

/** 40px square icon button for toolbars. */
export function IconButton({
  label,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx(
        "inline-flex size-10 cursor-pointer items-center justify-center rounded-md",
        "text-muted transition-colors duration-150 ease-out",
        "enabled:hover:bg-sunken enabled:hover:text-text enabled:active:scale-[0.96]",
        "disabled:cursor-default disabled:opacity-40",
        className,
      )}
      {...rest}
    />
  );
}

/** Shows or hides the part of the page under it. Not an action, so no
    fill: it keeps the voice of a heading, with the chevron that says it
    opens. The one labelled button left without a fill. */
export function Disclosure({
  open,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { open: boolean }) {
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      aria-expanded={open}
      className={clsx(
        "inline-flex h-10 cursor-pointer items-center gap-2 rounded-md px-2",
        "font-ui text-sm font-medium text-muted transition-colors duration-150 ease-out",
        "hover:bg-sunken hover:text-text",
        className,
      )}
      {...rest}
    >
      <Chevron size={14} strokeWidth={1.5} aria-hidden className="shrink-0" />
      {children}
    </button>
  );
}
