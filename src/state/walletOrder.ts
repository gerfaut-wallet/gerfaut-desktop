// The order wallets are listed in, held here from the moment one is
// moved until the vault has been read back: the switcher and the
// settings rows both move wallets, and the view doing the moving shows
// it at once rather than after the round trip. The other view follows
// when the list comes back from the vault.

import { useMemo, useState } from "react";
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

  const reorder = (next: WalletMeta[]) => {
    const ids = next.map((wallet) => wallet.id);
    setOrder(ids);
    // The mutation settles once the list has been read back, or once the
    // vault has refused: either way what the vault says is what to show,
    // and the copy goes. A newer move replaces this one's callbacks, so
    // the copy outlives every move but the last.
    reorderWallets.mutate(ids, { onSettled: () => setOrder(null) });
  };

  return { shown, reorder };
}
