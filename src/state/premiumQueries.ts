// Server-state hooks of the premium section. One place names the cache
// keys, and one rule holds them all: nothing is asked of the server
// until a key is set.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import type { ChannelKind, Device } from "../lib/ipc";
import { ipc } from "../lib/ipc";
import { TIMING } from "../lib/premium";
import { keys } from "./queries";

export const premiumKeys = {
  status: ["premium", "status"] as const,
  device: ["premium", "device"] as const,
  devices: ["premium", "devices"] as const,
  account: ["premium", "account"] as const,
  wallets: ["premium", "wallets"] as const,
  channels: ["premium", "channels"] as const,
  events: ["premium", "events"] as const,
};

/** What the vault says, without a network. */
export function usePremiumStatus(enabled = true) {
  return useQuery({ queryKey: premiumKeys.status, queryFn: ipc.premiumStatus, enabled });
}

/** This device as the server sees it: whether it has full access or
    waits for approval, and until when. Connecting a vault written
    before devices existed happens on the way, on the Rust side. */
export function usePremiumDevice(enabled: boolean) {
  return useQuery({
    queryKey: premiumKeys.device,
    queryFn: ipc.premiumDevice,
    enabled,
    retry: false,
    staleTime: TIMING.devicesFocusMs,
  });
}

/** Every device of the account, for a device with full access. Shared
    by the Devices card and the banner on the Overview; the Rust side
    posts the notification for a newly pending one on the way, and asks
    again on its own every five minutes. */
export function usePremiumDevices(enabled: boolean) {
  return useQuery({
    queryKey: premiumKeys.devices,
    queryFn: ipc.premiumDevices,
    enabled,
    retry: false,
    staleTime: TIMING.devicesFocusMs,
  });
}

/** The account from the server, refreshing the certificate on the way. */
export function usePremiumAccount(enabled: boolean) {
  return useQuery({
    queryKey: premiumKeys.account,
    queryFn: ipc.premiumAccount,
    enabled,
    retry: false,
  });
}

/** Whether any of the server's wallets is still in its first scan. */
export function anyScanning(wallets: { baseline_at: number | null }[] | undefined): boolean {
  return (wallets ?? []).some((wallet) => wallet.baseline_at === null);
}

/** The wallets the server watches. While one scans, the list is asked
    again every five seconds for two minutes, then rests: a scan that
    long is the server's to explain, and a hand refresh is one click. */
export function usePremiumWallets(enabled: boolean) {
  const scanningSince = useRef<number | null>(null);
  return useQuery({
    queryKey: premiumKeys.wallets,
    queryFn: ipc.premiumWallets,
    enabled,
    retry: false,
    refetchInterval: (query) => {
      if (!anyScanning(query.state.data)) {
        scanningSince.current = null;
        return false;
      }
      scanningSince.current ??= Date.now();
      return Date.now() - scanningSince.current < TIMING.pollWindowMs
        ? TIMING.walletPollMs
        : false;
    },
  });
}

/** Whether a Telegram channel still waits for its code to reach the bot. */
export function anyWaitingForBot(
  channels: { kind: ChannelKind; linked: boolean }[] | undefined,
): boolean {
  return (channels ?? []).some((channel) => channel.kind === "telegram" && !channel.linked);
}

/** The account's channels. While a Telegram code waits for the bot, the
    list is asked again every three seconds for two minutes. */
export function usePremiumChannels(enabled: boolean) {
  const waitingSince = useRef<number | null>(null);
  return useQuery({
    queryKey: premiumKeys.channels,
    queryFn: ipc.premiumChannels,
    enabled,
    retry: false,
    refetchInterval: (query) => {
      if (!anyWaitingForBot(query.state.data)) {
        waitingSince.current = null;
        return false;
      }
      waitingSince.current ??= Date.now();
      return Date.now() - waitingSince.current < TIMING.pollWindowMs
        ? TIMING.telegramPollMs
        : false;
    },
  });
}

/** The last twenty events, newest first. */
export function usePremiumEvents(enabled: boolean) {
  return useQuery({
    queryKey: premiumKeys.events,
    queryFn: ipc.premiumEvents,
    enabled,
    retry: false,
  });
}

/** Everything the premium section shows is read again: the status the
    vault holds, and what the server says. */
function useInvalidatePremium() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ["premium"] });
    // The settings carry the same state, for the heartbeat's sake.
    void client.invalidateQueries({ queryKey: keys.settings });
  };
}

export function useActivatePremium() {
  const invalidate = useInvalidatePremium();
  return useMutation({
    mutationFn: (key: string) => ipc.premiumActivate(key),
    onSuccess: invalidate,
  });
}

/** Everything the old key was worth showing, dropped: what the server
    said about it is not ours to show once it is not ours. */
function forgetServerState(client: ReturnType<typeof useQueryClient>) {
  client.removeQueries({ queryKey: premiumKeys.device });
  client.removeQueries({ queryKey: premiumKeys.devices });
  client.removeQueries({ queryKey: premiumKeys.account });
  client.removeQueries({ queryKey: premiumKeys.wallets });
  client.removeQueries({ queryKey: premiumKeys.channels });
  client.removeQueries({ queryKey: premiumKeys.events });
}

/** Deletes the account on the server — the wallets it watches, the
    channels it tells, the key itself — and then forgets it here. The
    core does the second half only once the server confirmed the first,
    so a failed call leaves the key where it was. */
export function useDeleteAccount() {
  const client = useQueryClient();
  const invalidate = useInvalidatePremium();
  return useMutation({
    mutationFn: (secret: string) => ipc.premiumDeleteAccount(secret),
    onSuccess: () => {
      forgetServerState(client);
      invalidate();
    },
  });
}

export function useForgetPremium() {
  const client = useQueryClient();
  const invalidate = useInvalidatePremium();
  return useMutation({
    mutationFn: (secret?: string) => ipc.premiumForget(secret),
    onSuccess: () => {
      forgetServerState(client);
      invalidate();
    },
  });
}

export function useWatchWallet() {
  const invalidate = useInvalidatePremium();
  return useMutation({
    mutationFn: (id: string) => ipc.premiumWatchWallet(id),
    // The consent is written before the request goes out: read it back
    // whatever the server answered.
    onSettled: invalidate,
  });
}

/** Ends the server's watch of a wallet. The core withdraws the consent
    with it, so the status is read again along with the server's lists,
    and the settings too: the switch asks the question again on the way
    back, and a removal no longer says the server hears about it. */
export function useUnwatchWallet() {
  const invalidate = useInvalidatePremium();
  return useMutation({
    mutationFn: (args: { id: string; secret: string }) =>
      ipc.premiumUnwatchWallet(args.id, args.secret),
    onSuccess: invalidate,
  });
}

export function useAddChannel() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      kind: ChannelKind;
      target?: string;
      secret?: string;
      identity?: string;
    }) => ipc.premiumAddChannel(args.kind, args.target, args.secret, args.identity),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: premiumKeys.channels });
      void client.invalidateQueries({ queryKey: premiumKeys.account });
    },
  });
}

/** Sends back the code the server e-mailed, which is what turns an
    e-mail channel on: nothing is written to an address before its owner
    proved they read it. */
export function useConfirmChannel() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; code: string }) =>
      ipc.premiumConfirmChannel(args.id, args.code),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: premiumKeys.channels });
      void client.invalidateQueries({ queryKey: premiumKeys.account });
    },
  });
}

export function useDeleteChannel() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; secret: string }) =>
      ipc.premiumDeleteChannel(args.id, args.secret),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: premiumKeys.channels });
      void client.invalidateQueries({ queryKey: premiumKeys.account });
    },
  });
}

export function useTestChannel() {
  return useMutation({ mutationFn: (id: string) => ipc.premiumTestChannel(id) });
}

/** Connects this device again with the key the vault keeps, after the
    server disconnected it. */
export function useReconnectPremium() {
  const client = useQueryClient();
  const invalidate = useInvalidatePremium();
  return useMutation({
    mutationFn: () => ipc.premiumReconnect(),
    onSuccess: () => {
      forgetServerState(client);
      invalidate();
    },
  });
}

/** Gives a pending device full access at once. */
export function useApproveDevice() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; secret: string }) =>
      ipc.premiumApproveDevice(args.id, args.secret),
    onSuccess: (approved) => {
      client.setQueryData<Device[]>(premiumKeys.devices, (devices) =>
        devices?.map((device) => (device.id === approved.id ? approved : device)),
      );
      void client.invalidateQueries({ queryKey: premiumKeys.devices });
    },
  });
}

/** Refuses a pending device, or disconnects one with full access: the
    server drops it either way. */
export function useRemoveDevice() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; secret: string }) =>
      ipc.premiumRemoveDevice(args.id, args.secret),
    onSuccess: (_, { id }) => {
      client.setQueryData<Device[]>(premiumKeys.devices, (devices) =>
        devices?.filter((device) => device.id !== id),
      );
      void client.invalidateQueries({ queryKey: premiumKeys.devices });
    },
  });
}

/** Replaces the key: the old one stops working everywhere and every
    other device is disconnected. Answers the new key as it is shown. */
export function useChangeKey() {
  const invalidate = useInvalidatePremium();
  return useMutation({
    mutationFn: (secret: string) => ipc.premiumChangeKey(secret),
    onSuccess: invalidate,
  });
}

export function useSetKeySaved() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (saved: boolean) => ipc.premiumSetKeySaved(saved),
    onSuccess: (status) => client.setQueryData(premiumKeys.status, status),
  });
}

export function useHideChecklist() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => ipc.premiumHideChecklist(),
    onSuccess: (status) => client.setQueryData(premiumKeys.status, status),
  });
}

export function useAcknowledgeOffline() {
  const invalidate = useInvalidatePremium();
  return useMutation({
    mutationFn: () => ipc.premiumAcknowledgeOffline(),
    onSuccess: invalidate,
  });
}
