import { useUi } from "../state/store";

/** Benign confirmations only ("Copied", "Setting saved"). Anything that
    matters never auto-dismisses — alerts are banners, not toasts. */
export function Toast() {
  const toast = useUi((s) => s.toast);
  if (!toast) return null;
  return (
    <output
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md bg-[#0d1317] px-4 py-2 font-ui text-sm text-[#e6ecf2]"
    >
      {toast}
    </output>
  );
}
