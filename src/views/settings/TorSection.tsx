import { VenetianMask } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/Button";
import type { TorMode, TorRoute, TorSettings } from "../../lib/ipc";
import { ipc, isCommandError } from "../../lib/ipc";
import { keys } from "../../state/queries";
import { FieldLabel, SectionCard, Segmented } from "./primitives";

/** The Tor modes as the settings name them; the backend form borrows
    the label when a scanned address turns out to be an onion. */
export const TOR_MODES: { value: TorMode; label: string }[] = [
  { value: "auto", label: "Automatic" },
  { value: "system", label: "System Tor" },
  { value: "embedded", label: "Built-in" },
];

const HINT: Record<TorMode, string> = {
  auto: "The Tor on this machine if it answers, the built-in one otherwise.",
  system: "Only the Tor on this machine, at the address below.",
  embedded: "Only the built-in Tor. The first connection takes a little longer while it starts.",
};

/** The settings card for how `.onion` backends reach Tor. */
export function TorSection({ tor }: { tor: TorSettings }) {
  const client = useQueryClient();
  const [proxy, setProxy] = useState(tor.socks_proxy ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [route, setRoute] = useState<TorRoute | null>(null);

  // Read on demand: nothing is probed or started until asked.
  const status = useQuery({ queryKey: ["tor-status"], queryFn: ipc.torStatus });
  const embedded = status.data?.embedded_available ?? false;

  const save = useMutation({
    mutationFn: (next: TorSettings) => ipc.setTorSettings(next),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.settings });
      void client.invalidateQueries({ queryKey: ["tor-status"] });
    },
  });

  const connect = useMutation({
    mutationFn: () => ipc.torConnect(),
    onSuccess: (found) => {
      setRoute(found);
      setProblem(null);
      void client.invalidateQueries({ queryKey: ["tor-status"] });
    },
    onError: (error) => {
      setRoute(null);
      setProblem(isCommandError(error) ? error.message : String(error));
    },
  });

  const apply = (next: Partial<TorSettings>) => {
    setRoute(null);
    setProblem(null);
    save.mutate(
      { mode: tor.mode, socks_proxy: tor.socks_proxy, ...next },
      {
        onError: (error) =>
          setProblem(isCommandError(error) ? error.message : String(error)),
      },
    );
  };

  return (
    <SectionCard icon={<VenetianMask size={18} strokeWidth={1.5} />} title="Tor">
      <p className="font-ui text-sm text-muted">
        {embedded
          ? "An address ending in .onion goes through Tor. Gerfaut uses the Tor already running on this machine when there is one, and starts its own otherwise."
          : "An address ending in .onion goes through Tor. This build has no Tor of its own: start Tor or the Tor Browser first."}
      </p>

      <div className="mt-4 flex flex-col gap-4">
        <div>
          <FieldLabel>Tor</FieldLabel>
          <Segmented
            label="Tor"
            value={tor.mode}
            onChange={(value) => apply({ mode: value as TorMode })}
            options={TOR_MODES.map((mode) => ({
              ...mode,
              // Nothing built in means nothing to choose.
              disabled: !embedded && mode.value === "embedded",
            }))}
          />
          <p className="mt-1.5 font-ui text-xs text-muted">{HINT[tor.mode]}</p>
        </div>

        {tor.mode !== "embedded" && (
          <div>
            <FieldLabel htmlFor="tor-proxy">SOCKS address</FieldLabel>
            <input
              id="tor-proxy"
              type="text"
              spellCheck={false}
              autoComplete="off"
              value={proxy}
              placeholder={status.data?.socks_proxy ?? "127.0.0.1:9050"}
              onChange={(event) => setProxy(event.target.value)}
              onBlur={() => {
                const next = proxy.trim();
                if (next === (tor.socks_proxy ?? "")) return;
                apply({ socks_proxy: next === "" ? null : next });
              }}
              className="field-focus h-11 w-full max-w-xs rounded-sm border border-transparent bg-sunken px-3 font-data text-[13px] text-text placeholder:text-muted"
            />
            <p className="mt-1.5 font-ui text-xs text-muted">
              Empty means 127.0.0.1:9050. The Tor Browser listens on 9150.
            </p>
          </div>
        )}

        {route && (
          <p className="font-ui text-xs text-muted">
            Reached through the {route.via === "system" ? "system Tor" : "built-in Tor"}.
          </p>
        )}
        {problem && <p className="font-ui text-xs text-muted">{problem}</p>}

        <div>
          <Button
            variant="secondary"
            disabled={connect.isPending}
            onClick={() => connect.mutate()}
          >
            {connect.isPending ? "Connecting…" : "Test the connection"}
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}
