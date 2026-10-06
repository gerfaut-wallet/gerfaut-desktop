import { Compass, FlaskConical, Info, MessageSquareWarning, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/Button";
import { OpenFailure, useOpenExternal } from "../../components/ExternalLink";
import { Pill } from "../../components/StatusPill";
import { isCommandError } from "../../lib/ipc";
import { isBeta, isUpdate } from "../../lib/version";
import { useCheckUpdate } from "../../state/queries";
import { RELEASES_URL, useUpdate } from "../../state/update";
import { WelcomeTour } from "../WelcomeTour";
import { SectionCard, SettingRow, Toggle } from "./primitives";

export const APP_VERSION = "0.1.0";

/** Where a problem is reported: the issues of this repository, the one
    other address the About card opens. */
export const ISSUES_URL = "https://github.com/gerfaut-wallet/gerfaut-desktop/issues";

/** The version, the way to a newer one, and the tour again.

    Every 0.x version is a public beta: the card says so next to the
    version, with one line on what that asks of you and a button to
    report a problem. Both go away by themselves at 1.0.0.

    A newer release already known, from the daily check or from an
    earlier press of the button, is offered as soon as the card opens:
    this is where the update notice sends people. The download button
    opens the releases page this app names itself, never an address the
    network answered.

    The check takes the route the syncs take, so with an onion backend
    it goes through Tor. When Tor cannot be had nothing is sent, and one
    quiet line says so. */
export function AboutSection() {
  const check = useCheckUpdate();
  const [result, setResult] = useState<"current" | "failed" | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const latest = useUpdate((state) => state.latest);
  const auto = useUpdate((state) => state.auto);
  const arriving = useUpdate((state) => state.arriving);
  const heading = useRef<HTMLHeadingElement>(null);
  const available = latest !== null && isUpdate(latest, APP_VERSION);
  const torUnavailable = useUpdate((state) => state.torUnavailable);
  const link = useOpenExternal();
  const beta = isBeta(APP_VERSION);

  // Sent here by the update notice, whose button is gone by now: the
  // card's heading takes the focus it held.
  useEffect(() => {
    if (!arriving) return;
    heading.current?.focus();
    useUpdate.getState().setArriving(false);
  }, [arriving]);

  return (
    <SectionCard
      icon={<Info size={18} strokeWidth={1.5} />}
      title="About"
      headingRef={heading}
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-ui text-sm text-text">
            Gerfaut {APP_VERSION}
            {beta && (
              <Pill
                tone="pending"
                icon={<FlaskConical size={12} strokeWidth={2} aria-hidden className="shrink-0" />}
              >
                Beta
              </Pill>
            )}
            <span className="font-ui text-xs text-muted">for Windows, macOS, and Linux</span>
          </p>
          <span className="flex flex-wrap items-center gap-3">
            <span role="status" className="font-ui text-xs text-muted">
              {available
                ? `Gerfaut ${latest} is available.`
                : result === "failed"
                  ? "Could not reach the release page. Try again later."
                  : result === "current"
                    ? "You are up to date."
                    : ""}
            </span>
            {available && (
              <Button variant="primary" onClick={() => void link.open(RELEASES_URL)}>
                Get {latest}
              </Button>
            )}
            <Button
              variant="ghost"
              disabled={check.isPending}
              onClick={() =>
                check.mutate(undefined, {
                  onSuccess: (data) => {
                    // Here the answer is on screen already, so the
                    // notice has nothing left to announce.
                    useUpdate.getState().record(data?.latest, { seen: true });
                    useUpdate.getState().setTorUnavailable(false);
                    setResult("current");
                  },
                  onError: (error) => {
                    const tor = isCommandError(error) && error.kind === "tor";
                    useUpdate.getState().setTorUnavailable(tor);
                    setResult(tor ? null : "failed");
                  },
                })
              }
            >
              <RefreshCw
                size={14}
                strokeWidth={1.5}
                aria-hidden
                className={check.isPending ? "motion-safe:animate-spin" : undefined}
              />
              {check.isPending ? "Checking…" : "Check for updates"}
            </Button>
          </span>
        </div>
        {beta && (
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <p className="min-w-0 max-w-md font-ui text-xs text-muted">
              This is a public beta. Check addresses and amounts on your signing device, and report
              anything that looks wrong.
            </p>
            <Button variant="ghost" onClick={() => void link.open(ISSUES_URL)}>
              <MessageSquareWarning size={14} strokeWidth={1.5} aria-hidden />
              Report a problem
            </Button>
          </div>
        )}
        <OpenFailure url={link.failed} className="" />
        <div>
          <SettingRow
            title="Check for updates automatically"
            hint="Asks GitHub for the latest release at most once a day while Gerfaut is unlocked, through Tor when a backend is an onion address, and downloads nothing."
          >
            <Toggle
              checked={auto}
              onChange={(on) => useUpdate.getState().setAuto(on)}
              label="Check for updates automatically"
            />
          </SettingRow>
          {torUnavailable && (
            <p role="status" className="mt-1.5 font-ui text-xs text-muted">
              Tor is not available, so the check was not sent.
            </p>
          )}
        </div>
        <div className="-ml-4">
          <Button variant="ghost" onClick={() => setTourOpen(true)}>
            <Compass size={14} strokeWidth={1.5} aria-hidden />
            Show the welcome tour
          </Button>
        </div>
      </div>
      <WelcomeTour open={tourOpen} onClose={() => setTourOpen(false)} beta={beta} />
    </SectionCard>
  );
}
