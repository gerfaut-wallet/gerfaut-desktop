import { clsx } from "clsx";
import { createContext, useContext, useEffect, useId } from "react";
import type { ReactNode } from "react";
import { create } from "zustand";
import type { PriceSource } from "../lib/ipc";
import { usePriceTable } from "../state/queries";
import { OpenFailure, useOpenExternal } from "./ExternalLink";

/* The credit a price source asks for beside its data ("Powered by
   CoinGecko", as the core's table words it and links it), shown by one
   mechanism for every screen, so that no screen can forget it:

   - whatever shows a price, or an amount a price turned into fiat,
     marks the source of that price while it is on screen
     (`useCreditFor`; `useFiatValue` does it for every fiat amount);
   - each layer of the window, the page or a modal over it, has one
     slot (`CreditSlot`), which shows the credit of what is marked in
     it, once, whatever the number of figures;
   - only the topmost layer shows its slot: under a modal, the page is
     dimmed, and a second credit would stand beside the first. */

interface Credits {
  /** The layers open, oldest first: the page, then each modal over it. */
  layers: string[];
  /** What each layer shows that a source priced, by the part that shows it. */
  marks: Record<string, Record<string, PriceSource>>;
}

const useCredits = create<Credits>(() => ({ layers: [], marks: {} }));

function open(layer: string) {
  useCredits.setState((s) => ({ layers: [...s.layers, layer] }));
}

function close(layer: string) {
  useCredits.setState((s) => {
    const marks = { ...s.marks };
    delete marks[layer];
    return { layers: s.layers.filter((open) => open !== layer), marks };
  });
}

function mark(layer: string, by: string, source: PriceSource) {
  useCredits.setState((s) => ({
    marks: { ...s.marks, [layer]: { ...s.marks[layer], [by]: source } },
  }));
}

function unmark(layer: string, by: string) {
  useCredits.setState((s) => {
    const held = s.marks[layer];
    if (!held || !(by in held)) return s;
    const rest = { ...held };
    delete rest[by];
    return { marks: { ...s.marks, [layer]: rest } };
  });
}

const Layer = createContext<string | null>(null);

/** A layer of the window with a slot of its own: the page, a modal. */
export function CreditLayer({ children }: { children: ReactNode }) {
  const id = useId();
  useEffect(() => {
    open(id);
    return () => close(id);
  }, [id]);
  return <Layer.Provider value={id}>{children}</Layer.Provider>;
}

/** Marks, while the caller is on screen, that it shows a figure
    `source` priced; `null` while it shows none. */
export function useCreditFor(source: PriceSource | null | undefined) {
  const layer = useContext(Layer);
  const by = useId();
  useEffect(() => {
    if (!layer || !source) return;
    mark(layer, by, source);
    return () => unmark(layer, by);
  }, [layer, by, source]);
}

/** The one place a layer shows the credits of what it marked: the
    source's words, opening its page in the browser, in the muted voice
    at 12px, legible without competing with the figures. A button, as
    every other way out of the app: an `<a href>` would let a context
    menu load the page in the app's own window. Nothing at all when no source on screen
    asks for one, or when a layer is open above this one. */
export function CreditSlot({ className }: { className?: string }) {
  const layer = useContext(Layer);
  const top = useCredits((s) => s.layers[s.layers.length - 1]);
  const marks = useCredits((s) => (layer ? s.marks[layer] : undefined));
  if (!layer || top !== layer || !marks) return null;
  const sources = [...new Set(Object.values(marks))];
  if (sources.length === 0) return null;
  return <Credits sources={sources} className={className} />;
}

/** The credits the table gives the sources on screen, as links. Only
    mounted when something on screen was priced: a layer that shows no
    price reads nothing. */
function Credits({ sources, className }: { sources: PriceSource[]; className?: string }) {
  const table = usePriceTable().data;
  const link = useOpenExternal();
  const credits = (table?.sources ?? []).flatMap((entry) =>
    sources.includes(entry.source) && entry.credit ? [entry.credit] : [],
  );
  if (credits.length === 0) return null;
  return (
    <div className={clsx("font-ui text-xs text-muted", className)}>
      {credits.map((credit) => (
        <button
          key={credit.url}
          type="button"
          onClick={() => void link.open(credit.url)}
          className="cursor-pointer underline decoration-border underline-offset-2 transition-colors duration-150 hover:text-text"
        >
          {credit.text}
        </button>
      ))}
      <OpenFailure url={link.failed} className="mt-1 text-left" />
    </div>
  );
}
