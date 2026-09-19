import { Eye, Lock, Plus, Server } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { clsx } from "clsx";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { useUi } from "../state/store";
import mark from "../assets/gerfaut-mark.svg";

interface Step {
  icon: ReactNode;
  title: string;
  body: string;
}

/** What Gerfaut says about itself, once, on a vault that holds nothing
    yet. Four facts, in the order they matter. */
const STEPS: Step[] = [
  {
    icon: <Eye size={32} strokeWidth={1.5} aria-hidden />,
    title: "Watch, never spend",
    body: "Gerfaut holds no private key and signs nothing. It watches the wallets you give it: a descriptor, an extended public key, an address.",
  },
  {
    icon: <Plus size={32} strokeWidth={1.5} aria-hidden />,
    title: "Add a wallet",
    body: "Paste it, scan a QR code or open a file. Gerfaut says what it recognized before it stores anything.",
  },
  {
    icon: <Server size={32} strokeWidth={1.5} aria-hidden />,
    title: "Choose who you talk to",
    body: "Public servers by default, or your own node: Esplora or Electrum, over Tor if you like.",
  },
  {
    icon: <Lock size={32} strokeWidth={1.5} aria-hidden />,
    title: "Keep it yours",
    body: "Lock the app, back up your list of wallets, and get told when a transaction lands.",
  },
];

/** The welcome tour: shown on a first launch, replayable from the
    settings, and dismissible at any point. */
export function WelcomeTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const setOnboardingSeen = useUi((state) => state.setOnboardingSeen);
  const markTourSeen = useUi((state) => state.markTourSeen);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  const done = () => {
    setOnboardingSeen(true);
    markTourSeen();
    onClose();
  };
  const last = step === STEPS.length - 1;
  const current = STEPS[step];

  return (
    <Modal open={open} onClose={done} title="Welcome" width={520} centered>
      <div
        className="flex flex-col items-center gap-5 px-6 pb-2 text-center"
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" && !last) setStep(step + 1);
          if (event.key === "ArrowLeft" && step > 0) setStep(step - 1);
        }}
      >
        {step === 0 ? (
          <img src={mark} alt="Gerfaut" className="h-16 w-16" />
        ) : (
          <span className="flex size-16 items-center justify-center rounded-full bg-sunken text-primary">
            {current.icon}
          </span>
        )}
        <h2 className="font-display text-2xl font-semibold text-text">{current.title}</h2>
        <p className="max-w-sm font-ui text-sm text-muted">{current.body}</p>

        <div className="flex gap-1.5" aria-hidden>
          {STEPS.map((_, index) => (
            <span
              key={index}
              className={clsx(
                "size-1.5 rounded-full",
                index === step ? "bg-primary" : "bg-border",
              )}
            />
          ))}
        </div>

        <div className="flex w-full items-center pt-2">
          {/* A page one can only leave or step past is re-read by
              starting over: Back takes the left from the second page on.
              Skip is pushed to the far side of the row — of these two
              ghost buttons one only steps back and the other retires
              the tour for good, and four pixels is all a slip needs. */}
          {step > 0 && (
            <Button variant="ghost" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          <div className="ml-auto flex items-center gap-3">
            <Button variant="ghost" onClick={done}>
              Skip
            </Button>
            <Button
              variant="primary"
              onClick={() => (last ? done() : setStep(step + 1))}
            >
              {last ? "Get started" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
