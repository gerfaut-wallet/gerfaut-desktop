// The order wallets are listed in, as the vault keeps it, held here
// from the moment one is moved until the vault lists them that way too:
// the switcher and the settings rows both move wallets, and both must
// show the move at once.

import { useEffect, useMemo, useState } from "react";
import type { WalletMeta } from "../lib/ipc";
import { sortByIds } from "../lib/reorder";
import { useReorderWallets } from "./queries";

export function useWalletOrder(wallets: WalletMeta[]): {
  /** The wallets in the order to show them. */
  shown: WalletMeta[];
  /** Shows this order now and asks the vault to keep it. */
  reorder: (next: WalletMeta[]) => void;
} {
  const reorderWallets = useReorderWallets();
  const [order, setOrder] = useState<string[] | null>(null);
  const shown = useMemo(() => (order ? sortByIds(wallets, order) : wallets), [wallets, order]);

  // Once the vault lists them in the order asked for, the copy goes.
  useEffect(() => {
    if (order && wallets.map((wallet) => wallet.id).join() === order.join()) setOrder(null);
  }, [wallets, order]);

  const reorder = (next: WalletMeta[]) => {
    const ids = next.map((wallet) => wallet.id);
    setOrder(ids);
    reorderWallets.mutate(ids, { onError: () => setOrder(null) });
  };

  return { shown, reorder };
}
