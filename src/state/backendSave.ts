import { create } from "zustand";
import type { BackendConfig, CertificateReport, Network } from "../lib/ipc";

/* A Save backend outlives the page it was pressed on. Checking an
   Electrum server's certificate takes as long as the server takes to
   answer, or to be given up on, and leaving Settings › Network
   meanwhile used to drop the answer: the certificate to accept was
   never asked about, the choice was lost and nothing said so. Held
   here, out of the form, the save goes on
   wherever the user is: its question opens over the page in view
   (`CertificateAsk`), and the form found again shows the save still
   under way, or why the core would not store it. */

/** The save under way, from Save backend until it is stored, refused,
    or waits on the user. */
export interface BackendSaving {
  network: Network;
  config: BackendConfig;
  /** The server's certificate is being read: what the button says. */
  checking: boolean;
}

/** A certificate to settle before `config` is stored for `network`. */
export interface BackendAsk {
  network: Network;
  url: string;
  config: BackendConfig;
  report: CertificateReport;
}

/** Why the core would not store `config`, in its own words: said under
    Save backend, beside the address it refused. */
export interface BackendRefusal {
  config: BackendConfig;
  message: string;
}

interface BackendSave {
  saving: BackendSaving | null;
  ask: BackendAsk | null;
  /** One refusal per network: a refusal on one never hides another's. */
  refusals: Partial<Record<Network, BackendRefusal>>;
  /** The network whose form is on screen, if one is. */
  viewing: Network | null;
  /** A network whose refusal landed while its form was not on screen:
      said over the page in view (`BackendRefusalNotice`), since a
      refusal waiting under a button nobody looks at says nothing. */
  unseen: Network | null;
}

export const useBackendSave = create<BackendSave>(() => ({
  saving: null,
  ask: null,
  refusals: {},
  viewing: null,
  unseen: null,
}));

/** Says why `config` was not stored for `network`: under Save backend,
    and over the page in view when that form is not on screen. */
export function refuseBackend(network: Network, config: BackendConfig, message: string) {
  useBackendSave.setState((state) => ({
    refusals: { ...state.refusals, [network]: { config, message } },
    unseen: state.viewing === network ? state.unseen : network,
  }));
}

/** The form of `network` is on screen: what it shows needs no other
    word. Returns what to call when it leaves. */
export function viewBackendForm(network: Network) {
  useBackendSave.setState((state) => ({
    viewing: network,
    unseen: state.unseen === network ? null : state.unseen,
  }));
  return () =>
    useBackendSave.setState((state) => (state.viewing === network ? { viewing: null } : state));
}

/** Takes the refusal of `network` back, and that one only. */
export function clearBackendRefusal(network: Network) {
  useBackendSave.setState((state) => {
    if (!(network in state.refusals)) return state;
    const refusals = { ...state.refusals };
    delete refusals[network];
    return { refusals };
  });
}
