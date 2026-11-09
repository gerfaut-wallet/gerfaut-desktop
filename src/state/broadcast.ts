import type { RecentBroadcast, TxPreview } from "../lib/ipc";

/* The broadcast page as one value. It used to be read off a preview
   mutation, a send mutation and a `sent` record side by side, and a
   send still in flight when the page was cleared put its card back over
   whatever had been read since. Here every step that starts a request
   or drops one takes a new ticket, each request carries the ticket it
   was started under, and an answer under any other ticket is dropped:
   the transaction still goes out, the vault lists it with the past
   broadcasts, but it no longer takes the screen. */

/** Why the field turned the input down: a file refused before it was
    read, or the core's refusal of what it was given. */
export type InputRefusal = { kind: "file"; message: string } | { kind: "core"; error: unknown };

export type BroadcastFlow =
  /** The field, empty or with what was typed, and why the last input
      was turned down, if it was. */
  | { phase: "compose"; ticket: number; refusal: InputRefusal | null }
  /** The core is reading the input. */
  | { phase: "previewing"; ticket: number }
  /** What the transaction does, and the network's refusal of the last
      send, if it refused. */
  | { phase: "ready"; ticket: number; preview: TxPreview; refusal: unknown }
  | { phase: "sending"; ticket: number; preview: TxPreview }
  /** The network took it: the record the status card follows. */
  | { phase: "sent"; ticket: number; preview: TxPreview; entry: RecentBroadcast };

/** What happens to the page. A step that starts a request or drops one
    brings a ticket no step of the page had before; an answer
    brings the ticket its request was started under. */
export type BroadcastEvent =
  /** Start over, or another network: back to an empty field. */
  | { type: "reset"; ticket: number }
  /** The field changed: a refusal of what it held goes. */
  | { type: "edit" }
  | { type: "fileRefused"; ticket: number; message: string }
  | { type: "preview"; ticket: number }
  | { type: "previewed"; ticket: number; preview: TxPreview }
  | { type: "previewFailed"; ticket: number; error: unknown }
  | { type: "send"; ticket: number }
  | { type: "sent"; ticket: number; entry: RecentBroadcast }
  | { type: "sendFailed"; ticket: number; error: unknown };

export const FIRST_FLOW: BroadcastFlow = { phase: "compose", ticket: 0, refusal: null };

/** The one transition of the page. A request's answer applies only
    under the ticket it was started with, and in the phase that waits
    for it. */
export function stepBroadcast(flow: BroadcastFlow, event: BroadcastEvent): BroadcastFlow {
  switch (event.type) {
    case "reset":
      return { phase: "compose", ticket: event.ticket, refusal: null };
    case "edit":
      return flow.phase === "compose" && flow.refusal ? { ...flow, refusal: null } : flow;
    case "fileRefused":
      return {
        phase: "compose",
        ticket: event.ticket,
        refusal: { kind: "file", message: event.message },
      };
    case "preview":
      return { phase: "previewing", ticket: event.ticket };
    case "previewed":
      return flow.phase === "previewing" && flow.ticket === event.ticket
        ? { phase: "ready", ticket: flow.ticket, preview: event.preview, refusal: null }
        : flow;
    case "previewFailed":
      return flow.phase === "previewing" && flow.ticket === event.ticket
        ? { phase: "compose", ticket: flow.ticket, refusal: { kind: "core", error: event.error } }
        : flow;
    case "send":
      return flow.phase === "ready"
        ? { phase: "sending", ticket: event.ticket, preview: flow.preview }
        : flow;
    case "sent":
      return flow.phase === "sending" && flow.ticket === event.ticket
        ? { phase: "sent", ticket: flow.ticket, preview: flow.preview, entry: event.entry }
        : flow;
    case "sendFailed":
      return flow.phase === "sending" && flow.ticket === event.ticket
        ? { phase: "ready", ticket: flow.ticket, preview: flow.preview, refusal: event.error }
        : flow;
  }
}
