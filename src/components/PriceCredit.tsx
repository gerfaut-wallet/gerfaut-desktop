import { clsx } from "clsx";

/** The credit a price source asks for under its data, word for word as
    the core hands it over with the price: "Powered by CoinGecko", and
    nothing at all for mempool.space, which asks for none. Once per
    screen, under what it credits, in the muted voice at 12px: legible
    without competing with the figures. */
export function PriceCredit({
  credit,
  className,
}: {
  credit: string | null | undefined;
  className?: string;
}) {
  if (!credit) return null;
  return <p className={clsx("font-ui text-xs text-muted", className)}>{credit}</p>;
}
