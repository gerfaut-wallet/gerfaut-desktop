import type { Network } from "./ipc";

/** Public explorer link for a transaction. Regtest has none. */
export function explorerTxUrl(network: Network, txid: string): string {
  switch (network) {
    case "mainnet":
      return `https://mempool.space/tx/${txid}`;
    case "signet":
      return `https://mempool.space/signet/tx/${txid}`;
    case "testnet4":
      return `https://mempool.space/testnet4/tx/${txid}`;
    case "regtest":
      return "";
  }
}
