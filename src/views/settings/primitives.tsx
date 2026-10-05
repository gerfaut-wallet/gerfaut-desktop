// The building blocks every settings section shares. Sections live in
// their own files; this keeps their frame, rows and controls identical.

import { clsx } from "clsx";
import type { ReactNode, Ref } from "react";
import { Notice } from "../../components/Notice";
import { useRadioGroup } from "../../components/radioGroup";
import { errorMessage } from "../../lib/ipc";

/** A ghost on a tinted panel: hover in Neige with a hairline rather
    than the Givre that would read dirty there; Givre again in dark. */
export const GHOST_ON_TINT =
  "h-9 hover:bg-surface hover:shadow-[inset_0_0_0_1px_var(--color-border)] dark:hover:bg-sunken dark:hover:shadow-none";

/** What a setting that was not saved leaves under it: the amber note,
    in the core's words, until the next try. Never a toast, which would
    be gone before it is read, and never a control left showing a value
    the vault does not hold. */
export function SaveFailure({ error, className }: { error: unknown; className?: string }) {
  if (error === null || error === undefined) return null;
  // `className` replaces the margin above, for a parent that spaces
  // its children itself.
  return (
    <Notice tone="info" role="alert" className={className ?? "mt-2"}>
      Not saved: {errorMessage(error)}
    </Notice>
  );
}

export function SectionCard({
  icon,
  title,
  children,
  className,
  headingRef,
  premium = false,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  className?: string;
  /** A card of the paid service: its glyph takes the premium colour,
      as the entry that leads here does. */
  premium?: boolean;
  /** The heading, for a section that moves the focus there once what
      held it is gone — a question answered, a row removed. Given a
      ref, the heading takes the focus from a script and never from
      Tab. */
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <section
      className={clsx(
        "rounded-lg border border-border bg-surface p-5",
        className,
      )}
    >
      <h2
        ref={headingRef}
        tabIndex={headingRef ? -1 : undefined}
        className="mb-4 flex items-center gap-2 font-display text-base font-semibold text-text"
      >
        <span className={premium ? "text-premium" : "text-muted"}>{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Full-width setting line: title and hint on the left, control on the
    right, so stacked cards stay balanced at any window width. */
export function SettingRow({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
      {/* The words give way before the control does: a hint at its full
          measure pushed a 96px field onto a line of its own. */}
      <div className="min-w-0 max-w-xl flex-[1_1_20rem]">
        <p className="font-ui text-sm font-medium text-text">{title}</p>
        {hint && <p className="mt-0.5 font-ui text-xs text-muted">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block font-ui text-xs font-medium uppercase tracking-[0.04em] text-muted"
    >
      {children}
    </label>
  );
}

/** Row of mutually exclusive choices, styled instead of a native select.
    The chosen one in a Glacier fill: the white chip with a hairline it
    used to be was the faintest mark on the page for the one thing the
    control says. An option that cannot apply stays, in Ardoise, and
    takes no click. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; icon?: ReactNode; disabled?: boolean }[];
  onChange: (value: T) => void;
  label: string;
}) {
  const radio = useRadioGroup(
    options.map((option) => option.value),
    value,
    onChange,
    (candidate) => options.find((option) => option.value === candidate)?.disabled === true,
  );
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-md bg-sunken p-0.5"
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          {...radio(option.value, index)}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          className={clsx(
            "inline-flex h-9 items-center gap-1.5 rounded-[6px] px-3 font-ui text-sm font-medium transition-colors duration-150",
            option.disabled ? "cursor-not-allowed text-muted" : "cursor-pointer",
            value === option.value
              ? "bg-primary text-on-primary"
              : !option.disabled && "text-text hover:bg-border/60",
          )}
        >
          {option.icon && (
            <span aria-hidden className="shrink-0">
              {option.icon}
            </span>
          )}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
  busy = false,
  tone = "primary",
  describedBy,
  ref,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  /** The id of the line that says what the switch does, read out after
      its name. */
  describedBy?: string;
  /** What the switch acts on when it is on: the app, or the paid
      service. */
  tone?: "primary" | "premium";
  /** Greyed and inert, but still there: a switch that cannot be used
      says more than a switch that is gone. */
  disabled?: boolean;
  /** Waiting on an answer: inert meanwhile, and said so. */
  busy?: boolean;
  /** The switch itself, for a caller that hands the focus back to it. */
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative h-6 w-11 rounded-full transition-colors duration-150",
        checked ? (tone === "premium" ? "bg-premium" : "bg-primary") : "bg-border",
        disabled ? "cursor-not-allowed opacity-45" : busy ? "cursor-wait" : "cursor-pointer",
      )}
    >
      {/* Anchored left-0.5: without an explicit inset the knob's resting
          spot follows the button's text alignment and drifts per engine. */}
      <span
        aria-hidden
        className={clsx(
          "absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-[0_1px_2px_rgba(13,19,23,0.25)] transition-transform duration-150",
          checked && "translate-x-5",
        )}
      />
    </button>
  );
}
