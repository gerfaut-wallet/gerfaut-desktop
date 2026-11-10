import { createPortal } from "react-dom";
import { useUi } from "../state/store";

/** Benign confirmations only ("Copied", "Setting saved"). Anything that
    matters never auto-dismisses — alerts are banners, not toasts. */
export function Toast() {
  const toast = useUi((s) => s.toast);
  if (!toast) return null;
  // The inversion (Nuit background, Écume text) comes from the dark
  // island tokens, never from hardcoded values.
  // Beside the modals in the body and above the highest of them: a copy
  // made in a modal is confirmed over its dim, not under it, and a
  // modal opened earlier hides the app from screen readers, which
  // would then never hear the toast.
  return createPortal(
    <output className="shell-rail fixed bottom-6 left-1/2 z-[100] -translate-x-1/2 rounded-md bg-background px-4 py-2 font-ui text-sm text-text">
      {toast}
    </output>,
    document.body,
  );
}
