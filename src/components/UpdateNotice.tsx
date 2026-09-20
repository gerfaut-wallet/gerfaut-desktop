import { CircleArrowUp } from "lucide-react";
import { useEffect, useRef } from "react";
import { useUi } from "../state/store";
import { pendingUpdate, useUpdate } from "../state/update";
import { APP_VERSION } from "../views/settings/AboutSection";
import { Button } from "./Button";

/** Says once that a newer Gerfaut exists, in a strip at the top of the
 *  canvas.
 *
 *  It is a piece of information and behaves like one. It takes no
 *  focus, dims nothing and blocks nothing. It is part of the layout and
 *  floats over nothing: the page below moves down by its height, so it
 *  can never sit on an amount, a transaction or an address, whatever
 *  the page and the width of the window. It comes before the page in
 *  the tab order, where it sits on screen. "Later" closes it for this
 *  version, and so does Escape when the keyboard is on the notice or on
 *  nothing at all: a menu, a field or a dialog that holds the focus
 *  keeps its own Escape. It does not leave on a timer, since what
 *  matters never does.
 *
 *  It only ever lives in the unlocked shell, so the lock screen never
 *  shows it, and it stays away from Settings › About, which says the
 *  same thing with the download beside it. */
export function UpdateNotice() {
  const version = useUpdate((state) => pendingUpdate(state, APP_VERSION));
  const onAbout = useUi((state) => state.view === "settings" && state.settingsSection === "about");
  const ref = useRef<HTMLElement>(null);
  const shown = version !== null && !onAbout;

  useEffect(() => {
    if (!shown) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const focused = document.activeElement;
      const idle = focused === null || focused === document.body;
      if (!idle && !ref.current?.contains(focused)) return;
      useUpdate.getState().dismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shown]);

  if (!shown) return null;

  const open = () => {
    const update = useUpdate.getState();
    update.setArriving(true);
    update.dismiss();
    useUi.getState().openSettings("about");
  };

  return (
    <section
      ref={ref}
      aria-label="Update available"
      className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface px-6 py-2"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span className="flex h-5 shrink-0 items-center text-muted">
          <CircleArrowUp size={16} strokeWidth={1.5} aria-hidden />
        </span>
        <div role="status" className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <p className="font-ui text-sm font-medium leading-5 text-text">
            Gerfaut <span className="tabular">{version}</span> is available
          </p>
          <p className="font-ui text-xs text-muted">
            You are running <span className="tabular">{APP_VERSION}</span>.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 justify-end gap-2">
        <Button variant="ghost" onClick={() => useUpdate.getState().dismiss()}>
          Later
        </Button>
        <Button variant="primary" onClick={open}>
          See the update
        </Button>
      </div>
    </section>
  );
}
