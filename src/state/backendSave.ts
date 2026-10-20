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
}

export const useBackendSave = create<BackendSave>(() => ({
  saving: null,
  ask: null,
  refusals: {},
}));

/** Says why `config` was not stored for `network`. */
export function refuseBackend(network: Network, config: BackendConfig, message: string) {
  useBackendSave.setState((state) => ({
    refusals: { ...state.refusals, [network]: { config, message } },
  }));
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
