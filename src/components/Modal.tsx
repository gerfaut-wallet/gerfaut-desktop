import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { IconButton } from "./Button";

/** Floating surface: the only place the overlay shadow exists.
    Focus is trapped, Esc closes, focus returns to the trigger. */
export function Modal({
  open,
  onClose,
  title,
  children,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef<Element | null>(null);

  // The effect must only run when `open` flips: re-running on parent
  // re-renders would steal focus mid-typing.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    previous.current = document.activeElement;
    const node = ref.current;
    // Initial focus goes to the content, never the header close button.
    const target =
      node?.querySelector<HTMLElement>("textarea, input, select") ??
      node?.querySelector<HTMLElement>('button:not([aria-label="Close"])') ??
      node;
    target?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
      }
      if (event.key === "Tab" && node) {
        const focusables = [
          ...node.querySelectorAll<HTMLElement>(
            'a, button:not(:disabled), input, textarea, select, [tabindex]:not([tabindex="-1"])',
          ),
        ].filter((el) => el.offsetParent !== null);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      (previous.current as HTMLElement | null)?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ width, maxWidth: "calc(100vw - 48px)" }}
        className="motion-safe:animate-[modal-in_250ms_ease-out] rounded-lg bg-surface shadow-overlay"
      >
        <header className="flex items-center justify-between border-b border-border px-6 py-4">
          <h1 className="font-display text-lg font-semibold text-text">{title}</h1>
          <IconButton label="Close" onClick={onClose}>
            <X size={20} strokeWidth={1.5} aria-hidden />
          </IconButton>
        </header>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
