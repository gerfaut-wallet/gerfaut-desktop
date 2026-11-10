import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

/** The shadcn/ui switch, on the Toundra roles: Glacier when on, Brume
    when off, a white knob that keeps its light shadow in both themes. */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-150",
        "data-[state=checked]:bg-primary data-[state=unchecked]:bg-border",
        "disabled:cursor-not-allowed disabled:opacity-45",
        className,
      )}
      {...props}
    >
      {/* Anchored left-0.5: without an explicit inset the knob's resting
          spot follows the button's text alignment and drifts per engine. */}
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none absolute left-0.5 top-0.5 block size-5 rounded-full bg-white",
          "shadow-[0_1px_2px_rgba(13,19,23,0.25)] transition-transform duration-150",
          "data-[state=checked]:translate-x-5",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
