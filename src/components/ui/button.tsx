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
    - `ghost`: a toolbar glyph or a disclosure, with no fill at rest.

    Off, a filled button gives up its fill: a hairline and the label in
    the muted colour, which stays readable where a button faded to half
    wrote white on a pale fill. Hollow, it is not the grey of a
    secondary either: the shape says it cannot be pressed. */
const OFF = "off:bg-transparent off:text-muted off:shadow-[inset_0_0_0_1px_var(--color-border)]";

const buttonVariants = cva(
  [
    "inline-flex cursor-pointer items-center justify-center gap-2 rounded-md",
    "font-ui text-sm font-medium",
    "transition-[background-color,color,box-shadow,scale] duration-150 ease-out",
    "live:active:scale-[0.96]",
    "disabled:cursor-default aria-busy:cursor-wait",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary: ["bg-primary text-on-primary live:hover:bg-primary-hover", OFF],
        secondary: ["bg-sunken text-text live:hover:bg-border/60", OFF],
        danger: ["bg-alert text-on-alert live:hover:bg-alert-hover", OFF],
        // No fill to give up: a glyph that is off fades.
        ghost: "text-muted live:hover:bg-sunken live:hover:text-text disabled:opacity-50",
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
  // Never a submit by accident: a form's submit says so where it is used.
  type = "button",
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
      type={asChild ? undefined : type}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
