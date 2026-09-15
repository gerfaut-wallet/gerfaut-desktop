// The building blocks every settings section shares. Sections live in
// their own files; this keeps their frame, rows and controls identical.

import { clsx } from "clsx";
import type { ReactNode, Ref } from "react";

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
      <div className="min-w-0 max-w-xl">
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

/** Row of mutually exclusive choices, styled instead of a native select. */
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
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-md bg-sunken p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          className={clsx(
            "inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 font-ui text-sm font-medium transition-colors duration-150",
            option.disabled
              ? "cursor-not-allowed text-muted/45"
              : "cursor-pointer",
            value === option.value
              ? "bg-surface text-text shadow-[inset_0_0_0_1px_var(--color-border)]"
              : !option.disabled && "text-muted hover:text-text",
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
  ref,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
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
