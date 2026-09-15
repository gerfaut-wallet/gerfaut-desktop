import { clsx } from "clsx";
import type { ButtonHTMLAttributes, Ref } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "premium" | "premium-ghost";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** The element itself, for a caller that hands the focus back to it. */
  ref?: Ref<HTMLButtonElement>;
}

/** The button roles of the design system. One primary per screen. The
    premium pair is the primary and the ghost in the premium colour: an
    action on the paid service reads as such before its words do. */
export function Button({ variant = "secondary", className, ...rest }: Props) {
  return (
    <button
      type="button"
      className={clsx(
        "inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md px-4",
        "font-ui text-sm font-medium transition-colors duration-150 ease-out",
        "active:scale-[0.96] disabled:cursor-default disabled:opacity-50",
        variant === "primary" &&
          "bg-primary text-on-primary hover:bg-primary-hover disabled:hover:bg-primary",
        variant === "secondary" && "bg-sunken text-text hover:bg-border/60",
        variant === "ghost" && "bg-transparent text-muted hover:bg-sunken hover:text-text",
        // The paid service's own primary and ghost: never on a chain
        // state, never outside the premium section and its dialogs.
        variant === "premium" &&
          "bg-premium text-on-premium hover:bg-premium-hover disabled:hover:bg-premium",
        variant === "premium-ghost" && "bg-transparent text-premium hover:bg-sunken",
        // Destructive confirmations only, never a lone delete button.
        variant === "danger" &&
          "bg-alert text-white hover:opacity-90 dark:text-background",
        className,
      )}
      {...rest}
    />
  );
}

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
