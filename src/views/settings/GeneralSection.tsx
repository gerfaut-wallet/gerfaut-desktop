import { Coins, Monitor, Moon, Sun, SunMoon } from "lucide-react";
import { useCreditFor } from "../../components/PriceCredit";
import { Select } from "../../components/Select";
import type { CurrencyReach } from "../../lib/ipc";
import { formatCurrency, relativeTime } from "../../lib/format";
import { liveAnswer, torDown, useFiatRate, usePriceTable } from "../../state/queries";
import { useUi } from "../../state/store";
import type { ThemePref } from "../../state/store";
import { SectionCard, Segmented, SettingRow, Toggle } from "./primitives";

/** The heading each currency is listed under: how many sources quote
    it, as the core's table says. */
const REACH_GROUP: Record<CurrencyReach, string> = {
  every: "Every source",
  coingecko_only: "CoinGecko only",
};

/** How the app reads: amounts and theme. */
export function GeneralSection() {
  return (
    <>
      <DisplayCard />
      <AppearanceCard />
    </>
  );
}

/** Unit, fiat value, currency and price source: how amounts read. */
function DisplayCard() {
  const {
    unit,
    setUnit,
    fiatEnabled,
    setFiatEnabled,
    fiatCurrency,
    setFiatCurrency,
    fiatSource,
    setFiatSource,
  } = useUi();
  // What is on offer, in the core's order: the currencies with the
  // sources that quote each, and the sources by name.
  const table = usePriceTable().data;
  const chosen = table?.currencies.find((entry) => entry.currency === fiatCurrency);
  const quotedBy = chosen?.sources ?? [];

  return (
    <SectionCard icon={<Coins size={18} strokeWidth={1.5} />} title="Display">
      <div className="flex flex-col gap-4">
        <SettingRow title="Unit" hint="Applies to every amount in the app.">
          <Segmented
            label="Amount unit"
            value={unit}
            onChange={setUnit}
            options={[
              { value: "btc", label: "BTC" },
              { value: "sats", label: "sats" },
            ]}
          />
        </SettingRow>
        <SettingRow
          title="Fiat value"
          hint="Shows the fiat value next to every amount."
        >
          <Toggle checked={fiatEnabled} onChange={setFiatEnabled} label="Show fiat value" />
        </SettingRow>
        <SettingRow
          title="Currency"
          hint="Used by the fiat value and the overview price."
        >
          <Select
            id="fiat-currency"
            label="Fiat currency"
            size="sm"
            // The list is wider than the field, which ends its row at the
            // card's right edge: kept to that edge, it opens leftwards
            // instead of running past the card and the window.
            align="end"
            className="w-40"
            value={fiatCurrency}
            onChange={setFiatCurrency}
            options={(table?.currencies ?? []).map((entry) => ({
              value: entry.currency,
              label: entry.code,
              hint: entry.name,
              group: REACH_GROUP[entry.reach],
            }))}
          />
        </SettingRow>
        <div>
          <SettingRow
            title="Price source"
            hint="Serves the fiat value and the overview price."
          >
            <Segmented
              label="Price source"
              value={fiatSource}
              onChange={setFiatSource}
              options={(table?.sources ?? []).map((entry) => ({
                value: entry.source,
                label: entry.label,
                disabled: !quotedBy.includes(entry.source),
              }))}
            />
          </SettingRow>
          {chosen?.reach === "coingecko_only" && (
            <p className="mt-1.5 font-ui text-xs text-muted">
              CoinGecko is the only source that quotes{" "}
              {chosen.code}.
            </p>
          )}
        </div>
        {fiatEnabled && <RatePreview />}
      </div>
    </SectionCard>
  );
}

/** The theme: light by default, dark, or the system's. */
function AppearanceCard() {
  const { theme, setTheme } = useUi();

  return (
    <SectionCard icon={<SunMoon size={18} strokeWidth={1.5} />} title="Appearance">
      <SettingRow title="Theme">
        <Segmented
          label="Theme"
          value={theme}
          onChange={(value) => setTheme(value as ThemePref)}
          options={[
            {
              value: "light",
              label: "Light",
              icon: <Sun size={15} strokeWidth={1.5} />,
            },
            {
              value: "dark",
              label: "Dark",
              icon: <Moon size={15} strokeWidth={1.5} />,
            },
            {
              value: "system",
              label: "System",
              icon: <Monitor size={15} strokeWidth={1.5} />,
            },
          ]}
        />
      </SettingRow>
    </SectionCard>
  );
}

function RatePreview() {
  const rate = useFiatRate();
  const { fiatCurrency } = useUi();
  // The line says what the amounts do: the same answer, by the same
  // rule, or the reason they show none.
  const quote = liveAnswer(rate, fiatCurrency);
  // The rate on screen is the source's: the screen credits it.
  useCreditFor(quote?.source);
  if (rate.isError) {
    return (
      <p className="font-ui text-xs text-pending">
        {torDown(rate.error)
          ? "Tor is not available, so no price was asked. Amounts show without fiat until it is."
          : "The price source did not answer. Amounts show without fiat until it does."}
      </p>
    );
  }
  if (!quote) {
    return <p className="font-ui text-xs text-muted">Fetching the current price…</p>;
  }
  // The price itself, not a wallet's amount: it stays what bitcoin
  // fetches whichever network is open.
  return (
    <p className="tabular text-xs text-muted">
      1 BTC = {formatCurrency(quote.rate, fiatCurrency)} · updated {relativeTime(quote.at)}
    </p>
  );
}
