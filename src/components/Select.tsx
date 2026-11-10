import { Fragment } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  Select as SelectRoot,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

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

/* Radix keeps the empty string for "nothing chosen" and refuses it as
   an item's value, while "" is a real choice here (the automatic public
   server). Every value travels prefixed, so none is ever empty. */
const encode = (value: string) => `=${value}`;
const decode = (value: string) => value.slice(1);

/** The wallet switcher's menu, made into a form control.
    Closed: an input-shaped button with the current choice and a
    chevron. Open: a floating list (listbox/option) under it with
    two-line rows, a check on the current one, group headings, hairline
    dividers. Arrow keys move, Enter and Space choose, Escape and outside
    clicks close, focus returns to the button. */
export function Select<T extends string>({
  id,
  value,
  options,
  onChange,
  label,
  disabled = false,
  size = "md",
  align = "start",
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
  /** The edge of the button the list keeps to when it is the wider:
      `end` for a narrow select at the right of a dialog, whose list
      would otherwise run past it and shift the dialog sideways. */
  align?: "start" | "end";
  className?: string;
}) {
  const current = options.find((option) => option.value === value);

  // Consecutive choices sharing a group, in display order: each named
  // group gets its heading, and a hairline when something comes before.
  const runs: { group?: string; options: SelectOption<T>[] }[] = [];
  for (const option of options) {
    const last = runs[runs.length - 1];
    if (last && last.group === option.group) last.options.push(option);
    else runs.push({ group: option.group, options: [option] });
  }

  const item = (option: SelectOption<T>) => (
    <SelectItem
      key={option.value}
      value={encode(option.value)}
      disabled={option.disabled}
      textValue={option.label}
      hint={option.hint}
      icon={option.icon}
      // The current row is the selected option at all times, not only
      // while it holds the focus, the way Radix marks it.
      aria-selected={option.value === value}
    >
      {option.label}
    </SelectItem>
  );

  return (
    <div className={className}>
      <SelectRoot
        value={encode(value)}
        onValueChange={(next) => onChange(decode(next) as T)}
        disabled={disabled}
      >
        <SelectTrigger id={id} size={size} aria-label={label} aria-haspopup="listbox">
          {current?.icon && (
            <span aria-hidden className="shrink-0 text-muted">
              {current.icon}
            </span>
          )}
          {/* Radix's Value drops a className of its own: the span it
              stands for carries the classes. */}
          <SelectValue asChild>
            <span
              className={cn(
                "min-w-0 flex-1 truncate font-ui text-text",
                size === "md" ? "text-base" : "text-sm font-medium",
              )}
            >
              {current?.label ?? ""}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent
          aria-label={label}
          align={align}
          // `start` spans the field; `end` keeps to its right edge and
          // takes the width its rows need, never less than the field.
          className={
            align === "end"
              ? "min-w-[max(220px,var(--radix-select-trigger-width))]"
              : "w-(--radix-select-trigger-width)"
          }
        >
          {runs.map((run, index) =>
            run.group === undefined ? (
              run.options.map(item)
            ) : (
              <Fragment key={`group-${index}`}>
                {index > 0 && <SelectSeparator />}
                <SelectGroup>
                  <SelectLabel>{run.group}</SelectLabel>
                  {run.options.map(item)}
                </SelectGroup>
              </Fragment>
            ),
          )}
        </SelectContent>
      </SelectRoot>
    </div>
  );
}
