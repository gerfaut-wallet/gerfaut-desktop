import { clsx } from "clsx";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

/** The three button roles of the design system. One primary per screen. */
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
        "hover:bg-sunken hover:text-text active:scale-[0.96]",
        className,
      )}
      {...rest}
    />
  );
}
