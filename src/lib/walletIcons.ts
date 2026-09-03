// The glyph a wallet wears, wherever its name is shown: the switcher,
// the settings rows, the picker. One map, so no view draws its own.

import { Key, Landmark, MapPin, PiggyBank, Shield, Snowflake, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { WalletIconId } from "./ipc";

/** The Lucide icon behind each id the core stores. */
export const WALLET_ICON: Record<WalletIconId, LucideIcon> = {
  wallet: Wallet,
  key: Key,
  shield: Shield,
  map_pin: MapPin,
  snowflake: Snowflake,
  landmark: Landmark,
  piggy_bank: PiggyBank,
};

/** How each icon is named, to a screen reader and in a tooltip. */
export const WALLET_ICON_LABEL: Record<WalletIconId, string> = {
  wallet: "Wallet",
  key: "Key",
  shield: "Shield",
  map_pin: "Pin",
  snowflake: "Snowflake",
  landmark: "Landmark",
  piggy_bank: "Piggy bank",
};

/** The glyph of a wallet, the plain wallet for anything unknown. */
export function walletGlyph(icon: WalletIconId): LucideIcon {
  return WALLET_ICON[icon] ?? Wallet;
}
