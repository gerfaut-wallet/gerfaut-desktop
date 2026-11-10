import * as React from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** The shadcn/ui radio group, drawn as a segmented control: a Givre
    track and its choices side by side. Radix gives it the platform's
    keyboard: Tab enters on the chosen one, the arrows move and choose,
    a disabled choice is stepped over. Home and End choose the first and
    the last, where Radix only moves the focus there.
    A press on the choice already shown is still a choice: a value the
    vault holds comes back a round trip later, and two quick arrows
    must not lose the second for landing on the choice still shown. */
function RadioGroup({
  className,
  onKeyDown,
  onClick,
  onValueChange,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn("inline-flex rounded-md bg-sunken p-0.5", className)}
      onValueChange={onValueChange}
      onClick={(event) => {
        onClick?.(event);
        const radio = (event.target as Element).closest<HTMLButtonElement>('[role="radio"]');
        if (radio?.dataset.state === "checked" && !radio.disabled) onValueChange?.(radio.value);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.key !== "Home" && event.key !== "End") return;
        const choices = event.currentTarget.querySelectorAll<HTMLButtonElement>(
          '[role="radio"]:not(:disabled)',
        );
        const target = event.key === "Home" ? choices[0] : choices[choices.length - 1];
        if (!target) return;
        event.preventDefault();
        target.focus();
        target.click();
      }}
      {...props}
    />
  );
}

/** - `solid`: a setting's choice; the chosen one in a Glacier fill.
    - `quiet`: a filter on a card (a chart's range); the chosen one
      raised on Neige, in the small label size. */
const radioGroupItemVariants = cva(
  "inline-flex items-center font-ui font-medium transition-colors duration-150 disabled:cursor-not-allowed",
  {
    variants: {
      tone: {
        solid: [
          "h-9 cursor-pointer gap-1.5 rounded-[6px] px-3 text-sm",
          "data-[state=checked]:bg-primary data-[state=checked]:text-on-primary",
          "data-[state=unchecked]:enabled:text-text data-[state=unchecked]:enabled:hover:bg-border/60",
          "disabled:text-muted",
        ],
        quiet: [
          "cursor-pointer rounded-[6px] px-2 py-0.5 text-[11px]",
          "data-[state=checked]:bg-surface data-[state=checked]:text-text",
          "data-[state=checked]:shadow-[inset_0_0_0_1px_var(--color-border)]",
          "data-[state=unchecked]:text-muted data-[state=unchecked]:hover:text-text",
        ],
      },
    },
    defaultVariants: { tone: "solid" },
  },
);

function RadioGroupItem({
  className,
  tone,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item> &
  VariantProps<typeof radioGroupItemVariants>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(radioGroupItemVariants({ tone }), className)}
      {...props}
    />
  );
}

export { RadioGroup, RadioGroupItem };
