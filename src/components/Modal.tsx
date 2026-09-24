import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { IconButton } from "./Button";

/** Open modals, bottom to top: Escape only closes the topmost one. */
const modalStack: symbol[] = [];

/** Floating surface: the only place the overlay shadow exists.
    Focus is trapped, Esc closes the topmost modal, focus returns to
    the trigger. Modals stack (`z` raises later ones). */
export function Modal({
  open,
  onClose,
  title,
  children,
  width = 520,
  z = 50,
  centered = false,
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: number;
  z?: number;
  /** Vertically centered instead of anchored near the top: for short
      confirmations that should sit in the middle of the window. */
  centered?: boolean;
  /** False while the dialog holds something that must not be lost to a
      stray Escape or click beside it: the one way out is the dialog's
      own button. The close button goes too. */
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef<Element | null>(null);
  const id = useRef(Symbol("modal"));

  // The effect must only run when `open` flips: re-running on parent
  // re-renders would steal focus mid-typing.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  useEffect(() => {
    if (!open) return;
    modalStack.push(id.current);
    previous.current = document.activeElement;
    const node = ref.current;
    // Initial focus goes to the content, never the header close button.
    const target =
      node?.querySelector<HTMLElement>(
        "textarea:not(:disabled), input:not(:disabled), select:not(:disabled)",
      ) ??
      node?.querySelector<HTMLElement>('button:not([aria-label="Close"])') ??
      node;
    target?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== id.current) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        if (dismissibleRef.current) onCloseRef.current();
      }
      if (event.key === "Tab" && node) {
        const focusables = [
          ...node.querySelectorAll<HTMLElement>(
            'a, button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
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
      const index = modalStack.indexOf(id.current);
      if (index !== -1) modalStack.splice(index, 1);
      (previous.current as HTMLElement | null)?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={
        centered
          ? "fixed inset-0 flex items-center justify-center bg-black/40"
          : "fixed inset-0 flex items-start justify-center bg-black/40 pt-[10vh]"
      }
      style={{ zIndex: z }}
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose();
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
          {dismissible ? (
            <IconButton label="Close" onClick={onClose}>
              <X size={20} strokeWidth={1.5} aria-hidden />
            </IconButton>
          ) : (
            // Holds the header's height, so the title does not jump
            // when the close button goes.
            <span aria-hidden className="size-10" />
          )}
        </header>
        <div className="max-h-[76vh] overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
