import { X } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { IconButton } from "./Button";
import { CreditLayer, CreditSlot } from "./PriceCredit";

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
  closable = true,
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
  /** Off while the modal is sending what it was opened for and cannot
      take it back: Escape, the backdrop and the close button do nothing
      until it is done, and the close button says so by being off. */
  closable?: boolean;
}) {
  const previous = useRef<Element | null>(null);

  // Taken before the content mounts (the portal lands it one render
  // later): a field marked autoFocus grabs the focus as soon as it is
  // in, and the trigger would be lost. There is no Radix trigger here
  // to fall back on either.
  useLayoutEffect(() => {
    if (open) previous.current = document.activeElement;
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && closable) onClose();
      }}
    >
      <DialogContent
        overlayClassName={centered ? "items-center" : "items-start pt-[10vh]"}
        overlayStyle={{ zIndex: z }}
        style={{ width, maxWidth: "calc(100vw - 48px)" }}
        // No description: the title names the modal, and what it says is
        // read in order.
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          // Initial focus goes to the content, never the header close
          // button: to what the modal marks `data-autofocus`, else its
          // first field, else its first button.
          const node = event.currentTarget as HTMLElement;
          const target =
            node.querySelector<HTMLElement>("[data-autofocus]") ??
            node.querySelector<HTMLElement>(
              "textarea:not(:disabled), input:not(:disabled), select:not(:disabled)",
            ) ??
            node.querySelector<HTMLElement>('button:not([aria-label="Close"]):not(:disabled)') ??
            node;
          target.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          // Radix hands the focus back a tick after the content is gone:
          // whatever took it meanwhile (the lock screen's field) keeps it.
          const active = document.activeElement;
          if (active !== null && active !== document.body) return;
          (previous.current as HTMLElement | null)?.focus?.();
        }}
        onEscapeKeyDown={(event) => {
          // The modal owns Escape while it is on top: nothing under it
          // (a menu, the update notice) closes as well.
          event.stopPropagation();
          if (!closable) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (!closable) event.preventDefault();
        }}
      >
        <header className="flex items-center justify-between border-b border-border px-6 py-4">
          <DialogTitle asChild>
            <h1>{title}</h1>
          </DialogTitle>
          <DialogClose asChild>
            <IconButton label="Close" disabled={!closable}>
              <X size={20} strokeWidth={1.5} aria-hidden />
            </IconButton>
          </DialogClose>
        </header>
        {/* A layer of its own: a price shown here is credited here,
            and the page's credit waits under the dim. */}
        <CreditLayer>
          <div className="max-h-[76vh] overflow-y-auto px-6 py-5">{children}</div>
          <CreditSlot className="border-t border-border px-6 py-2 text-right" />
        </CreditLayer>
      </DialogContent>
    </Dialog>
  );
}
