import { RotateCcw } from "lucide-react";
import { Component } from "react";
import type { ReactNode } from "react";
import { Button } from "./Button";
import { Mark } from "./Mark";

/** What a render that threw leaves on screen. Without it, React takes
    the whole tree down and the window stays empty, with no word and no
    way out but closing it. Reloading starts the window again: a vault
    with a lock opens on the lock screen, as at launch, so the curtain
    comes back with it. Nothing in the vault is touched. */
export class ErrorBoundary extends Component<
  { children: ReactNode; onReload?: () => void },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    const reload = this.props.onReload ?? (() => window.location.reload());
    return (
      <div className="shell-rail flex h-full items-center justify-center bg-shell px-6">
        <div role="alert" className="flex max-w-md flex-col items-center text-center">
          <Mark className="h-10 w-auto text-primary" />
          <h1 className="mt-4 text-balance font-display text-lg font-semibold text-text">
            This screen failed
          </h1>
          <p className="mt-2 text-pretty font-ui text-sm text-text">
            Gerfaut ran into an error it could not recover from. Reload to start the window
            again; your wallets and settings are not affected.
          </p>
          <p className="mt-2 break-words text-pretty font-ui text-xs text-muted">
            {error.message}
          </p>
          <Button variant="primary" className="mt-6" onClick={reload}>
            <RotateCcw size={15} strokeWidth={1.5} aria-hidden />
            Reload
          </Button>
        </div>
      </div>
    );
  }
}
