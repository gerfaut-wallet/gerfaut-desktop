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

interface BackendSave {
  saving: BackendSaving | null;
  ask: BackendAsk | null;
  /** Why the core would not store the backend of `network`, in its own
      words: said under Save backend. */
  refusal: { network: Network; message: string } | null;
}

export const useBackendSave = create<BackendSave>(() => ({
  saving: null,
  ask: null,
  refusal: null,
}));
