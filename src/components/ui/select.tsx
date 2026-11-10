import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

/** The shadcn/ui select, on the Toundra roles: the wallet switcher's
    menu made into a form control. Radix gives it the platform's
    keyboard (arrows, Home/End, typeahead, Enter/Space, Escape), the
    outside click, focus back on the trigger, and its own layer: Escape
    closes the list, never the dialog it sits in. */
function Select(props: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectGroup(props: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectValue(props: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

/** Closed, the select is a field: Givre fill, 4px radius, 44px in a
    form (`md`), 36px in a settings row (`sm`), the chevron turning
    over while the list is open. */
function SelectTrigger({
  className,
  size = "md",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "md" | "sm";
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "group/select field-focus flex w-full items-center gap-2.5 rounded-sm border border-transparent bg-sunken text-left",
        "live:cursor-pointer live:hover:bg-border/60 disabled:cursor-default disabled:opacity-60",
        size === "md" ? "h-11 px-3" : "h-9 px-2.5",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown
          size={size === "md" ? 16 : 14}
          strokeWidth={1.5}
          aria-hidden
          className="shrink-0 text-muted transition-transform duration-150 group-data-[state=open]/select:rotate-180"
        />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

/** Open, a floating panel anchored under the trigger: Neige, Brume
    hairline, 12px radius, the overlay shadow, 320px at most then it
    scrolls. Anchored, it has its origin on screen: it fades in, nothing
    slides. Always `popper`: Radix's item-aligned mode would lay the
    list over the trigger, the current row on top of it.
    Above every modal layer (the topmost sits at 70): a select lives in
    dialogs and its list must not open underneath one. */
function SelectContent({
  className,
  children,
  sideOffset = 6,
  ...props
}: Omit<React.ComponentProps<typeof SelectPrimitive.Content>, "position">) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position="popper"
        sideOffset={sideOffset}
        className={cn(
          "relative z-[100] max-h-[min(320px,var(--radix-select-content-available-height))] min-w-[220px] overflow-hidden",
          "rounded-lg border border-border bg-surface shadow-overlay",
          "motion-safe:animate-[menu-in_150ms_ease-out]",
          className,
        )}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport className="p-1.5">{children}</SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

/** A group's heading: small caps in Ardoise. */
function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn(
        "px-2.5 pb-1 pt-2 font-ui text-[11px] font-medium uppercase tracking-[0.04em] text-muted",
        className,
      )}
      {...props}
    />
  );
}

/** A row on up to two lines: the label, then in Ardoise what the
    choice means or its caveat. The current one rests on Givre with a
    Glace check at its end; a disabled one stays in view at 45%.
    Label and hint are both the option's name, as block elements, so a
    screen reader announces "label hint"; typeahead keys on the label
    alone (`textValue`). */
function SelectItem({
  className,
  children,
  hint,
  icon,
  textValue,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item> & {
  hint?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      textValue={textValue ?? (typeof children === "string" ? children : undefined)}
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left outline-none transition-colors duration-100",
        "data-[highlighted]:bg-sunken/70 data-[state=checked]:not-data-[highlighted]:bg-sunken/50",
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45",
        className,
      )}
      {...props}
    >
      {icon && (
        <span aria-hidden className="shrink-0 text-muted">
          {icon}
        </span>
      )}
      <SelectPrimitive.ItemText asChild>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="truncate font-ui text-sm font-medium text-text">{children}</div>
          {hint && <div className="truncate font-ui text-[11px] text-muted">{hint}</div>}
        </div>
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="shrink-0">
        <Check size={14} strokeWidth={2} aria-hidden className="text-primary" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

/** The hairline between two groups. */
function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none mx-1 my-1 h-px bg-border/60", className)}
      {...props}
    />
  );
}

/** Radix hides the viewport's scrollbar: past 320px these arrows say
    there is more, and scroll while the pointer rests on them. */
function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn("flex cursor-default items-center justify-center py-1 text-muted", className)}
      {...props}
    >
      <ChevronUp size={14} strokeWidth={1.5} aria-hidden />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn("flex cursor-default items-center justify-center py-1 text-muted", className)}
      {...props}
    >
      <ChevronDown size={14} strokeWidth={1.5} aria-hidden />
    </SelectPrimitive.ScrollDownButton>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
