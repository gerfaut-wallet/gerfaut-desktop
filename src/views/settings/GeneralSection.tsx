import { Coins, Monitor, Moon, Sun, SunMoon } from "lucide-react";
import { Select } from "../../components/Select";
import { COINGECKO_ONLY_CURRENCIES, SHARED_CURRENCIES, quotesCurrency } from "../../lib/ipc";
import type { FiatCurrency, PriceSource } from "../../lib/ipc";
import { formatFiat, relativeTime } from "../../lib/format";
import { useFiatRate } from "../../state/queries";
import { useUi } from "../../state/store";
import type { ThemePref } from "../../state/store";
import { SectionCard, Segmented, SettingRow, Toggle } from "./primitives";

/** Plain names beside the codes: a list of thirty triplets is not a
    list anyone can read. */
const CURRENCY_NAME: Record<FiatCurrency, string> = {
  eur: "Euro",
  usd: "US dollar",
  gbp: "Pound sterling",
  chf: "Swiss franc",
  jpy: "Japanese yen",
  cad: "Canadian dollar",
  aud: "Australian dollar",
  inr: "Indian rupee",
  cny: "Chinese yuan",
  brl: "Brazilian real",
  ngn: "Nigerian naira",
  idr: "Indonesian rupiah",
  pkr: "Pakistani rupee",
  bdt: "Bangladeshi taka",
  rub: "Russian ruble",
  mxn: "Mexican peso",
  php: "Philippine peso",
  vnd: "Vietnamese dong",
  try: "Turkish lira",
  ars: "Argentine peso",
  krw: "South Korean won",
  zar: "South African rand",
  thb: "Thai baht",
  uah: "Ukrainian hryvnia",
  pln: "Polish zloty",
  sek: "Swedish krona",
  sgd: "Singapore dollar",
  hkd: "Hong Kong dollar",
  aed: "UAE dirham",
  nzd: "New Zealand dollar",
};

const PRICE_SOURCES: { value: PriceSource; label: string }[] = [
  { value: "coingecko", label: "CoinGecko" },
  { value: "kraken", label: "Kraken" },
  { value: "mempool_space", label: "mempool.space" },
];

/** Unit, fiat value, currency and price source: how amounts read. */
export function DisplayCard() {
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
          hint="Used by the fiat value and the overview price chart."
        >
          <Select
            id="fiat-currency"
            label="Fiat currency"
            size="sm"
            className="w-40"
            value={fiatCurrency}
            onChange={setFiatCurrency}
            options={[
              ...SHARED_CURRENCIES.map((currency) => ({
                value: currency,
                label: currency.toUpperCase(),
                hint: CURRENCY_NAME[currency],
                group: "Every source",
              })),
              ...COINGECKO_ONLY_CURRENCIES.map((currency) => ({
                value: currency,
                label: currency.toUpperCase(),
                hint: CURRENCY_NAME[currency],
                group: "CoinGecko only",
              })),
            ]}
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
              options={PRICE_SOURCES.map((source) => ({
                ...source,
                disabled: !quotesCurrency(source.value, fiatCurrency),
              }))}
            />
          </SettingRow>
          {!quotesCurrency("kraken", fiatCurrency) && (
            <p className="mt-1.5 font-ui text-xs text-muted">
              CoinGecko is the only source that quotes{" "}
              {fiatCurrency.toUpperCase()}.
            </p>
          )}
          {/* Required by the CoinGecko API terms whenever their data
              is on screen. */}
          {fiatSource === "coingecko" && (
            <p className="mt-1.5 font-ui text-[11px] text-muted">Powered by CoinGecko</p>
          )}
        </div>
        {fiatEnabled && <RatePreview />}
      </div>
    </SectionCard>
  );
}

/** The theme: light by default, dark, or the system's. */
export function AppearanceCard() {
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
  if (rate.isPending) {
    return <p className="font-ui text-xs text-muted">Fetching the current price…</p>;
  }
  if (rate.isError || !rate.data) {
    return (
      <p className="font-ui text-xs text-pending">
        The price source did not answer. Amounts show without fiat until it does.
      </p>
    );
  }
  return (
    <p className="tabular text-xs text-muted">
      1 BTC = {formatFiat(100_000_000, rate.data.rate, fiatCurrency)} · updated{" "}
      {relativeTime(rate.data.at)}
    </p>
  );
}
