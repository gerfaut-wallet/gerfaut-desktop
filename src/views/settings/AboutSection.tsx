import { Compass, Info, RefreshCw } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { Button } from "../../components/Button";
import type { UpdateCheck } from "../../lib/ipc";
import { useCheckUpdate } from "../../state/queries";
import { WelcomeTour } from "../WelcomeTour";
import { SectionCard } from "./primitives";

const APP_VERSION = "0.1.0";

/** The version, the way to a newer one, and the tour again. */
export function AboutSection() {
  const check = useCheckUpdate();
  const [result, setResult] = useState<UpdateCheck | "failed" | null>(null);
  const [tourOpen, setTourOpen] = useState(false);

  return (
    <SectionCard
      icon={<Info size={18} strokeWidth={1.5} />}
      title="About"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-ui text-sm text-text">
          Gerfaut {APP_VERSION}
          <span className="ml-2 font-ui text-xs text-muted">for Windows, macOS, and Linux</span>
        </p>
        <span className="flex items-center gap-3">
          {result === "failed" && (
            <span className="font-ui text-xs text-muted">
              Could not reach the release page. Try again later.
            </span>
          )}
          {result !== null && result !== "failed" && !result.update_available && (
            <span className="font-ui text-xs text-muted">You are up to date.</span>
          )}
          {result !== null && result !== "failed" && result.update_available && (
            <Button variant="primary" onClick={() => void openUrl(result.url)}>
              Get {result.latest}
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={check.isPending}
            onClick={() =>
              check.mutate(undefined, {
                onSuccess: (data) => setResult(data),
                onError: () => setResult("failed"),
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
      <div className="mt-3">
        <Button variant="ghost" onClick={() => setTourOpen(true)}>
          <Compass size={14} strokeWidth={1.5} aria-hidden />
          Show the welcome tour
        </Button>
      </div>
      <WelcomeTour open={tourOpen} onClose={() => setTourOpen(false)} />
    </SectionCard>
  );
}
