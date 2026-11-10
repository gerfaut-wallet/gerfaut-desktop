import * as React from "react";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

/** The shadcn/ui button, on the Toundra roles. The focus ring is the
    app's own (tokens.css, `:focus-visible`), so none is drawn here.

    - `primary`: an action that stands on its own.
    - `secondary`: the way out beside it, or one of several equal choices.
    - `danger`: the yes of a destructive confirmation only.
    - `ghost`: a toolbar glyph or a disclosure, with no fill at rest. */
const buttonVariants = cva(
  [
    "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md",
    "font-ui text-sm font-medium whitespace-nowrap",
    "transition-[background-color,color,box-shadow,scale] duration-150 ease-out",
    "live:active:scale-[0.96]",
    "disabled:cursor-default disabled:opacity-50 aria-busy:cursor-wait",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary: "bg-primary text-on-primary live:hover:bg-primary-hover",
        secondary: "bg-sunken text-text live:hover:bg-border/60",
        danger: "bg-alert text-on-alert live:hover:bg-alert-hover",
        ghost: "text-muted live:hover:bg-sunken live:hover:text-text",
      },
      size: {
        md: "h-11 px-4",
        sm: "h-10 px-3",
        icon: "size-10 disabled:opacity-40",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
